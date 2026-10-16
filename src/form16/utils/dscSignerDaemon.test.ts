import fs from "fs"
import os from "os"
import path from "path"
import { describe, it, expect, vi, afterEach } from "vitest"
import { missingDotnetRuntimeMessage, signViaDaemon, stopSignerDaemon } from "./dscSignerDaemon"

describe("missingDotnetRuntimeMessage", () => {
  it("explains the .NET host's missing-runtime exit codes", () => {
    for (const code of [2147516547, 0x80008083 | 0, 2147516566]) {
      const message = missingDotnetRuntimeMessage(code)
      expect(message).toContain("the .NET 10 x64 runtime is missing")
      expect(message).toContain("winget install Microsoft.DotNet.DesktopRuntime.10")
    }
    expect(missingDotnetRuntimeMessage(2147516547)).toContain("0x80008083")
  })

  it("leaves every other exit alone", () => {
    expect(missingDotnetRuntimeMessage(0)).toBeNull()
    expect(missingDotnetRuntimeMessage(1)).toBeNull()
    expect(missingDotnetRuntimeMessage(null)).toBeNull()
  })
})

// The fake signer is a node script run through its shebang, which Windows cannot do.
describe.skipIf(process.platform === "win32")("signer daemon stderr", () => {
  afterEach(() => {
    stopSignerDaemon()
    vi.restoreAllMocks()
  })

  it("reaches the console and the current job's logger, not the starter's", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fake-signer-"))
    const exe = path.join(dir, "pdf-signer")
    fs.writeFileSync(
      exe,
      [
        "#!/usr/bin/env node",
        'require("readline").createInterface({ input: process.stdin }).on("line", (line) => {',
        "  const job = JSON.parse(line)",
        "  process.stderr.write(`pdf-signer: key ${job.Name}\\npdf-signer: signed ${job.Name}.pdf\\n`)",
        '  setTimeout(() => process.stdout.write(JSON.stringify({ Signed: 1 }) + "\\n"), 50)',
        "})",
      ].join("\n"),
      { mode: 0o755 }
    )

    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {})
    const first: string[] = []
    const second: string[] = []

    await expect(
      signViaDaemon(exe, { Name: "one" }, 10_000, (m) => first.push(m))
    ).resolves.toEqual({
      signed: 1,
      error: null,
    })
    await signViaDaemon(exe, { Name: "two" }, 10_000, (m) => second.push(m))

    const printed = consoleLog.mock.calls.map((args) => args[0])
    expect(printed).toEqual(
      expect.arrayContaining([
        "pdf-signer: key one",
        "pdf-signer: signed one.pdf",
        "pdf-signer: key two",
        "pdf-signer: signed two.pdf",
      ])
    )
    // Each job sees only its own lines, and per-PDF lines stay on the console only.
    expect(first).toEqual(["pdf-signer: key one"])
    expect(second).toEqual(["pdf-signer: key two"])
  })
})
