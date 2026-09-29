using System.Security.Cryptography.X509Certificates;
using System.Text.Json;
using System.Text.Json.Serialization;
using Spire.Pdf;
using Spire.Pdf.Security;

namespace PdfSigner;

/// <summary>
/// Signs certificate PDFs with a DSC from the Windows certificate store.
///
/// Reads one JSON job from a file argument (or stdin) and signs every PDF in it with a single
/// certificate, so a hardware token asks for at most one PIN per run.
///
/// Two things this adds over a fixed-position signer:
///   * Bounds  — each PDF may carry its own page + rectangle, so the visible stamp lands in the
///               form's signature cell instead of a hardcoded corner.
///   * Pin     — when supplied, it is pushed into the private key handle before signing, so an
///               unattended batch does not stop on the driver's PIN dialog.
/// </summary>
public static class Program
{
    public static int Main(string[] args)
    {
        // Spire formats the stamp's date with the current culture. These are Indian tax
        // certificates, so force day-first formatting rather than inheriting the machine's
        // locale and stamping an ambiguous 9/9/2026 on a form that reads 09/Sep/2026.
        var culture = new System.Globalization.CultureInfo("en-IN");
        System.Globalization.CultureInfo.DefaultThreadCurrentCulture = culture;
        System.Threading.Thread.CurrentThread.CurrentCulture = culture;

        if (args.Any(a => a == "--serve"))
        {
            return Serve();
        }

        try
        {
            var job = ReadJob(args);
            if (job is null)
            {
                Console.Error.WriteLine("pdf-signer: no job supplied (pass a JSON file path or pipe JSON to stdin)");
                return 2;
            }

            if (string.IsNullOrWhiteSpace(job.CertificateName))
            {
                Console.Error.WriteLine("pdf-signer: CertificateName is required");
                return 2;
            }

            if (job.Pdfs is null || job.Pdfs.Count == 0)
            {
                Console.Error.WriteLine("pdf-signer: Pdfs is empty");
                return 2;
            }

            var certificate = CertificateStore.Find(job.CertificateName!);
            if (certificate is null)
            {
                Console.Error.WriteLine($"pdf-signer: no certificate matching \"{job.CertificateName}\" in CurrentUser\\My or LocalMachine\\My");
                return 3;
            }

            Console.WriteLine($"pdf-signer: using {certificate.Subject}");

            // Unlock once for the whole batch. A failure here is not fatal: the driver will fall
            // back to its own dialog, which is exactly the old behaviour.
            if (!string.IsNullOrEmpty(job.Pin))
            {
                // Apply returns the certificate to sign with: one bound to the unlocked key
                // handle, so Spire does not open a fresh locked one and prompt.
                certificate = TokenPin.Apply(certificate, job.Pin!, out var pinStatus);
                Console.WriteLine($"pdf-signer: pin {pinStatus}");
            }

            var failures = 0;
            foreach (var item in job.Pdfs)
            {
                try
                {
                    SignOne(item, certificate, job);
                    Console.WriteLine($"pdf-signer: signed {item.InputPath}");
                }
                catch (Exception ex)
                {
                    failures++;
                    Console.Error.WriteLine($"pdf-signer: FAILED {item.InputPath}: {ex.Message}");
                }
            }

            return failures == 0 ? 0 : 4;
        }
        catch (Exception ex)
        {
            Console.Error.WriteLine($"pdf-signer: {ex.Message}");
            return 1;
        }
    }

    /// <summary>
    /// Read the job from the file named on the command line, or from stdin when the argument is
    /// "-" or absent. Stdin is how the app passes a job containing a PIN: a temp file holding a
    /// token PIN could outlive the process on disk, a pipe cannot.
    /// </summary>
    private static PdfJob? ReadJob(string[] args)
    {
        var source = args.Length > 0 ? args[0] : "-";
        var json = source == "-" ? Console.In.ReadToEnd() : File.ReadAllText(source);

        if (string.IsNullOrWhiteSpace(json)) return null;

        return JsonSerializer.Deserialize<PdfJob>(json, JobOptions());
    }

    /// <summary>
    /// Long-running mode: read one JSON job per line from stdin, sign it, and write one JSON
    /// result line to stdout. Keeps running until stdin closes.
    ///
    /// This exists because the token's login is tied to the process. Signing each company in a
    /// fresh process means a fresh PIN dialog every time, however the PIN is supplied; keeping
    /// one process alive means the operator answers at most one, at unlock time, and every later
    /// batch signs silently through the session that is already open.
    ///
    /// Progress goes to stderr so stdout carries nothing but the result lines the caller parses.
    /// </summary>
    private static int Serve()
    {
        Console.Error.WriteLine("pdf-signer: serve mode ready");

        X509Certificate2? certificate = null;
        var certificateKey = "";

        string? line;
        while ((line = Console.In.ReadLine()) != null)
        {
            if (string.IsNullOrWhiteSpace(line)) continue;

            var signed = 0;
            string? error = null;

            try
            {
                var job = JsonSerializer.Deserialize<PdfJob>(line, JobOptions())
                    ?? throw new InvalidOperationException("empty job");

                if (string.IsNullOrWhiteSpace(job.CertificateName))
                    throw new InvalidOperationException("CertificateName is required");

                // Resolve and unlock once per certificate, then reuse it for every later job —
                // that reuse is the whole point of this mode.
                if (certificate is null || certificateKey != job.CertificateName)
                {
                    certificate = CertificateStore.Find(job.CertificateName!)
                        ?? throw new InvalidOperationException(
                            $"no certificate matching \"{job.CertificateName}\" in CurrentUser\\My or LocalMachine\\My");
                    certificateKey = job.CertificateName!;
                    Console.Error.WriteLine($"pdf-signer: using {certificate.Subject}");

                    if (!string.IsNullOrEmpty(job.Pin))
                    {
                        certificate = TokenPin.Apply(certificate, job.Pin!, out var pinStatus);
                        Console.Error.WriteLine($"pdf-signer: pin {pinStatus}");
                    }
                }

                foreach (var item in job.Pdfs ?? new List<PdfJobItem>())
                {
                    SignOne(item, certificate, job);
                    signed++;
                    Console.Error.WriteLine($"pdf-signer: signed {item.InputPath}");
                }
            }
            catch (Exception ex)
            {
                error = ex.Message.Trim();
                Console.Error.WriteLine($"pdf-signer: FAILED {error}");

                // A certificate that failed mid-run may have a dead token behind it; resolve
                // again next time rather than reusing a handle that is no longer usable.
                certificate = null;
                certificateKey = "";
            }

            Console.WriteLine(JsonSerializer.Serialize(new JobResult { Signed = signed, Error = error }));
            Console.Out.Flush();
        }

        Console.Error.WriteLine("pdf-signer: serve mode ending");
        return 0;
    }

    private static JsonSerializerOptions JobOptions() =>
        new()
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true
        };

    private static void SignOne(PdfJobItem item, X509Certificate2 certificate, PdfJob job)
    {
        if (string.IsNullOrWhiteSpace(item.InputPath) || !File.Exists(item.InputPath))
        {
            throw new FileNotFoundException($"input not found: {item.InputPath}");
        }

        var outputPath = string.IsNullOrWhiteSpace(item.OutputPath) ? item.InputPath! : item.OutputPath!;

        using var doc = new PdfDocument();
        doc.LoadFromFile(item.InputPath);

        if (doc.Pages.Count == 0)
        {
            throw new InvalidOperationException("document has no pages");
        }

        var placement = Placement.For(item, doc);
        var page = doc.Pages[placement.PageIndex];

        var signature = new PdfSignature(doc, page, new PdfCertificate(certificate), $"sig-{Guid.NewGuid():N}")
        {
            Bounds = placement.Bounds,
            DocumentPermissions = PdfCertificationFlags.ForbidChanges
        };

        Appearance.Apply(signature, certificate, job, placement.Bounds.Height);

        doc.SaveToFile(outputPath);
        doc.Close();
    }
}

public sealed class PdfJob
{
    public string? CertificateName { get; set; }

    /// <summary>Token PIN. Never logged, never written to disk by this process.</summary>
    public string? Pin { get; set; }

    public string? Reason { get; set; }

    public string? Location { get; set; }

    public List<PdfJobItem>? Pdfs { get; set; }
}

public sealed class PdfJobItem
{
    public string? InputPath { get; set; }

    public string? OutputPath { get; set; }

    /// <summary>0-based page for the visible stamp. Omitted means the last page.</summary>
    public int? Page { get; set; }

    /// <summary>Stamp rectangle in points, top-left origin. Omitted means the default corner.</summary>
    public float? X { get; set; }

    public float? Y { get; set; }

    public float? Width { get; set; }

    public float? Height { get; set; }
}

/// <summary>One line of stdout in serve mode: how many PDFs were signed, and why not.</summary>
public sealed class JobResult
{
    public int Signed { get; set; }

    public string? Error { get; set; }
}

[JsonSerializable(typeof(PdfJob))]
internal partial class JobContext : JsonSerializerContext
{
}
