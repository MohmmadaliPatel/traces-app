/**
 * DSC attach diagnostic for Form 131 (New Act certificate) PDFs.
 *
 * Runs the SAME code path production uses after Form 131 PDFs are generated
 * (`attachDscToForm16aPdfs` in src/form16/utils/signForm16Pdfs.ts) and logs every step
 * in detail, so one log file explains a failure end to end:
 *
 *   1  environment (OS, user, admin, locale, DB)
 *   2  signer binary (files, PE architecture, blocked-file flag, .NET runtime)
 *   3  Windows certificate store (CurrentUser\My + LocalMachine\My) and how each
 *      certificate compares to the configured subject
 *   4  pdf-signer/dsc-map.json
 *   5  certificate resolution, step by step, plus the DB inventory
 *   6  optional Form 131 PDF generation from a sample txt
 *   7  target PDFs (auto-discovered when none given) + writability / lock / path checks
 *   8  signature state BEFORE
 *   9  the exact JSON handed to pdf-signer.exe, then the signer run:
 *      command line, stdout, stderr, exit code, duration, timeout
 *  10  signature state AFTER (+ signer identity recovered from the PKCS#7 blob)
 *  11  optional fallback attempts with every certificate in the store
 *  12  the production entry point, with its result object
 *
 * Output goes to the console, to tmp/dsc-test/dsc-test-<timestamp>.log, and to a
 * machine-readable tmp/dsc-test/dsc-test-<timestamp>.json. Send both files back.
 *
 * Run (Windows machine holding the DSC, token plugged in):
 *   yarn dsc:test                                       auto-discovers recent Form 131 PDFs
 *   yarn dsc:test --company="ACME Pvt Ltd" --tan=MUMA12345B
 *   yarn dsc:test --generate                            render a fresh Form 131 PDF, then sign it
 *   yarn dsc:test --try-all-certs                       if resolution fails, try every store cert
 *   npm run dsc:test -- --generate                      (npm needs the extra --)
 *
 * CLI:
 *   --company=NAME      Company name used for certificate resolution
 *   --tan=TAN           TAN used for certificate resolution (preferred key)
 *   --cert=SUBJECT      Force this certificate subject (skips resolution)
 *   --pdf=PATH          PDF to sign (repeatable)
 *   --dir=PATH          Sign every *.pdf under this directory (recursive)
 *   --generate          Render a Form 131 PDF from a sample txt and sign that
 *   --sample=PATH       Sample Form 131 txt (default docs/pdf-reference/fusion-form131-sample.txt)
 *   --pan=PAN           Which record to pick from the sample (default: first)
 *   --limit=N           Max PDFs to sign (default 2)
 *   --timeout=SEC       Kill the signer after SEC seconds (default 120; catches PIN prompts)
 *   --in-place          Sign the real files instead of copies under tmp/dsc-test/
 *   --try-all-certs     After a failure, retry with each certificate found in the store
 *   --list-companies    Print every company with a DSC configured, then exit
 *   --no-sign           Run every check but never launch the signer
 *   --log=PATH          Log file path
 */
import fs from "fs"
import path from "path"
import os from "os"
import { spawn, execFile } from "child_process"
import { glob } from "glob"
import dotenv from "dotenv"

import { attachDscToForm16aPdfs, resolveDscCertificateName } from "../form16/utils/signForm16Pdfs"
import { inspectPdfSignature, type PdfSignatureInfo } from "../form16/utils/pdfSignatureInfo"

dotenv.config()

const IS_WINDOWS = process.platform === "win32"
const startedAt = new Date()
const stamp = startedAt.toISOString().replace(/[:.]/g, "-")
const OUT_DIR = path.join(process.cwd(), "tmp", "dsc-test")

// ---------------------------------------------------------------------------
// Logging + machine-readable report
// ---------------------------------------------------------------------------

let logStream: fs.WriteStream | null = null
let logFilePath = ""
let jsonFilePath = ""

const report: Record<string, any> = {
  startedAt: startedAt.toISOString(),
  argv: process.argv.slice(2),
}

function initLog(customPath?: string) {
  logFilePath = customPath ? path.resolve(customPath) : path.join(OUT_DIR, `dsc-test-${stamp}.log`)
  jsonFilePath = logFilePath.replace(/\.log$/i, "") + ".json"
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
  logStream = fs.createWriteStream(logFilePath, { flags: "a" })
}

function log(msg = "") {
  console.log(msg)
  logStream?.write(`${msg}\n`)
}

function section(title: string) {
  log("")
  log("=".repeat(78))
  log(title)
  log("=".repeat(78))
}

function kv(key: string, value: unknown) {
  const shown = value === undefined || value === null || value === "" ? "-" : String(value)
  log(`  ${key.padEnd(28)} ${shown}`)
}

const fail = (m: string) => log(`  [FAIL] ${m}`)
const ok = (m: string) => log(`  [ok]   ${m}`)
const warn = (m: string) => log(`  [warn] ${m}`)
const info = (m: string) => log(`  [info] ${m}`)

function writeJsonReport() {
  try {
    fs.writeFileSync(jsonFilePath, JSON.stringify(report, null, 2), "utf8")
  } catch (err: any) {
    log(`  [warn] could not write JSON report: ${err?.message || err}`)
  }
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

type Args = {
  company?: string
  tan?: string
  cert?: string
  pdfs: string[]
  dir?: string
  generate: boolean
  sample?: string
  pan?: string
  limit: number
  timeoutSec: number
  inPlace: boolean
  tryAllCerts: boolean
  listCompanies: boolean
  noSign: boolean
  log?: string
}

function parseArgs(argv: string[]): Args {
  const a: Args = {
    pdfs: [],
    generate: false,
    limit: 2,
    timeoutSec: 120,
    inPlace: false,
    tryAllCerts: false,
    listCompanies: false,
    noSign: false,
  }
  for (const raw of argv) {
    const eq = raw.indexOf("=")
    const flag = eq === -1 ? raw : raw.slice(0, eq)
    const value = eq === -1 ? "" : raw.slice(eq + 1).replace(/^["']|["']$/g, "")
    switch (flag) {
      case "--company":
        a.company = value
        break
      case "--tan":
        a.tan = value
        break
      case "--cert":
      case "--certificate":
        a.cert = value
        break
      case "--pdf":
        if (value) a.pdfs.push(value)
        break
      case "--dir":
        a.dir = value
        break
      case "--generate":
        a.generate = true
        break
      case "--sample":
        a.sample = value
        break
      case "--pan":
        a.pan = value
        break
      case "--limit":
        a.limit = Math.max(1, parseInt(value, 10) || 2)
        break
      case "--timeout":
        a.timeoutSec = Math.max(5, parseInt(value, 10) || 120)
        break
      case "--in-place":
        a.inPlace = true
        break
      case "--try-all-certs":
        a.tryAllCerts = true
        break
      case "--list-companies":
        a.listCompanies = true
        break
      case "--no-sign":
      case "--dry-run":
        a.noSign = true
        break
      case "--log":
        a.log = value
        break
      default:
        break
    }
  }
  return a
}

// ---------------------------------------------------------------------------
// Small process helpers
// ---------------------------------------------------------------------------

function run(
  cmd: string,
  cmdArgs: string[],
  timeoutMs = 30000
): Promise<{ ok: boolean; stdout: string; stderr: string; error?: string }> {
  return new Promise((resolve) => {
    try {
      execFile(
        cmd,
        cmdArgs,
        { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
        (err, stdout, stderr) => {
          resolve({
            ok: !err,
            stdout: String(stdout || ""),
            stderr: String(stderr || ""),
            error: err ? `${(err as any).code || ""} ${err.message}`.trim() : undefined,
          })
        }
      )
    } catch (err: any) {
      resolve({
        ok: false,
        stdout: "",
        stderr: "",
        error: `${err?.code || ""} ${err?.message || err}`.trim(),
      })
    }
  })
}

function powershell(script: string, timeoutMs = 45000) {
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    timeoutMs
  )
}

// ---------------------------------------------------------------------------
// PDF signature inspection (shared with production — src/form16/utils/pdfSignatureInfo)
// ---------------------------------------------------------------------------

type SignatureInfo = PdfSignatureInfo

function describeSignature(label: string, sig: SignatureInfo) {
  log(`  ${label}`)
  log(
    `      signed=${sig.signed} bytes=${sig.sizeBytes} /ByteRange=${sig.byteRangeCount} ` +
      `/Type/Sig=${sig.sigDictCount} subFilter=[${sig.subFilters.join(", ")}]`
  )
  if (sig.names.length) log(`      /Name=[${sig.names.join(" | ")}]`)
  if (sig.reasons.length) log(`      /Reason=[${sig.reasons.join(" | ")}]`)
  if (sig.signerHints.length) log(`      signer blob strings: ${sig.signerHints.join(" | ")}`)
}

// ---------------------------------------------------------------------------
// 1. Environment
// ---------------------------------------------------------------------------

async function logEnvironment() {
  section("1. ENVIRONMENT")
  const env: Record<string, any> = {
    startedAt: startedAt.toISOString(),
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    node: process.version,
    cwd: process.cwd(),
    user: os.userInfo().username,
    hostname: os.hostname(),
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone,
    loader: process.env.DSC_TEST_LOADER || "(unknown)",
  }

  kv("started", env.startedAt)
  kv("platform", `${env.platform} (${env.arch})`)
  kv("os", `${env.osType} ${env.osRelease}`)
  kv("hostname", env.hostname)
  kv("user", env.user)
  kv("node", env.node)
  kv("ts loader", env.loader)
  kv("cwd", env.cwd)
  kv("timezone", env.tz)
  kv("log file", logFilePath)
  kv("json report", jsonFilePath)

  const dbUrl = process.env.DATABASE_URL || ""
  env.databaseUrl = dbUrl ? dbUrl.replace(/\/\/[^@]*@/, "//***:***@") : "(not set)"
  kv("DATABASE_URL", env.databaseUrl)

  if (!IS_WINDOWS) {
    warn(
      "pdf-signer.exe is a Windows .NET binary that reads the Windows certificate store. " +
        `On ${process.platform} it cannot run natively (spawn ENOEXEC) — run this on the Windows machine holding the DSC.`
    )
  } else {
    const ver = await run("cmd.exe", ["/c", "ver"], 10000)
    if (ver.stdout.trim()) {
      env.windowsVersion = ver.stdout.trim()
      kv("windows version", env.windowsVersion)
    }

    const whoami = await run("whoami.exe", [], 10000)
    if (whoami.stdout.trim()) {
      env.whoami = whoami.stdout.trim()
      kv("whoami", env.whoami)
      info(
        "the certificate store is PER USER — this account must own the DSC, and must be the same account " +
          "the app/worker runs as in production"
      )
    }

    const admin = await powershell(
      "([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent())" +
        ".IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)",
      20000
    )
    env.isAdmin = admin.stdout.trim()
    kv("running as admin", env.isAdmin || "(unknown)")
    if (!admin.ok && admin.error) {
      warn(`PowerShell unavailable or blocked: ${admin.error} — certificate store checks may be skipped`)
      env.powershellError = admin.error
    }

    const session = await powershell("(Get-Process -Id $PID).SessionId", 20000)
    if (session.stdout.trim()) {
      env.sessionId = session.stdout.trim()
      kv("windows session id", env.sessionId)
      if (env.sessionId === "0") {
        warn(
          "session 0 — this is a service/non-interactive session. A DSC token PIN prompt cannot appear here " +
            "and signing will hang or fail. Run from a normal desktop login."
        )
      }
    }

    const chcp = await run("cmd.exe", ["/c", "chcp"], 10000)
    if (chcp.stdout.trim()) kv("code page", chcp.stdout.trim())
  }

  const writable = (dir: string) => {
    try {
      fs.mkdirSync(dir, { recursive: true })
      const probe = path.join(dir, `.write-probe-${Date.now()}`)
      fs.writeFileSync(probe, "x")
      fs.unlinkSync(probe)
      return true
    } catch {
      return false
    }
  }
  env.tmpWritable = writable(OUT_DIR)
  env.tempWritable = writable(path.join(process.cwd(), "temp"))
  kv("tmp/dsc-test writable", env.tmpWritable)
  kv("temp/ writable", env.tempWritable)
  if (!env.tempWritable) {
    fail("temp/ is not writable — signPdfPathsWithCertificate() cannot write its input JSON, so signing always fails")
  }

  report.environment = env
}

// ---------------------------------------------------------------------------
// 2. Signer binary
// ---------------------------------------------------------------------------

type SignerCheck = { exePath: string; exists: boolean }

function peMachineType(exePath: string): string {
  try {
    const fd = fs.openSync(exePath, "r")
    const head = Buffer.alloc(0x400)
    fs.readSync(fd, head, 0, head.length, 0)
    fs.closeSync(fd)
    if (head.readUInt16LE(0) !== 0x5a4d) return "not a PE/EXE file"
    const peOffset = head.readUInt32LE(0x3c)
    if (peOffset + 6 > head.length) return "unknown"
    if (head.readUInt32LE(peOffset) !== 0x00004550) return "unknown"
    const machine = head.readUInt16LE(peOffset + 4)
    const map: Record<number, string> = {
      0x014c: "x86 (32-bit)",
      0x8664: "x64",
      0xaa64: "ARM64",
      0x01c4: "ARM",
    }
    return map[machine] || `0x${machine.toString(16)}`
  } catch (err: any) {
    return `unreadable (${err?.message || err})`
  }
}

async function checkSignerBinary(): Promise<SignerCheck> {
  section("2. SIGNER BINARY (pdf-signer/)")
  const result: Record<string, any> = {}
  const signerDir = path.join(process.cwd(), "pdf-signer")
  const exePath = path.join(signerDir, "pdf-signer.exe")

  kv("signer dir", signerDir)
  result.dir = signerDir
  result.dirExists = fs.existsSync(signerDir)
  kv("dir exists", result.dirExists)

  if (!result.dirExists) {
    fail("pdf-signer/ is missing — attachDscToForm16aPdfs() skips signing entirely")
    report.signer = result
    return { exePath, exists: false }
  }

  result.files = {}
  const wanted = [
    "pdf-signer.exe",
    "pdf-signer.dll",
    "pdf-signer.runtimeconfig.json",
    "pdf-signer.deps.json",
    "Spire.Pdf.dll",
  ]
  for (const name of wanted) {
    const p = path.join(signerDir, name)
    if (fs.existsSync(p)) {
      const st = fs.statSync(p)
      result.files[name] = { size: st.size, mtime: st.mtime.toISOString() }
      ok(`${name} (${st.size} bytes, ${st.mtime.toISOString()})`)
    } else {
      result.files[name] = null
      if (name === "pdf-signer.deps.json") warn(`${name} missing`)
      else fail(`${name} MISSING`)
    }
  }

  const exists = fs.existsSync(exePath)
  result.exeExists = exists
  if (!exists) {
    fail('pdf-signer.exe not found — production logs "pdf-signer.exe not found — DSC attach skipped"')
    report.signer = result
    return { exePath, exists }
  }

  result.peMachine = peMachineType(exePath)
  kv("exe architecture", result.peMachine)
  if (IS_WINDOWS && result.peMachine === "x64" && process.arch === "arm64") {
    info("x64 binary on ARM64 Windows — runs under emulation; the x64 .NET runtime must be installed")
  }

  // Mark of the Web: files extracted from a downloaded zip are often blocked by Windows.
  if (IS_WINDOWS) {
    try {
      const zone = fs.readFileSync(`${exePath}:Zone.Identifier`, "utf8")
      result.zoneIdentifier = zone.trim()
      fail(
        "pdf-signer.exe carries a Mark-of-the-Web (blocked file) — Windows may refuse to run it.\n" +
          `        Zone.Identifier: ${zone.trim().replace(/\s+/g, " ")}\n` +
          `        Fix: powershell -Command "Get-ChildItem '${signerDir}' -Recurse | Unblock-File"`
      )
    } catch {
      result.zoneIdentifier = null
      ok("no Mark-of-the-Web on pdf-signer.exe (not a blocked file)")
    }
  }

  const runtimeCfgPath = path.join(signerDir, "pdf-signer.runtimeconfig.json")
  if (fs.existsSync(runtimeCfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(runtimeCfgPath, "utf8"))
      const frameworks = [cfg?.runtimeOptions?.framework, ...(cfg?.runtimeOptions?.frameworks || [])].filter(
        Boolean
      )
      result.tfm = cfg?.runtimeOptions?.tfm
      result.requiredFrameworks = frameworks.map((f: any) => `${f.name} ${f.version}`)
      kv("target framework", result.tfm)
      for (const f of result.requiredFrameworks as string[]) kv("requires runtime", f)
    } catch (err: any) {
      warn(`could not parse pdf-signer.runtimeconfig.json: ${err?.message || err}`)
    }
  }

  const runtimesDir = path.join(signerDir, "runtimes")
  if (fs.existsSync(runtimesDir)) {
    result.nativeRuntimes = fs
      .readdirSync(runtimesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    kv("native runtimes", (result.nativeRuntimes as string[]).join(", "))
  } else {
    warn("runtimes/ missing — native SkiaSharp/HarfBuzz assets may fail to load")
  }

  const dotnet = await run("dotnet", ["--list-runtimes"], 30000)
  if (dotnet.ok) {
    const lines = dotnet.stdout.split(/\r?\n/).filter((l) => l.trim())
    result.dotnetRuntimes = lines
    kv("dotnet runtimes", `${lines.length} found`)
    for (const l of lines) log(`      ${l}`)

    for (const req of (result.requiredFrameworks || []) as string[]) {
      const [name, version] = req.split(" ")
      const major = (version || "").split(".")[0]
      const hit = lines.some((l) => l.startsWith(`${name} ${major}.`))
      if (hit) ok(`runtime present for ${req}`)
      else
        fail(
          `runtime MISSING for ${req} — install the .NET ${major} runtime from ` +
            "https://dotnet.microsoft.com/download, otherwise the signer exits immediately with no output"
        )
    }
  } else {
    result.dotnetRuntimes = null
    warn(
      `"dotnet --list-runtimes" failed: ${dotnet.error || dotnet.stderr.trim()} — ` +
        "either the .NET runtime is not installed (a problem), or pdf-signer.exe is self-contained (fine)"
    )
  }

  report.signer = result
  return { exePath, exists }
}

// ---------------------------------------------------------------------------
// 3. Windows certificate store
// ---------------------------------------------------------------------------

type StoreCert = {
  store: string
  subject: string
  cn: string
  friendlyName: string
  issuer: string
  thumbprint: string
  notBefore: string
  notAfter: string
  hasPrivateKey: boolean
  expired: boolean
}

function cnOf(subject: string): string {
  const m = subject.match(/CN=([^,]+)/i)
  return (m?.[1] || subject || "").trim()
}

async function enumerateCertificates(): Promise<StoreCert[]> {
  section("3. WINDOWS CERTIFICATE STORE")
  const certs: StoreCert[] = []

  if (!IS_WINDOWS) {
    info("skipped — not running on Windows")
    report.certificates = { skipped: "not windows" }
    return certs
  }

  for (const store of ["CurrentUser\\My", "LocalMachine\\My"]) {
    const ps = await powershell(
      `Get-ChildItem Cert:\\${store} | Select-Object Subject,FriendlyName,Issuer,Thumbprint,` +
        `@{n='NotBefore';e={$_.NotBefore.ToString('s')}},@{n='NotAfter';e={$_.NotAfter.ToString('s')}},` +
        `HasPrivateKey | ConvertTo-Json -Depth 3 -Compress`,
      45000
    )
    if (!ps.ok) {
      warn(`could not read Cert:\\${store}: ${ps.error || ps.stderr.trim()}`)
      continue
    }
    const raw = ps.stdout.trim()
    if (!raw) {
      warn(`Cert:\\${store} is EMPTY (no certificates for this account)`)
      continue
    }
    let parsed: any
    try {
      parsed = JSON.parse(raw)
    } catch (err: any) {
      warn(`could not parse the certificate list for ${store}: ${err?.message || err}`)
      log(`      raw: ${raw.slice(0, 500)}`)
      continue
    }
    for (const c of Array.isArray(parsed) ? parsed : [parsed]) {
      const subject = String(c?.Subject || "")
      const notAfter = String(c?.NotAfter || "")
      certs.push({
        store,
        subject,
        cn: cnOf(subject),
        friendlyName: String(c?.FriendlyName || ""),
        issuer: String(c?.Issuer || ""),
        thumbprint: String(c?.Thumbprint || ""),
        notBefore: String(c?.NotBefore || ""),
        notAfter,
        hasPrivateKey: Boolean(c?.HasPrivateKey),
        expired: notAfter ? new Date(notAfter).getTime() < Date.now() : false,
      })
    }
  }

  kv("certificates found", certs.length)
  if (certs.length === 0) {
    fail(
      "no certificates in CurrentUser\\My or LocalMachine\\My for this account — plug in the DSC token, " +
        "install its driver/middleware, and log in as the DSC owner"
    )
  }
  for (const c of certs) {
    log("")
    log(`  [${c.store}] CN=${c.cn}`)
    log(`      subject      ${c.subject}`)
    log(`      friendlyName ${c.friendlyName || "-"}`)
    log(`      issuer       ${c.issuer}`)
    log(`      thumbprint   ${c.thumbprint}`)
    log(`      valid        ${c.notBefore} -> ${c.notAfter}${c.expired ? "   *** EXPIRED ***" : ""}`)
    log(`      privateKey   ${c.hasPrivateKey}`)
    if (!c.hasPrivateKey) warn("no private key — this certificate CANNOT sign")
    if (c.expired) warn("expired — signing will fail or produce an invalid signature")
  }

  const usable = certs.filter((c) => c.hasPrivateKey && !c.expired)
  log("")
  kv("usable for signing", `${usable.length}/${certs.length}`)
  info('use the CN exactly as printed above (without the "CN=" prefix) as dscCertificateName')
  report.certificates = { count: certs.length, usable: usable.length, list: certs }
  return certs
}

function compareCertificateWithStore(certificateName: string, certs: StoreCert[]) {
  section("3b. CONFIGURED SUBJECT vs CERTIFICATE STORE")
  kv("configured subject", certificateName || "(none)")
  if (!certificateName) {
    info("nothing to compare — no certificate resolved")
    return
  }
  if (!IS_WINDOWS) {
    info("skipped — not running on Windows")
    return
  }
  if (certs.length === 0) {
    fail("no certificates in the store to match against")
    return
  }

  const want = certificateName.trim().toLowerCase()
  const exactCn = certs.filter((c) => c.cn.toLowerCase() === want)
  const exactFriendly = certs.filter((c) => c.friendlyName.trim().toLowerCase() === want)
  // .NET's FindBySubjectName does a substring match on the subject.
  const substring = certs.filter((c) => c.subject.toLowerCase().includes(want))

  kv("exact CN match", exactCn.length)
  kv("exact FriendlyName match", exactFriendly.length)
  kv("subject substring match", substring.length)

  const matches = substring.length ? substring : [...exactCn, ...exactFriendly]
  if (matches.length === 0) {
    fail(
      `"${certificateName}" matches NO certificate in the store — the most common cause of signer failure. ` +
        "Use the exact CN printed in section 3."
    )
    const near = certs
      .map((c) => ({
        c,
        score: want.split(/\s+/).filter((w) => w.length > 2 && c.subject.toLowerCase().includes(w)).length,
      }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
    for (const n of near) info(`closest candidate: "${n.c.cn}" (${n.c.store}, thumbprint ${n.c.thumbprint})`)
  } else if (matches.length > 1) {
    warn(
      `${matches.length} certificates match "${certificateName}" — the signer picks one of them, ` +
        "which may not be the DSC you expect:"
    )
    for (const m of matches) log(`      ${m.store} ${m.cn} (thumbprint ${m.thumbprint}, expires ${m.notAfter})`)
  } else {
    const m = matches[0]!
    ok(`matches ${m.store} CN=${m.cn} (thumbprint ${m.thumbprint})`)
    if (!m.hasPrivateKey) fail("...but it has NO private key — signing will fail")
    if (m.expired) fail("...but it is EXPIRED")
    if (m.store === "LocalMachine\\My") {
      info(
        "the match is in LocalMachine — signers usually read CurrentUser; if signing fails, " +
          "import the DSC into the current user's Personal store"
      )
    }
  }

  report.certificateMatch = {
    configured: certificateName,
    exactCn: exactCn.length,
    exactFriendly: exactFriendly.length,
    substring: substring.length,
  }
}

// ---------------------------------------------------------------------------
// 4. dsc-map.json
// ---------------------------------------------------------------------------

function checkDscMap(): Record<string, string> {
  section("4. DSC MAP (pdf-signer/dsc-map.json)")
  const mapPath = path.join(process.cwd(), "pdf-signer", "dsc-map.json")
  kv("map path", mapPath)
  kv("exists", fs.existsSync(mapPath))

  if (!fs.existsSync(mapPath)) {
    warn("dsc-map.json not found — the certificate can still come from Company.dscCertificateName in the DB")
    const example = `${mapPath}.example`
    if (fs.existsSync(example)) info(`template available: ${example}`)
    report.dscMap = { exists: false, entries: 0 }
    return {}
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(mapPath, "utf8"))
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      fail("dsc-map.json is not a JSON object — loadDscMap() ignores it silently")
      report.dscMap = { exists: true, invalid: true, entries: 0 }
      return {}
    }
    const entries = Object.entries(parsed).filter(
      ([k, v]) => typeof v === "string" && (v as string).trim() && !k.startsWith("_")
    ) as [string, string][]
    ok(`${entries.length} usable entry/entries`)
    for (const [k, v] of entries) log(`      "${k}" -> "${v}"`)
    const map = Object.fromEntries(entries.map(([k, v]) => [k.trim(), v.trim()]))
    report.dscMap = { exists: true, entries: entries.length, map }
    return map
  } catch (err: any) {
    fail(
      `dsc-map.json could not be parsed: ${err?.message || err} — loadDscMap() swallows this and returns {}, ` +
        "so resolution silently falls through to the database"
    )
    report.dscMap = { exists: true, parseError: String(err?.message || err), entries: 0 }
    return {}
  }
}

// ---------------------------------------------------------------------------
// 5. Certificate resolution
// ---------------------------------------------------------------------------

async function loadDb(): Promise<any | null> {
  try {
    return (await import("db")).default
  } catch (err: any) {
    warn(`database module unavailable: ${err?.message || err}`)
    return null
  }
}

async function listCompanies() {
  section("COMPANIES WITH A DSC CONFIGURED")
  const db = await loadDb()
  if (!db) return
  try {
    const rows = await db.company.findMany({
      select: { id: true, name: true, tan: true, dscCertificateName: true },
      orderBy: { name: "asc" },
    })
    const withDsc = rows.filter((r: any) => r.dscCertificateName?.trim())
    kv("companies total", rows.length)
    kv("with dscCertificateName", withDsc.length)
    for (const r of withDsc) log(`      #${r.id} ${r.tan} | ${r.name} -> "${r.dscCertificateName}"`)
    if (withDsc.length === 0) {
      fail("no company has dscCertificateName set — DSC attach is skipped for every company")
    }
    report.companies = { total: rows.length, withDsc }
  } catch (err: any) {
    fail(`query failed: ${err?.message || err}`)
  }
}

async function resolveCertificate(args: Args, map: Record<string, string>): Promise<string> {
  section("5. CERTIFICATE RESOLUTION")
  const res: Record<string, any> = { company: args.company, tan: args.tan, override: args.cert }
  kv("company", args.company || "(not provided)")
  kv("tan", args.tan || "(not provided)")
  kv("--cert override", args.cert || "(none)")

  if (args.cert) {
    ok(`using forced subject "${args.cert}" — resolution steps skipped`)
    res.resolved = args.cert
    report.resolution = res
    return args.cert
  }

  log("  order: explicit field -> dsc-map.json by TAN -> dsc-map.json by name -> DB by TAN -> DB by name")

  const tanKey = args.tan?.trim().toUpperCase()
  if (tanKey) {
    const hit = map[tanKey] || map[args.tan!.trim()]
    res.mapByTan = hit || null
    log(`  [map by TAN]   ${tanKey} -> ${hit ? `"${hit}"` : "no match"}`)
  } else {
    log("  [map by TAN]   skipped (no --tan)")
  }

  if (args.company) {
    const want = args.company.trim().toLowerCase()
    const hit = Object.entries(map).find(([k]) => k.toLowerCase() === want)
    res.mapByName = hit?.[1] || null
    log(`  [map by name]  "${args.company}" -> ${hit ? `"${hit[1]}"` : "no match"}`)
  }

  const db = await loadDb()
  if (db) {
    try {
      if (tanKey) {
        const row = await db.company.findUnique({
          where: { tan: tanKey },
          select: { id: true, name: true, tan: true, dscCertificateName: true },
        })
        res.dbByTan = row || null
        log(
          `  [db by TAN]    ${tanKey} -> ${
            row
              ? `#${row.id} "${row.name}", dscCertificateName=${
                  row.dscCertificateName ? `"${row.dscCertificateName}"` : "(empty)"
                }`
              : "no company row"
          }`
        )
      }
      if (args.company) {
        const row = await db.company.findFirst({
          where: { name: args.company },
          select: { id: true, name: true, tan: true, dscCertificateName: true },
        })
        res.dbByName = row || null
        log(
          `  [db by name]   "${args.company}" -> ${
            row
              ? `#${row.id} (${row.tan}), dscCertificateName=${
                  row.dscCertificateName ? `"${row.dscCertificateName}"` : "(empty)"
                }`
              : "no company row"
          }`
        )
      }
      const configured = await db.company.findMany({
        where: { dscCertificateName: { not: null } },
        select: { name: true, tan: true, dscCertificateName: true },
        take: 50,
      })
      const nonEmpty = configured.filter((c: any) => c.dscCertificateName?.trim())
      res.dbInventory = nonEmpty
      log(`  [db inventory] ${nonEmpty.length} company row(s) have dscCertificateName set`)
      for (const c of nonEmpty) log(`      ${c.tan} | ${c.name} -> "${c.dscCertificateName}"`)
    } catch (err: any) {
      warn(`database lookup failed: ${err?.message || err}`)
      res.dbError = String(err?.message || err)
    }
  }

  let resolved = ""
  try {
    resolved = await resolveDscCertificateName({
      companyName: args.company || "",
      tan: args.tan,
      dscCertificateName: null,
    })
  } catch (err: any) {
    fail(`resolveDscCertificateName() threw: ${err?.message || err}`)
    res.resolveError = String(err?.message || err)
  }

  res.resolved = resolved || null
  if (resolved) ok(`resolved certificate subject: "${resolved}"`)
  else
    fail(
      'no certificate resolved — production logs "no DSC configured for …" and SKIPS signing without ' +
        "failing the download. Fix: set Company.dscCertificateName, or add the TAN to pdf-signer/dsc-map.json"
    )

  report.resolution = res
  return resolved
}

// ---------------------------------------------------------------------------
// 6. Form 131 PDF generation
// ---------------------------------------------------------------------------

async function generateSampleForm131Pdf(args: Args): Promise<string | null> {
  section("6. FORM 131 PDF GENERATION (--generate)")
  const samplePath = path.resolve(
    args.sample || path.join("docs", "pdf-reference", "fusion-form131-sample.txt")
  )
  kv("sample txt", samplePath)
  if (!fs.existsSync(samplePath)) {
    fail("sample txt not found — pass --sample=C:\\path\\to\\FORM131.txt")
    report.generation = { ok: false, reason: "sample missing", samplePath }
    return null
  }

  try {
    const { parseForm131File } = await import("../utils/form131ParserExact")
    const { generateForm131Pdf, closeForm131Browser } = await import("../utils/form131PdfGeneratorExact")

    const records = parseForm131File(fs.readFileSync(samplePath, "utf8"))
    kv("records parsed", records.length)
    if (records.length === 0) {
      fail("no Form 131 records parsed from the sample")
      report.generation = { ok: false, reason: "no records", samplePath }
      return null
    }

    const record = (args.pan && records.find((r) => r.deducteeData?.pan === args.pan)) || records[0]!
    kv("using PAN", record.deducteeData?.pan)
    kv("certificate no", record.deducteeData?.certificateNumber)

    fs.mkdirSync(OUT_DIR, { recursive: true })
    const outputPath = path.join(OUT_DIR, `form131-${record.deducteeData?.pan || "UNKNOWN"}-${stamp}.pdf`)
    const t0 = Date.now()
    const status = await generateForm131Pdf({ outputPath, data: record }, { skipExisting: false })
    await closeForm131Browser().catch(() => {})
    ok(`PDF ${status} in ${Date.now() - t0}ms -> ${outputPath}`)
    report.generation = { ok: true, outputPath, ms: Date.now() - t0 }
    return outputPath
  } catch (err: any) {
    fail(`Form 131 PDF generation failed: ${err?.message || err}`)
    if (err?.stack) log(err.stack)
    info("Puppeteer/Chromium may be missing here — DSC can still be tested with --pdf / --dir")
    report.generation = { ok: false, error: String(err?.message || err) }
    return null
  }
}

// ---------------------------------------------------------------------------
// 7. Target PDFs
// ---------------------------------------------------------------------------

async function autoDiscoverPdfs(limit: number): Promise<string[]> {
  const roots = [
    path.join(process.cwd(), "public", "pdf", "form16a"),
    path.join(process.cwd(), "public", "pdf", "form16a-download"),
    path.join(process.cwd(), "public", "pdf", "child-certificates"),
  ]
  const found: { p: string; mtime: number }[] = []
  for (const root of roots) {
    if (!fs.existsSync(root)) continue
    for (const p of await glob("**/*.pdf", { cwd: root, absolute: true })) {
      try {
        found.push({ p, mtime: fs.statSync(p).mtimeMs })
      } catch {
        /* ignore */
      }
    }
  }
  found.sort((a, b) => b.mtime - a.mtime)
  return found.slice(0, limit).map((f) => f.p)
}

function checkPdfHealth(p: string) {
  // Long paths, non-ASCII names and file locks all break the signer.
  if (p.length > 240) warn(`path is ${p.length} chars — Windows MAX_PATH (260) problems are likely: ${p}`)
  if (/[^\x20-\x7E]/.test(p)) warn(`path contains non-ASCII characters, which some signers mishandle: ${p}`)
  try {
    const fd = fs.openSync(p, "r+")
    fs.closeSync(fd)
  } catch (err: any) {
    fail(
      `cannot open for writing (locked or read-only — close it in Acrobat / Explorer preview): ${p} — ${
        err?.code || err?.message
      }`
    )
  }
}

async function collectPdfs(args: Args, generated: string | null): Promise<string[]> {
  section("7. TARGET PDFs")
  let candidates: string[] = []

  if (generated) candidates.push(generated)
  for (const p of args.pdfs) candidates.push(path.resolve(p))

  if (args.dir) {
    const dir = path.resolve(args.dir)
    kv("scan dir", dir)
    if (!fs.existsSync(dir)) fail("--dir does not exist")
    else {
      const found = await glob("**/*.pdf", { cwd: dir, absolute: true })
      kv("pdfs found", found.length)
      candidates.push(...found)
    }
  }

  if (candidates.length === 0) {
    info("no --pdf/--dir/--generate given — auto-discovering the most recent generated certificates")
    const auto = await autoDiscoverPdfs(args.limit)
    kv("auto-discovered", auto.length)
    for (const p of auto) log(`      ${p}`)
    candidates.push(...auto)
  }

  candidates = candidates.filter((p, i) => candidates.indexOf(p) === i)
  for (const m of candidates.filter((p) => !fs.existsSync(p))) fail(`not found: ${m}`)
  candidates = candidates.filter((p) => fs.existsSync(p))

  if (candidates.length === 0) {
    fail("no PDFs to sign — pass --pdf / --dir, or use --generate")
    report.targets = []
    return []
  }

  const limited = candidates.slice(0, args.limit)
  if (candidates.length > limited.length) {
    info(`using ${limited.length} of ${candidates.length} PDF(s) (raise with --limit=N)`)
  }

  let targets: string[]
  if (args.inPlace) {
    warn("--in-place: the real PDFs will be overwritten with signed versions")
    targets = limited
  } else {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    targets = limited.map((src) => {
      if (path.dirname(src) === OUT_DIR) return src
      const dest = path.join(OUT_DIR, `${stamp}-${path.basename(src)}`)
      fs.copyFileSync(src, dest)
      log(`      copy: ${src}`)
      log(`         -> ${dest}`)
      return dest
    })
    info("signing copies under tmp/dsc-test/ (use --in-place to sign the originals)")
  }

  for (const t of targets) checkPdfHealth(t)
  report.targets = targets
  return targets
}

// ---------------------------------------------------------------------------
// Signer run
// ---------------------------------------------------------------------------

type SignerRun = {
  code: number | null
  signal: string | null
  stdout: string
  stderr: string
  ms: number
  timedOut: boolean
  error?: string
}

function buildInputJson(certificateName: string, pdfPaths: string[]) {
  return {
    CertificateName: certificateName,
    Pdfs: pdfPaths.map((p) => ({ InputPath: p, OutputPath: p })),
  }
}

function runSignerVerbose(exePath: string, inputJsonPath: string, timeoutSec: number): Promise<SignerRun> {
  return new Promise((resolve) => {
    const t0 = Date.now()
    log(`  command: "${exePath}" "${inputJsonPath}"`)
    log(`  timeout: ${timeoutSec}s`)

    let child: ReturnType<typeof spawn>
    try {
      // windowsHide MUST stay false here: the token's PIN dialog and any console the signer
      // opens have to be visible, otherwise a prompt is indistinguishable from a hang.
      child = spawn(exePath, [inputJsonPath], { cwd: process.cwd(), windowsHide: false })
    } catch (err: any) {
      // Node throws synchronously for e.g. ENOEXEC (wrong-platform binary).
      resolve({
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        ms: Date.now() - t0,
        timedOut: false,
        error: `${err?.code || ""} ${err?.message || String(err)}`.trim(),
      })
      return
    }

    kv("signer pid", child.pid)

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    let windowsProbed = false

    // Any titled window appearing while we wait is almost certainly the PIN prompt.
    const probeWindows = async (label: string) => {
      if (!IS_WINDOWS) return
      const ps = await powershell(
        "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | " +
          "Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress",
        20000
      )
      if (!ps.ok || !ps.stdout.trim()) return
      let list: any
      try {
        list = JSON.parse(ps.stdout.trim())
      } catch {
        return
      }
      log(`  [${label}] windows currently open on this desktop:`)
      for (const w of Array.isArray(list) ? list : [list]) {
        log(`      ${w.ProcessName} (pid ${w.Id}): ${w.MainWindowTitle}`)
      }
    }

    const done = (result: SignerRun) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(heartbeat)
      resolve(result)
    }

    const heartbeat = setInterval(() => {
      const secs = Math.round((Date.now() - t0) / 1000)
      log(`  [waiting] signer running for ${secs}s — no output yet`)
      if (secs >= 15 && !windowsProbed) {
        windowsProbed = true
        info(
          "if a PIN dialog is open, enter the PIN now. Check the taskbar and Alt+Tab — the dialog " +
            "may be behind this window."
        )
        void probeWindows("waiting")
      }
    }, 10000)

    const timer = setTimeout(async () => {
      timedOut = true
      warn(`signer still running after ${timeoutSec}s — collecting diagnostics, then killing it`)
      info(
        "a hang here means the signer is blocked on something: a token PIN prompt, a smart-card dialog, " +
          "a certificate-selection window, or a network call to a timestamp server (TSA) that cannot be reached."
      )
      await probeWindows("timeout")
      try {
        if (IS_WINDOWS && child.pid) {
          const kill = await run("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], 15000)
          if (kill.stdout.trim()) log(`  [taskkill] ${kill.stdout.trim()}`)
          if (!kill.ok && kill.stderr.trim()) log(`  [taskkill] ${kill.stderr.trim()}`)
        } else {
          child.kill()
        }
      } catch {
        /* ignore */
      }
      // Settle now rather than waiting for 'close': if the process is stuck behind a modal
      // dialog the kill may not land, and the diagnostic must still finish and write its log.
      done({
        code: null,
        signal: "killed-after-timeout",
        stdout,
        stderr,
        ms: Date.now() - t0,
        timedOut: true,
      })
    }, timeoutSec * 1000)

    child.stdout?.on("data", (d) => {
      const s = d.toString("utf8")
      stdout += s
      for (const line of s.split(/\r?\n/)) if (line.trim()) log(`  [signer stdout] ${line}`)
    })
    child.stderr?.on("data", (d) => {
      const s = d.toString("utf8")
      stderr += s
      for (const line of s.split(/\r?\n/)) if (line.trim()) log(`  [signer stderr] ${line}`)
    })
    child.on("error", (err: any) => {
      done({
        code: null,
        signal: null,
        stdout,
        stderr,
        ms: Date.now() - t0,
        timedOut,
        error: `${err?.code || ""} ${err?.message || String(err)}`.trim(),
      })
    })
    child.on("close", (code, signal) => {
      done({ code, signal: signal || null, stdout, stderr, ms: Date.now() - t0, timedOut })
    })
  })
}

function explainSignerFailure(res: SignerRun, certificateName: string, certs: StoreCert[]) {
  const blob = `${res.stdout}\n${res.stderr}`.toLowerCase()

  if (res.error?.includes("ENOEXEC")) {
    info("ENOEXEC — the OS refused to execute the binary. Expected on macOS/Linux; run this on Windows.")
    return
  }
  if (res.error?.includes("EACCES") || res.error?.includes("EPERM")) {
    info(
      "EACCES/EPERM — Windows blocked execution. Check antivirus / SmartScreen, and Unblock-File the pdf-signer folder."
    )
    return
  }
  if (res.error?.includes("ENOENT")) {
    info("ENOENT — the pdf-signer.exe path is wrong or the file was removed.")
    return
  }
  if (res.timedOut) {
    info("timed out — see the PIN/dialog note above; re-run with a larger --timeout if the PIN was entered late.")
    return
  }

  if (res.code === 2147516547 || blob.includes("you must install .net") || blob.includes("app-launch-failed")) {
    info(
      "THE .NET RUNTIME IS MISSING (exit code 0x80008083). Nothing is wrong with the certificate or the PDF — " +
        "the signer cannot start at all. Install the .NET 10 Desktop Runtime (x64) on this machine:\n" +
        "        winget install Microsoft.DotNet.DesktopRuntime.10\n" +
        "        or download it from https://dotnet.microsoft.com/download/dotnet/10.0 (Run desktop apps, x64)\n" +
        "        then re-run this test."
    )
    return
  }

  if (blob.includes("certificate not found") || blob.includes("no certificate") || blob.includes("subject")) {
    info(
      `the signer complained about the certificate. Configured subject: "${certificateName}". ` +
        `The store holds ${certs.length} certificate(s) — compare with sections 3 and 3b and use the exact CN.`
    )
  }
  if (blob.includes("access") || blob.includes("denied") || blob.includes("used by another process")) {
    info("file-access error — the PDF is open elsewhere, or the folder is read-only.")
  }
  if (blob.includes("keyset") || blob.includes("pin") || blob.includes("csp") || blob.includes("smart card")) {
    info("crypto-provider error — token not inserted, driver/middleware missing, or a wrong/blocked PIN.")
  }
  if (blob.includes("framework") || blob.includes("runtime") || blob.includes("hostfxr") || blob.includes(".net")) {
    info("the .NET runtime the signer needs is missing — see the runtime lines in section 2.")
  }
  if (!blob.trim() && res.code !== 0) {
    info(
      "the signer produced no output at all. That usually means a missing .NET runtime, a blocked binary " +
        "(Mark-of-the-Web / antivirus), or a crash before any output. Try running it by hand:\n" +
        "        pdf-signer\\pdf-signer.exe <the input json path printed above>"
    )
  }
}

async function signOnce(
  label: string,
  signer: SignerCheck,
  certificateName: string,
  pdfPaths: string[],
  args: Args,
  certs: StoreCert[]
): Promise<{ run: SignerRun; signedCount: number }> {
  const before = new Map<string, SignatureInfo>()
  for (const p of pdfPaths) {
    try {
      before.set(p, inspectPdfSignature(p))
    } catch {
      /* reported elsewhere */
    }
  }

  const inputJSON = buildInputJson(certificateName, pdfPaths)
  log("  input JSON handed to the signer:")
  log(JSON.stringify(inputJSON, null, 2))

  const tempDir = path.join(process.cwd(), "temp")
  fs.mkdirSync(tempDir, { recursive: true })
  const inputJsonPath = path.join(tempDir, `dsc-test-input-${stamp}-${label.replace(/\W+/g, "_")}.json`)
  fs.writeFileSync(inputJsonPath, JSON.stringify(inputJSON, null, 2), "utf8")
  kv("input json path", inputJsonPath)

  const res = await runSignerVerbose(signer.exePath, inputJsonPath, args.timeoutSec)
  kv("exit code", res.code)
  kv("killed by signal", res.signal)
  kv("duration", `${res.ms}ms`)
  kv("timed out", res.timedOut)
  if (res.error) fail(`spawn failed: ${res.error}`)
  else if (res.code === 0) ok("signer exited 0")
  else fail(`signer exited with code ${res.code}`)
  explainSignerFailure(res, certificateName, certs)

  let signedCount = 0
  for (const p of pdfPaths) {
    try {
      const after = inspectPdfSignature(p)
      const prev = before.get(p)
      describeSignature(path.basename(p), after)
      const newlySigned = after.signed && !(prev?.signed && prev.byteRangeCount === after.byteRangeCount)
      if (newlySigned) {
        signedCount++
        const grew = prev ? after.sizeBytes - prev.sizeBytes : 0
        ok(`${path.basename(p)} — signature present (${grew >= 0 ? "+" : ""}${grew} bytes)`)
      } else if (prev && after.sizeBytes !== prev.sizeBytes) {
        fail(`${path.basename(p)} — file changed but no signature found (partial write?)`)
      } else {
        fail(`${path.basename(p)} — unchanged, no signature`)
      }
    } catch (err: any) {
      fail(`could not re-read ${p}: ${err?.message || err}`)
    }
  }
  return { run: res, signedCount }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2))
  initLog(args.log)

  log("Form 131 — DSC attach diagnostic")
  log(`Command: node ${process.argv.slice(1).join(" ")}`)
  report.args = args

  await logEnvironment()

  if (args.listCompanies) {
    await listCompanies()
    writeJsonReport()
    log("")
    log(`Full log: ${logFilePath}`)
    return
  }

  const signer = await checkSignerBinary()
  const certs = await enumerateCertificates()
  const map = checkDscMap()
  const certificateName = await resolveCertificate(args, map)
  compareCertificateWithStore(certificateName, certs)

  const generated = args.generate ? await generateSampleForm131Pdf(args) : null
  const pdfPaths = await collectPdfs(args, generated)

  if (pdfPaths.length > 0) {
    section("8. SIGNATURE STATE BEFORE SIGNING")
    for (const p of pdfPaths) {
      try {
        const sig = inspectPdfSignature(p)
        describeSignature(path.basename(p), sig)
        if (sig.signed) warn(`${path.basename(p)} already carries a signature — another one will be added`)
      } catch (err: any) {
        fail(`could not read ${p}: ${err?.message || err}`)
      }
    }
  }

  const summary: Record<string, any> = {
    platform: process.platform,
    signerPresent: signer.exists,
    certificatesInStore: certs.length,
    dscMapEntries: Object.keys(map).length,
    certificateName: certificateName || null,
    pdfsTargeted: pdfPaths.length,
  }

  const finish = (verdict: string, note?: string) => {
    section("SUMMARY")
    for (const [k, v] of Object.entries(summary)) {
      kv(k, v && typeof v === "object" ? JSON.stringify(v) : v)
    }
    log("")
    log(`RESULT: ${verdict}`)
    if (note) info(note)
    report.summary = { ...summary, verdict }
    writeJsonReport()
    log("")
    log(`Full log:    ${logFilePath}`)
    log(`JSON report: ${jsonFilePath}`)
    log("Send BOTH files back — together they show the whole picture.")
    if (!verdict.startsWith("PASS")) process.exitCode = 1
  }

  if (pdfPaths.length === 0) return finish("FAIL — no PDFs to sign (see section 7)")
  if (!certificateName && !args.tryAllCerts) {
    return finish(
      "FAIL — no certificate resolved; production would SKIP signing",
      'fix the configuration, or re-run with --cert="<exact CN from section 3>" or --try-all-certs to test the signer itself'
    )
  }
  if (args.noSign) {
    report.summary = summary
    writeJsonReport()
    section("SUMMARY")
    info("--no-sign: stopped before launching the signer")
    for (const [k, v] of Object.entries(summary)) {
      kv(k, v && typeof v === "object" ? JSON.stringify(v) : v)
    }
    log("")
    log(`Full log:    ${logFilePath}`)
    log(`JSON report: ${jsonFilePath}`)
    return
  }
  if (!signer.exists) return finish("FAIL — pdf-signer.exe missing (see section 2)")

  // ---- primary attempt ----------------------------------------------------
  let signedCount = 0
  if (certificateName) {
    section("9. SIGNER RUN — resolved certificate")
    const r = await signOnce("primary", signer, certificateName, pdfPaths, args, certs)
    signedCount = r.signedCount
    summary.signerExitCode = r.run.code
    summary.signerError = r.run.error || null
    summary.signerTimedOut = r.run.timedOut
    summary.pdfsSigned = `${signedCount}/${pdfPaths.length}`
    report.primaryRun = { certificateName, ...r.run, signedCount }
  }

  // ---- fallback: try every certificate in the store ------------------------
  if (args.tryAllCerts && signedCount < pdfPaths.length) {
    section("10. FALLBACK — trying every certificate in the store")
    const usable = certs.filter((c) => c.hasPrivateKey && !c.expired)
    kv("candidates", usable.length)
    report.fallbackRuns = []
    for (const c of usable) {
      if (certificateName && c.cn.toLowerCase() === certificateName.trim().toLowerCase()) continue
      log("")
      log(`  --- trying CN="${c.cn}" (${c.store}, thumbprint ${c.thumbprint})`)
      const r = await signOnce(`cert-${c.thumbprint.slice(0, 8)}`, signer, c.cn, pdfPaths, args, certs)
      report.fallbackRuns.push({ cn: c.cn, thumbprint: c.thumbprint, ...r.run, signedCount: r.signedCount })
      if (r.signedCount > 0) {
        ok(
          `signing SUCCEEDED with CN="${c.cn}" — use this exact value as the company's dscCertificateName ` +
            "(or in pdf-signer/dsc-map.json)"
        )
        summary.workingCertificate = c.cn
        signedCount = r.signedCount
        break
      }
    }
  }

  // ---- production entry point ---------------------------------------------
  section("11. PRODUCTION PATH — attachDscToForm16aPdfs()")
  info("this is the exact function Form 131 generation calls once the PDFs are written")
  try {
    const prod = await attachDscToForm16aPdfs({
      companyName: args.company || "(diagnostic)",
      tan: args.tan,
      dscCertificateName: args.cert || summary.workingCertificate || null,
      pdfPaths,
      log: (m) => log(`  [attachDsc] ${m}`),
    })
    log(`  result: ${JSON.stringify(prod, null, 2)}`)
    summary.attachDscResult = prod
    report.productionRun = prod
  } catch (err: any) {
    fail(`attachDscToForm16aPdfs threw (it never should): ${err?.message || err}`)
    if (err?.stack) log(err.stack)
    summary.attachDscResult = { threw: String(err?.message || err) }
  }

  const passed = signedCount > 0 && signedCount === pdfPaths.length && Boolean(summary.attachDscResult?.signed)
  finish(
    passed
      ? "PASS — DSC attached to the Form 131 PDF(s)"
      : "FAIL — see the sections above (signer run, certificate store, resolution)"
  )
}

main()
  .catch((err) => {
    log("")
    fail(`unhandled error: ${err?.message || err}`)
    if (err?.stack) log(err.stack)
    report.unhandledError = { message: String(err?.message || err), stack: err?.stack }
    writeJsonReport()
    process.exitCode = 1
  })
  .finally(() => {
    logStream?.end()
  })
