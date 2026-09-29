import fs from "fs"
import fsPromises from "fs/promises"
import os from "os"
import path from "path"
import { spawn, execFile } from "child_process"
import { glob } from "glob"
import db from "db"
import { inspectPdfSignature } from "./pdfSignatureInfo"
import { readSignatureBox } from "src/form16/utils/dscSignatureBox"
import { getRememberedDscPin } from "src/form16/utils/dscPinVault"
import { signViaDaemon, signerDaemonEnabled } from "src/form16/utils/dscSignerDaemon"
import { isTokenLikelyWarm, markSignSucceeded, withSignerLock } from "./dscSession"

export type SignForm16PdfsResult = {
  attempted: boolean
  signed: boolean
  certificateName?: string
  pdfCount: number
  /** PDFs that carry a signature after the run (verified by reading the file). */
  signedCount?: number
  unsignedPaths?: string[]
  /** True when every PDF was checked after signing, rather than trusting the exit code. */
  verified?: boolean
  skippedReason?: string
  error?: string
}

/** Seconds allowed for the signer itself, on top of a per-PDF allowance. */
function signerTimeoutMs(pdfCount: number): number {
  const warm = isTokenLikelyWarm()
  const baseSec = warm
    ? parseInt(process.env.DSC_SIGN_TIMEOUT_SEC || "", 10) || 120
    : // Cold: a human has to find the PIN dialog and type the PIN.
      parseInt(process.env.DSC_PIN_TIMEOUT_SEC || "", 10) || 300
  const perPdfMs = parseInt(process.env.DSC_PER_PDF_MS || "", 10) || 1500
  return baseSec * 1000 + Math.max(0, pdfCount) * perPdfMs
}

function pdfSignerExePath() {
  return path.join(process.cwd(), "pdf-signer", "pdf-signer.exe")
}

function dscMapPath() {
  return path.join(process.cwd(), "pdf-signer", "dsc-map.json")
}

function loadDscMap(): Record<string, string> {
  try {
    const raw = fs.readFileSync(dscMapPath(), "utf8")
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    const out: Record<string, string> = {}
    for (const [key, value] of Object.entries(parsed)) {
      if (typeof value === "string" && value.trim()) {
        out[key.trim()] = value.trim()
      }
    }
    return out
  } catch {
    return {}
  }
}

function lookupDscMap(map: Record<string, string>, companyName: string, tan?: string): string | undefined {
  if (tan) {
    const tanKey = tan.trim().toUpperCase()
    const byTan = map[tanKey] || map[tan.trim()]
    if (byTan) return byTan
  }
  const want = companyName.trim().toLowerCase()
  for (const [key, value] of Object.entries(map)) {
    if (key.toLowerCase() === want) return value
  }
  return undefined
}

/**
 * Resolve Windows cert subject for auto-DSC.
 * Returns empty string when no DSC is configured (caller should skip signing).
 * Order: explicit company field → dsc-map.json (TAN / name) → DB by TAN → DB by name →
 * DSC_CERTIFICATE_NAME env var (install-wide default).
 * Does NOT fall back to company name as the certificate subject.
 */
export async function resolveDscCertificateName(opts: {
  companyName: string
  tan?: string
  dscCertificateName?: string | null
}): Promise<string> {
  const explicit = opts.dscCertificateName?.trim()
  if (explicit) return explicit

  const map = loadDscMap()
  const fromMap = lookupDscMap(map, opts.companyName, opts.tan)
  if (fromMap) return fromMap

  const tan = opts.tan?.trim().toUpperCase()
  if (tan) {
    const company = await db.company.findUnique({
      where: { tan },
      select: { dscCertificateName: true },
    })
    if (company?.dscCertificateName?.trim()) return company.dscCertificateName.trim()
  }

  const byName = await db.company.findFirst({
    where: { name: opts.companyName },
    select: { dscCertificateName: true },
  })
  if (byName?.dscCertificateName?.trim()) return byName.dscCertificateName.trim()

  // Last resort: a single certificate configured for the whole install. Lets one DSC sign
  // for every company without setting dscCertificateName on each row.
  const fallback = process.env.DSC_CERTIFICATE_NAME?.trim()
  if (fallback) return fallback

  return ""
}

/** One PDF in a signing job, with the optional stamp rectangle measured at generation time. */
export type SignerJobPdf = {
  InputPath: string
  OutputPath: string
  Page?: number
  X?: number
  Y?: number
  Width?: number
  Height?: number
}

export type SignerJob = {
  CertificateName: string
  /** Token PIN. Passed over stdin only — it must never reach a file or a command line. */
  Pin?: string
  Reason?: string
  Location?: string
  Pdfs: SignerJobPdf[]
}

export function runPdfSigner(job: SignerJob, opts: { pdfCount?: number } = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    const exePath = pdfSignerExePath()
    const timeoutMs = signerTimeoutMs(opts.pdfCount ?? 1)

    let child: ReturnType<typeof spawn>
    try {
      // "-" makes the signer read the job from stdin, so a PIN never touches the disk.
      child = spawn(exePath, ["-"], {
        cwd: process.cwd(),
        // Must stay false: the DSC token's PIN dialog is raised by the crypto provider from
        // inside the signer process. Hiding the window makes a PIN prompt look like a hang.
        windowsHide: false,
      })
    } catch (err: any) {
      // Node throws synchronously for ENOEXEC (e.g. running the Windows binary elsewhere).
      reject(err)
      return
    }

    try {
      child.stdin?.end(JSON.stringify(job), "utf8")
    } catch (err: any) {
      reject(err)
      return
    }

    let stdout = ""
    let stderr = ""
    let settled = false
    let timedOut = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }

    const timer = setTimeout(() => {
      timedOut = true
      // A soft kill does not land on a process blocked in a modal dialog.
      if (process.platform === "win32" && child.pid) {
        execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], () => {})
      } else {
        try {
          child.kill()
        } catch {
          /* ignore */
        }
      }
      finish(() =>
        reject(
          new Error(
            `PDF signer timed out after ${Math.round(timeoutMs / 1000)}s. The DSC token is most ` +
              `likely waiting on an unanswered PIN dialog on ${os.hostname()}, or is locked. ` +
              `Unlock it once with "yarn dsc:unlock", then retry.`
          )
        )
      )
    }, timeoutMs)

    child.stdout?.on("data", (data) => {
      stdout += data.toString("utf8")
      console.log(data.toString("utf8"))
    })

    child.stderr?.on("data", (data) => {
      stderr += data.toString("utf8")
      console.log(data.toString("utf8"))
    })

    child.on("error", (err) => {
      finish(() => reject(err))
    })

    child.on("close", (code) => {
      if (timedOut) return
      finish(() => {
        if (code === 0) {
          resolve(stdout || "PDF signer completed")
        } else {
          reject(new Error(stderr || stdout || `PDF signer exited with code ${code}`))
        }
      })
    })
  })
}

export async function signPdfPathsWithCertificate(
  certificateName: string,
  pdfPaths: string[],
  opts: { log?: (msg: string) => void; pin?: string } = {}
): Promise<string[]> {
  const existing = pdfPaths.filter((p) => {
    try {
      return fs.existsSync(p) && fs.statSync(p).isFile()
    } catch {
      return false
    }
  })
  if (existing.length === 0) return []

  // Each certificate carries the rectangle of its own signature cell, measured when the PDF was
  // generated. A PDF without one (generated before this existed, or by another tool) is sent
  // without a rectangle and the signer falls back to its default corner.
  const pdfs: SignerJobPdf[] = await Promise.all(
    existing.map(async (p) => {
      const box = await readSignatureBox(p)
      return box
        ? {
            InputPath: p,
            OutputPath: p,
            Page: box.page,
            X: box.x,
            Y: box.y,
            Width: box.width,
            Height: box.height,
          }
        : { InputPath: p, OutputPath: p }
    })
  )

  // Each company is a separate signer process, and some drivers cache the PIN per process.
  // Reusing the PIN from the unlock keeps a multi-company run free of dialogs.
  const pin = opts.pin || getRememberedDscPin(certificateName)

  const job: SignerJob = {
    CertificateName: certificateName,
    ...(pin ? { Pin: pin } : {}),
    Pdfs: pdfs,
  }

  // Serialised across processes: two signers at once mean two PIN dialogs.
  return withSignerLock(async () => {
    if (signerDaemonEnabled()) {
      // One long-lived signer holds the token session open, so only the first job of the
      // session can raise a dialog — every company after it signs silently.
      const result = await signViaDaemon(
        pdfSignerExePath(),
        job,
        signerTimeoutMs(existing.length),
        opts.log || console.log
      )
      if (result.error) throw new Error(result.error)
    } else {
      await runPdfSigner(job, { pdfCount: existing.length })
    }

    markSignSucceeded(certificateName)
    return existing
  }, { log: opts.log })
}

/**
 * After Form 16A PDFs are generated, attach DSC when a matching Windows certificate
 * can be resolved (company.dscCertificateName or pdf-signer/dsc-map.json by TAN/name).
 * Never throws — download/PDF generation should still succeed if signing is unavailable.
 */
export async function attachDscToForm16aPdfs(opts: {
  companyName: string
  tan?: string
  dscCertificateName?: string | null
  pdfPaths?: string[]
  pdfDir?: string
  log?: (msg: string) => void
  /** Token PIN captured in the UI; unlocks the token without the driver's own dialog. */
  pin?: string
}): Promise<SignForm16PdfsResult> {
  const log = opts.log || console.log
  let pdfPaths = (opts.pdfPaths || []).filter(Boolean)

  if (pdfPaths.length === 0 && opts.pdfDir) {
    pdfPaths = await glob("**/*.pdf", { cwd: opts.pdfDir, absolute: true })
  }

  if (pdfPaths.length === 0) {
    return { attempted: false, signed: false, pdfCount: 0, skippedReason: "no PDFs to sign" }
  }

  // The cluster script signs once in the master after its children finish, so children
  // must not each raise their own PIN dialog.
  if (process.env.DSC_SKIP_SIGNING === "1") {
    const skippedReason = "DSC_SKIP_SIGNING=1 — signing deferred to the parent process"
    log(`ℹ ${skippedReason}`)
    return { attempted: false, signed: false, pdfCount: pdfPaths.length, skippedReason }
  }

  const exePath = pdfSignerExePath()
  if (!fs.existsSync(exePath)) {
    const skippedReason = "pdf-signer.exe not found — DSC attach skipped"
    log(`ℹ ${skippedReason}`)
    return { attempted: false, signed: false, pdfCount: pdfPaths.length, skippedReason }
  }

  const certificateName = await resolveDscCertificateName({
    companyName: opts.companyName,
    tan: opts.tan,
    dscCertificateName: opts.dscCertificateName,
  })
  if (!certificateName) {
    const skippedReason = `no DSC configured for "${opts.companyName}"${
      opts.tan ? ` (${opts.tan})` : ""
    } — set Company.dscCertificateName, pdf-signer/dsc-map.json, or the DSC_CERTIFICATE_NAME env var`
    log(`ℹ ${skippedReason}`)
    return { attempted: false, signed: false, pdfCount: pdfPaths.length, skippedReason }
  }

  log(`🔏 Attach DSC: ${pdfPaths.length} PDF(s) with certificate "${certificateName}"`)
  if (!isTokenLikelyWarm()) {
    log(
      `ℹ Auto-DSC: the token may be locked — a PIN dialog will appear on ${os.hostname()}. ` +
        `Enter the PIN to continue (unlock once per session with "yarn dsc:unlock").`
    )
  }

  try {
    const attemptedPaths = await signPdfPathsWithCertificate(certificateName, pdfPaths, {
      log,
      pin: opts.pin,
    })

    // Trust the file, not the exit code: confirm a signature really landed on each PDF.
    const unsignedPaths = attemptedPaths.filter((p) => {
      try {
        return !inspectPdfSignature(p).signed
      } catch {
        return true
      }
    })
    const signedCount = attemptedPaths.length - unsignedPaths.length

    if (unsignedPaths.length > 0) {
      log(
        `⚠ DSC reported success but ${unsignedPaths.length}/${attemptedPaths.length} PDF(s) carry ` +
          `no signature (e.g. ${path.basename(unsignedPaths[0]!)})`
      )
      return {
        attempted: true,
        signed: false,
        verified: true,
        certificateName,
        pdfCount: attemptedPaths.length,
        signedCount,
        unsignedPaths,
        error: `${unsignedPaths.length} of ${attemptedPaths.length} PDF(s) are still unsigned`,
      }
    }

    log(`✓ DSC attached on ${signedCount} PDF(s) using "${certificateName}"`)
    return {
      attempted: true,
      signed: true,
      verified: true,
      certificateName,
      pdfCount: signedCount,
      signedCount,
      unsignedPaths: [],
    }
  } catch (err: any) {
    const error = err?.message || String(err)
    log(`⚠ DSC not attached (certificate "${certificateName}" unavailable or signer failed): ${error}`)
    return {
      attempted: true,
      signed: false,
      verified: false,
      certificateName,
      pdfCount: pdfPaths.length,
      signedCount: 0,
      unsignedPaths: pdfPaths,
      error,
    }
  }
}
