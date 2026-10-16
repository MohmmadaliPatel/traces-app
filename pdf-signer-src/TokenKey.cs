using System.ComponentModel;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace PdfSigner;

/// <summary>Anything that can sign a SHA-256 digest with a certificate's private key.</summary>
public interface IDigestSigner
{
    X509Certificate2 Certificate { get; }

    /// <summary>PKCS#1 v1.5 signature over a 32-byte SHA-256 digest, big-endian.</summary>
    byte[] SignSha256(byte[] digest);
}

/// <summary>A failed call into the token's crypto provider, with the HRESULT it returned.</summary>
public sealed class TokenException : Exception
{
    public TokenException(string step, int code)
        : base(Describe(step, code))
    {
        HResult = code;
    }

    public bool PinRejected => HResult is TokenKey.SCARD_W_WRONG_CHV or TokenKey.SCARD_W_CHV_BLOCKED;

    public bool Cancelled => HResult is TokenKey.NTE_USER_CANCELLED or TokenKey.SCARD_W_CANCELLED_BY_USER;

    private static string Describe(string step, int code)
    {
        var text = code switch
        {
            TokenKey.NTE_USER_CANCELLED or TokenKey.SCARD_W_CANCELLED_BY_USER =>
                "the PIN dialog was cancelled",
            _ => new Win32Exception(code).Message.Trim(),
        };
        return $"{step} failed (0x{code:X8}): {text}";
    }
}

/// <summary>
/// The certificate's private key, opened and used exactly the way the TRACES PDF Utility does.
///
/// Spire is no longer allowed near the key. Its own signer first tries to export the private key
/// and sign in software, then signs through fresh .NET key handles with no parent window — and
/// the HyperPKI HYP2003 driver answers that with a bare NTE_FAIL ("An internal error occurred.")
/// on a token the utility signs with perfectly well. So this class repeats the utility's calls
/// one for one (from its certificate_handler_plugin_plugin.dll):
///
///   * CryptAcquireCertificatePrivateKey with ALLOW|ONLY_NCRYPT|COMPARE_KEY (0x50004), then
///     without COMPARE_KEY (0x50000), each retried once if the provider reports a silent context;
///   * our window is handed to the provider as the parent of its PIN dialog ("HWND Handle", or
///     PP_CLIENT_HWND on a legacy CSP handle);
///   * a single SHA-256 digest is signed with PKCS#1 v1.5 — NCryptSignHash(BCRYPT_PAD_PKCS1,
///     "SHA256"), or CryptCreateHash(CALG_SHA_256) + HP_HASHVAL + CryptSignHash on a CSP handle —
///     and a silent-context failure re-acquires the key and tries once more;
///   * the handle stays open for the life of the process, so the token session, and the PIN the
///     operator typed into it, is reused for every later PDF.
///
/// The one addition is a last-resort CSP acquisition (0x10000) for a driver with no CNG side at
/// all; it only runs where the utility's own flags have already failed.
/// </summary>
public sealed class TokenKey : IDigestSigner, IDisposable
{
    // CryptAcquireCertificatePrivateKey flags, as the utility passes them.
    public const uint ACQUIRE_UTILITY_PRIMARY = 0x50004; // ALLOW_NCRYPT | ONLY_NCRYPT | COMPARE_KEY
    public const uint ACQUIRE_UTILITY_FALLBACK = 0x50000; // ALLOW_NCRYPT | ONLY_NCRYPT
    public const uint ACQUIRE_ALLOW_CSP = 0x10000; // ALLOW_NCRYPT: hands back a CSP handle for CAPI-only keys

    private static readonly uint[] DefaultOrder = { ACQUIRE_UTILITY_PRIMARY, ACQUIRE_UTILITY_FALLBACK, ACQUIRE_ALLOW_CSP };

    private const uint CERT_NCRYPT_KEY_SPEC = 0xFFFFFFFF;
    private const uint AT_KEYEXCHANGE = 1;

    private const int BCRYPT_PAD_PKCS1 = 2;
    private const uint CALG_SHA_256 = 0x800C;
    private const uint HP_HASHVAL = 2;
    private const uint PP_CLIENT_HWND = 1;
    private const uint PP_IMPTYPE = 3;
    private const uint PP_NAME = 4;
    private const uint PP_CONTAINER = 6;
    private const uint CERT_KEY_PROV_INFO_PROP_ID = 2;
    private const uint PP_KEYEXCHANGE_PIN = 32;
    private const uint PP_SIGNATURE_PIN = 33;

    internal const int NTE_SILENT_CONTEXT = unchecked((int)0x80090022);
    internal const int NTE_USER_CANCELLED = unchecked((int)0x80090036);
    internal const int SCARD_W_WRONG_CHV = unchecked((int)0x8010006B);
    internal const int SCARD_W_CHV_BLOCKED = unchecked((int)0x8010006C);
    internal const int SCARD_W_CANCELLED_BY_USER = unchecked((int)0x8010006E);

    private readonly uint[] acquireOrder;
    private IntPtr handle;
    private uint keySpec;
    private bool callerFrees;
    private uint acquiredWith;
    private string? pin;

    private TokenKey(X509Certificate2 certificate, uint[] acquireOrder)
    {
        Certificate = certificate;
        this.acquireOrder = acquireOrder;
    }

    public X509Certificate2 Certificate { get; }

    private bool IsCng => keySpec == CERT_NCRYPT_KEY_SPEC;

    private string Kind => IsCng ? "CNG" : $"CSP (key spec {keySpec})";

    /// <summary>Open the certificate's private key. Does not sign, so it never prompts.</summary>
    public static TokenKey Open(X509Certificate2 certificate) => OpenWith(certificate, DefaultOrder);

    /// <summary>Open the key trying only <paramref name="flags"/>, in order — for the self-test.</summary>
    public static TokenKey OpenWith(X509Certificate2 certificate, params uint[] flags)
    {
        var key = new TokenKey(certificate, flags);
        key.Acquire();
        return key;
    }

    /// <summary>A short line for the log: which kind of handle was opened, and how.</summary>
    public string Describe() => $"{Kind} handle, acquired with 0x{acquiredWith:X}";

    /// <summary>
    /// Hand the PIN to the provider and prove it with one throwaway signature, so a wrong PIN
    /// fails now rather than as a dialog halfway through an unattended batch.
    ///
    /// Returns a status line. A provider that will not take a PIN this way is not an error: the
    /// driver then prompts, exactly as it does for the utility. A PIN the token rejects is never
    /// retried — tokens lock after a few wrong attempts.
    /// </summary>
    public string ApplyPin(string value)
    {
        pin = value;
        var status = PushPin();
        if (status is not null)
        {
            pin = null;
            Log.Info($"pin: the driver would not take it programmatically ({status})");
            return $"not accepted by this driver ({status}); its own dialog will ask for the PIN";
        }

        Log.Info($"pin: pushed into the {Kind} handle; checking it with one throwaway signature");

        try
        {
            SignSha256(SHA256.HashData(Encoding.UTF8.GetBytes("pdf-signer pin check")));
        }
        catch (TokenException ex) when (ex.PinRejected)
        {
            pin = null;
            throw new InvalidOperationException(
                $"the token rejected the PIN ({ex.Message}). Tokens lock after a few wrong attempts — check the PIN before retrying.");
        }

        return $"accepted ({(IsCng ? "CNG" : "CSP")})";
    }

    public byte[] SignSha256(byte[] digest)
    {
        if (digest.Length != 32)
            throw new ArgumentException("expected a 32-byte SHA-256 digest", nameof(digest));

        try
        {
            return SignOnce(digest);
        }
        catch (TokenException ex) when (ex.HResult == NTE_SILENT_CONTEXT)
        {
            // What the utility does: the handle was opened silently, so open it again and let the
            // provider show its dialog this time.
            Log.Info("sign: the provider reported a silent context; re-opening the key and retrying with its dialog allowed");
            Acquire();
            if (pin is not null) PushPin();
            return SignOnce(digest);
        }
    }

    public void Dispose()
    {
        Release();
    }

    private byte[] SignOnce(byte[] digest)
    {
        var watch = Stopwatch.StartNew();
        try
        {
            var signature = IsCng ? SignCng(digest) : SignCsp(digest);
            Log.Info($"sign: {(IsCng ? "NCryptSignHash" : "CryptSignHash")} ok, {signature.Length}-byte signature in {Log.Took(watch)}");
            return signature;
        }
        catch (TokenException ex)
        {
            Log.Info($"sign: {ex.Message} after {Log.Took(watch)}");
            throw;
        }
    }

    private byte[] SignCng(byte[] digest)
    {
        var padding = new BCRYPT_PKCS1_PADDING_INFO { pszAlgId = "SHA256" };

        var status = NCryptSignHash(handle, ref padding, digest, digest.Length, null, 0, out var size, BCRYPT_PAD_PKCS1);
        if (status != 0) throw new TokenException("NCryptSignHash (size)", status);

        var signature = new byte[size];
        status = NCryptSignHash(handle, ref padding, digest, digest.Length, signature, signature.Length, out size, BCRYPT_PAD_PKCS1);
        if (status != 0) throw new TokenException("NCryptSignHash", status);

        return signature.AsSpan(0, size).ToArray();
    }

    private byte[] SignCsp(byte[] digest)
    {
        if (!CryptCreateHash(handle, CALG_SHA_256, IntPtr.Zero, 0, out var hash))
            throw new TokenException("CryptCreateHash", Marshal.GetLastPInvokeError());

        try
        {
            if (!CryptSetHashParam(hash, HP_HASHVAL, digest, 0))
                throw new TokenException("CryptSetHashParam(HP_HASHVAL)", Marshal.GetLastPInvokeError());

            var size = 0;
            if (!CryptSignHash(hash, keySpec, null, 0, null, ref size))
                throw new TokenException("CryptSignHash (size)", Marshal.GetLastPInvokeError());

            var signature = new byte[size];
            if (!CryptSignHash(hash, keySpec, null, 0, signature, ref size))
                throw new TokenException("CryptSignHash", Marshal.GetLastPInvokeError());

            // CryptoAPI hands signatures back little-endian; PKCS#1 and CMS are big-endian.
            var result = signature.AsSpan(0, size).ToArray();
            Array.Reverse(result);
            return result;
        }
        finally
        {
            CryptDestroyHash(hash);
        }
    }

    private void Acquire()
    {
        Release();

        var failures = new List<string>();
        foreach (var flags in acquireOrder)
        {
            var code = TryAcquire(flags);
            if (code == 0)
            {
                acquiredWith = flags;
                Log.Info($"key: acquired with 0x{flags:X} -> {Kind} handle (caller frees: {callerFrees})");
                AttachWindow();
                return;
            }

            var reason = $"0x{code:X8} {new Win32Exception(code).Message.Trim()}";
            Log.Info($"key: acquire with 0x{flags:X} failed: {reason}");
            failures.Add($"0x{flags:X}: {reason}");
        }

        throw new CryptographicException(
            $"could not open the private key of \"{Certificate.Subject}\" ({string.Join("; ", failures)})");
    }

    private int TryAcquire(uint flags)
    {
        for (var attempt = 0; attempt < 2; attempt++)
        {
            if (CryptAcquireCertificatePrivateKey(Certificate.Handle, flags, IntPtr.Zero, out var key, out var spec, out var free))
            {
                handle = key;
                keySpec = spec;
                callerFrees = free;
                return 0;
            }

            var code = Marshal.GetLastPInvokeError();
            if (code != NTE_SILENT_CONTEXT) return code;
            Log.Info($"key: acquire with 0x{flags:X} reported a silent context; retrying once");
        }

        return NTE_SILENT_CONTEXT;
    }

    /// <summary>
    /// Parent the provider's PIN dialog to our console window when it is on screen, otherwise to
    /// whatever window is in front — the utility does the same with its own window. Best effort:
    /// a provider that ignores it just shows an unparented dialog.
    /// </summary>
    private void AttachWindow()
    {
        var source = "console window";
        var window = GetConsoleWindow();
        if (window == IntPtr.Zero || !IsWindow(window) || !IsWindowVisible(window))
        {
            source = "foreground window";
            window = GetForegroundWindow();
        }
        if (window == IntPtr.Zero)
        {
            Log.Info("key: no window to parent the PIN dialog to; the driver will show it unparented");
            return;
        }

        var value = BitConverter.GetBytes(window.ToInt64());
        int status;
        if (IsCng)
        {
            status = NCryptSetProperty(handle, "HWND Handle", value, value.Length, 0);
        }
        else
        {
            status = CryptSetProvParam(handle, PP_CLIENT_HWND, value, 0) ? 0 : Marshal.GetLastPInvokeError();
        }

        Log.Info($"key: PIN-dialog parent = {source} 0x{window.ToInt64():X}" +
                 (status == 0 ? "" : $" (provider refused it: 0x{status:X8}, harmless)"));
    }

    /// <summary>Push the PIN into the open handle. Returns null on success, the reason otherwise.</summary>
    private string? PushPin()
    {
        if (pin is null) return null;

        if (IsCng)
        {
            // NCRYPT_PIN_PROPERTY takes a null-terminated UTF-16 string.
            var bytes = Encoding.Unicode.GetBytes(pin + "\0");
            try
            {
                var status = NCryptSetProperty(handle, "SmartCardPin", bytes, bytes.Length, 0);
                return status == 0 ? null : $"0x{status:X8} {new Win32Exception(status).Message.Trim()}";
            }
            finally
            {
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
        else
        {
            // The CSP PIN parameters take a null-terminated ANSI string.
            var bytes = Encoding.ASCII.GetBytes(pin + "\0");
            try
            {
                var param = keySpec == AT_KEYEXCHANGE ? PP_KEYEXCHANGE_PIN : PP_SIGNATURE_PIN;
                if (CryptSetProvParam(handle, param, bytes, 0)) return null;
                var code = Marshal.GetLastPInvokeError();
                return $"0x{code:X8} {new Win32Exception(code).Message.Trim()}";
            }
            finally
            {
                CryptographicOperations.ZeroMemory(bytes);
            }
        }
    }

    /// <summary>Which windows a PIN dialog could be parented to, for the self-test.</summary>
    public static string WindowState()
    {
        var console = GetConsoleWindow();
        var foreground = GetForegroundWindow();
        var consoleState = console == IntPtr.Zero ? "none" : IsWindowVisible(console) ? "visible" : "hidden";
        return $"console window {consoleState}, foreground window {(foreground == IntPtr.Zero ? "none" : "present")}";
    }

    /// <summary>
    /// Which provider and container the certificate's key lives in, as recorded in the store
    /// (CERT_KEY_PROV_INFO) — the same facts certutil prints as "Provider" and "Key Container".
    /// </summary>
    public static string StoredKeyInfo(X509Certificate2 certificate)
    {
        uint size = 0;
        if (!CertGetCertificateContextProperty(certificate.Handle, CERT_KEY_PROV_INFO_PROP_ID, IntPtr.Zero, ref size))
            return $"no key provider info (0x{Marshal.GetLastPInvokeError():X8})";

        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            if (!CertGetCertificateContextProperty(certificate.Handle, CERT_KEY_PROV_INFO_PROP_ID, buffer, ref size))
                return $"no key provider info (0x{Marshal.GetLastPInvokeError():X8})";

            var info = Marshal.PtrToStructure<CRYPT_KEY_PROV_INFO>(buffer);
            var kind = info.dwProvType == 0 ? "CNG key storage provider" : $"CSP type {info.dwProvType}";
            return $"provider \"{Marshal.PtrToStringUni(info.pwszProvName)}\" ({kind}), " +
                   $"container \"{Marshal.PtrToStringUni(info.pwszContainerName)}\", key spec {info.dwKeySpec}, flags 0x{info.dwFlags:X}";
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    /// <summary>What the open handle reports about itself. Read-only; never prompts.</summary>
    public string HandleDetails()
    {
        if (IsCng)
        {
            var provider = "?";
            var provHandle = NCryptGetBytes(handle, "Provider Handle");
            if (provHandle is { Length: >= 8 })
            {
                var prov = new IntPtr(BitConverter.ToInt64(provHandle, 0));
                provider = NCryptGetString(prov, "Name") ?? "?";
                NCryptFreeObject(prov);
            }

            var exportPolicy = NCryptGetBytes(handle, "Export Policy");
            return $"CNG provider \"{provider}\", algorithm {NCryptGetString(handle, "Algorithm Name") ?? "?"}, " +
                   $"{(NCryptGetBytes(handle, "Length") is { Length: >= 4 } len ? BitConverter.ToInt32(len, 0) : 0)} bits, " +
                   $"key name \"{NCryptGetString(handle, "Name") ?? "?"}\", " +
                   $"export policy 0x{(exportPolicy is { Length: >= 4 } ? BitConverter.ToInt32(exportPolicy, 0) : -1):X}";
        }

        var impType = CspGetBytes(handle, PP_IMPTYPE);
        return $"CSP \"{CspGetString(handle, PP_NAME) ?? "?"}\", container \"{CspGetString(handle, PP_CONTAINER) ?? "?"}\", " +
               $"implementation {(impType is { Length: >= 4 } ? BitConverter.ToInt32(impType, 0) : -1)} (1 hardware, 2 software, 8 removable)";
    }

    private static byte[]? NCryptGetBytes(IntPtr obj, string property)
    {
        if (NCryptGetProperty(obj, property, null, 0, out var size, 0) != 0 || size <= 0) return null;
        var buffer = new byte[size];
        return NCryptGetProperty(obj, property, buffer, buffer.Length, out size, 0) == 0 ? buffer.AsSpan(0, size).ToArray() : null;
    }

    private static string? NCryptGetString(IntPtr obj, string property) =>
        NCryptGetBytes(obj, property) is { } bytes ? Encoding.Unicode.GetString(bytes).TrimEnd('\0') : null;

    private static byte[]? CspGetBytes(IntPtr prov, uint param)
    {
        var size = 0;
        if (!CryptGetProvParam(prov, param, null, ref size, 0) || size <= 0) return null;
        var buffer = new byte[size];
        return CryptGetProvParam(prov, param, buffer, ref size, 0) ? buffer.AsSpan(0, size).ToArray() : null;
    }

    private static string? CspGetString(IntPtr prov, uint param) =>
        CspGetBytes(prov, param) is { } bytes ? Encoding.ASCII.GetString(bytes).TrimEnd('\0') : null;

    private void Release()
    {
        if (handle != IntPtr.Zero && callerFrees)
        {
            if (IsCng)
                NCryptFreeObject(handle);
            else
                CryptReleaseContext(handle, 0);
        }

        handle = IntPtr.Zero;
        callerFrees = false;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct CRYPT_KEY_PROV_INFO
    {
        public IntPtr pwszContainerName;
        public IntPtr pwszProvName;
        public uint dwProvType;
        public uint dwFlags;
        public uint cProvParam;
        public IntPtr rgProvParam;
        public uint dwKeySpec;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct BCRYPT_PKCS1_PADDING_INFO
    {
        [MarshalAs(UnmanagedType.LPWStr)]
        public string pszAlgId;
    }

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptAcquireCertificatePrivateKey(
        IntPtr pCert, uint dwFlags, IntPtr pvParameters,
        out IntPtr phCryptProvOrNCryptKey, out uint pdwKeySpec,
        [MarshalAs(UnmanagedType.Bool)] out bool pfCallerFreeProvOrNCryptKey);

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode)]
    private static extern int NCryptSetProperty(IntPtr hObject, string pszProperty, byte[] pbInput, int cbInput, int dwFlags);

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode)]
    private static extern int NCryptSignHash(
        IntPtr hKey, ref BCRYPT_PKCS1_PADDING_INFO pPaddingInfo,
        byte[] pbHashValue, int cbHashValue,
        byte[]? pbSignature, int cbSignature, out int pcbResult, int dwFlags);

    [DllImport("ncrypt.dll")]
    private static extern int NCryptFreeObject(IntPtr hObject);

    [DllImport("ncrypt.dll", CharSet = CharSet.Unicode)]
    private static extern int NCryptGetProperty(IntPtr hObject, string pszProperty, byte[]? pbOutput, int cbOutput, out int pcbResult, int dwFlags);

    [DllImport("crypt32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CertGetCertificateContextProperty(IntPtr pCertContext, uint dwPropId, IntPtr pvData, ref uint pcbData);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptGetProvParam(IntPtr hProv, uint dwParam, byte[]? pbData, ref int pdwDataLen, uint dwFlags);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptSetProvParam(IntPtr hProv, uint dwParam, byte[] pbData, uint dwFlags);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptCreateHash(IntPtr hProv, uint algId, IntPtr hKey, uint dwFlags, out IntPtr phHash);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptSetHashParam(IntPtr hHash, uint dwParam, byte[] pbData, uint dwFlags);

    [DllImport("advapi32.dll", SetLastError = true, EntryPoint = "CryptSignHashW", CharSet = CharSet.Unicode)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptSignHash(
        IntPtr hHash, uint dwKeySpec, string? szDescription, uint dwFlags, byte[]? pbSignature, ref int pdwSigLen);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptDestroyHash(IntPtr hHash);

    [DllImport("advapi32.dll", SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CryptReleaseContext(IntPtr hProv, uint dwFlags);

    [DllImport("kernel32.dll")]
    private static extern IntPtr GetConsoleWindow();

    [DllImport("user32.dll")]
    private static extern IntPtr GetForegroundWindow();

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindow(IntPtr hWnd);

    [DllImport("user32.dll")]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool IsWindowVisible(IntPtr hWnd);
}
