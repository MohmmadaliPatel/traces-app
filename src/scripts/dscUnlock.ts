/**
 * Unlock the DSC token for this Windows logon session — the once-per-session PIN entry.
 *
 * Signing once unlocks the token for the whole Windows logon session: the driver caches the
 * PIN, so every later signature runs unattended. This command performs that one signature
 * deliberately — on a throwaway copy of a sample certificate — so the PIN is entered while
 * somebody is at the keyboard, instead of halfway through an unattended batch.
 *
 * With --pin the PIN is read from the terminal (hidden) and pushed into the key handle, so no
 * dialog appears at all. Without it the token's own dialog asks for the PIN on this machine.
 *
 * Run it after every reboot, log-off, or token re-plug:
 *   yarn dsc:unlock
 *   yarn dsc:unlock --cert="HARDIK HEMCHAND SAVLA"
 *   yarn dsc:unlock --company="ACME Pvt Ltd" --tan=MUMA12345B
 *   yarn dsc:unlock --pdf=C:\path\to\any.pdf
 *
 * CLI:
 *   --cert=SUBJECT     Certificate subject to sign with (else the normal resolution order)
 *   --company=NAME     Company used for certificate resolution
 *   --tan=TAN          TAN used for certificate resolution
 *   --pdf=PATH         Sign this throwaway PDF instead of the bundled sample
 *   --pin              Ask for the token PIN (hidden) instead of waiting on the driver dialog
 *   --keep             Keep the signed scratch file (default: deleted)
 */
import fs from "fs"
import path from "path"
import os from "os"
import dotenv from "dotenv"
import db from "db"
import { attachDscToForm16aPdfs, resolveDscCertificateName } from "src/form16/utils/signForm16Pdfs"
import { inspectPdfSignature, describePdfSignature } from "src/form16/utils/pdfSignatureInfo"
import { isTokenLikelyWarm } from "src/form16/utils/dscSession"
import { promptForPin } from "src/form16/utils/promptForPin"

dotenv.config()

const SAMPLE_PDF = path.join(process.cwd(), "docs", "pdf-reference", "131_AAECC1568J_Q1_2026-27.pdf")

type Options = { cert?: string; company?: string; tan?: string; pdf?: string; keep: boolean; askPin: boolean }

function parseArgs(argv: string[]): Options {
  const opts: Options = { keep: false, askPin: false }
  for (const raw of argv) {
    const eq = raw.indexOf("=")
    const flag = eq === -1 ? raw : raw.slice(0, eq)
    const value = eq === -1 ? "" : raw.slice(eq + 1).replace(/^["']|["']$/g, "")
    if (flag === "--cert" || flag === "--certificate") opts.cert = value
    else if (flag === "--company") opts.company = value
    else if (flag === "--tan") opts.tan = value
    else if (flag === "--pdf") opts.pdf = value
    else if (flag === "--keep") opts.keep = true
    // Intentionally a flag, not a value: a PIN passed on the command line is visible in the
    // process list and saved to shell history.
    else if (flag === "--pin" || flag === "--ask-pin") opts.askPin = true
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const line = "=".repeat(64)

  console.log(line)
  console.log("DSC token unlock — one PIN for this Windows session")
  console.log(line)
  console.log(`Host              : ${os.hostname()}`)
  console.log(`User              : ${os.userInfo().username}`)
  console.log(`Token looks warm  : ${isTokenLikelyWarm() ? "yes (a PIN may not be needed)" : "no (expect a PIN dialog)"}`)

  const certificateName = await resolveDscCertificateName({
    companyName: opts.company || "",
    tan: opts.tan,
    dscCertificateName: opts.cert,
  })
  console.log(`Certificate       : ${certificateName || "(none resolved)"}`)

  if (!certificateName) {
    console.error(
      "\n❌ No certificate configured. Set DSC_CERTIFICATE_NAME in .env.production, or pass " +
        '--cert="<exact CN>". Run "yarn dsc:test --no-sign" to list the certificates on this machine.'
    )
    return 1
  }

  const source = opts.pdf ? path.resolve(opts.pdf) : SAMPLE_PDF
  if (!fs.existsSync(source)) {
    console.error(`\n❌ Sample PDF not found: ${source}\n   Pass --pdf=<any pdf> instead.`)
    return 1
  }

  // Always sign a scratch copy: never mutate a real certificate for an unlock.
  const tempDir = path.join(process.cwd(), "temp")
  fs.mkdirSync(tempDir, { recursive: true })
  const scratch = path.join(tempDir, `dsc-unlock-${Date.now()}.pdf`)
  fs.copyFileSync(source, scratch)

  console.log(`Scratch file      : ${scratch}`)
  console.log(line)

  const pin = opts.askPin ? await promptForPin() : ""
  if (!pin) console.log("Signing… if a PIN dialog appears, enter the token PIN now.")
  else console.log("Signing with the PIN supplied…")

  const result = await attachDscToForm16aPdfs({
    companyName: opts.company || "(dsc:unlock)",
    tan: opts.tan,
    dscCertificateName: certificateName,
    pdfPaths: [scratch],
    pin: pin || undefined,
    log: (m) => console.log(`  ${m}`),
  })

  let exitCode = 0
  console.log(line)
  if (result.signed) {
    console.log(describePdfSignature(inspectPdfSignature(scratch)))
    console.log(`✓ Token unlocked with "${result.certificateName}".`)
    console.log("  Form 131 batches will now sign without prompting, until this Windows session")
    console.log("  ends (reboot, log off, or unplugging the token).")
  } else {
    exitCode = 1
    console.log(`❌ Unlock failed: ${result.error || result.skippedReason}`)
    console.log('   Run "yarn dsc:test --no-sign" to check .NET, the certificate store and resolution.')
  }

  if (!opts.keep) {
    try {
      fs.unlinkSync(scratch)
    } catch {
      /* leave it behind rather than failing the unlock */
    }
  } else {
    console.log(`Kept scratch file : ${scratch}`)
  }
  console.log(line)

  return exitCode
}

main()
  .then(async (code) => {
    try {
      await db.$disconnect()
    } catch {
      /* ignore */
    }
    process.exit(code)
  })
  .catch(async (err) => {
    console.error("Fatal:", err)
    try {
      await db.$disconnect()
    } catch {
      /* ignore */
    }
    process.exit(1)
  })
