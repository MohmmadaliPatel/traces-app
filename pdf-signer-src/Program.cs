using System.Text.Json;
using System.Text.Json.Serialization;

namespace PdfSigner;

/// <summary>
/// Signs certificate PDFs with a DSC from the Windows certificate store.
///
/// Reads one JSON job from a file argument (or stdin) and signs every PDF in it with a single
/// certificate, so a hardware token asks for at most one PIN per run.
///
/// Three things this adds over a fixed-position signer:
///   * Bounds  — each PDF may carry its own page + rectangle, so the visible stamp lands in the
///               form's signature cell instead of a hardcoded corner.
///   * Pin     — when supplied, it is pushed into the private key handle before signing, so an
///               unattended batch does not stop on the driver's PIN dialog.
///   * Token   — the key is driven the way the TRACES PDF Utility drives it (see TokenKey), not
///               through Spire, whose key handling some token drivers reject.
/// </summary>
public static class Program
{
    // The utility signs from a GUI thread. Token drivers raise their PIN dialog on the calling
    // thread, and some of them expect a single-threaded apartment to do it from.
    [STAThread]
    public static int Main(string[] args)
    {
        // The stamp formats its own date, but Spire still formats numbers and dates with the
        // current culture while writing the PDF. Pin it rather than inherit whatever locale the
        // machine happens to have.
        var culture = new System.Globalization.CultureInfo("en-IN");
        System.Globalization.CultureInfo.DefaultThreadCurrentCulture = culture;
        System.Threading.Thread.CurrentThread.CurrentCulture = culture;

        if (args.Any(a => a == "--diagnose"))
        {
            return Diagnose.Run(args.Where(a => a != "--diagnose").ToArray());
        }

        // One file per day: the app keeps one signer alive for the whole session, and a client
        // machine that fails sends back today's file.
        Log.Open($"pdf-signer-{DateTime.Now:yyyy-MM-dd}.log");

        if (args.Any(a => a == "--serve"))
        {
            return Serve();
        }

        try
        {
            var job = ReadJob(args);
            if (job is null)
            {
                Log.Info("no job supplied (pass a JSON file path or pipe JSON to stdin)");
                return 2;
            }

            if (string.IsNullOrWhiteSpace(job.CertificateName))
            {
                Log.Info("CertificateName is required");
                return 2;
            }

            if (job.Pdfs is null || job.Pdfs.Count == 0)
            {
                Log.Info("Pdfs is empty");
                return 2;
            }

            Log.Info($"job: {job.Pdfs.Count} PDF(s) for \"{job.CertificateName}\", PIN {(string.IsNullOrEmpty(job.Pin) ? "not supplied" : "supplied")}");

            var certificate = CertificateStore.Find(job.CertificateName!);
            if (certificate is null)
            {
                Log.Info($"no certificate matching \"{job.CertificateName}\" in CurrentUser\\My or LocalMachine\\My");
                return 3;
            }

            Log.Info($"using {certificate.Subject} (thumbprint {certificate.Thumbprint})");

            using var key = TokenKey.Open(certificate);
            Log.Info($"key {key.Describe()}");

            // Unlock once for the whole batch. A driver that will not take the PIN this way is not
            // fatal: it falls back to its own dialog, which is all the TRACES utility ever does.
            if (!string.IsNullOrEmpty(job.Pin))
            {
                Log.Info($"pin {key.ApplyPin(job.Pin!)}");
            }

            var failures = 0;
            foreach (var item in job.Pdfs)
            {
                try
                {
                    SignatureWriter.Sign(item, key, job);
                    Log.Info($"signed {item.InputPath}");
                }
                catch (Exception ex)
                {
                    failures++;
                    Log.Error(item.InputPath ?? "(no path)", ex);
                }
            }

            return failures == 0 ? 0 : 4;
        }
        catch (Exception ex)
        {
            Log.Error("job", ex);
            Log.Info($"log: {Log.FilePath}");
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
        Log.Info("serve mode ready");

        TokenKey? key = null;
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

                Log.Info($"job: {job.Pdfs?.Count ?? 0} PDF(s) for \"{job.CertificateName}\", PIN {(string.IsNullOrEmpty(job.Pin) ? "not supplied" : "supplied")}");

                // Resolve and unlock once per certificate, then reuse it for every later job —
                // that reuse is the whole point of this mode.
                if (key is null || certificateKey != job.CertificateName)
                {
                    key?.Dispose();
                    key = null;

                    var certificate = CertificateStore.Find(job.CertificateName!)
                        ?? throw new InvalidOperationException(
                            $"no certificate matching \"{job.CertificateName}\" in CurrentUser\\My or LocalMachine\\My");
                    Log.Info($"using {certificate.Subject} (thumbprint {certificate.Thumbprint})");

                    key = TokenKey.Open(certificate);
                    certificateKey = job.CertificateName!;
                    Log.Info($"key {key.Describe()}");

                    if (!string.IsNullOrEmpty(job.Pin))
                    {
                        Log.Info($"pin {key.ApplyPin(job.Pin!)}");
                    }
                }

                foreach (var item in job.Pdfs ?? new List<PdfJobItem>())
                {
                    SignatureWriter.Sign(item, key, job);
                    signed++;
                    Log.Info($"signed {item.InputPath}");
                }
            }
            catch (Exception ex)
            {
                Log.Error("job", ex);
                // The app shows this string to the operator; point them at the file to send.
                error = ex.Message.Trim() + (Log.FilePath is null ? "" : $" (signer log: {Log.FilePath})");

                // A key that failed mid-run may have a dead token behind it; open it again next
                // time rather than reusing a handle that is no longer usable.
                key?.Dispose();
                key = null;
                certificateKey = "";
            }

            Console.WriteLine(JsonSerializer.Serialize(new JobResult { Signed = signed, Error = error }));
            Console.Out.Flush();
        }

        Log.Info("serve mode ending");
        return 0;
    }

    private static JsonSerializerOptions JobOptions() =>
        new()
        {
            PropertyNameCaseInsensitive = true,
            ReadCommentHandling = JsonCommentHandling.Skip,
            AllowTrailingCommas = true
        };
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
