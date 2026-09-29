/**
 * Enumerate the DSC certificates available on this machine, for the picker on the Form 16 page.
 *
 * Reads the Windows certificate store through PowerShell — the same store pdf-signer.exe signs
 * from, so what the user sees in the dropdown is exactly what the signer can use. Certificates
 * without a private key cannot sign (they are somebody else's public certificate) and expired
 * ones are rejected by the signer, so both are reported but flagged.
 */
import { execFile } from "child_process"

export type DscCertificate = {
  /** Full subject, e.g. "CN=HARDIK HEMCHAND SAVLA, O=Personal, C=IN". */
  subject: string
  /** Just the CN — this is the value pdf-signer.exe matches on. */
  commonName: string
  friendlyName: string
  issuer: string
  thumbprint: string
  notBefore: string
  notAfter: string
  hasPrivateKey: boolean
  expired: boolean
  /** "CurrentUser\\My" or "LocalMachine\\My". */
  store: string
  /** True when this certificate can actually be used to sign right now. */
  usable: boolean
}

const IS_WINDOWS = process.platform === "win32"

function powershell(script: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", script],
      { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, windowsHide: true },
      (error, stdout, stderr) => {
        resolve({ ok: !error, stdout: String(stdout || ""), stderr: String(stderr || "") })
      }
    )
  })
}

/** Pull the CN out of a subject string, tolerating quoted values and extra RDNs. */
export function commonNameOf(subject: string): string {
  const match = subject.match(/CN=("([^"]*)"|[^,]*)/i)
  if (!match) return subject.trim()
  return (match[2] ?? match[1] ?? "").trim()
}

/**
 * List every certificate in the current user's and the machine's personal stores.
 * Returns an empty list off Windows (development machines) rather than throwing, so the UI
 * simply shows "no certificates found" instead of an error.
 */
export async function listDscCertificates(): Promise<DscCertificate[]> {
  if (!IS_WINDOWS) return []

  const seen = new Set<string>()
  const certs: DscCertificate[] = []

  for (const store of ["CurrentUser\\My", "LocalMachine\\My"]) {
    const ps = await powershell(
      `Get-ChildItem Cert:\\${store} | Select-Object Subject,FriendlyName,Issuer,Thumbprint,` +
        `@{n='NotBefore';e={$_.NotBefore.ToString('s')}},@{n='NotAfter';e={$_.NotAfter.ToString('s')}},` +
        `HasPrivateKey | ConvertTo-Json -Depth 3 -Compress`,
      45000
    )
    if (!ps.ok) continue

    const raw = ps.stdout.trim()
    if (!raw) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(raw)
    } catch {
      continue
    }

    for (const entry of Array.isArray(parsed) ? parsed : [parsed]) {
      const c = entry as Record<string, unknown>
      const subject = String(c?.Subject || "")
      if (!subject) continue

      const thumbprint = String(c?.Thumbprint || "")
      // The same token often appears in both stores; keep the first listing.
      const key = thumbprint || subject
      if (seen.has(key)) continue
      seen.add(key)

      const notAfter = String(c?.NotAfter || "")
      const expired = notAfter ? new Date(notAfter).getTime() < Date.now() : false
      const hasPrivateKey = Boolean(c?.HasPrivateKey)

      certs.push({
        subject,
        commonName: commonNameOf(subject),
        friendlyName: String(c?.FriendlyName || ""),
        issuer: String(c?.Issuer || ""),
        thumbprint,
        notBefore: String(c?.NotBefore || ""),
        notAfter,
        hasPrivateKey,
        expired,
        store,
        usable: hasPrivateKey && !expired,
      })
    }
  }

  // Signable certificates first, then by name, so the dropdown opens on something usable.
  return certs.sort((a, b) => {
    if (a.usable !== b.usable) return a.usable ? -1 : 1
    return a.commonName.localeCompare(b.commonName)
  })
}
