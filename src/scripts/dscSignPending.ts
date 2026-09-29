/**
 * Find generated certificate PDFs that carry no digital signature, and sign them — all of
 * them in ONE signer run, so the token asks for at most one PIN.
 *
 * This is the recovery path for any batch that ran while the token was locked, and the way
 * to check what is signed without touching anything.
 *
 *   yarn dsc:sign --check                                  report only, sign nothing
 *   yarn dsc:sign --company="Clean Max Aero Private Limited"
 *   yarn dsc:sign --fy=2026-27 --quarter=Q1 --form=131
 *   yarn dsc:sign --cert="HARDIK HEMCHAND SAVLA"
 *
 * CLI:
 *   --check            List signed/unsigned counts and exit without signing
 *   --company=NAME     Only this company's folder
 *   --fy=2026-27       Only this financial year
 *   --quarter=Q1       Only this quarter
 *   --form=131         Only this form type (131, 26Q, 16A, ...)
 *   --form16Type=X     "form16a" (default scan covers both) or "form16"
 *   --cert=SUBJECT     Certificate subject to sign with (else normal resolution order)
 *   --tan=TAN          TAN used for certificate resolution
 *   --limit=N          Sign at most N PDFs (default: all)
 *   --list             Print every matching path, not just the summary
 */
import path from "path"
import dotenv from "dotenv"
import db from "db"
import { attachDscToForm16aPdfs, resolveDscCertificateName } from "src/form16/utils/signForm16Pdfs"
import { findGeneratedPdfs, partitionBySignature } from "src/form16/utils/findGeneratedPdfs"
import { isTokenLikelyWarm } from "src/form16/utils/dscSession"

dotenv.config()

type Options = {
  check: boolean
  list: boolean
  company?: string
  fy?: string
  quarter?: string
  form?: string
  form16Type?: "form16" | "form16a"
  cert?: string
  tan?: string
  limit?: number
}

function parseArgs(argv: string[]): Options {
  const opts: Options = { check: false, list: false }
  for (const raw of argv) {
    const eq = raw.indexOf("=")
    const flag = eq === -1 ? raw : raw.slice(0, eq)
    const value = eq === -1 ? "" : raw.slice(eq + 1).replace(/^["']|["']$/g, "")
    switch (flag) {
      case "--check":
      case "--dry-run":
        opts.check = true
        break
      case "--list":
        opts.list = true
        break
      case "--company":
        opts.company = value
        break
      case "--fy":
      case "--financialYear":
        opts.fy = value
        break
      case "--quarter":
        opts.quarter = value
        break
      case "--form":
      case "--formType":
        opts.form = value
        break
      case "--form16Type":
        if (value === "form16" || value === "form16a") opts.form16Type = value
        break
      case "--cert":
      case "--certificate":
        opts.cert = value
        break
      case "--tan":
        opts.tan = value
        break
      case "--limit":
        opts.limit = Math.max(1, parseInt(value, 10) || 0) || undefined
        break
      default:
        break
    }
  }
  return opts
}

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const line = "=".repeat(64)

  console.log(line)
  console.log("DSC — sign pending certificate PDFs")
  console.log(line)
  console.log(`Company           : ${opts.company || "(all)"}`)
  console.log(`Financial year    : ${opts.fy || "(all)"}`)
  console.log(`Quarter           : ${opts.quarter || "(all)"}`)
  console.log(`Form type         : ${opts.form || "(all)"}`)

  const all = await findGeneratedPdfs({
    companyName: opts.company,
    financialYear: opts.fy,
    quarter: opts.quarter,
    formType: opts.form,
    form16Type: opts.form16Type,
  })

  if (all.length === 0) {
    console.log("\nNo certificate PDFs matched. Nothing to do.")
    return 0
  }

  const { signed, unsigned } = partitionBySignature(all)
  console.log(line)
  console.log(`PDFs found        : ${all.length}`)
  console.log(`Already signed    : ${signed.length}`)
  console.log(`Unsigned          : ${unsigned.length}`)

  if (opts.list) {
    for (const p of unsigned) console.log(`  unsigned  ${p}`)
    for (const p of signed) console.log(`  signed    ${p}`)
  } else {
    for (const p of unsigned.slice(0, 10)) console.log(`  unsigned  ${path.basename(p)}`)
    if (unsigned.length > 10) console.log(`  … and ${unsigned.length - 10} more (use --list)`)
  }

  if (unsigned.length === 0) {
    console.log("\n✓ Every matching PDF is already signed.")
    return 0
  }

  if (opts.check) {
    console.log("\n--check: nothing signed. Re-run without --check to sign the unsigned PDFs.")
    return 0
  }

  const targets = opts.limit ? unsigned.slice(0, opts.limit) : unsigned

  const certificateName = await resolveDscCertificateName({
    companyName: opts.company || "",
    tan: opts.tan,
    dscCertificateName: opts.cert,
  })
  if (!certificateName) {
    console.error(
      '\n❌ No certificate configured. Set DSC_CERTIFICATE_NAME in .env.production or pass --cert="<exact CN>".'
    )
    return 1
  }

  console.log(line)
  console.log(`Certificate       : ${certificateName}`)
  console.log(`Signing           : ${targets.length} PDF(s) in one run`)
  if (!isTokenLikelyWarm()) {
    console.log('Token looks locked — expect ONE PIN dialog (or run "yarn dsc:unlock" first).')
  }

  const result = await attachDscToForm16aPdfs({
    companyName: opts.company || "(dsc:sign)",
    tan: opts.tan,
    dscCertificateName: certificateName,
    pdfPaths: targets,
    log: (m) => console.log(`  ${m}`),
  })

  console.log(line)
  if (result.signed) {
    console.log(`✓ Signed ${result.signedCount}/${targets.length} PDF(s) with "${result.certificateName}"`)
    return 0
  }

  console.log(`❌ Signing failed: ${result.error || result.skippedReason}`)
  if (result.signedCount) {
    console.log(`  ${result.signedCount} PDF(s) were signed before the failure`)
  }
  console.log('  Check the setup with "yarn dsc:test --no-sign".')
  return 1
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
