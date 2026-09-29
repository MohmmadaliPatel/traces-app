#!/usr/bin/env node
/**
 * STANDALONE Form 131 DSC diagnostic — plain Node, ZERO npm dependencies.
 *
 * Use this when you only want to test DSC signing on another Windows machine and do not
 * want to copy the whole project. Copy just these to that machine, keeping the layout:
 *
 *     <folder>\scripts\dsc-test-standalone.js      (this file)
 *     <folder>\pdf-signer\                          (the whole folder, ~69 MB)
 *     <folder>\pdfs\*.pdf                           (any Form 131 PDFs to test with)
 *
 * Then, from <folder>:
 *
 *     node scripts\dsc-test-standalone.js --cert="<exact CN>" --dir=pdfs
 *     node scripts\dsc-test-standalone.js --try-all-certs --dir=pdfs
 *
 * It performs every check the full `yarn dsc:test` does EXCEPT the two that need the app:
 * database certificate resolution, and Form 131 PDF generation (bring ready-made PDFs
 * instead). Everything else — certificate store dump, signer run, signature verification —
 * is identical, because the signer contract (the input JSON) is reproduced exactly.
 *
 * Output: console + dsc-test-<timestamp>.log + dsc-test-<timestamp>.json next to the
 * script's working directory. Send both files back.
 *
 * CLI:
 *   --cert=SUBJECT     Certificate subject / CN to sign with
 *   --pdf=PATH         PDF to sign (repeatable)
 *   --dir=PATH         Sign every *.pdf under this directory (recursive)
 *   --limit=N          Max PDFs (default 2)
 *   --timeout=SEC      Kill the signer after SEC seconds (default 120)
 *   --in-place         Sign the originals instead of copies
 *   --try-all-certs    Try every usable certificate in the store until one signs
 *   --signer=PATH      Path to pdf-signer.exe (default ./pdf-signer/pdf-signer.exe)
 *   --no-sign          Run the checks but never launch the signer
 *   --log=PATH         Log file path
 */
"use strict"

const fs = require("fs")
const path = require("path")
const os = require("os")
const { spawn, execFile } = require("child_process")

const IS_WINDOWS = process.platform === "win32"
const startedAt = new Date()
const stamp = startedAt.toISOString().replace(/[:.]/g, "-")
const ROOT = process.cwd()
const OUT_DIR = path.join(ROOT, "dsc-test-output")

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

let logStream = null
let logFilePath = ""
let jsonFilePath = ""
const report = { startedAt: startedAt.toISOString(), argv: process.argv.slice(2), standalone: true }

function initLog(custom) {
  logFilePath = custom ? path.resolve(custom) : path.join(OUT_DIR, `dsc-test-${stamp}.log`)
  jsonFilePath = logFilePath.replace(/\.log$/i, "") + ".json"
  fs.mkdirSync(path.dirname(logFilePath), { recursive: true })
  logStream = fs.createWriteStream(logFilePath, { flags: "a" })
}

function log(msg = "") {
  console.log(msg)
  if (logStream) logStream.write(`${msg}\n`)
}
function section(title) {
  log("")
  log("=".repeat(78))
  log(title)
  log("=".repeat(78))
}
function kv(key, value) {
  const shown = value === undefined || value === null || value === "" ? "-" : String(value)
  log(`  ${key.padEnd(28)} ${shown}`)
}
const fail = (m) => log(`  [FAIL] ${m}`)
const ok = (m) => log(`  [ok]   ${m}`)
const warn = (m) => log(`  [warn] ${m}`)
const info = (m) => log(`  [info] ${m}`)

function writeJsonReport() {
  try {
    fs.writeFileSync(jsonFilePath, JSON.stringify(report, null, 2), "utf8")
  } catch (err) {
    log(`  [warn] could not write JSON report: ${err.message}`)
  }
}

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const a = {
    cert: "",
    pdfs: [],
    dir: "",
    limit: 2,
    timeoutSec: 120,
    inPlace: false,
    tryAllCerts: false,
    signer: "",
    noSign: false,
    log: "",
  }
  for (const raw of argv) {
    const eq = raw.indexOf("=")
    const flag = eq === -1 ? raw : raw.slice(0, eq)
    const value = eq === -1 ? "" : raw.slice(eq + 1).replace(/^["']|["']$/g, "")
    switch (flag) {
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
      case "--signer":
        a.signer = value
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
// Process helpers
// ---------------------------------------------------------------------------

function run(cmd, cmdArgs, timeoutMs = 30000) {
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
            error: err ? `${err.code || ""} ${err.message}`.trim() : undefined,
          })
        }
      )
    } catch (err) {
      resolve({ ok: false, stdout: "", stderr: "", error: `${err.code || ""} ${err.message}`.trim() })
    }
  })
}

function powershell(script, timeoutMs = 45000) {
  return run(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
    timeoutMs
  )
}

// ---------------------------------------------------------------------------
// PDF signature inspection
// ---------------------------------------------------------------------------

function signerHintsFromPkcs7(text) {
  const hints = []
  const re = /\/Contents\s*<([0-9A-Fa-f\s]{64,})>/g
  let m
  while ((m = re.exec(text)) !== null && hints.length < 20) {
    const hex = (m[1] || "").replace(/\s+/g, "")
    if (hex.length < 64) continue
    let bin = ""
    try {
      bin = Buffer.from(hex, "hex").toString("latin1")
    } catch {
      continue
    }
    for (const frag of bin.match(/[ -~]{4,}/g) || []) {
      if (/^[A-Za-z0-9 .,'&()\-_@]{4,64}$/.test(frag) && /[A-Za-z]{3}/.test(frag)) {
        if (!hints.includes(frag)) hints.push(frag)
      }
      if (hints.length >= 20) break
    }
  }
  return hints.slice(0, 20)
}

function inspectPdfSignature(pdfPath) {
  const buf = fs.readFileSync(pdfPath)
  const text = buf.toString("latin1")
  const st = fs.statSync(pdfPath)

  const countOf = (needle) => text.split(needle).length - 1
  const collect = (re) => {
    const out = []
    let m
    while ((m = re.exec(text)) !== null) {
      const v = (m[1] || "").trim()
      if (v && !out.includes(v)) out.push(v)
    }
    return out
  }

  const byteRangeCount = countOf("/ByteRange")
  const sigDictCount = countOf("/Type /Sig") + countOf("/Type/Sig")
  const signed = byteRangeCount > 0 && (sigDictCount > 0 || text.includes("Adobe.PPKLite"))

  return {
    signed,
    byteRangeCount,
    sigDictCount,
    subFilters: collect(/\/SubFilter\s*\/([A-Za-z0-9.#_]+)/g),
    names: collect(/\/Name\s*\(([^)]{0,120})\)/g),
    reasons: collect(/\/Reason\s*\(([^)]{0,120})\)/g),
    signerHints: signed ? signerHintsFromPkcs7(text) : [],
    sizeBytes: buf.length,
    mtime: st.mtime.toISOString(),
  }
}

function describeSignature(label, sig) {
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
  const env = {
    startedAt: startedAt.toISOString(),
    platform: process.platform,
    arch: process.arch,
    osType: os.type(),
    osRelease: os.release(),
    node: process.version,
    cwd: ROOT,
    user: os.userInfo().username,
    hostname: os.hostname(),
    mode: "standalone (no database, no PDF generation)",
  }

  kv("started", env.startedAt)
  kv("mode", env.mode)
  kv("platform", `${env.platform} (${env.arch})`)
  kv("os", `${env.osType} ${env.osRelease}`)
  kv("hostname", env.hostname)
  kv("user", env.user)
  kv("node", env.node)
  kv("cwd", env.cwd)
  kv("log file", logFilePath)
  kv("json report", jsonFilePath)

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
      info("the certificate store is PER USER — this account must own the DSC")
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
          "session 0 — non-interactive/service session. A token PIN prompt cannot appear here, " +
            "so signing will hang or fail. Run from a normal desktop login."
        )
      }
    }
  }

  try {
    fs.mkdirSync(OUT_DIR, { recursive: true })
    const probe = path.join(OUT_DIR, `.write-probe-${Date.now()}`)
    fs.writeFileSync(probe, "x")
    fs.unlinkSync(probe)
    env.outputWritable = true
  } catch {
    env.outputWritable = false
  }
  kv("output dir writable", env.outputWritable)

  report.environment = env
}

// ---------------------------------------------------------------------------
// 2. Signer binary
// ---------------------------------------------------------------------------

function peMachineType(exePath) {
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
    return (
      { 0x014c: "x86 (32-bit)", 0x8664: "x64", 0xaa64: "ARM64", 0x01c4: "ARM" }[machine] ||
      `0x${machine.toString(16)}`
    )
  } catch (err) {
    return `unreadable (${err.message})`
  }
}

async function checkSignerBinary(args) {
  section("2. SIGNER BINARY")
  const result = {}
  const exePath = args.signer
    ? path.resolve(args.signer)
    : path.join(ROOT, "pdf-signer", "pdf-signer.exe")
  const signerDir = path.dirname(exePath)

  kv("signer exe", exePath)
  result.exePath = exePath
  result.exeExists = fs.existsSync(exePath)
  kv("exists", result.exeExists)

  if (!result.exeExists) {
    fail(
      "pdf-signer.exe not found. Copy the WHOLE pdf-signer folder next to this script, " +
        "or pass --signer=C:\\path\\to\\pdf-signer.exe"
    )
    report.signer = result
    return { exePath, exists: false }
  }

  result.files = {}
  for (const name of [
    "pdf-signer.exe",
    "pdf-signer.dll",
    "pdf-signer.runtimeconfig.json",
    "pdf-signer.deps.json",
    "Spire.Pdf.dll",
  ]) {
    const p = path.join(signerDir, name)
    if (fs.existsSync(p)) {
      const st = fs.statSync(p)
      result.files[name] = { size: st.size, mtime: st.mtime.toISOString() }
      ok(`${name} (${st.size} bytes)`)
    } else {
      result.files[name] = null
      if (name === "pdf-signer.deps.json") warn(`${name} missing`)
      else fail(`${name} MISSING — copy the entire pdf-signer folder, not just the .exe`)
    }
  }

  result.peMachine = peMachineType(exePath)
  kv("exe architecture", result.peMachine)
  if (IS_WINDOWS && result.peMachine === "x64" && process.arch === "arm64") {
    info("x64 binary on ARM64 Windows — runs under emulation; the x64 .NET runtime must be installed")
  }

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
      ok("no Mark-of-the-Web (not a blocked file)")
    }
    info(
      "files copied over the network or unzipped from a download are frequently blocked — " +
        "if the signer fails with no output, run the Unblock-File command above"
    )
  }

  const runtimeCfgPath = path.join(signerDir, "pdf-signer.runtimeconfig.json")
  if (fs.existsSync(runtimeCfgPath)) {
    try {
      const cfg = JSON.parse(fs.readFileSync(runtimeCfgPath, "utf8"))
      const frameworks = [cfg && cfg.runtimeOptions && cfg.runtimeOptions.framework]
        .concat((cfg && cfg.runtimeOptions && cfg.runtimeOptions.frameworks) || [])
        .filter(Boolean)
      result.tfm = cfg && cfg.runtimeOptions && cfg.runtimeOptions.tfm
      result.requiredFrameworks = frameworks.map((f) => `${f.name} ${f.version}`)
      kv("target framework", result.tfm)
      for (const f of result.requiredFrameworks) kv("requires runtime", f)
    } catch (err) {
      warn(`could not parse pdf-signer.runtimeconfig.json: ${err.message}`)
    }
  }

  const runtimesDir = path.join(signerDir, "runtimes")
  if (fs.existsSync(runtimesDir)) {
    result.nativeRuntimes = fs
      .readdirSync(runtimesDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
    kv("native runtimes", result.nativeRuntimes.join(", "))
  } else {
    warn("runtimes/ folder missing — copy the whole pdf-signer folder")
  }

  const dotnet = await run("dotnet", ["--list-runtimes"], 30000)
  if (dotnet.ok) {
    const lines = dotnet.stdout.split(/\r?\n/).filter((l) => l.trim())
    result.dotnetRuntimes = lines
    kv("dotnet runtimes", `${lines.length} found`)
    for (const l of lines) log(`      ${l}`)
    for (const req of result.requiredFrameworks || []) {
      const parts = req.split(" ")
      const name = parts[0]
      const major = String(parts[1] || "").split(".")[0]
      if (lines.some((l) => l.startsWith(`${name} ${major}.`))) ok(`runtime present for ${req}`)
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
        "either the .NET runtime is not installed (a problem), or the signer is self-contained (fine)"
    )
  }

  report.signer = result
  return { exePath, exists: true }
}

// ---------------------------------------------------------------------------
// 3. Certificate store
// ---------------------------------------------------------------------------

function cnOf(subject) {
  const m = String(subject || "").match(/CN=([^,]+)/i)
  return (m && m[1] ? m[1] : subject || "").trim()
}

async function enumerateCertificates() {
  section("3. WINDOWS CERTIFICATE STORE")
  const certs = []

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
    let parsed
    try {
      parsed = JSON.parse(raw)
    } catch (err) {
      warn(`could not parse the certificate list for ${store}: ${err.message}`)
      log(`      raw: ${raw.slice(0, 500)}`)
      continue
    }
    for (const c of Array.isArray(parsed) ? parsed : [parsed]) {
      const subject = String((c && c.Subject) || "")
      const notAfter = String((c && c.NotAfter) || "")
      certs.push({
        store,
        subject,
        cn: cnOf(subject),
        friendlyName: String((c && c.FriendlyName) || ""),
        issuer: String((c && c.Issuer) || ""),
        thumbprint: String((c && c.Thumbprint) || ""),
        notBefore: String((c && c.NotBefore) || ""),
        notAfter,
        hasPrivateKey: Boolean(c && c.HasPrivateKey),
        expired: notAfter ? new Date(notAfter).getTime() < Date.now() : false,
      })
    }
  }

  kv("certificates found", certs.length)
  if (certs.length === 0) {
    fail(
      "no certificates in CurrentUser\\My or LocalMachine\\My — plug in the DSC token, install its " +
        "driver/middleware, and log in as the DSC owner"
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

  // Which CSP/KSP and key container each certificate points at. A certificate whose
  // container belongs to a different token (or to a stale enrolment) prompts for a PIN
  // that the inserted token cannot satisfy — it looks exactly like a "wrong PIN".
  log("")
  log("  --- key provider / container per certificate (certutil) ---")
  for (const c of certs) {
    const args = c.store === "CurrentUser\\My" ? ["-user", "-store", "My", c.thumbprint] : ["-store", "My", c.thumbprint]
    const cu = await run("certutil.exe", args, 25000)
    if (!cu.ok && !cu.stdout.trim()) {
      warn(`certutil failed for ${c.cn}: ${cu.error || cu.stderr.trim()}`)
      continue
    }
    const wanted = /^\s*(Provider\s*=|Provider\s*Type|Key Container\s*=|Unique container name|Private key is|Signature test|Encryption test|Missing|ProviderType\s*=|KeySpec\s*=)/i
    const lines = cu.stdout.split(/\r?\n/).filter((l) => wanted.test(l))
    log(`  CN=${c.cn}`)
    if (lines.length === 0) {
      warn("    certutil returned no provider/container details")
      const err = (cu.stdout.match(/CertUtil: .*/g) || []).slice(0, 3)
      for (const e of err) log(`    ${e.trim()}`)
    }
    for (const l of lines) log(`    ${l.trim()}`)
    c.providerInfo = lines.map((l) => l.trim())
  }

  const usable = certs.filter((c) => c.hasPrivateKey && !c.expired)
  log("")
  kv("usable for signing", `${usable.length}/${certs.length}`)
  info('use the CN exactly as printed above (without the "CN=" prefix) as dscCertificateName')
  info(
    "if the PIN dialog rejects the correct PIN, compare the Provider / Key Container above with the " +
      "token actually plugged in — a certificate left behind by an older token prompts for a PIN that " +
      "the current token cannot satisfy"
  )
  report.certificates = { count: certs.length, usable: usable.length, list: certs }
  return certs
}

function compareCertificateWithStore(certificateName, certs) {
  section("3b. CONFIGURED SUBJECT vs CERTIFICATE STORE")
  kv("configured subject", certificateName || "(none)")
  if (!certificateName) return info("nothing to compare — pass --cert or --try-all-certs")
  if (!IS_WINDOWS) return info("skipped — not running on Windows")
  if (certs.length === 0) return fail("no certificates in the store to match against")

  const want = certificateName.trim().toLowerCase()
  const exactCn = certs.filter((c) => c.cn.toLowerCase() === want)
  const exactFriendly = certs.filter((c) => c.friendlyName.trim().toLowerCase() === want)
  const substring = certs.filter((c) => c.subject.toLowerCase().includes(want))

  kv("exact CN match", exactCn.length)
  kv("exact FriendlyName match", exactFriendly.length)
  kv("subject substring match", substring.length)

  const matches = substring.length ? substring : exactCn.concat(exactFriendly)
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
    warn(`${matches.length} certificates match "${certificateName}" — the signer picks one of them:`)
    for (const m of matches) log(`      ${m.store} ${m.cn} (thumbprint ${m.thumbprint}, expires ${m.notAfter})`)
  } else {
    const m = matches[0]
    ok(`matches ${m.store} CN=${m.cn} (thumbprint ${m.thumbprint})`)
    if (!m.hasPrivateKey) fail("...but it has NO private key — signing will fail")
    if (m.expired) fail("...but it is EXPIRED")
    if (m.store === "LocalMachine\\My") {
      info("the match is in LocalMachine — signers usually read CurrentUser; import the DSC there if signing fails")
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
// 4. dsc-map.json (optional here — no database in standalone mode)
// ---------------------------------------------------------------------------

function checkDscMap() {
  section("4. DSC MAP (pdf-signer/dsc-map.json)")
  const mapPath = path.join(ROOT, "pdf-signer", "dsc-map.json")
  kv("map path", mapPath)
  kv("exists", fs.existsSync(mapPath))
  if (!fs.existsSync(mapPath)) {
    info("not present — in standalone mode the certificate comes from --cert / --try-all-certs anyway")
    report.dscMap = { exists: false, entries: 0 }
    return {}
  }
  try {
    const parsed = JSON.parse(fs.readFileSync(mapPath, "utf8"))
    const entries = Object.entries(parsed).filter(
      ([k, v]) => typeof v === "string" && v.trim() && !k.startsWith("_")
    )
    ok(`${entries.length} usable entry/entries`)
    for (const [k, v] of entries) log(`      "${k}" -> "${v}"`)
    report.dscMap = { exists: true, entries: entries.length, map: Object.fromEntries(entries) }
    return Object.fromEntries(entries)
  } catch (err) {
    fail(`dsc-map.json could not be parsed: ${err.message} — the app ignores this silently and falls back to the DB`)
    report.dscMap = { exists: true, parseError: err.message, entries: 0 }
    return {}
  }
}

// ---------------------------------------------------------------------------
// 5. Target PDFs
// ---------------------------------------------------------------------------

function findPdfsRecursively(dir, acc = []) {
  let entries = []
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true })
  } catch {
    return acc
  }
  for (const e of entries) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) findPdfsRecursively(full, acc)
    else if (e.isFile() && e.name.toLowerCase().endsWith(".pdf")) acc.push(full)
  }
  return acc
}

function checkPdfHealth(p) {
  if (p.length > 240) warn(`path is ${p.length} chars — Windows MAX_PATH (260) problems are likely: ${p}`)
  if (/[^\x20-\x7E]/.test(p)) warn(`path contains non-ASCII characters, which some signers mishandle: ${p}`)
  try {
    const fd = fs.openSync(p, "r+")
    fs.closeSync(fd)
  } catch (err) {
    fail(`cannot open for writing (locked or read-only — close it in Acrobat/preview): ${p} — ${err.code || err.message}`)
  }
}

function collectPdfs(args) {
  section("5. TARGET PDFs")
  let candidates = args.pdfs.map((p) => path.resolve(p))

  if (args.dir) {
    const dir = path.resolve(args.dir)
    kv("scan dir", dir)
    if (!fs.existsSync(dir)) fail("--dir does not exist")
    else {
      const found = findPdfsRecursively(dir)
      kv("pdfs found", found.length)
      candidates = candidates.concat(found)
    }
  }

  if (candidates.length === 0) {
    info("no --pdf/--dir given — scanning the current folder for PDFs")
    const found = findPdfsRecursively(ROOT).filter((p) => !p.startsWith(OUT_DIR))
    kv("pdfs found", found.length)
    for (const p of found.slice(0, 10)) log(`      ${p}`)
    candidates = found
  }

  candidates = candidates.filter((p, i) => candidates.indexOf(p) === i).filter((p) => fs.existsSync(p))
  if (candidates.length === 0) {
    fail("no PDFs to sign — copy a Form 131 PDF next to this script, or pass --pdf / --dir")
    report.targets = []
    return []
  }

  const limited = candidates.slice(0, args.limit)
  if (candidates.length > limited.length) info(`using ${limited.length} of ${candidates.length} PDF(s) (raise with --limit=N)`)

  let targets
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
    info(`signing copies under ${OUT_DIR} (use --in-place to sign the originals)`)
  }

  for (const t of targets) checkPdfHealth(t)
  report.targets = targets
  return targets
}

// ---------------------------------------------------------------------------
// 6. Signer run
// ---------------------------------------------------------------------------

function runSignerVerbose(exePath, inputJsonPath, timeoutSec) {
  return new Promise((resolve) => {
    const t0 = Date.now()
    log(`  command: "${exePath}" "${inputJsonPath}"`)
    log(`  timeout: ${timeoutSec}s`)

    let child
    try {
      // windowsHide MUST stay false here: the token's PIN dialog and any console the
      // signer opens have to be visible, otherwise a prompt looks like a hang.
      child = spawn(exePath, [inputJsonPath], { cwd: ROOT, windowsHide: false })
    } catch (err) {
      resolve({
        code: null,
        signal: null,
        stdout: "",
        stderr: "",
        ms: Date.now() - t0,
        timedOut: false,
        error: `${err.code || ""} ${err.message}`.trim(),
      })
      return
    }

    kv("signer pid", child.pid)

    let stdout = ""
    let stderr = ""
    let timedOut = false
    let settled = false
    let windowsProbed = false

    // Any window with a title that appears while we wait is almost certainly the PIN prompt.
    const probeWindows = async (label) => {
      if (!IS_WINDOWS) return
      const ps = await powershell(
        "Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | " +
          "Select-Object Id,ProcessName,MainWindowTitle | ConvertTo-Json -Compress",
        20000
      )
      if (!ps.ok || !ps.stdout.trim()) return
      let list
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

    const heartbeat = setInterval(() => {
      const secs = Math.round((Date.now() - t0) / 1000)
      log(`  [waiting] signer running for ${secs}s — no output yet`)
      if (secs >= 15 && !windowsProbed) {
        windowsProbed = true
        info(
          "if a PIN dialog is open, enter the PIN now. Check the taskbar and Alt+Tab — the dialog " +
            "may be behind this window."
        )
        probeWindows("waiting")
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

    const done = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      clearInterval(heartbeat)
      resolve(result)
    }

    if (child.stdout) {
      child.stdout.on("data", (d) => {
        const s = d.toString("utf8")
        stdout += s
        for (const line of s.split(/\r?\n/)) if (line.trim()) log(`  [signer stdout] ${line}`)
      })
    }
    if (child.stderr) {
      child.stderr.on("data", (d) => {
        const s = d.toString("utf8")
        stderr += s
        for (const line of s.split(/\r?\n/)) if (line.trim()) log(`  [signer stderr] ${line}`)
      })
    }
    child.on("error", (err) => {
      done({
        code: null,
        signal: null,
        stdout,
        stderr,
        ms: Date.now() - t0,
        timedOut,
        error: `${err.code || ""} ${err.message}`.trim(),
      })
    })
    child.on("close", (code, signal) => {
      done({ code, signal: signal || null, stdout, stderr, ms: Date.now() - t0, timedOut })
    })
  })
}

function explainSignerFailure(res, certificateName, certs) {
  const blob = `${res.stdout}\n${res.stderr}`.toLowerCase()
  const err = res.error || ""

  if (err.includes("ENOEXEC")) return info("ENOEXEC — the OS refused to execute the binary. Run this on Windows.")
  if (err.includes("EACCES") || err.includes("EPERM"))
    return info("EACCES/EPERM — Windows blocked execution. Check antivirus/SmartScreen and Unblock-File the folder.")
  if (err.includes("ENOENT")) return info("ENOENT — the pdf-signer.exe path is wrong or the file was removed.")
  if (res.timedOut) return info("timed out — see the PIN/dialog note above; retry with a larger --timeout.")

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
      `the signer complained about the certificate. Configured: "${certificateName}". ` +
        `The store holds ${certs.length} certificate(s) — compare with sections 3 and 3b.`
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
      "the signer produced no output at all. Usually a missing .NET runtime, a blocked binary " +
        "(Mark-of-the-Web / antivirus), or a crash before any output."
    )
  }
}

async function signOnce(label, exePath, certificateName, pdfPaths, args, certs) {
  const before = new Map()
  for (const p of pdfPaths) {
    try {
      before.set(p, inspectPdfSignature(p))
    } catch {
      /* reported elsewhere */
    }
  }

  // Exactly the contract the app's signPdfPathsWithCertificate() uses.
  const inputJSON = {
    CertificateName: certificateName,
    Pdfs: pdfPaths.map((p) => ({ InputPath: p, OutputPath: p })),
  }
  log("  input JSON handed to the signer:")
  log(JSON.stringify(inputJSON, null, 2))

  fs.mkdirSync(OUT_DIR, { recursive: true })
  const inputJsonPath = path.join(OUT_DIR, `input-${stamp}-${label.replace(/\W+/g, "_")}.json`)
  fs.writeFileSync(inputJsonPath, JSON.stringify(inputJSON, null, 2), "utf8")
  kv("input json path", inputJsonPath)

  const res = await runSignerVerbose(exePath, inputJsonPath, args.timeoutSec)
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
      const newlySigned = after.signed && !(prev && prev.signed && prev.byteRangeCount === after.byteRangeCount)
      if (newlySigned) {
        signedCount++
        const grew = prev ? after.sizeBytes - prev.sizeBytes : 0
        ok(`${path.basename(p)} — signature present (${grew >= 0 ? "+" : ""}${grew} bytes)`)
      } else if (prev && after.sizeBytes !== prev.sizeBytes) {
        fail(`${path.basename(p)} — file changed but no signature found (partial write?)`)
      } else {
        fail(`${path.basename(p)} — unchanged, no signature`)
      }
    } catch (err) {
      fail(`could not re-read ${p}: ${err.message}`)
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

  log("Form 131 — DSC attach diagnostic (STANDALONE)")
  log(`Command: node ${process.argv.slice(1).join(" ")}`)
  report.args = args

  await logEnvironment()
  const signer = await checkSignerBinary(args)
  const certs = await enumerateCertificates()
  compareCertificateWithStore(args.cert, certs)
  checkDscMap()
  const pdfPaths = collectPdfs(args)

  if (pdfPaths.length > 0) {
    section("5b. SIGNATURE STATE BEFORE SIGNING")
    for (const p of pdfPaths) {
      try {
        const sig = inspectPdfSignature(p)
        describeSignature(path.basename(p), sig)
        if (sig.signed) warn(`${path.basename(p)} already carries a signature — another one will be added`)
      } catch (err) {
        fail(`could not read ${p}: ${err.message}`)
      }
    }
  }

  const summary = {
    mode: "standalone",
    platform: process.platform,
    signerPresent: signer.exists,
    certificatesInStore: certs.length,
    certificateName: args.cert || null,
    pdfsTargeted: pdfPaths.length,
  }

  const finish = (verdict, note) => {
    section("SUMMARY")
    for (const [k, v] of Object.entries(summary)) kv(k, v && typeof v === "object" ? JSON.stringify(v) : v)
    log("")
    log(`RESULT: ${verdict}`)
    if (note) info(note)
    report.summary = Object.assign({}, summary, { verdict })
    writeJsonReport()
    log("")
    log(`Full log:    ${logFilePath}`)
    log(`JSON report: ${jsonFilePath}`)
    log("Send BOTH files back — together they show the whole picture.")
    if (!verdict.startsWith("PASS")) process.exitCode = 1
  }

  if (pdfPaths.length === 0) return finish("FAIL — no PDFs to sign (see section 5)")
  if (!signer.exists) return finish("FAIL — pdf-signer.exe missing (see section 2)")
  if (!args.cert && !args.tryAllCerts) {
    return finish(
      "FAIL — no certificate given",
      'pass --cert="<exact CN from section 3>", or --try-all-certs to try every certificate in the store'
    )
  }
  if (args.noSign) {
    report.summary = summary
    writeJsonReport()
    section("SUMMARY")
    info("--no-sign: stopped before launching the signer")
    for (const [k, v] of Object.entries(summary)) kv(k, v && typeof v === "object" ? JSON.stringify(v) : v)
    log("")
    log(`Full log:    ${logFilePath}`)
    log(`JSON report: ${jsonFilePath}`)
    return
  }

  let signedCount = 0
  if (args.cert) {
    section("6. SIGNER RUN — given certificate")
    const r = await signOnce("primary", signer.exePath, args.cert, pdfPaths, args, certs)
    signedCount = r.signedCount
    summary.signerExitCode = r.run.code
    summary.signerError = r.run.error || null
    summary.signerTimedOut = r.run.timedOut
    summary.pdfsSigned = `${signedCount}/${pdfPaths.length}`
    report.primaryRun = Object.assign({ certificateName: args.cert }, r.run, { signedCount })
  }

  if (args.tryAllCerts && signedCount < pdfPaths.length) {
    section("7. FALLBACK — trying every certificate in the store")
    const usable = certs.filter((c) => c.hasPrivateKey && !c.expired)
    kv("candidates", usable.length)
    report.fallbackRuns = []
    for (const c of usable) {
      if (args.cert && c.cn.toLowerCase() === args.cert.trim().toLowerCase()) continue
      log("")
      log(`  --- trying CN="${c.cn}" (${c.store}, thumbprint ${c.thumbprint})`)
      const r = await signOnce(`cert-${c.thumbprint.slice(0, 8)}`, signer.exePath, c.cn, pdfPaths, args, certs)
      report.fallbackRuns.push(Object.assign({ cn: c.cn, thumbprint: c.thumbprint }, r.run, { signedCount: r.signedCount }))
      if (r.signedCount > 0) {
        ok(`signing SUCCEEDED with CN="${c.cn}" — use this exact value as the company's dscCertificateName`)
        summary.workingCertificate = c.cn
        signedCount = r.signedCount
        break
      }
    }
  }

  finish(
    signedCount > 0 && signedCount === pdfPaths.length
      ? "PASS — DSC attached to the PDF(s)"
      : "FAIL — see the sections above (signer run, certificate store)"
  )
}

main()
  .catch((err) => {
    log("")
    fail(`unhandled error: ${err && err.message ? err.message : err}`)
    if (err && err.stack) log(err.stack)
    report.unhandledError = { message: String(err && err.message ? err.message : err), stack: err && err.stack }
    writeJsonReport()
    process.exitCode = 1
  })
  .finally(() => {
    if (logStream) logStream.end()
  })
