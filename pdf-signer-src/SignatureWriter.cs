using System.Diagnostics;
using Spire.Pdf;
using Spire.Pdf.Interactive.DigitalSignatures;

namespace PdfSigner;

/// <summary>
/// Puts one visible, certifying signature into one PDF.
///
/// Spire only lays out the field and the byte range; the signature itself comes from
/// <see cref="CmsFormatter"/>, which signs through the token the way the TRACES utility does.
/// </summary>
public static class SignatureWriter
{
    public static void Sign(PdfJobItem item, IDigestSigner signer, PdfJob job)
    {
        if (string.IsNullOrWhiteSpace(item.InputPath) || !File.Exists(item.InputPath))
        {
            throw new FileNotFoundException($"input not found: {item.InputPath}");
        }

        var outputPath = string.IsNullOrWhiteSpace(item.OutputPath) ? item.InputPath! : item.OutputPath!;

        // Saved beside the target and moved over it only once the signature is in. The input is
        // usually the output, and the signature is computed during Spire's save — a token error
        // half way through must not leave the generated certificate truncated.
        var staging = outputPath + ".signing";

        using var doc = new PdfDocument();
        try
        {
            doc.LoadFromFile(item.InputPath);

            if (doc.Pages.Count == 0)
            {
                throw new InvalidOperationException("document has no pages");
            }

            var placement = Placement.For(item, doc);
            var bounds = placement.Bounds;
            var measured = item.X is not null && item.Y is not null && item.Width is not null && item.Height is not null;
            Log.Info($"pdf: {item.InputPath} -> page {placement.PageIndex + 1}/{doc.Pages.Count}, " +
                     $"box {bounds.X:0.##},{bounds.Y:0.##} {bounds.Width:0.##}x{bounds.Height:0.##}{(measured ? "" : " (fallback corner: no measured box)")}");

            // A certifying signature that forbids any later change, as before (DocMDP level 1).
            var maker = new PdfMDPSignatureMaker(doc, new CmsFormatter(signer), PdfMDPSignatureMaker.Level1Permissions);
            maker.Signature.Name = StampAppearance.SignerName(signer.Certificate);
            if (!string.IsNullOrWhiteSpace(job.Reason)) maker.Signature.Reason = job.Reason;
            if (!string.IsNullOrWhiteSpace(job.Location)) maker.Signature.Location = job.Location;

            maker.MakeSignature(
                $"sig-{Guid.NewGuid():N}",
                doc.Pages[placement.PageIndex],
                bounds.X, bounds.Y, bounds.Width, bounds.Height,
                new StampAppearance(signer.Certificate, job, bounds.Size, DateTime.Now));

            // Rewrite the whole file. Spire loads these PDFs for incremental update, and its
            // incremental save leaves the catalog untouched — the signature field, /AcroForm and
            // the DocMDP /Perms are written but nothing links them, so viewers see no signature at
            // all. The certificates are unsigned until now, so there is no earlier revision to keep.
            doc.FileInfo.IncrementalUpdate = false;
            var watch = Stopwatch.StartNew();
            doc.SaveToFile(staging);
            Log.Info($"pdf: saved with signature in {Log.Took(watch)}");
        }
        catch
        {
            TryDelete(staging);
            throw;
        }
        finally
        {
            doc.Close();
        }

        File.Move(staging, outputPath, overwrite: true);
    }

    private static void TryDelete(string path)
    {
        try
        {
            File.Delete(path);
        }
        catch
        {
            /* a stray staging file is harmless; the original is untouched */
        }
    }
}
