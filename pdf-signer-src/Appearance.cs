using System.Security.Cryptography.X509Certificates;
using Spire.Pdf.Graphics;
using Spire.Pdf.Security;

namespace PdfSigner;

/// <summary>
/// What the visible stamp looks like inside the signature cell.
///
/// Spire draws nothing at all unless the appearance is configured — a signature with default
/// settings produces an empty appearance stream, which is a valid signature that simply cannot
/// be seen. The certificate has to *look* signed to whoever opens it, so the stamp carries the
/// signer's name and the signing time in the form's own typeface.
/// </summary>
public static class Appearance
{
    /// <summary>
    /// Fit the stamp to the cell. The signature cell in Form 16A / 131 is short — around 26pt —
    /// so the text is sized to fit two lines inside whatever box the generator measured, rather
    /// than a fixed size that would overflow into the ruled lines around it.
    /// </summary>
    public static void Apply(PdfSignature signature, X509Certificate2 certificate, PdfJob job, float boxHeight)
    {
        var signer = SignerName(certificate);

        signature.GraphicsMode = GraphicMode.SignDetail;
        signature.SignTextAlignment = SignTextAlignment.Center;
        signature.DigitalSigner = signer;
        signature.Date = DateTime.Now;

        // Two lines of text with a little breathing room, clamped to a legible range.
        var fontSize = Math.Clamp((boxHeight - 6f) / 2f, 5f, 8f);
        signature.SignDetailsFont = new PdfFont(PdfFontFamily.TimesRoman, fontSize);

        // Spire concatenates label and value with no separator of its own.
        signature.NameLabel = "Digitally signed by ";
        signature.DateLabel = "Date: ";

        // Spire renders exactly the details that are set — nothing else is needed to make the
        // stamp appear, and the older ShowConfiguerText flags are deprecated.
        if (!string.IsNullOrWhiteSpace(job.Reason))
        {
            signature.Reason = job.Reason;
            signature.ReasonLabel = "Reason: ";
        }

        if (!string.IsNullOrWhiteSpace(job.Location))
        {
            signature.LocationInfo = job.Location;
            signature.LocationInfoLabel = "Location: ";
        }
    }

    private static string SignerName(X509Certificate2 certificate)
    {
        var cn = certificate.GetNameInfo(X509NameType.SimpleName, false);
        return string.IsNullOrWhiteSpace(cn) ? certificate.Subject : cn;
    }
}
