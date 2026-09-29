using Spire.Pdf;
using System.Drawing;

namespace PdfSigner;

/// <summary>
/// Where the visible stamp goes on the page.
/// </summary>
public readonly struct Placement
{
    public int PageIndex { get; }

    public RectangleF Bounds { get; }

    private Placement(int pageIndex, RectangleF bounds)
    {
        PageIndex = pageIndex;
        Bounds = bounds;
    }

    /// <summary>
    /// Use the rectangle the generator measured from the form's signature cell when the job
    /// carries one, and fall back to the old bottom-right-of-the-last-page corner otherwise —
    /// certificates generated before this change, or by another tool, still sign.
    ///
    /// Incoming coordinates are top-left origin in points, which is already Spire's convention
    /// for signature bounds, so they are used as-is; they are only clamped to the page so a
    /// stale or malformed box can never push the stamp off the paper.
    /// </summary>
    public static Placement For(PdfJobItem item, PdfDocument doc)
    {
        var lastPage = doc.Pages.Count - 1;

        if (item.X is null || item.Y is null || item.Width is null || item.Height is null)
        {
            var page = doc.Pages[lastPage];
            var size = page.Size;
            var fallback = new RectangleF(size.Width - 210f, size.Height - 90f, 190f, 60f);
            return new Placement(lastPage, fallback);
        }

        var pageIndex = item.Page ?? lastPage;
        if (pageIndex < 0 || pageIndex > lastPage) pageIndex = lastPage;

        var target = doc.Pages[pageIndex];
        var client = target.Size;

        var width = Math.Max(1f, item.Width.Value);
        var height = Math.Max(1f, item.Height.Value);
        var x = Math.Clamp(item.X.Value, 0f, Math.Max(0f, client.Width - width));
        var y = Math.Clamp(item.Y.Value, 0f, Math.Max(0f, client.Height - height));

        return new Placement(pageIndex, new RectangleF(x, y, width, height));
    }
}
