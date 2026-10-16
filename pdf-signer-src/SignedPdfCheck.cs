using System.Formats.Asn1;
using System.Security.Cryptography.Pkcs;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.RegularExpressions;

namespace PdfSigner;

/// <summary>
/// Independent proof that a PDF came out signed: the byte range covers the whole file, the
/// PKCS#7 verifies over exactly those bytes with the expected certificate, and a viewer starting
/// from the catalog actually finds the signature field.
/// </summary>
public static class SignedPdfCheck
{
    /// <summary>Returns a one-line summary, or throws with the first thing that is wrong.</summary>
    public static string Verify(string path, X509Certificate2 expected)
    {
        var bytes = File.ReadAllBytes(path);
        var text = Encoding.Latin1.GetString(bytes);

        var ranges = Regex.Matches(text, @"/ByteRange\s*\[\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*\]");
        if (ranges.Count != 1)
            throw new InvalidOperationException($"expected one /ByteRange, found {ranges.Count}");

        var r = ranges[0].Groups.Cast<Group>().Skip(1).Select(g => long.Parse(g.Value)).ToArray();
        if (r[0] != 0 || r[2] + r[3] != bytes.Length)
            throw new InvalidOperationException($"/ByteRange [{string.Join(' ', r)}] does not cover the {bytes.Length}-byte file");

        var hex = Encoding.Latin1.GetString(bytes, (int)r[1], (int)(r[2] - r[1])).Trim('<', '>', ' ');
        var der = Convert.FromHexString(hex);
        AsnDecoder.ReadEncodedValue(der, AsnEncodingRules.BER, out _, out _, out var length);

        var signedContent = new byte[r[1] + r[3]];
        Buffer.BlockCopy(bytes, 0, signedContent, 0, (int)r[1]);
        Buffer.BlockCopy(bytes, (int)r[2], signedContent, (int)r[1], (int)r[3]);

        var cms = new SignedCms(new ContentInfo(signedContent), detached: true);
        cms.Decode(der.AsSpan(0, length));
        cms.CheckSignature(verifySignatureOnly: true);

        var signer = cms.SignerInfos[0];
        if (signer.Certificate?.Thumbprint != expected.Thumbprint)
            throw new InvalidOperationException($"signed by {signer.Certificate?.Subject ?? "an unknown certificate"}, not {expected.Subject}");

        return $"signature valid over the whole file, {signer.DigestAlgorithm.FriendlyName ?? signer.DigestAlgorithm.Value}, " +
               $"{cms.Certificates.Count} certificate(s) embedded, {length} of the reserved bytes used, {CatalogLinks(text)}";
    }

    /// <summary>
    /// Viewers (pdfium, which is Chrome's, and pypdf among them) find a signature only through the
    /// catalog's /AcroForm. Spire's tolerant reader finds it either way, so it cannot be the judge
    /// here: read the catalog the trailer points to and look.
    /// </summary>
    private static string CatalogLinks(string text)
    {
        var roots = Regex.Matches(text, @"/Root\s+(\d+)\s+0\s+R");
        if (roots.Count == 0) throw new InvalidOperationException("no /Root in the trailer");

        var root = roots[^1].Groups[1].Value;
        var catalogs = Regex.Matches(text, $@"(?<!\d){root}\s+0\s+obj\s*<<((?:(?!endobj).)*?)>>\s*endobj", RegexOptions.Singleline);
        if (catalogs.Count == 0)
        {
            if (Regex.Matches(text, "startxref").Count > 1)
                throw new InvalidOperationException(
                    "the signature was saved as an incremental update that never rewrote the catalog, so viewers will not show it");
            return "catalog stored compressed, not inspected";
        }

        var catalog = catalogs[^1].Groups[1].Value;
        if (!catalog.Contains("/AcroForm"))
            throw new InvalidOperationException("the catalog has no /AcroForm, so viewers will not show the signature");

        return catalog.Contains("/DocMDP")
            ? "catalog links /AcroForm and /Perms /DocMDP"
            : "catalog links /AcroForm (no /Perms /DocMDP: not a certifying signature)";
    }
}
