/**
 * Download missing Payment History PDFs using gaps JSON from the payment-gaps batch.
 *
 * Reads public/pdf/payment_history_gaps_batch_report.json (or per-company gaps),
 * then for each company with missing PDFs:
 *   - Old Act (FY < 2026-27): date-range filter + CIN match
 *   - New Act (FY >= 2026-27): no filter — download all available missing PDFs
 *
 * Usage:
 *   yarn challan:download-missing-pdfs
 *   yarn challan:download-missing-pdfs --concurrency=4
 *   yarn challan:download-missing-pdfs --tan=MUMC24640A
 *   yarn challan:download-missing-pdfs --limit=5
 *   yarn challan:download-missing-pdfs --only-missing   (skip companies with 0 missing)
 */
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import db from "db"
import {
  actTypeForFinancialYear,
  loadMissingFromGapsJson,
  paymentHistoryPdfExists,
  paymentTimeToFinancialYear,
  type PaymentHistoryRowWithPdf,
} from "../challan/utils/paymentHistoryFiles"
import { runWithConcurrency } from "../challan/utils/runWithConcurrency"
import { downloadMissingPaymentHistoryPdfs } from "./downloadChallanPayment"

dotenv.config()

const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 7
const GAPS_BATCH_REPORT = path.join(
  process.cwd(),
  "public",
  "pdf",
  "payment_history_gaps_batch_report.json"
)
const DOWNLOAD_REPORT = path.join(
  process.cwd(),
  "public",
  "pdf",
  "payment_history_download_batch_report.json"
)

type CompanyRow = {
  id: number
  name: string
  tan: string
  it_password: string
}

type GapsBatchCompany = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  pdfsMissing?: number
  gapsJsonPath?: string
}

type CliOptions = {
  concurrency: number
  limit?: number
  companyId?: number
  tan?: string
  onlyMissing: boolean
}

type CompanyDownloadResult = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  missingBefore: number
  downloadedOld: number
  downloadedNew: number
  downloadedCins: string[]
  stillMissing: number
  error?: string
}

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    concurrency: DEFAULT_CONCURRENCY,
    onlyMissing: true,
  }
  for (const arg of argv) {
    if (arg === "--all-companies") {
      opts.onlyMissing = false
      continue
    }
    if (arg === "--only-missing") {
      opts.onlyMissing = true
      continue
    }
    const limitMatch = /^--limit=(\d+)$/.exec(arg)
    if (limitMatch) {
      opts.limit = parseInt(limitMatch[1]!, 10)
      continue
    }
    const idMatch = /^--companyId=(\d+)$/.exec(arg)
    if (idMatch) {
      opts.companyId = parseInt(idMatch[1]!, 10)
      continue
    }
    const tanMatch = /^--tan=(.+)$/i.exec(arg)
    if (tanMatch) {
      opts.tan = tanMatch[1]!.trim().toUpperCase()
      continue
    }
    const concMatch = /^--concurrency=(\d+)$/.exec(arg)
    if (concMatch) {
      opts.concurrency = parseInt(concMatch[1]!, 10)
    }
  }

  if (!opts.companyId && process.env.COMPANY_ID) {
    const n = parseInt(process.env.COMPANY_ID, 10)
    if (!Number.isNaN(n)) opts.companyId = n
  }
  if (!opts.tan && process.env.COMPANY_TAN) {
    opts.tan = process.env.COMPANY_TAN.trim().toUpperCase()
  }
  if (process.env.CONCURRENCY) {
    const n = parseInt(process.env.CONCURRENCY, 10)
    if (!Number.isNaN(n)) opts.concurrency = n
  }

  opts.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY))
  return opts
}

function splitMissingByAct(missing: PaymentHistoryRowWithPdf[]): {
  old: PaymentHistoryRowWithPdf[]
  newAct: PaymentHistoryRowWithPdf[]
} {
  const old: PaymentHistoryRowWithPdf[] = []
  const newAct: PaymentHistoryRowWithPdf[] = []
  for (const row of missing) {
    const fy = row.paymentTime ? paymentTimeToFinancialYear(row.paymentTime) : null
    const act =
      fy != null
        ? actTypeForFinancialYear(fy)
        : row.actType === "N" || row.actType === "new"
        ? "N"
        : "O"
    if (act === "N") newAct.push(row)
    else old.push(row)
  }
  return { old, newAct }
}

function loadGapsReportCompanies(): GapsBatchCompany[] {
  if (!fs.existsSync(GAPS_BATCH_REPORT)) {
    return []
  }
  const data = JSON.parse(fs.readFileSync(GAPS_BATCH_REPORT, "utf8")) as {
    companies?: GapsBatchCompany[]
  }
  return data.companies ?? []
}

function log(msg: string) {
  console.log(msg)
}

async function downloadForCompany(
  company: CompanyRow,
  index: number,
  total: number
): Promise<CompanyDownloadResult> {
  const prefix = `[${index + 1}/${total}] ${company.name}`
  let missing = loadMissingFromGapsJson(company.name).filter(
    (r) => !paymentHistoryPdfExists(company.name, r.cin)
  )

  const result: CompanyDownloadResult = {
    companyId: company.id,
    companyName: company.name,
    tan: company.tan,
    success: false,
    missingBefore: missing.length,
    downloadedOld: 0,
    downloadedNew: 0,
    downloadedCins: [],
    stillMissing: missing.length,
  }

  if (missing.length === 0) {
    log(`${prefix} — no missing PDFs, skip`)
    result.success = true
    result.stillMissing = 0
    return result
  }

  log(`${prefix} — ${missing.length} missing PDF(s)`)
  const { old: missingOld, newAct: missingNew } = splitMissingByAct(missing)

  try {
    if (missingOld.length > 0) {
      log(`${prefix} — Old Act: ${missingOld.length} (date range + CIN)`)
      const oldRes = await downloadMissingPaymentHistoryPdfs(
        company.tan,
        company.it_password,
        company.name,
        {
          skipNewActRadio: true,
          skipDateFilter: false,
          missing: missingOld.map((r) => ({
            cin: r.cin,
            paymentTime: r.paymentTime,
            assessmentYear: r.assessmentYear,
            paymentType: r.paymentType,
            actType: r.actType,
          })),
        }
      )
      result.downloadedOld = oldRes.downloadedCins?.length ?? 0
      result.downloadedCins.push(...(oldRes.downloadedCins ?? []))
      log(`${prefix} — Old Act downloaded: ${result.downloadedOld}`)
    }

    // New Act: always attempt unfiltered download if any new-act missing OR gaps listed new CINs
    if (missingNew.length > 0) {
      log(`${prefix} — New Act: ${missingNew.length} (no filter, all available)`)
      const newRes = await downloadMissingPaymentHistoryPdfs(
        company.tan,
        company.it_password,
        company.name,
        {
          skipNewActRadio: false,
          skipDateFilter: true,
        }
      )
      result.downloadedNew = newRes.downloadedCins?.length ?? 0
      result.downloadedCins.push(...(newRes.downloadedCins ?? []))
      log(`${prefix} — New Act downloaded: ${result.downloadedNew}`)
    }

    const originalMissing = loadMissingFromGapsJson(company.name)
    result.stillMissing = originalMissing.filter(
      (r) => !paymentHistoryPdfExists(company.name, r.cin)
    ).length

    result.success = true
    log(
      `${prefix} — done: +${result.downloadedOld + result.downloadedNew} PDFs, still missing ${result.stillMissing}`
    )
    return result
  } catch (err: any) {
    result.error = err.message || String(err)
    result.stillMissing = loadMissingFromGapsJson(company.name).filter(
      (r) => !paymentHistoryPdfExists(company.name, r.cin)
    ).length
    log(`${prefix} — ERROR: ${result.error}`)
    return result
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2))

  log("========================================")
  log(" Download Missing Payment PDFs Batch")
  log("========================================")
  log(`Concurrency: ${cli.concurrency}`)
  log(`Only companies with missing PDFs: ${cli.onlyMissing}`)
  if (cli.companyId != null) log(`Filter: companyId=${cli.companyId}`)
  if (cli.tan) log(`Filter: tan=${cli.tan}`)
  if (cli.limit != null) log(`Limit: ${cli.limit}`)

  const gapsCompanies = loadGapsReportCompanies()
  if (gapsCompanies.length === 0) {
    console.error(
      `ERROR: Gaps batch report not found or empty: ${GAPS_BATCH_REPORT}\n` +
        `Run yarn challan:payment-gaps first.`
    )
    process.exit(1)
  }

  log(`Loaded gaps report: ${gapsCompanies.length} companies`)

  const dbCompanies = await db.company.findMany({
    where: { isTemporary: false },
    select: { id: true, name: true, tan: true, it_password: true },
  })
  const byId = new Map(dbCompanies.map((c) => [c.id, c]))
  const byTan = new Map(dbCompanies.map((c) => [c.tan.toUpperCase(), c]))

  let workList: CompanyRow[] = []
  for (const g of gapsCompanies) {
    if (!g.success) continue
    if (cli.onlyMissing && !(g.pdfsMissing && g.pdfsMissing > 0)) continue
    const company = byId.get(g.companyId) || byTan.get(g.tan.toUpperCase())
    if (!company) {
      log(`WARN: company not in DB: ${g.companyName} (${g.tan})`)
      continue
    }
    workList.push(company)
  }

  if (cli.companyId != null) {
    workList = workList.filter((c) => c.id === cli.companyId)
  }
  if (cli.tan) {
    workList = workList.filter((c) => c.tan.toUpperCase() === cli.tan)
  }
  if (cli.limit != null && cli.limit > 0) {
    workList = workList.slice(0, cli.limit)
  }

  // Prefer companies with the most missing first (optional — keep report order)
  workList.sort((a, b) => {
    const ga = gapsCompanies.find((g) => g.companyId === a.id)
    const gb = gapsCompanies.find((g) => g.companyId === b.id)
    return (gb?.pdfsMissing ?? 0) - (ga?.pdfsMissing ?? 0)
  })

  if (workList.length === 0) {
    console.error("ERROR: No companies to process (all have 0 missing, or filters exclude all).")
    process.exit(1)
  }

  const totalMissingHint = gapsCompanies
    .filter((g) => workList.some((w) => w.id === g.companyId))
    .reduce((s, g) => s + (g.pdfsMissing ?? 0), 0)

  log(`Companies to download: ${workList.length}`)
  log(`Missing PDFs (from gaps report): ~${totalMissingHint}`)

  const results = await runWithConcurrency(
    workList,
    cli.concurrency,
    (company, index) => downloadForCompany(company, index, workList.length)
  )

  const errors = results.filter((r) => !r.success).map((r) => `${r.companyName}: ${r.error}`)
  const report = {
    generatedAt: new Date().toISOString(),
    sourceGapsReport: GAPS_BATCH_REPORT,
    concurrency: cli.concurrency,
    summary: {
      companiesProcessed: results.length,
      companiesSucceeded: results.filter((r) => r.success).length,
      companiesFailed: results.filter((r) => !r.success).length,
      missingBefore: results.reduce((s, r) => s + r.missingBefore, 0),
      downloadedTotal: results.reduce((s, r) => s + r.downloadedOld + r.downloadedNew, 0),
      downloadedOld: results.reduce((s, r) => s + r.downloadedOld, 0),
      downloadedNew: results.reduce((s, r) => s + r.downloadedNew, 0),
      stillMissing: results.reduce((s, r) => s + r.stillMissing, 0),
    },
    companies: results,
    errors,
  }

  fs.writeFileSync(DOWNLOAD_REPORT, JSON.stringify(report, null, 2), "utf8")

  log("\n========================================")
  log(" SUMMARY")
  log("========================================")
  log(`Companies:           ${report.summary.companiesProcessed}`)
  log(`Succeeded:           ${report.summary.companiesSucceeded}`)
  log(`Failed:              ${report.summary.companiesFailed}`)
  log(`Missing before:      ${report.summary.missingBefore}`)
  log(`Downloaded (total):  ${report.summary.downloadedTotal}`)
  log(`  Old Act:           ${report.summary.downloadedOld}`)
  log(`  New Act:           ${report.summary.downloadedNew}`)
  log(`Still missing:       ${report.summary.stillMissing}`)
  log(`Report:              ${DOWNLOAD_REPORT}`)
  if (errors.length > 0) {
    log(`\nErrors (${errors.length}):`)
    for (const e of errors.slice(0, 40)) log(`  - ${e}`)
    if (errors.length > 40) log(`  ... +${errors.length - 40} more`)
  }
  log("========================================")

  await db.$disconnect()
  process.exit(errors.length > 0 ? 1 : 0)
}

main().catch(async (err) => {
  console.error("Fatal:", err)
  try {
    await db.$disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
