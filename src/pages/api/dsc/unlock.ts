import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import fs from "fs"
import path from "path"
import os from "os"
import { attachDscToForm16aPdfs } from "src/form16/utils/signForm16Pdfs"
import { inspectPdfSignature } from "src/form16/utils/pdfSignatureInfo"
import { rememberDscPin, forgetDscPin } from "src/form16/utils/dscPinVault"

/**
 * Unlock the DSC token before a batch runs.
 *
 * This is a plain API route rather than a Blitz mutation for one reason: the Blitz RPC handler
 * logs every resolver's deserialized input unconditionally, so a PIN sent that way is printed
 * to the server console in clear text. Nothing here logs the body.
 *
 * Signing a throwaway copy of a sample certificate is what proves the token is usable: it makes
 * the driver accept the PIN now, while somebody is watching, rather than halfway through an
 * unattended download.
 */
const SAMPLE_PDF = () =>
  path.join(process.cwd(), "docs", "pdf-reference", "131_AAECC1568J_Q1_2026-27.pdf")

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ ok: false, message: "Method not allowed" })
  }

  const certificateName = String(req.body?.certificateName || "").trim()
  // Never destructured into a log line, never echoed back in the response.
  const pin = typeof req.body?.pin === "string" ? req.body.pin : ""

  if (!certificateName) {
    return res.status(400).json({ ok: false, message: "Choose a certificate" })
  }

  const sample = SAMPLE_PDF()
  if (!fs.existsSync(sample)) {
    return res
      .status(500)
      .json({ ok: false, message: `Sample PDF not found at ${sample} — cannot test the token.` })
  }

  const tempDir = path.join(process.cwd(), "temp")
  fs.mkdirSync(tempDir, { recursive: true })
  const scratch = path.join(tempDir, `dsc-unlock-${Date.now()}.pdf`)
  fs.copyFileSync(sample, scratch)

  try {
    const result = await attachDscToForm16aPdfs({
      companyName: "(dsc unlock)",
      dscCertificateName: certificateName,
      pdfPaths: [scratch],
      pin: pin || undefined,
      log: () => {
        /* the signer's own output already goes to the console; nothing extra here */
      },
    })

    if (result.signed && inspectPdfSignature(scratch).signed) {
      const resolved = result.certificateName || certificateName

      // Every company is signed by its own pdf-signer.exe process, so the PIN has to be
      // available for each of them — that is what makes one unlock cover the whole run.
      if (pin) rememberDscPin(pin, resolved)

      const ttl = Math.max(1, parseInt(process.env.DSC_PIN_TTL_MIN || "", 10) || 720)
      return res.status(200).json({
        ok: true,
        certificateName: resolved,
        message: pin
          ? `Token unlocked with "${resolved}". Every company in this run will sign without prompting for the next ${ttl} minutes, or until the app restarts.`
          : `Signed successfully with "${resolved}". No PIN was supplied, so the token's own dialog may still appear for each company.`,
      })
    }

    // A failed unlock must not leave a stale PIN behind to be replayed at the token.
    forgetDscPin()

    return res.status(200).json({
      ok: false,
      certificateName,
      message:
        result.error ||
        result.skippedReason ||
        `Could not sign with "${certificateName}" on ${os.hostname()}.`,
    })
  } catch (error: any) {
    forgetDscPin()
    return res
      .status(200)
      .json({ ok: false, certificateName, message: error?.message || "Could not unlock the token" })
  } finally {
    try {
      fs.unlinkSync(scratch)
    } catch {
      /* a leftover scratch file is harmless */
    }
  }
})
