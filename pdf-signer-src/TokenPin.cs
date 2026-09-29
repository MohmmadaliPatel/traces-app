using System.Security;
using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;
using System.Text;

namespace PdfSigner;

/// <summary>
/// Pushing the token PIN into the private key so a batch does not stop on the driver's dialog.
///
/// A DSC's private key never leaves the token: the PIN is consumed by the token's own crypto
/// provider, not by us. What we can do is hand the PIN to the provider through the key handle
/// before Spire asks it to sign — CNG exposes NCRYPT_PIN_PROPERTY, legacy CSP exposes a key
/// password on the container.
///
/// The subtlety that matters: NCRYPT_PIN_PROPERTY attaches the PIN to the **key object behind
/// the handle we hold**, not to the certificate. If the signing library then calls
/// GetRSAPrivateKey() on the original certificate, NCryptOpenKey hands it a brand-new key
/// object with no PIN on it and the driver prompts — even though our PIN was perfectly valid.
/// That is why this returns a certificate bound to the handle we just unlocked, and the caller
/// signs with that one. CopyWithPrivateKey exports nothing (it cannot — the key lives on the
/// token); it only associates the already-unlocked handle with the certificate.
///
/// The throwaway signature stays: it validates the PIN immediately, so a wrong PIN becomes a
/// clear error now rather than a dialog nobody is watching halfway through a batch.
/// </summary>
public static class TokenPin
{
    /// <summary>NCRYPT_PIN_PROPERTY — the CNG property name for a smart-card PIN.
    private const string PinProperty = "SmartCardPin";

    /// <summary>
    /// Unlocked key handles, kept open for the life of the process.
    ///
    /// Belt and braces: most token providers keep the card session logged in for as long as any
    /// key handle on it stays open, so holding this reference suppresses further prompts even if
    /// the signing library ignores the certificate we hand back and opens its own handle. Letting
    /// the handle be collected would close the session and invite a fresh dialog.
    /// 
    private static readonly List<IDisposable> UnlockedKeys = new();

    /// <summary>
    /// Unlock the certificate's private key with <paramref name="pin"/> and return the
    /// certificate to sign with: a copy bound to the unlocked key where that is possible, or
    /// the original otherwise. <paramref name="status"/> carries a short line for the log.
    ///
    /// Never throws for an unsupported provider — the run continues and the driver prompts,
    /// exactly as it did before PINs were supported.
    /// </summary>
    public static X509Certificate2 Apply(X509Certificate2 certificate, string pin, out string status)
    {
        try
        {
            // Deliberately not disposed on the success paths: the returned certificate keeps
            // using this handle, and disposing it would close the key under the signer's feet.
            var rsa = certificate.GetRSAPrivateKey();

            if (rsa is RSACng cng)
            {
                // The provider expects a null-terminated Unicode string.
                cng.Key.SetProperty(new CngProperty(PinProperty, PinBytes(pin), CngPropertyOptions.None));
                Warm(cng);
                UnlockedKeys.Add(cng);
                return Bind(certificate, cng, "CNG", out status);
            }

            if (rsa is RSACryptoServiceProvider csp)
            {
                var withPin = OpenCspWithPin(csp, pin);
                Warm(withPin);
                UnlockedKeys.Add(withPin);
                return Bind(certificate, withPin, "CSP", out status);
            }

            rsa?.Dispose();

            var ecdsa = certificate.GetECDsaPrivateKey();
            if (ecdsa is ECDsaCng ecCng)
            {
                ecCng.Key.SetProperty(new CngProperty(PinProperty, PinBytes(pin), CngPropertyOptions.None));
                ecCng.SignData(new byte[] { 0x01 }, HashAlgorithmName.SHA256);
                UnlockedKeys.Add(ecCng);

                try
                {
                    var bound = PublicOnly(certificate).CopyWithPrivateKey(ecCng);
                    status = "accepted (CNG/ECDsa)";
                    return bound;
                }
                catch (Exception ex)
                {
                    status = $"accepted (CNG/ECDsa) but could not be bound ({ex.Message.Trim()}); the driver may prompt";
                    return certificate;
                }
            }

            ecdsa?.Dispose();

            status = "not supported by this provider; the driver will prompt";
            return certificate;
        }
        catch (CryptographicException ex)
        {
            // Almost always a wrong PIN. Say so plainly and let the caller stop: tokens lock
            // after a handful of wrong attempts, so retrying automatically would be harmful.
            throw new InvalidOperationException(
                $"the token rejected the PIN ({ex.Message.Trim()}). Tokens lock after a few wrong attempts — check the PIN before retrying.");
        }
        catch (Exception ex)
        {
            status = $"could not be applied ({ex.Message.Trim()}); the driver will prompt";
            return certificate;
        }
    }

    private static byte[] PinBytes(string pin) => Encoding.Unicode.GetBytes(pin + "\0");

    /// <summary>
    /// A copy of the certificate carrying only its public part.
    ///
    /// CopyWithPrivateKey refuses a certificate that already has a key associated ("The
    /// certificate already has an associated private key") — and one loaded from the Windows
    /// store always does. Re-loading the raw bytes gives an unencumbered certificate that the
    /// unlocked handle can then be attached to. Nothing is exported: RawData is the public
    /// certificate, and the private key stays on the token throughout.
    /// </summary>
    private static X509Certificate2 PublicOnly(X509Certificate2 certificate) =>
        X509CertificateLoader.LoadCertificate(certificate.RawData);

    /// <summary>
    /// Bind the unlocked key to the certificate, so the signer uses *this* handle instead of
    /// opening a fresh, still-locked one. If the provider refuses, fall back to the original
    /// certificate and say so — signing still works, it just prompts.
    /// </summary>
    private static X509Certificate2 Bind(X509Certificate2 certificate, RSA key, string kind, out string status)
    {
        try
        {
            var bound = PublicOnly(certificate).CopyWithPrivateKey(key);
            status = $"accepted ({kind})";
            return bound;
        }
        catch (Exception ex)
        {
            status = $"accepted ({kind}) but could not be bound ({ex.Message.Trim()}); the driver may prompt";
            return certificate;
        }
    }

    /// <summary>
    /// Re-open a legacy CSP container with the PIN attached, suppressing the provider's dialog
    /// so a wrong PIN fails instead of silently waiting for a human.
    /// </summary>
    private static RSACryptoServiceProvider OpenCspWithPin(RSACryptoServiceProvider csp, string pin)
    {
        var secure = new SecureString();
        foreach (var ch in pin) secure.AppendChar(ch);
        secure.MakeReadOnly();

        var info = csp.CspKeyContainerInfo;
        var parameters = new CspParameters(info.ProviderType, info.ProviderName, info.KeyContainerName)
        {
            Flags = CspProviderFlags.UseExistingKey | CspProviderFlags.NoPrompt,
            KeyPassword = secure
        };

        return new RSACryptoServiceProvider(parameters);
    }

    /// <summary>One tiny signature, purely to make the token validate and cache the PIN.</summary>
    private static void Warm(RSA rsa)
    {
        rsa.SignData(new byte[] { 0x01 }, HashAlgorithmName.SHA256, RSASignaturePadding.Pkcs1);
    }
}
