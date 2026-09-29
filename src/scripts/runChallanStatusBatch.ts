/**
 * Orchestrates challan status for companies by calling portal login + scripts directly
 * (no HTTP API / API_TOKEN required).
 *
 * Phase 1 (concurrency N): Payment History API + PDF downloads
 * Phase 2 (concurrency N): Challan status — checkpointed on disk after each company
 *
 * Checkpoint / resume:
 *   public/pdf/challan_status_batch_checkpoint.json  (live progress)
 *   public/pdf/challan_status_batch_report.json      (full summary, rewritten on each update)
 *
 * CLI:
 *   --trial              Process only the first company
 *   --status-only        Skip Phase 1; run challan status only
 *   --retry-failed       Only re-run companies marked Failed in checkpoint
 *   --fresh              Ignore checkpoint and start clean
 *   --limit=N / --companyId=N / --tan=XXXX / --concurrency=N
 *
 * Examples:
 *   yarn challan:status-only --concurrency=4
 *   yarn challan:status-only --concurrency=4 --retry-failed
 *   yarn challan:status-only --fresh --concurrency=4
 */
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import db from "db"
import {
  actTypeForFinancialYear,
  getLastNIndianFinancialYears,
  incomeTaxActForFinancialYear,
  paymentTimeToFinancialYear,
  type PaymentHistoryRowWithPdf,
} from "../challan/utils/paymentHistoryFiles"
import { runWithConcurrency } from "../challan/utils/runWithConcurrency"
import { fetchPaymentHistory } from "./fetchPaymentHistory"
import { downloadMissingPaymentHistoryPdfs } from "./downloadChallanPayment"
import NoticeDownloaderChallanStatus from "../jobs/NoticeDownloader-challanStatus"

dotenv.config()

const DEFAULT_CONCURRENCY = 4
const MAX_CONCURRENCY = 7

const CHECKPOINT_PATH = path.join(
  process.cwd(),
  "public",
  "pdf",
  "challan_status_batch_checkpoint.json"
)
const REPORT_PATH = path.join(process.cwd(), "public", "pdf", "challan_status_batch_report.json")
const TRIAL_REPORT_PATH = path.join(
  process.cwd(),
  "public",
  "pdf",
  "challan_status_batch_report_trial.json"
)

type CompanyRow = {
  id: number
  name: string
  tan: string
  it_password: string
  user_id: string
  password: string
}

type CliOptions = {
  trial: boolean
  statusOnly: boolean
  retryFailed: boolean
  fresh: boolean
  limit?: number
  companyId?: number
  tan?: string
  concurrency: number
}

type CompanyStatus = "Pending" | "InProgress" | "Completed" | "Failed" | "Skipped"

type CompanyCheckpoint = {
  companyId: number
  companyName: string
  tan: string
  status: CompanyStatus
  error?: string
  startedAt?: string
  completedAt?: string
  details?: Record<string, unknown>
  attempts: number
}

type CheckpointFile = {
  startedAt: string
  updatedAt: string
  mode: "status-only" | "full"
  concurrency: number
  financialYears: string[]
  companies: Record<string, CompanyCheckpoint>
  summary: {
    total: number
    completed: number
    failed: number
    pending: number
    inProgress: number
    skipped: number
  }
}

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    trial: false,
    statusOnly: false,
    retryFailed: false,
    fresh: false,
    concurrency: DEFAULT_CONCURRENCY,
  }
  for (const arg of argv) {
    if (arg === "--trial" || arg === "-t") {
      opts.trial = true
      continue
    }
    if (arg === "--status-only") {
      opts.statusOnly = true
      continue
    }
    if (arg === "--retry-failed") {
      opts.retryFailed = true
      continue
    }
    if (arg === "--fresh") {
      opts.fresh = true
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
  if (process.env.TRIAL === "1" || process.env.TRIAL === "true") opts.trial = true
  if (process.env.CONCURRENCY) {
    const n = parseInt(process.env.CONCURRENCY, 10)
    if (!Number.isNaN(n)) opts.concurrency = n
  }

  if (opts.trial && opts.limit == null) opts.limit = 1

  opts.concurrency = Math.min(MAX_CONCURRENCY, Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY))
  return opts
}

function selectCompanies(all: CompanyRow[], opts: CliOptions): CompanyRow[] {
  let selected = all
  if (opts.companyId != null) selected = selected.filter((c) => c.id === opts.companyId)
  if (opts.tan) selected = selected.filter((c) => c.tan.toUpperCase() === opts.tan)
  if (opts.limit != null && opts.limit > 0) selected = selected.slice(0, opts.limit)
  return selected
}

function log(msg: string) {
  console.log(msg)
}

function computeSummary(companies: Record<string, CompanyCheckpoint>) {
  const values = Object.values(companies)
  return {
    total: values.length,
    completed: values.filter((c) => c.status === "Completed").length,
    failed: values.filter((c) => c.status === "Failed").length,
    pending: values.filter((c) => c.status === "Pending").length,
    inProgress: values.filter((c) => c.status === "InProgress").length,
    skipped: values.filter((c) => c.status === "Skipped").length,
  }
}

/** Simple mutex so concurrent workers don't corrupt the checkpoint JSON. */
let writeChain: Promise<void> = Promise.resolve()

function persistCheckpoint(checkpoint: CheckpointFile, reportPath: string) {
  writeChain = writeChain.then(() => {
    checkpoint.updatedAt = new Date().toISOString()
    checkpoint.summary = computeSummary(checkpoint.companies)

    const dir = path.dirname(CHECKPOINT_PATH)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

    const tmp = `${CHECKPOINT_PATH}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), "utf8")
    fs.renameSync(tmp, CHECKPOINT_PATH)

    const companies = Object.values(checkpoint.companies).sort((a, b) =>
      a.companyName.localeCompare(b.companyName)
    )
    const errors = companies
      .filter((c) => c.status === "Failed")
      .map((c) => `${c.companyName}: ${c.error || "Failed"}`)

    const report = {
      generatedAt: checkpoint.updatedAt,
      startedAt: checkpoint.startedAt,
      mode: checkpoint.mode,
      concurrency: checkpoint.concurrency,
      financialYears: checkpoint.financialYears,
      checkpointPath: CHECKPOINT_PATH,
      summary: {
        ...checkpoint.summary,
        companiesProcessed: checkpoint.summary.total,
        challanStatus: {
          completed: checkpoint.summary.completed,
          failed: checkpoint.summary.failed,
          pending: checkpoint.summary.pending,
          inProgress: checkpoint.summary.inProgress,
          skipped: checkpoint.summary.skipped,
        },
      },
      failedCompanyIds: companies.filter((c) => c.status === "Failed").map((c) => c.companyId),
      completedCompanyIds: companies
        .filter((c) => c.status === "Completed")
        .map((c) => c.companyId),
      companies,
      errors,
    }

    const reportTmp = `${reportPath}.tmp`
    fs.writeFileSync(reportTmp, JSON.stringify(report, null, 2), "utf8")
    fs.renameSync(reportTmp, reportPath)
  })
  return writeChain
}

function loadCheckpoint(): CheckpointFile | null {
  if (!fs.existsSync(CHECKPOINT_PATH)) return null
  try {
    return JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8")) as CheckpointFile
  } catch {
    return null
  }
}

function initOrMergeCheckpoint(
  companies: CompanyRow[],
  opts: CliOptions,
  financialYears: string[]
): CheckpointFile {
  const existing = opts.fresh ? null : loadCheckpoint()
  const startedAt = existing?.startedAt || new Date().toISOString()
  const map: Record<string, CompanyCheckpoint> = {}

  for (const c of companies) {
    const key = String(c.id)
    const prev = existing?.companies?.[key]
    if (prev && !opts.fresh) {
      // Crash recovery: InProgress → Pending so it can be retried
      const status: CompanyStatus =
        prev.status === "InProgress" ? "Pending" : prev.status
      map[key] = {
        ...prev,
        companyName: c.name,
        tan: c.tan,
        status: opts.retryFailed && prev.status === "Failed" ? "Pending" : status,
        error: opts.retryFailed && prev.status === "Failed" ? undefined : prev.error,
      }
    } else {
      map[key] = {
        companyId: c.id,
        companyName: c.name,
        tan: c.tan,
        status: "Pending",
        attempts: 0,
      }
    }
  }

  // Keep historical companies from checkpoint that are not in current filter? Skip — only current set.

  return {
    startedAt,
    updatedAt: new Date().toISOString(),
    mode: opts.statusOnly ? "status-only" : "full",
    concurrency: opts.concurrency,
    financialYears,
    companies: map,
    summary: computeSummary(map),
  }
}

function companiesToRun(
  companies: CompanyRow[],
  checkpoint: CheckpointFile,
  opts: CliOptions
): CompanyRow[] {
  return companies.filter((c) => {
    const entry = checkpoint.companies[String(c.id)]
    if (!entry) return true
    if (opts.retryFailed) return entry.status === "Pending" || entry.status === "Failed"
    // Resume: skip Completed / Skipped
    return entry.status === "Pending" || entry.status === "Failed" || entry.status === "InProgress"
  })
}

function splitMissingByAct(missing: PaymentHistoryRowWithPdf[]) {
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

async function processCompanyPhase1(
  company: CompanyRow,
  financialYears: string[],
  index: number,
  total: number
): Promise<{ success: boolean; error?: string }> {
  log(`\n[Phase1 ${index + 1}/${total}] ${company.name} (${company.tan})`)
  try {
    const result = await fetchPaymentHistory({
      tan: company.tan,
      itPassword: company.it_password,
      companyName: company.name,
      acts: ["O", "N"],
      financialYears,
    })
    const missing = result.gaps.missing
    const { old: missingOld } = splitMissingByAct(missing)

    if (missingOld.length > 0) {
      await downloadMissingPaymentHistoryPdfs(company.tan, company.it_password, company.name, {
        skipNewActRadio: true,
        skipDateFilter: false,
        missing: missingOld.map((r) => ({
          cin: r.cin,
          paymentTime: r.paymentTime,
          assessmentYear: r.assessmentYear,
          paymentType: r.paymentType,
          actType: r.actType,
        })),
      })
    }

    await downloadMissingPaymentHistoryPdfs(company.tan, company.it_password, company.name, {
      skipNewActRadio: false,
      skipDateFilter: true,
    })

    log(`  Phase 1 done for ${company.name}`)
    return { success: true }
  } catch (err: any) {
    const error = err.message || String(err)
    log(`  Phase 1 ERROR: ${error}`)
    return { success: false, error }
  }
}

async function runChallanStatusForCompany(company: CompanyRow): Promise<{
  success: boolean
  error?: string
  details?: Record<string, unknown>
}> {
  if (!company.user_id?.trim() || !company.password?.trim()) {
    return { success: false, error: "Company missing TRACES credentials (user_id / password)" }
  }

  const logger = {
    log: (message: string) => {
      console.log(`  [status][${company.name}] ${message}`)
    },
  }

  try {
    const downloader = new NoticeDownloaderChallanStatus(company as any, logger, 0, {
      onlyPaymentPdfNotInExcel: true,
    })
    const details = await downloader.queryChallanStatusPuppeteer()
    if (details && typeof details === "object" && (details as { success?: boolean }).success === false) {
      return {
        success: false,
        error: (details as { reason?: string }).reason || "Challan status returned success=false",
        details: details as Record<string, unknown>,
      }
    }
    return {
      success: true,
      details: (details as Record<string, unknown>) || undefined,
    }
  } catch (err: any) {
    return { success: false, error: err.message || String(err) }
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2))
  const financialYears = getLastNIndianFinancialYears(2)
  const reportPath = cli.trial || cli.limit === 1 ? TRIAL_REPORT_PATH : REPORT_PATH

  log("========================================")
  log(cli.trial ? " Challan Status Batch (TRIAL)" : " Challan Status Batch")
  log("========================================")
  log(`Financial years: ${financialYears.join(", ")}`)
  log(
    `Act mapping: FY >= 2026-27 → New (${incomeTaxActForFinancialYear("2026-27")}), earlier FYs → Old`
  )
  log(`Concurrency: ${cli.concurrency}`)
  if (cli.statusOnly) log("Mode: STATUS ONLY")
  if (cli.retryFailed) log("Mode: RETRY FAILED only")
  if (cli.fresh) log("Mode: FRESH (ignore checkpoint)")
  if (cli.companyId != null) log(`Filter: companyId=${cli.companyId}`)
  if (cli.tan) log(`Filter: tan=${cli.tan}`)
  if (cli.limit != null) log(`Limit: ${cli.limit}`)
  log(`Checkpoint: ${CHECKPOINT_PATH}`)
  log(`Report:     ${reportPath}`)

  log("\nLoading companies from database...")
  const allCompanies = await db.company.findMany({
    where: { isTemporary: false },
    select: {
      id: true,
      name: true,
      tan: true,
      it_password: true,
      user_id: true,
      password: true,
    },
    orderBy: { name: "asc" },
  })

  const companies = selectCompanies(allCompanies, cli)
  if (companies.length === 0) {
    console.error(
      `ERROR: No companies matched filters (total in DB: ${allCompanies.length}).`
    )
    process.exit(1)
  }

  const checkpoint = initOrMergeCheckpoint(companies, cli, financialYears)
  await persistCheckpoint(checkpoint, reportPath)

  log(
    `Companies in scope: ${companies.length} | checkpoint: completed=${checkpoint.summary.completed} failed=${checkpoint.summary.failed} pending=${checkpoint.summary.pending}`
  )

  if (!cli.statusOnly) {
    log("\n========================================")
    log(` PHASE 1 — Payment History + PDF download (${cli.concurrency} concurrent)`)
    log("========================================")
    await runWithConcurrency(companies, cli.concurrency, async (company, index) => {
      const result = await processCompanyPhase1(company, financialYears, index, companies.length)
      if (!result.success) {
        const entry = checkpoint.companies[String(company.id)]!
        entry.status = "Failed"
        entry.error = `Phase1: ${result.error}`
        entry.completedAt = new Date().toISOString()
        entry.attempts = (entry.attempts || 0) + 1
        await persistCheckpoint(checkpoint, reportPath)
      }
      return result
    })
  }

  const queue = companiesToRun(companies, checkpoint, cli)
  log("\n========================================")
  log(` PHASE 2 — Challan Status (${cli.concurrency} concurrent)`)
  log(` To process now: ${queue.length} (skipping already Completed)`)
  log("========================================")

  if (queue.length === 0) {
    log("Nothing to do — all companies already Completed (or none match --retry-failed).")
  } else {
    await runWithConcurrency(queue, cli.concurrency, async (company, index) => {
      const key = String(company.id)
      const entry = checkpoint.companies[key]!

      entry.status = "InProgress"
      entry.startedAt = new Date().toISOString()
      entry.attempts = (entry.attempts || 0) + 1
      delete entry.error
      await persistCheckpoint(checkpoint, reportPath)

      log(
        `\n[Phase2 ${index + 1}/${queue.length}] ${company.name} (${company.tan}) attempt=${entry.attempts}`
      )

      const result = await runChallanStatusForCompany(company)

      if (result.success) {
        entry.status = "Completed"
        entry.completedAt = new Date().toISOString()
        entry.details = result.details
        delete entry.error
        log(`  ✓ Completed ${company.name}`)
      } else {
        entry.status = "Failed"
        entry.completedAt = new Date().toISOString()
        entry.error = result.error
        entry.details = result.details
        log(`  ✗ Failed ${company.name}: ${result.error}`)
      }

      await persistCheckpoint(checkpoint, reportPath)
      return result
    })
  }

  await persistCheckpoint(checkpoint, reportPath)
  const summary = checkpoint.summary

  log("\n========================================")
  log(" SUMMARY")
  log("========================================")
  log(`Total:       ${summary.total}`)
  log(`Completed:   ${summary.completed}`)
  log(`Failed:      ${summary.failed}`)
  log(`Pending:     ${summary.pending}`)
  log(`In progress: ${summary.inProgress}`)
  log(`Checkpoint:  ${CHECKPOINT_PATH}`)
  log(`Report:      ${reportPath}`)
  if (summary.failed > 0) {
    log(`\nRetry failed with:`)
    log(`  yarn challan:status-only --concurrency=${cli.concurrency} --retry-failed`)
    const failed = Object.values(checkpoint.companies).filter((c) => c.status === "Failed")
    for (const f of failed.slice(0, 30)) {
      log(`  - ${f.companyName}: ${f.error}`)
    }
    if (failed.length > 30) log(`  ... +${failed.length - 30} more`)
  }
  log("========================================")

  await db.$disconnect()
  process.exit(summary.failed > 0 || summary.pending > 0 ? 1 : 0)
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
