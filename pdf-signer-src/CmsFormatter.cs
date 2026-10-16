using System.Security.Cryptography;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using Spire.Pdf.Interactive.DigitalSignatures;

namespace PdfSigner;

/// <summary>
/// Gives Spire a finished detached PKCS#7 signature, so Spire only lays out the signature field
/// and the byte range and never touches the private key.
/// </summary>
internal sealed class CmsFormatter : IPdfSignatureFormatter
{
    /// <summary>
    /// Bytes reserved for /Contents. Spire never checks that the signature fits — a longer one is
    /// written over the bytes after it — and, given no size, it signs random bytes once just to
    /// measure, which would be a second token operation for every PDF. A 2048-bit signature plus
    /// the chain is around 5 KB; this leaves room for 4096-bit keys and longer chains.
    /// </summary>
    private const uint ReservedBytes = 16384;

    private static readonly Oid Sha256 = new("2.16.840.1.101.3.4.2.1");

    private readonly IDigestSigner signer;

    public CmsFormatter(IDigestSigner signer)
    {
        this.signer = signer;

        Properties = new PdfSignatureProperties();
        Properties.SetFilter("Adobe.PPKLite");
        Properties.SetSubFilter("adbe.pkcs7.detached");
        Properties.SetSignatureLength(ReservedBytes);
    }

    public PdfSignatureProperties Properties { get; }

    public byte[] Sign(byte[] content)
    {
        var cms = new SignedCms(new ContentInfo(content), detached: true);

        using var key = new TokenRsa(signer);
        var cmsSigner = new CmsSigner(SubjectIdentifierType.IssuerAndSerialNumber, signer.Certificate, key)
        {
            DigestAlgorithm = Sha256,
            // The chain is added by hand below: asking SignedCms for it throws outright when the
            // issuing CA is missing from this machine's store.
            IncludeOption = X509IncludeOption.EndCertOnly,
        };
        var issuers = IssuerChain(signer.Certificate);
        cmsSigner.Certificates.AddRange(issuers);
        cmsSigner.SignedAttributes.Add(new Pkcs9SigningTime(DateTime.UtcNow));

        // SignedCms checks the result against the certificate's public key, so a token that
        // signed with the wrong key, or a byte-order slip, fails here rather than in a viewer.
        cms.ComputeSignature(cmsSigner, silent: false);

        var encoded = cms.Encode();
        Log.Info($"cms: {encoded.Length} of {ReservedBytes} reserved bytes, {issuers.Count} issuing CA certificate(s) embedded");
        if (encoded.Length > ReservedBytes)
            throw new InvalidOperationException(
                $"the signature is {encoded.Length} bytes but only {ReservedBytes} were reserved in the PDF");

        return encoded;
    }

    /// <summary>
    /// The issuing CAs, without the root, as far as this machine can build the chain offline.
    /// Viewers validate better with them embedded; a chain that cannot be completed just
    /// contributes what was found.
    /// </summary>
    private static X509Certificate2Collection IssuerChain(X509Certificate2 certificate)
    {
        var issuers = new X509Certificate2Collection();

        using var chain = new X509Chain();
        chain.ChainPolicy.RevocationMode = X509RevocationMode.NoCheck;
        chain.ChainPolicy.DisableCertificateDownloads = true;
        chain.ChainPolicy.VerificationFlags = X509VerificationFlags.AllFlags;

        try
        {
            chain.Build(certificate);
        }
        catch (CryptographicException)
        {
            return issuers;
        }

        foreach (var element in chain.ChainElements.Skip(1))
        {
            var selfSigned = element.Certificate.SubjectName.RawData.AsSpan()
                .SequenceEqual(element.Certificate.IssuerName.RawData);
            if (!selfSigned) issuers.Add(element.Certificate);
        }

        return issuers;
    }
}
