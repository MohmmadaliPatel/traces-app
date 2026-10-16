using System.Diagnostics;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using Spire.Pdf;
using Spire.Pdf.Graphics;

namespace PdfSigner;

/// <summary>
/// One-command self-test for a client machine: <c>pdf-signer.exe --diagnose ["CERT NAME"] [--pin]</c>,
/// or double-click <c>diagnose.cmd</c>.
///
/// Walks the same path the app takes — certificate, key, PIN, one signature, one signed PDF —
/// and says plainly which step failed. When signing fails it also tries the other ways of reaching
/// the key, so one log shows which of them this driver accepts. Everything goes to
/// <c>pdf-signer\logs\diagnose-*.log</c>, which is the file to send back. The PIN is never logged.
/// </summary>
public static class Diagnose
{
    private const int Steps = 7;

    /// <summary>The exception behind the first failed step, if any.</summary>
    private static Exception? failedWith;

    public static int Run(string[] args)
    {
        Log.Open($"diagnose-{DateTime.Now:yyyyMMdd-HHmmss}.log");

        var wantedName = args.FirstOrDefault(a => !a.StartsWith("--", StringComparison.Ordinal));
        var askPin = args.Contains("--pin");
        string? failure = null;
        string? testPdf = null;
        X509Certificate2? certificate = null;
        TokenKey? key = null;

        try
        {
            Step(1, "environment", Environment_);
            Step(2, "certificates in the Windows store", () => ListCertificates());

            failure = Step(3, "choose the certificate", () =>
            {
                certificate = Choose(wantedName);
                Log.Info($"  -> {certificate.Subject}");
                Log.Info($"     thumbprint {certificate.Thumbprint}, valid {certificate.NotBefore:dd-MM-yyyy} to {certificate.NotAfter:dd-MM-yyyy}");
                Log.Info($"     store says: {Safe(() => TokenKey.StoredKeyInfo(certificate))}");
            });

            failure ??= Step(4, "open the private key (as the TRACES utility does)", () =>
            {
                key = TokenKey.Open(certificate!);
                Log.Info($"  -> {key.Describe()}");
                Log.Info($"     handle says: {Safe(key.HandleDetails)}");
            });

            failure ??= Step(5, "PIN", () =>
            {
                if (!askPin)
                {
                    Log.Info("  -> no --pin given: the token's own PIN dialog will appear at the next step; enter the PIN there");
                    return;
                }
                Log.Info($"  -> {key!.ApplyPin(ReadPin())}");
            });

            failure ??= Step(6, "sign a test digest on the token", () =>
            {
                var digest = SHA256.HashData(Encoding.UTF8.GetBytes($"pdf-signer diagnose {DateTime.Now:O}"));
                var signature = key!.SignSha256(digest);
                using var publicKey = certificate!.GetRSAPublicKey()
                    ?? throw new InvalidOperationException("the certificate's key is not RSA");
                if (!publicKey.VerifyHash(digest, signature, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1))
                    throw new InvalidOperationException("the token signed, but the signature does not match the certificate — wrong token plugged in?");
                Log.Info("  -> the signature verifies against the certificate");
            });

            failure ??= Step(7, "sign a test PDF exactly as the app does", () =>
            {
                testPdf = SignTestPdf(key!);
            });

            // Never after a PIN problem: every alternative may prompt again, and a token locks after
            // a few wrong attempts.
            var pinProblem = failedWith is TokenException { PinRejected: true } or TokenException { Cancelled: true }
                || failedWith?.Message.Contains("rejected the PIN") == true;
            if (failure is not null && certificate is not null && !pinProblem)
            {
                Alternatives(certificate);
            }
        }
        finally
        {
            key?.Dispose();
        }

        Log.Info("");
        if (failure is null)
        {
            Log.Info("==================== RESULT: PASS ====================");
            Log.Info("The token signed a test PDF the same way the app will. Signing in the app should work.");
            Log.Info($"Signed test PDF: {testPdf}");
        }
        else
        {
            Log.Info("==================== RESULT: FAIL ====================");
            Log.Info($"Failed at: {failure}");
        }
        Log.Info($"Log file (send this one): {Log.FilePath}");
        return failure is null ? 0 : 1;
    }

    /// <summary>Make a one-page PDF and sign it with <paramref name="signer"/> through the app's own path.</summary>
    public static string SignTestPdf(IDigestSigner signer)
    {
        var path = Path.Combine(Log.Directory, $"diagnose-{DateTime.Now:yyyyMMdd-HHmmss}.pdf");

        using (var doc = new PdfDocument())
        {
            var page = doc.Pages.Add();
            page.Canvas.DrawString(
                $"pdf-signer self-test, {DateTime.Now:dd-MM-yyyy HH:mm:ss}", new PdfFont(PdfFontFamily.Helvetica, 12f),
                PdfBrushes.Black, new PointF(40f, 40f));
            doc.SaveToFile(path);
            doc.Close();
        }

        var item = new PdfJobItem { InputPath = path, OutputPath = path, Page = 0, X = 300f, Y = 100f, Width = 261f, Height = 26.25f };
        var watch = Stopwatch.StartNew();
        SignatureWriter.Sign(item, signer, new PdfJob { Reason = "pdf-signer self-test" });
        Log.Info($"  -> signed in {Log.Took(watch)}: {path}");
        Log.Info($"  -> check: {SignedPdfCheck.Verify(path, signer.Certificate)}");
        return path;
    }

    /// <summary>Returns null when the step passed, or "step N (name): reason" when it failed.</summary>
    private static string? Step(int number, string name, Action action)
    {
        Log.Info("");
        Log.Info($"[{number}/{Steps}] {name}");
        var watch = Stopwatch.StartNew();
        try
        {
            action();
            Log.Info($"  OK ({Log.Took(watch)})");
            return null;
        }
        catch (Exception ex)
        {
            failedWith ??= ex;
            Log.Error($"step {number} ({name})", ex);
            if (ex is TokenException { Cancelled: true })
                Log.Info("  The PIN dialog was cancelled — run the test again and enter the PIN.");
            if (ex is TokenException { PinRejected: true } || ex.Message.Contains("rejected the PIN"))
                Log.Info("  Wrong PIN. Do not retry blindly: tokens lock after a few wrong attempts.");
            return $"step {number} ({name}): {ex.Message.Trim()}";
        }
    }

    private static void Environment_()
    {
        Log.Info($"  OS: {RuntimeInformation.OSDescription} ({RuntimeInformation.OSArchitecture})");
        Log.Info($"  user: {Environment.UserDomainName}\\{Environment.UserName}, session {Process.GetCurrentProcess().SessionId}, interactive {Environment.UserInteractive}");
        Log.Info($"  thread apartment: {Thread.CurrentThread.GetApartmentState()}");
        Log.Info($"  windows: {Safe(TokenKey.WindowState)}");
        Log.Info($"  signer folder: {AppContext.BaseDirectory}");
        if (Process.GetCurrentProcess().SessionId == 0)
            Log.Info("  WARNING: session 0 (a service). The token's PIN dialog cannot appear here — run this from the logged-in desktop.");
    }

    private static List<X509Certificate2> ListCertificates()
    {
        var withKeys = new List<X509Certificate2>();
        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using var store = new X509Store(StoreName.My, location);
            try
            {
                store.Open(OpenFlags.ReadOnly);
            }
            catch (Exception ex)
            {
                Log.Info($"  {location}\\My: cannot open ({ex.Message.Trim()})");
                continue;
            }

            var all = store.Certificates.OfType<X509Certificate2>().ToList();
            Log.Info($"  {location}\\My: {all.Count} certificate(s), {all.Count(c => c.HasPrivateKey)} with a private key");
            foreach (var c in all.Where(c => c.HasPrivateKey))
            {
                var expired = c.NotAfter < DateTime.Now ? " EXPIRED" : "";
                Log.Info($"   - {StampAppearance.SignerName(c)} | issuer {c.GetNameInfo(X509NameType.SimpleName, true)} | until {c.NotAfter:dd-MM-yyyy}{expired} | {c.Thumbprint}");
                Log.Info($"     {Safe(() => TokenKey.StoredKeyInfo(c))}");
                withKeys.Add(c);
            }
        }
        return withKeys;
    }

    private static X509Certificate2 Choose(string? wantedName)
    {
        if (!string.IsNullOrWhiteSpace(wantedName))
        {
            return CertificateStore.Find(wantedName)
                ?? throw new InvalidOperationException($"no certificate with a private key matches \"{wantedName}\"");
        }

        var candidates = ListCertificatesQuietly().Where(c => c.NotAfter >= DateTime.Now).ToList();
        if (candidates.Count == 1) return candidates[0];
        if (candidates.Count == 0)
            throw new InvalidOperationException("no unexpired certificate with a private key — is the token plugged in and its driver installed?");

        if (!Environment.UserInteractive || Console.IsInputRedirected)
            throw new InvalidOperationException($"{candidates.Count} certificates found; pass the name, e.g. diagnose.cmd \"{StampAppearance.SignerName(candidates[0])}\"");

        for (var i = 0; i < candidates.Count; i++)
            Console.Error.WriteLine($"   {i + 1}. {StampAppearance.SignerName(candidates[i])} (until {candidates[i].NotAfter:dd-MM-yyyy})");
        Console.Error.Write("  Which certificate? Type its number and press Enter: ");
        var answer = Console.ReadLine();
        if (int.TryParse(answer, out var n) && n >= 1 && n <= candidates.Count) return candidates[n - 1];
        throw new InvalidOperationException($"no certificate chosen (answer \"{answer}\")");
    }

    private static List<X509Certificate2> ListCertificatesQuietly()
    {
        var found = new List<X509Certificate2>();
        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using var store = new X509Store(StoreName.My, location);
            try
            {
                store.Open(OpenFlags.ReadOnly);
                found.AddRange(store.Certificates.OfType<X509Certificate2>().Where(c => c.HasPrivateKey));
            }
            catch
            {
                /* already reported in step 2 */
            }
        }
        return found;
    }

    /// <summary>
    /// After a failure, try the other ways of reaching the key, so one log shows which of them this
    /// driver accepts. Each may raise its own PIN dialog.
    /// </summary>
    private static void Alternatives(X509Certificate2 certificate)
    {
        Log.Info("");
        Log.Info("[extra] other ways of reaching the key, for comparison (each may ask for the PIN again)");
        var digest = SHA256.HashData(Encoding.UTF8.GetBytes("pdf-signer diagnose alternative"));

        Try("legacy CSP handle (CryptAcquireCertificatePrivateKey 0x10000)", () =>
        {
            using var csp = TokenKey.OpenWith(certificate, TokenKey.ACQUIRE_ALLOW_CSP);
            Log.Info($"    {csp.Describe()}; {Safe(csp.HandleDetails)}");
            csp.SignSha256(digest);
        });

        Try(".NET GetRSAPrivateKey().SignHash (the call Spire's fallback made)", () =>
        {
            using var rsa = certificate.GetRSAPrivateKey() ?? throw new InvalidOperationException("no RSA private key");
            Log.Info($"    .NET key type {rsa.GetType().Name}");
            rsa.SignHash(digest, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
        });

        Try(".NET RSA.ExportParameters(true) (what Spire tried first; expected to fail on a token)", () =>
        {
            using var rsa = certificate.GetRSAPrivateKey() ?? throw new InvalidOperationException("no RSA private key");
            rsa.ExportParameters(true);
        });
    }

    private static void Try(string name, Action action)
    {
        var watch = Stopwatch.StartNew();
        try
        {
            action();
            Log.Info($"  - {name}: OK ({Log.Took(watch)})");
        }
        catch (Exception ex)
        {
            Log.Info($"  - {name}: FAILED 0x{ex.HResult:X8} {ex.GetType().Name}: {ex.Message.Trim()} ({Log.Took(watch)})");
        }
    }

    private static string ReadPin()
    {
        if (Console.IsInputRedirected)
            throw new InvalidOperationException("--pin needs an interactive console");

        Console.Error.Write("  Token PIN (not shown, never logged), then Enter: ");
        var pin = new StringBuilder();
        while (true)
        {
            var k = Console.ReadKey(intercept: true);
            if (k.Key == ConsoleKey.Enter) break;
            if (k.Key == ConsoleKey.Backspace)
            {
                if (pin.Length > 0) pin.Length--;
                continue;
            }
            if (!char.IsControl(k.KeyChar)) pin.Append(k.KeyChar);
        }
        Console.Error.WriteLine();
        return pin.ToString();
    }

    private static string Safe(Func<string> describe)
    {
        try
        {
            return describe();
        }
        catch (Exception ex)
        {
            return $"(unavailable: {ex.GetType().Name} {ex.Message.Trim()})";
        }
    }
}
