/**
 * Fetch Payment History API for last 2 FYs (Old + New Act), save response JSON,
 * compare against local PaymentHistory PDFs, and save gaps JSON — for all companies.
 *
 * Per company (under public/pdf/challans/{Company}/):
 *   - payment_history_content.json  — API payments (last 2 FYs)
 *   - payment_history_gaps.json     — present / missing vs {cin}_ChallanReceipt.pdf
 *
 * Aggregate:
 *   - public/pdf/payment_history_gaps_batch_report.json
 *
 * Usage:
 *   yarn challan:payment-gaps
 *   yarn challan:payment-gaps -- --concurrency=4
 *   yarn challan:payment-gaps -- --tan=MUMC24640A
 *   yarn challan:payment-gaps -- --limit=5
 */
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import db from "db"
import {
  getLastNIndianFinancialYears,
  incomeTaxActForFinancialYear,
} from "../challan/utils/paymentHistoryFiles"
import { runWithConcurrency } from "../challan/utils/runWithConcurrency"
import { fetchPaymentHistory } from "./fetchPaymentHistory"

dotenv.config()

const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 7
const AGGREGATE_REPORT = path.join(
  process.cwd(),
  "public",
  "pdf",
  "payment_history_gaps_batch_report.json"
)

type CompanyRow = {
  id: number
  name: string
  tan: string
  it_password: string
}

type CliOptions = {
  concurrency: number
  limit?: number
  companyId?: number
  tan?: string
}

type CompanyResult = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  challansFromApi: number
  pdfsPresent: number
  pdfsMissing: number
  contentJsonPath?: string
  gapsJsonPath?: string
  error?: string
}

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { concurrency: DEFAULT_CONCURRENCY }
  for (const arg of argv) {
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

function selectCompanies(all: CompanyRow[], opts: CliOptions): CompanyRow[] {
  let selected = all
  if (opts.companyId != null) {
    selected = selected.filter((c) => c.id === opts.companyId)
  }
  if (opts.tan) {
    selected = selected.filter((c) => c.tan.toUpperCase() === opts.tan)
  }
  if (opts.limit != null && opts.limit > 0) {
    selected = selected.slice(0, opts.limit)
  }
  return selected
}

function log(msg: string) {
  console.log(msg)
}

async function processCompany(
  company: CompanyRow,
  financialYears: string[],
  index: number,
  total: number
): Promise<CompanyResult> {
  const prefix = `[${index + 1}/${total}] ${company.name}`
  log(`\n${prefix} — fetching payment history...`)

  try {
    const result = await fetchPaymentHistory({
      tan: company.tan,
      itPassword: company.it_password,
      companyName: company.name,
      acts: ["O", "N"],
      financialYears,
    })

    log(
      `${prefix} — OK: ${result.gaps.summary.totalPayments} challans, ` +
        `${result.gaps.summary.pdfsPresent} PDFs present, ` +
        `${result.gaps.summary.pdfsMissing} missing`
    )

    return {
      companyId: company.id,
      companyName: company.name,
      tan: company.tan,
      success: true,
      challansFromApi: result.gaps.summary.totalPayments,
      pdfsPresent: result.gaps.summary.pdfsPresent,
      pdfsMissing: result.gaps.summary.pdfsMissing,
      contentJsonPath: result.contentJsonPath,
      gapsJsonPath: result.gapsJsonPath,
    }
  } catch (err: any) {
    const error = err.message || String(err)
    log(`${prefix} — ERROR: ${error}`)
    return {
      companyId: company.id,
      companyName: company.name,
      tan: company.tan,
      success: false,
      challansFromApi: 0,
      pdfsPresent: 0,
      pdfsMissing: 0,
      error,
    }
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2))
  const financialYears = getLastNIndianFinancialYears(2)

  log("========================================")
  log(" Payment History Gaps Batch")
  log("========================================")
  log(`Financial years: ${financialYears.join(", ")}`)
  log(
    `Act mapping: FY >= 2026-27 → New (${incomeTaxActForFinancialYear("2026-27")}), earlier → Old`
  )
  log(`Concurrency: ${cli.concurrency}`)
  if (cli.companyId != null) log(`Filter: companyId=${cli.companyId}`)
  if (cli.tan) log(`Filter: tan=${cli.tan}`)
  if (cli.limit != null) log(`Limit: ${cli.limit}`)

  log("\nLoading companies from database...")
  const allCompanies = await db.company.findMany({
    where: { isTemporary: false },
    select: { id: true, name: true, tan: true, it_password: true },
    orderBy: { name: "asc" },
  })

  const companies = selectCompanies(allCompanies, cli)
  if (companies.length === 0) {
    console.error(
      `ERROR: No companies matched (total in DB: ${allCompanies.length}). Check --companyId / --tan.`
    )
    process.exit(1)
  }

  log(`Companies to process: ${companies.length} (of ${allCompanies.length})`)

  const results = await runWithConcurrency(
    companies,
    cli.concurrency,
    (company, index) => processCompany(company, financialYears, index, companies.length)
  )

  const errors = results.filter((r) => !r.success).map((r) => `${r.companyName}: ${r.error}`)
  const aggregate = {
    generatedAt: new Date().toISOString(),
    financialYears,
    concurrency: cli.concurrency,
    summary: {
      companiesProcessed: results.length,
      companiesSucceeded: results.filter((r) => r.success).length,
      companiesFailed: results.filter((r) => !r.success).length,
      totalChallansFromApi: results.reduce((s, r) => s + r.challansFromApi, 0),
      totalPdfsPresent: results.reduce((s, r) => s + r.pdfsPresent, 0),
      totalPdfsMissing: results.reduce((s, r) => s + r.pdfsMissing, 0),
    },
    companies: results,
    errors,
  }

  const reportDir = path.dirname(AGGREGATE_REPORT)
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true })
  }
  fs.writeFileSync(AGGREGATE_REPORT, JSON.stringify(aggregate, null, 2), "utf8")

  log("\n========================================")
  log(" SUMMARY")
  log("========================================")
  log(`Companies:        ${aggregate.summary.companiesProcessed}`)
  log(`Succeeded:        ${aggregate.summary.companiesSucceeded}`)
  log(`Failed:           ${aggregate.summary.companiesFailed}`)
  log(`Challans (API):   ${aggregate.summary.totalChallansFromApi}`)
  log(`PDFs present:     ${aggregate.summary.totalPdfsPresent}`)
  log(`PDFs missing:     ${aggregate.summary.totalPdfsMissing}`)
  log(`Aggregate report: ${AGGREGATE_REPORT}`)
  log(`Per company:      public/pdf/challans/{Company}/payment_history_content.json`)
  log(`                  public/pdf/challans/{Company}/payment_history_gaps.json`)
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
