using System.Drawing;
using System.Security.Cryptography.X509Certificates;
using Spire.Pdf.Graphics;
using Spire.Pdf.Interactive.DigitalSignatures;

namespace PdfSigner;

/// <summary>
/// What the visible stamp looks like inside the signature cell.
///
/// The stamp is drawn here rather than by Spire's stock appearance, because that one has no
/// font size: the signature cell in Form 16A / 131 is short — around 26pt — and the text has to
/// fit inside whatever box the generator measured instead of spilling into the ruled lines
/// around it. It carries the same lines the old stamp did: signer, signing time, and the reason
/// and location when the job sets them.
/// </summary>
public sealed class StampAppearance : IPdfSignatureAppearance
{
    private const float MaxFontSize = 8f;
    private const float MinFontSize = 4f;

    private readonly string[] lines;
    private readonly SizeF box;

    public StampAppearance(X509Certificate2 certificate, PdfJob job, SizeF box, DateTime signedAt)
    {
        this.box = box;

        var details = new List<string>
        {
            "Digitally signed by " + SignerName(certificate),
            // Day-first whatever the machine's locale: these are Indian tax certificates, and the
            // old stamp read the same way (en-IN short date).
            "Date: " + signedAt.ToString("dd-MM-yyyy HH:mm:ss", System.Globalization.CultureInfo.InvariantCulture),
        };
        if (!string.IsNullOrWhiteSpace(job.Reason)) details.Add("Reason: " + job.Reason);
        if (!string.IsNullOrWhiteSpace(job.Location)) details.Add("Location: " + job.Location);
        lines = details.ToArray();
    }

    public void Generate(PdfCanvas g)
    {
        var font = FittingFont();
        var lineHeight = font.Height;
        var top = Math.Max(0f, (box.Height - lineHeight * lines.Length) / 2f);
        var centered = new PdfStringFormat(PdfTextAlignment.Center, PdfVerticalAlignment.Top);

        for (var i = 0; i < lines.Length; i++)
        {
            var row = new RectangleF(0f, top + i * lineHeight, box.Width, lineHeight);
            g.DrawString(lines[i], font, PdfBrushes.Black, row, centered);
        }
    }

    /// <summary>
    /// The largest font, within a legible range, at which every line fits the cell: two lines in
    /// a 26pt cell come out at 8pt, as before, and longer names or extra lines shrink it.
    /// </summary>
    private PdfFont FittingFont()
    {
        var size = Math.Clamp((box.Height - 6f) / lines.Length, MinFontSize, MaxFontSize);

        while (true)
        {
            var font = new PdfFont(PdfFontFamily.TimesRoman, size);
            var widest = lines.Max(line => font.MeasureString(line).Width);
            if (size <= MinFontSize || (widest <= box.Width - 2f && font.Height * lines.Length <= box.Height))
                return font;
            size = Math.Max(MinFontSize, size - 0.25f);
        }
    }

    public static string SignerName(X509Certificate2 certificate)
    {
        var cn = certificate.GetNameInfo(X509NameType.SimpleName, false);
        return string.IsNullOrWhiteSpace(cn) ? certificate.Subject : cn;
    }
}
