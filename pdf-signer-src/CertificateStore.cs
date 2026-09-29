using System.Security.Cryptography.X509Certificates;

namespace PdfSigner;

/// <summary>
/// Resolving a certificate by the name the operator picked in the UI.
/// </summary>
public static class CertificateStore
{
    /// <summary>
    /// Look the certificate up in the user's store first, then the machine store.
    ///
    /// Matching is deliberately forgiving because the name reaches us from a dropdown, an env
    /// var, or a hand-edited JSON map: an exact thumbprint wins, then an exact CN, then a
    /// case-insensitive substring of the subject. Only certificates with a usable private key
    /// are considered — a public certificate cannot sign, and picking one would surface as a
    /// confusing failure much later.
    /// </summary>
    public static X509Certificate2? Find(string name)
    {
        var wanted = name.Trim();

        foreach (var location in new[] { StoreLocation.CurrentUser, StoreLocation.LocalMachine })
        {
            using var store = new X509Store(StoreName.My, location);
            try
            {
                store.Open(OpenFlags.ReadOnly);
            }
            catch
            {
                continue;
            }

            var candidates = store.Certificates
                .OfType<X509Certificate2>()
                .Where(c => c.HasPrivateKey)
                .ToList();

            var match =
                candidates.FirstOrDefault(c => string.Equals(c.Thumbprint, wanted, StringComparison.OrdinalIgnoreCase))
                ?? candidates.FirstOrDefault(c => string.Equals(CommonName(c), wanted, StringComparison.OrdinalIgnoreCase))
                ?? candidates.FirstOrDefault(c => c.Subject.Contains(wanted, StringComparison.OrdinalIgnoreCase));

            if (match is not null) return match;
        }

        return null;
    }

    private static string CommonName(X509Certificate2 certificate)
    {
        var cn = certificate.GetNameInfo(X509NameType.SimpleName, false);
        return string.IsNullOrWhiteSpace(cn) ? certificate.Subject : cn;
    }
}
