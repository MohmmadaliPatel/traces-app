using System.Diagnostics;
using System.Reflection;

namespace PdfSigner;

/// <summary>
/// The signer's diagnostics: every line goes to stderr (the app forwards it to its console and
/// task log) and to a file under <c>pdf-signer\logs\</c>, so a failure on a client machine can be
/// sent back as a single file.
///
/// stdout is never touched here — in serve mode it carries nothing but the JSON result lines the
/// app parses. A PIN is never passed to this class.
/// </summary>
public static class Log
{
    private static readonly object Gate = new();
    private static StreamWriter? file;

    /// <summary>Where this run's log is being written, or null if no file could be opened.</summary>
    public static string? FilePath { get; private set; }

    /// <summary>Directory holding the logs: next to the exe, or %TEMP% if that is read-only.</summary>
    public static string Directory { get; private set; } = Path.Combine(AppContext.BaseDirectory, "logs");

    /// <summary>
    /// Start writing to <paramref name="fileName"/> (appending), then record which build is
    /// running where. Never throws: a signer that cannot write its log still signs.
    /// </summary>
    public static void Open(string fileName)
    {
        foreach (var dir in new[] { Path.Combine(AppContext.BaseDirectory, "logs"), Path.Combine(Path.GetTempPath(), "pdf-signer-logs") })
        {
            try
            {
                System.IO.Directory.CreateDirectory(dir);
                var path = Path.Combine(dir, fileName);
                var stream = new FileStream(path, FileMode.Append, FileAccess.Write, FileShare.ReadWrite | FileShare.Delete);
                file = new StreamWriter(stream) { AutoFlush = true };
                FilePath = path;
                Directory = dir;
                break;
            }
            catch
            {
                /* try the next location */
            }
        }

        Info($"---- {Build()} | pid {Environment.ProcessId} | args: {string.Join(' ', Environment.GetCommandLineArgs().Skip(1))}");
    }

    public static void Info(string message)
    {
        lock (Gate)
        {
            Console.Error.WriteLine($"pdf-signer: {message}");
            try
            {
                file?.WriteLine($"{DateTime.Now:yyyy-MM-dd HH:mm:ss.fff} [{Environment.ProcessId}] {message}");
            }
            catch
            {
                /* a full disk must not stop a signature */
            }
        }
    }

    /// <summary>A failure, with the full exception chain and HRESULTs in the file.</summary>
    public static void Error(string what, Exception ex)
    {
        Info($"FAILED {what}: {ex.Message.Trim()}");
        for (var inner = ex; inner is not null; inner = inner.InnerException)
        {
            Info($"  {inner.GetType().Name} (HRESULT 0x{inner.HResult:X8}): {inner.Message.Trim()}");
        }
        var stack = ex.StackTrace?.Trim();
        if (!string.IsNullOrEmpty(stack))
        {
            lock (Gate)
            {
                try
                {
                    file?.WriteLine(stack);
                }
                catch
                {
                    /* best effort */
                }
            }
        }
    }

    /// <summary>Which signer build this is — so a log can be matched to the binary that wrote it.</summary>
    public static string Build()
    {
        var assembly = typeof(Log).Assembly;
        var built = File.Exists(assembly.Location) ? File.GetLastWriteTime(assembly.Location).ToString("yyyy-MM-dd HH:mm") : "?";
        var mvid = assembly.ManifestModule.ModuleVersionId.ToString("N")[..8];
        var version = assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "?";
        return $"pdf-signer {version} (build {mvid}, {built}) on .NET {Environment.Version}, {(Environment.Is64BitProcess ? "x64" : "x86")}";
    }

    /// <summary>Elapsed time for a step, for the log.</summary>
    public static string Took(Stopwatch watch) => $"{watch.ElapsedMilliseconds} ms";
}
