using System.Security.Cryptography;
using System.Security.Cryptography.X509Certificates;

namespace PdfSigner;

/// <summary>
/// Lets .NET's SignedCms assemble the PKCS#7 container while the one private-key operation in
/// it goes through <see cref="IDigestSigner"/>.
///
/// Only PKCS#1 v1.5 over SHA-256 is offered — the exact operation the token is known to accept
/// from the TRACES utility. The private half can never be exported: it never leaves the token,
/// and an export attempt is precisely what upset the driver when Spire held the key.
/// </summary>
internal sealed class TokenRsa : RSA
{
    private readonly IDigestSigner signer;
    private readonly RSA publicKey;

    public TokenRsa(IDigestSigner signer)
    {
        this.signer = signer;
        publicKey = signer.Certificate.GetRSAPublicKey()
            ?? throw new NotSupportedException("the certificate's key is not RSA");

        KeySizeValue = publicKey.KeySize;
        LegalKeySizesValue = new[] { new KeySizes(KeySizeValue, KeySizeValue, 0) };
    }

    public override byte[] SignHash(byte[] hash, HashAlgorithmName hashAlgorithm, RSASignaturePadding padding)
    {
        if (hashAlgorithm != HashAlgorithmName.SHA256 || padding != RSASignaturePadding.Pkcs1)
            throw new CryptographicException($"only SHA-256 with PKCS#1 v1.5 is signed on the token, not {hashAlgorithm.Name}/{padding}");

        return signer.SignSha256(hash);
    }

    public override bool VerifyHash(byte[] hash, byte[] signature, HashAlgorithmName hashAlgorithm, RSASignaturePadding padding) =>
        publicKey.VerifyHash(hash, signature, hashAlgorithm, padding);

    public override RSAParameters ExportParameters(bool includePrivateParameters) =>
        includePrivateParameters
            ? throw new CryptographicException("the private key stays on the token and cannot be exported")
            : publicKey.ExportParameters(false);

    public override void ImportParameters(RSAParameters parameters) =>
        throw new NotSupportedException("a token key cannot be replaced");

    protected override void Dispose(bool disposing)
    {
        if (disposing) publicKey.Dispose();
        base.Dispose(disposing);
    }
}
