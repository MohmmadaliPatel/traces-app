import fs from "fs"

/**
 * Reads the signature state of a PDF straight from its bytes — no PDF library needed.
 *
 * A DSC-signed PDF carries a signature dictionary (`/Type /Sig`) whose `/ByteRange` covers
 * the signed span and whose `/Contents` holds the hex-encoded PKCS#7 blob. That is enough
 * to tell "signed" from "not signed" without trusting the signer's exit code.
 */

export type PdfSignatureInfo = {
  signed: boolean
  byteRangeCount: number
  sigDictCount: number
  subFilters: string[]
  names: string[]
  reasons: string[]
  /** Printable fragments recovered from the PKCS#7 blob (signer CN, issuer, e-mail, ...). */
  signerHints: string[]
  sizeBytes: number
}

/** Pull readable CN / issuer fragments out of the hex-encoded PKCS#7 blob in /Contents. */
function signerHintsFromPkcs7(text: string): string[] {
  const hints: string[] = []
  const re = /\/Contents\s*<([0-9A-Fa-f\s]{64,})>/g
  let match: RegExpExecArray | null

  while ((match = re.exec(text)) !== null && hints.length < 20) {
    const hex = (match[1] || "").replace(/\s+/g, "")
    if (hex.length < 64) continue

    let bin = ""
    try {
      bin = Buffer.from(hex, "hex").toString("latin1")
    } catch {
      continue
    }

    for (const fragment of bin.match(/[ -~]{4,}/g) || []) {
      // The blob is mostly binary noise — keep only name-ish fragments.
      if (/^[A-Za-z0-9 .,'&()\-_@]{4,64}$/.test(fragment) && /[A-Za-z]{3}/.test(fragment)) {
        if (!hints.includes(fragment)) hints.push(fragment)
      }
      if (hints.length >= 20) break
    }
  }

  return hints.slice(0, 20)
}

export function inspectPdfSignature(pdfPath: string): PdfSignatureInfo {
  const buf = fs.readFileSync(pdfPath)
  const text = buf.toString("latin1")

  const countOf = (needle: string) => text.split(needle).length - 1
  const collect = (re: RegExp) => {
    const out: string[] = []
    let match: RegExpExecArray | null
    while ((match = re.exec(text)) !== null) {
      const value = (match[1] || "").trim()
      if (value && !out.includes(value)) out.push(value)
    }
    return out
  }

  const byteRangeCount = countOf("/ByteRange")
  const sigDictCount = countOf("/Type /Sig") + countOf("/Type/Sig")

  return {
    signed: byteRangeCount > 0 && (sigDictCount > 0 || text.includes("Adobe.PPKLite")),
    byteRangeCount,
    sigDictCount,
    subFilters: collect(/\/SubFilter\s*\/([A-Za-z0-9.#_]+)/g),
    names: collect(/\/Name\s*\(([^)]{0,120})\)/g),
    reasons: collect(/\/Reason\s*\(([^)]{0,120})\)/g),
    signerHints: byteRangeCount > 0 ? signerHintsFromPkcs7(text) : [],
    sizeBytes: buf.length,
  }
}

/** Tolerant check used for reporting and for finding PDFs that still need signing. */
export function isPdfSigned(pdfPath: string): boolean {
  try {
    return inspectPdfSignature(pdfPath).signed
  } catch {
    return false
  }
}

/** One-line summary for logs. */
export function describePdfSignature(info: PdfSignatureInfo): string {
  if (!info.signed) return `unsigned (${info.sizeBytes} bytes)`
  const who = info.reasons[0] || info.names[0] || info.signerHints[0] || "unknown signer"
  return `signed by ${who} (${info.subFilters.join(", ") || "unknown subfilter"}, ${info.sizeBytes} bytes)`
}
