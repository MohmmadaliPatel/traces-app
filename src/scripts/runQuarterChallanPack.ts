/**
 * Quarterly challan pack for every company in the DB, checkpointed per company × task so a
 * crash or a fix-and-rerun resumes where it stopped.
 *
 * Tasks (run in this order per company):
 *   ph      Payment History receipts (PDF) + Excel for deposits in [--ph-from, --ph-to]
 *   csi     CSI file for [--csi-from, --csi-to] (Income-tax Act 2025 by default)
 *   status  TRACES unconsumed challans: full list + View Amount status Excels
 *   demand  TRACES outstanding demand (saved to OutstandingDemand + per-company Excel)
 *
 * Every browser a company's tasks open is closed once that company is finished.
 *
 * Output (everything for the client in one folder):
 *   public/pdf/<label>/<Company>/PaymentHistory/*.pdf + PaymentHistory_<Company>_<range>.xlsx
 *   public/pdf/<label>/<Company>/CSI/*.csi
 *   public/pdf/<label>/<Company>/<Company>_unconsumed_list.xlsx, _challan_status*.xlsx
 *   public/pdf/<label>/<Company>/<Company>_outstanding_demand.xlsx
 *   public/pdf/<label>/checkpoint.json   live state (resume source)
 *   public/pdf/<label>/progress.md       human-readable progress + failures
 *
 * CLI:
 *   --prepare            One-time: move challan_status_results aside, seed Q1 receipts
 *   --collect            Write <label>_summary.xlsx and zip the label folder
 *   --tasks=ph,csi,status,demand
 *   --retry-failed       Re-run tasks marked Failed (Done/NoData are always skipped)
 *   --fresh              Ignore the checkpoint
 *   --limit=N / --companyId=N / --tan=XXXX / --concurrency=N
 *   --companies-xlsx=PATH  Companies from a sheet (Company Name, Tan, IT Password, User ID,
 *                          Password) instead of the DB, e.g. Continuum; use with its own --label
 *
 *   node scripts/run-ts.js src/scripts/runQuarterChallanPack.ts --prepare
 *   node scripts/run-ts.js src/scripts/runQuarterChallanPack.ts --limit=1
 *   node scripts/run-ts.js src/scripts/runQuarterChallanPack.ts --concurrency=2
 *   node scripts/run-ts.js src/scripts/runQuarterChallanPack.ts --retry-failed
 *   node scripts/run-ts.js src/scripts/runQuarterChallanPack.ts --collect
 */
import fs from "fs"
import path from "path"
import { AsyncLocalStorage } from "async_hooks"
import { execFileSync } from "child_process"
import dotenv from "dotenv"
import * as XLSX from "xlsx"
import db from "db"
import {
  findMatchingCompanyFolder,
  parsePortalDayKey,
  paymentHistoryDir,
  paymentHistoryPdfPath,
  type PaymentHistoryRowInput,
} from "../challan/utils/paymentHistoryFiles"
import {
  challanStatusExcelPath,
  unconsumedListExcelPath,
  unmatchedChallanStatusExcelPath,
} from "../challan/utils/challanStatusExcel"
import { runWithConcurrency } from "../challan/utils/runWithConcurrency"
import { loadCompaniesXlsx } from "../challan/utils/companiesXlsx"
import { fetchPaymentHistory } from "./fetchPaymentHistory"
import {
  convertPdfsToExcel,
  downloadCsiFiles,
  downloadMissingPaymentHistoryPdfs,
} from "./downloadChallanPayment"
import NoticeDownloaderChallanStatus from "../jobs/NoticeDownloader-challanStatus"
import puppeteer from "puppeteer-extra"
import type { Browser } from "puppeteer"
import { fetchOutstandingDemand } from "./fetchOutstandingDemand"

dotenv.config()

const TASKS = ["ph", "csi", "status", "demand"] as const
type TaskName = (typeof TASKS)[number]
/** Tasks that log in to TRACES with the company's TAN password. */
const TRACES_TASKS = new Set<TaskName>(["status", "demand"])
type TaskStatus = "Pending" | "InProgress" | "Done" | "NoData" | "Failed"

type TaskState = {
  status: TaskStatus
  attempts: number
  error?: string
  startedAt?: string
  finishedAt?: string
  verify?: Record<string, unknown>
}

type CompanyState = {
  companyId: number
  companyName: string
  tan: string
  tasks: Record<TaskName, TaskState>
}

type Checkpoint = {
  label: string
  config: Config
  startedAt: string
  updatedAt: string
  companies: Record<string, CompanyState>
}

type Config = {
  label: string
  phFrom: string
  phTo: string
  csiFrom: string
  csiTo: string
  csiAct: "new" | "old"
}

type CliOptions = Config & {
  tasks: TaskName[]
  prepare: boolean
  collect: boolean
  retryFailed: boolean
  fresh: boolean
  concurrency: number
  limit?: number
  companyId?: number
  tan?: string
  companiesXlsx?: string
}

type CompanyRow = {
  id: number
  name: string
  tan: string
  it_password: string | null
  user_id: string | null
  password: string | null
  /** Loaded from --companies-xlsx: not in the DB, so nothing is written to DB tables for it. */
  external?: boolean
}

const PDF_BASE = path.join(process.cwd(), "public", "pdf")

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = {
    label: "q2-fy2026-27",
    phFrom: "01-Jul-2026",
    phTo: "30-Sep-2026",
    csiFrom: "01-Apr-2026",
    csiTo: "10-Oct-2026",
    csiAct: "new",
    tasks: [...TASKS],
    prepare: false,
    collect: false,
    retryFailed: false,
    fresh: false,
    concurrency: 2,
  }
  for (const arg of argv) {
    const [key, rawValue] = arg.split("=", 2) as [string, string | undefined]
    const value = rawValue?.trim() ?? ""
    switch (key) {
      case "--prepare":
        opts.prepare = true
        break
      case "--collect":
        opts.collect = true
        break
      case "--retry-failed":
        opts.retryFailed = true
        break
      case "--fresh":
        opts.fresh = true
        break
      case "--label":
        opts.label = value
        break
      case "--ph-from":
        opts.phFrom = value
        break
      case "--ph-to":
        opts.phTo = value
        break
      case "--csi-from":
        opts.csiFrom = value
        break
      case "--csi-to":
        opts.csiTo = value
        break
      case "--csi-act":
        opts.csiAct = value === "old" ? "old" : "new"
        break
      case "--tasks":
        opts.tasks = value
          .split(",")
          .map((t) => t.trim())
          .filter((t): t is TaskName => (TASKS as readonly string[]).includes(t))
        break
      case "--limit":
        opts.limit = parseInt(value, 10)
        break
      case "--companyId":
        opts.companyId = parseInt(value, 10)
        break
      case "--tan":
        opts.tan = value.toUpperCase()
        break
      case "--companies-xlsx":
        opts.companiesXlsx = path.resolve(value)
        break
      case "--concurrency":
        opts.concurrency = Math.min(7, Math.max(1, parseInt(value, 10) || 1))
        break
      default:
        throw new Error(`Unknown argument: ${arg}`)
    }
  }
  for (const [name, v] of [
    ["--ph-from", opts.phFrom],
    ["--ph-to", opts.phTo],
    ["--csi-from", opts.csiFrom],
    ["--csi-to", opts.csiTo],
  ] as const) {
    if (!parsePortalDayKey(v)) throw new Error(`${name} must be DD-MMM-YYYY, got "${v}"`)
  }
  return opts
}

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/** Wrong password, unregistered TAN or locked account: retrying only burns password attempts. */
function isTracesCredentialError(message: string): boolean {
  return /INVALID_PASSWORD|USR404|TAN does not exist|account (will be|is|has been) locked/i.test(message)
}

/** Folder-safe company name (matches what the challan_status helpers strip). */
function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim()
}

function labelDir(cfg: Config) {
  return path.join(PDF_BASE, cfg.label)
}

function companyOutDir(cfg: Config, company: { name: string }) {
  return path.join(labelDir(cfg), safeName(company.name))
}

// ---------------------------------------------------------------------------
// Checkpoint
// ---------------------------------------------------------------------------

function checkpointPath(cfg: Config) {
  return path.join(labelDir(cfg), "checkpoint.json")
}

function emptyTask(): TaskState {
  return { status: "Pending", attempts: 0 }
}

function loadOrInitCheckpoint(companies: CompanyRow[], opts: CliOptions): Checkpoint {
  const file = checkpointPath(opts)
  let existing: Checkpoint | null = null
  if (!opts.fresh && fs.existsSync(file)) {
    existing = JSON.parse(fs.readFileSync(file, "utf8")) as Checkpoint
  }
  const now = new Date().toISOString()
  const checkpoint: Checkpoint = existing ?? {
    label: opts.label,
    config: pickConfig(opts),
    startedAt: now,
    updatedAt: now,
    companies: {},
  }

  for (const c of companies) {
    const key = String(c.id)
    const prev = checkpoint.companies[key]
    const tasks = {} as Record<TaskName, TaskState>
    for (const t of TASKS) {
      const p = prev?.tasks?.[t]
      if (!p) {
        tasks[t] = emptyTask()
        continue
      }
      // Crash recovery: anything left InProgress is retried.
      let status: TaskStatus = p.status === "InProgress" ? "Pending" : p.status
      if (opts.retryFailed && status === "Failed") status = "Pending"
      tasks[t] = { ...p, status }
    }
    checkpoint.companies[key] = { companyId: c.id, companyName: c.name, tan: c.tan, tasks }
  }
  return checkpoint
}

function pickConfig(opts: CliOptions): Config {
  const { label, phFrom, phTo, csiFrom, csiTo, csiAct } = opts
  return { label, phFrom, phTo, csiFrom, csiTo, csiAct }
}

/** Serialises checkpoint writes so concurrent workers don't interleave. */
let writeChain: Promise<void> = Promise.resolve()

function persist(checkpoint: Checkpoint) {
  writeChain = writeChain.then(() => {
    checkpoint.updatedAt = new Date().toISOString()
    const file = checkpointPath(checkpoint.config)
    fs.mkdirSync(path.dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(checkpoint, null, 2), "utf8")
    fs.renameSync(tmp, file)
    fs.writeFileSync(path.join(path.dirname(file), "progress.md"), renderProgress(checkpoint), "utf8")
  })
  return writeChain
}

function renderProgress(checkpoint: Checkpoint): string {
  const companies = Object.values(checkpoint.companies)
  const lines: string[] = [
    `# ${checkpoint.label} challan pack`,
    "",
    `Updated ${checkpoint.updatedAt} · started ${checkpoint.startedAt} · ${companies.length} companies`,
    "",
    `Payment history ${checkpoint.config.phFrom} → ${checkpoint.config.phTo} · CSI ${checkpoint.config.csiFrom} → ${checkpoint.config.csiTo} (${checkpoint.config.csiAct} act)`,
    "",
    "| Task | Done | NoData | Failed | Pending | InProgress |",
    "|---|---|---|---|---|---|",
  ]
  for (const t of TASKS) {
    const count = (s: TaskStatus) => companies.filter((c) => c.tasks[t].status === s).length
    lines.push(
      `| ${t} | ${count("Done")} | ${count("NoData")} | ${count("Failed")} | ${count("Pending")} | ${count("InProgress")} |`
    )
  }
  const failures = companies.flatMap((c) =>
    TASKS.filter((t) => c.tasks[t].status === "Failed").map(
      (t) =>
        `| ${c.companyId} | ${c.companyName} | ${c.tan} | ${t} | ${c.tasks[t].attempts} | ${(
          c.tasks[t].error || ""
        )
          .replace(/\|/g, "/")
          .replace(/\s+/g, " ")
          .slice(0, 300)} |`
    )
  )
  lines.push("", `## Failures (${failures.length})`, "")
  if (failures.length > 0) {
    lines.push("| ID | Company | TAN | Task | Attempts | Error |", "|---|---|---|---|---|---|", ...failures)
  }
  return lines.join("\n") + "\n"
}

// ---------------------------------------------------------------------------
// Task: payment history
// ---------------------------------------------------------------------------

function paymentDay(row: PaymentHistoryRowInput): Date | null {
  const dayKey = (row.paymentTime || "").trim().split(/\s+/)[0] ?? ""
  return dayKey ? parsePortalDayKey(dayKey) : null
}

function isValidPdf(file: string): boolean {
  if (!fs.existsSync(file)) return false
  const fd = fs.openSync(file, "r")
  try {
    const header = Buffer.alloc(5)
    fs.readSync(fd, header, 0, 5, 0)
    return header.toString("latin1") === "%PDF-" && fs.statSync(file).size > 1000
  } finally {
    fs.closeSync(fd)
  }
}

/**
 * Companies whose CSI file should be taken from the Payment History New Act session (CSI tab
 * selected right after the receipts, no second login), and the files that session produced.
 * runCsi consumes a result here and only logs in on its own when there is none.
 */
const csiViaPh = new Set<number>()
const csiFromPh = new Map<number, { downloadPath: string; files: string[]; startedAt: number }>()

async function runPaymentHistory(company: CompanyRow, cfg: Config): Promise<TaskState["verify"] & { noData?: boolean }> {
  if (!company.it_password?.trim()) throw new Error("Company has no Income Tax password (it_password)")
  const csiAfter = (newAct: boolean) =>
    newAct && csiViaPh.has(company.id) && !csiFromPh.has(company.id)
      ? { fromDate: cfg.csiFrom, toDate: cfg.csiTo }
      : undefined
  const takeCsi = (res: { csi?: { downloadPath: string; files: string[]; startedAt: number }; csiError?: string }) => {
    if (res.csi) {
      csiFromPh.set(company.id, res.csi)
      log(`  [ph] ${company.name}: CSI tab downloaded in same session: ${res.csi.files.join(", ")}`)
    } else if (res.csiError) {
      log(`  [ph] ${company.name}: CSI tab in same session failed (csi task will log in): ${res.csiError}`)
    }
  }

  const from = parsePortalDayKey(cfg.phFrom)!
  const to = parsePortalDayKey(cfg.phTo)!
  const fy = (() => {
    const y = from.getMonth() >= 3 ? from.getFullYear() : from.getFullYear() - 1
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`
  })()

  const fetched = await fetchPaymentHistory({
    tan: company.tan,
    itPassword: company.it_password,
    companyName: company.name,
    acts: ["O", "N"],
    financialYears: [fy],
  })
  const expected = fetched.payments.filter((p) => {
    const d = paymentDay(p)
    return d !== null && d.getTime() >= from.getTime() && d.getTime() <= to.getTime()
  })
  if (expected.length === 0) {
    return { noData: true, portalRowsInFy: fetched.payments.length, expected: 0 }
  }

  const missing = expected.filter((p) => !isValidPdf(paymentHistoryPdfPath(company.name, p.cin)))
  // A truncated or HTML "PDF" from an earlier attempt would be skipped by the downloader.
  for (const p of missing) fs.rmSync(paymentHistoryPdfPath(company.name, p.cin), { force: true })

  const missingOld = missing.filter((p) => p.actType !== "N")
  const missingNew = missing.filter((p) => p.actType === "N")
  const toTarget = (rows: PaymentHistoryRowInput[]) =>
    rows.map((r) => ({
      cin: r.cin,
      paymentTime: r.paymentTime,
      assessmentYear: r.assessmentYear,
      paymentType: r.paymentType,
    }))
  // A failure here is not fatal: whatever is still missing goes to the per-day pass below.
  const bulk = async (label: string, rows: PaymentHistoryRowInput[], newAct: boolean) => {
    if (rows.length === 0) return
    log(`  [ph] ${company.name}: downloading ${rows.length} ${label} receipt(s)`)
    try {
      const res = await downloadMissingPaymentHistoryPdfs(company.tan, company.it_password!, company.name, {
        skipNewActRadio: !newAct,
        skipDateFilter: newAct,
        missing: toTarget(rows),
        csiAfter: csiAfter(newAct),
      })
      takeCsi(res)
    } catch (err) {
      log(`  [ph] ${company.name}: ${label} bulk download failed: ${errorMessage(err)}`)
    }
  }
  await bulk("Old Act", missingOld, false)
  await bulk("New Act", missingNew, true)

  // The unfiltered grid pages 5 rows at a time and a page's API reply is occasionally not
  // captured, which ends pagination early. Fetch any stragglers one deposit day at a time:
  // a single day's filter fits on one grid page, so no paging is involved.
  const byDay = new Map<string, PaymentHistoryRowInput[]>()
  for (const p of expected) {
    if (isValidPdf(paymentHistoryPdfPath(company.name, p.cin))) continue
    fs.rmSync(paymentHistoryPdfPath(company.name, p.cin), { force: true })
    const key = `${(p.paymentTime || "").split(/\s+/)[0]} (${p.actType === "N" ? "new" : "old"} act)`
    byDay.set(key, [...(byDay.get(key) ?? []), p])
  }
  for (const [day, rows] of byDay) {
    log(`  [ph] ${company.name}: retrying ${rows.length} receipt(s) with date filter ${day}`)
    try {
      const res = await downloadMissingPaymentHistoryPdfs(company.tan, company.it_password, company.name, {
        skipNewActRadio: rows[0]!.actType !== "N",
        skipDateFilter: false,
        missing: toTarget(rows),
        csiAfter: csiAfter(rows[0]!.actType === "N"),
      })
      takeCsi(res)
    } catch (err) {
      log(`  [ph] ${company.name}: day ${day} retry failed: ${errorMessage(err)}`)
    }
  }

  const stillMissing = expected.filter((p) => !isValidPdf(paymentHistoryPdfPath(company.name, p.cin)))
  if (stillMissing.length > 0) {
    throw new Error(
      `${stillMissing.length}/${expected.length} receipt(s) still missing: ${stillMissing
        .map((p) => `${p.cin} (${p.actType}, ${p.paymentTime})`)
        .join(", ")}`
    )
  }

  const outDir = path.join(companyOutDir(cfg, company), "PaymentHistory")
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  for (const p of expected) {
    fs.copyFileSync(paymentHistoryPdfPath(company.name, p.cin), path.join(outDir, `${p.cin}_ChallanReceipt.pdf`))
  }
  const range = `${cfg.phFrom}_to_${cfg.phTo}`
  const excelPath = await convertPdfsToExcel(outDir, company.name, {
    skipWait: true,
    quiet: true,
    excelFileName: `PaymentHistory_${safeName(company.name)}_${range}.xlsx`,
  })
  if (!excelPath || !fs.existsSync(excelPath)) throw new Error("PaymentHistory Excel was not created")

  const wb = XLSX.readFile(excelPath)
  const sheet = wb.Sheets[wb.SheetNames[0]!]!
  const excelRows = XLSX.utils.sheet_to_json(sheet).length
  if (excelRows < expected.length) {
    throw new Error(`Excel has ${excelRows} row(s) for ${expected.length} receipt(s) — some PDFs did not parse`)
  }
  const total = expected.reduce((sum, p) => sum + (Number(p.amount) || 0), 0)
  return {
    expected: expected.length,
    pdfs: expected.length,
    excelRows,
    totalAmount: total,
    oldAct: expected.filter((p) => p.actType !== "N").length,
    newAct: expected.filter((p) => p.actType === "N").length,
    excel: path.relative(process.cwd(), excelPath),
  }
}

// ---------------------------------------------------------------------------
// Task: CSI
// ---------------------------------------------------------------------------

const NO_CSI_DATA = /no (record|data|challan)s? (found|available)|no challans? (found|available)/i

async function runCsi(company: CompanyRow, cfg: Config): Promise<TaskState["verify"] & { noData?: boolean }> {
  if (!company.it_password?.trim()) throw new Error("Company has no Income Tax password (it_password)")
  // Taken once: if it fails verification, the task's retry logs in on its own.
  const fromPh = csiFromPh.get(company.id)
  csiFromPh.delete(company.id)
  let startedAt = Date.now()
  let result: { downloadPath: string; files: string[] }
  if (fromPh) {
    log(`  [csi] ${company.name}: using CSI file from the Payment History session`)
    result = fromPh
    startedAt = fromPh.startedAt
  } else {
    try {
      result = await downloadCsiFiles(company.tan, company.it_password, company.name, cfg.csiFrom, cfg.csiTo, {
        skipNewActRadio: cfg.csiAct === "old",
      })
    } catch (err) {
      if (NO_CSI_DATA.test(errorMessage(err))) return { noData: true, reason: errorMessage(err) }
      throw err
    }
  }

  const fresh = result.files
    .map((f) => path.join(result.downloadPath, path.basename(f)))
    .filter((f) => f.toLowerCase().endsWith(".csi") && fs.existsSync(f))
    .filter((f) => fs.statSync(f).mtimeMs >= startedAt - 5000 && fs.statSync(f).size > 0)
  if (fresh.length === 0) {
    throw new Error(`No fresh non-empty .csi file in ${result.downloadPath} (got: ${result.files.join(", ") || "none"})`)
  }

  const outDir = path.join(companyOutDir(cfg, company), "CSI")
  fs.rmSync(outDir, { recursive: true, force: true })
  fs.mkdirSync(outDir, { recursive: true })
  for (const f of fresh) fs.copyFileSync(f, path.join(outDir, path.basename(f)))
  return {
    files: fresh.map((f) => path.basename(f)),
    bytes: fresh.reduce((s, f) => s + fs.statSync(f).size, 0),
    via: fromPh ? "ph-session" : "own-login",
  }
}

// ---------------------------------------------------------------------------
// Task: TRACES unconsumed challan status
// ---------------------------------------------------------------------------

async function runStatus(company: CompanyRow, cfg: Config): Promise<TaskState["verify"] & { noData?: boolean }> {
  if (!company.user_id?.trim() || !company.password?.trim()) {
    throw new Error("Company has no TRACES credentials (user_id / password)")
  }
  const logger = { log: (m: string) => console.log(`  [status][${company.name}] ${m}`) }
  const startedAt = Date.now()

  // Full unconsumed list first: its row count is checked against the portal's own total.
  const listRun = await new NoticeDownloaderChallanStatus(company as any, logger, 0, {
    mode: "list",
  }).scrapeUnconsumedListPuppeteer()
  if (listRun.complete === false) {
    throw new Error(`Unconsumed list truncated: read ${listRun.rowsProcessed} of ${listRun.portalTotal} row(s)`)
  }

  const statusRun = (await new NoticeDownloaderChallanStatus(company as any, logger, 0, {
    onlyPaymentPdfNotInExcel: true,
  }).queryChallanStatusPuppeteer()) as Record<string, unknown> & { success?: boolean; reason?: string }
  if (statusRun?.success === false) throw new Error(statusRun.reason || "Challan status returned success=false")

  const outDir = companyOutDir(cfg, company)
  fs.mkdirSync(outDir, { recursive: true })
  const copied: string[] = []
  for (const src of [
    unconsumedListExcelPath(company.name),
    challanStatusExcelPath(company.name),
    unmatchedChallanStatusExcelPath(company.name),
  ]) {
    if (fs.existsSync(src) && fs.statSync(src).mtimeMs >= startedAt - 5000) {
      fs.copyFileSync(src, path.join(outDir, path.basename(src)))
      copied.push(path.basename(src))
    }
  }

  if (listRun.rowsProcessed === 0) {
    return { noData: true, portalTotal: listRun.portalTotal ?? 0, files: copied }
  }
  if (copied.length === 0) throw new Error("Portal returned unconsumed rows but no Excel was written")
  return {
    unconsumedRows: listRun.rowsProcessed,
    portalTotal: listRun.portalTotal,
    statusRecords: statusRun.totalRecords,
    unmatched: statusRun.unmatchedRecords,
    files: copied,
  }
}

// ---------------------------------------------------------------------------
// Task: TRACES outstanding demand
// ---------------------------------------------------------------------------

function demandAmount(value: unknown): number {
  return parseFloat(String(value ?? "").replace(/[₹,\s]/g, "")) || 0
}

async function runDemand(company: CompanyRow, cfg: Config): Promise<TaskState["verify"] & { noData?: boolean }> {
  if (!company.user_id?.trim() || !company.password?.trim()) {
    throw new Error("Company has no TRACES credentials (user_id / password)")
  }
  const result = await fetchOutstandingDemand({
    credentials: { userId: company.user_id, password: company.password, tan: company.tan },
  })
  if (!Array.isArray(result.data?.rows)) {
    throw new Error(`Unexpected demand reply: ${JSON.stringify(result.data).slice(0, 200)}`)
  }
  // Same merge as /api/outstanding-demand/fetch: the "Prior Years" marker row (fin 1) is
  // replaced by the prior-years feed.
  const rows: any[] = [
    ...result.data.rows.filter((r: any) => r.fin !== 1),
    ...(Array.isArray(result.priorYearsData?.rows) ? result.priorYearsData.rows : []),
  ]
  if (result.data.rows.some((r: any) => r.fin === 1) && !Array.isArray(result.priorYearsData?.rows)) {
    throw new Error("Prior Years row present but the prior-years feed returned no rows")
  }

  for (const row of company.external ? [] : rows) {
    const data = { fin: String(row.fin), aodmnd: row.aodmnd || "0.00", cpcdmd: row.cpcdmd || "0.00" }
    await db.outstandingDemand.upsert({
      where: { companyId_finYr: { companyId: company.id, finYr: row.finYr } },
      update: data,
      create: { companyId: company.id, finYr: row.finYr, ...data },
    })
  }

  const sheetRows = rows.map((r) => ({
    "Company Name": company.name,
    TAN: company.tan,
    "Financial Year": r.finYr,
    "Demand (AO)": demandAmount(r.aodmnd),
    "Demand (CPC)": demandAmount(r.cpcdmd),
    "Total Demand": demandAmount(r.aodmnd) + demandAmount(r.cpcdmd),
  }))
  const totalAo = sheetRows.reduce((sum, r) => sum + r["Demand (AO)"], 0)
  const totalCpc = sheetRows.reduce((sum, r) => sum + r["Demand (CPC)"], 0)

  const outDir = companyOutDir(cfg, company)
  fs.mkdirSync(outDir, { recursive: true })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(
      sheetRows.length > 0
        ? sheetRows
        : [{ "Company Name": company.name, TAN: company.tan, "Financial Year": "No outstanding demand" }]
    ),
    "Outstanding Demand"
  )
  const file = path.join(outDir, `${safeName(company.name)}_outstanding_demand.xlsx`)
  XLSX.writeFile(wb, file)
  return { years: rows.length, totalAo, totalCpc, total: totalAo + totalCpc, file: path.basename(file) }
}

const RUNNERS: Record<TaskName, (c: CompanyRow, cfg: Config) => Promise<Record<string, unknown> & { noData?: boolean }>> = {
  ph: runPaymentHistory,
  csi: runCsi,
  status: runStatus,
  demand: runDemand,
}

// ---------------------------------------------------------------------------
// Browser cleanup: every engine launches through the shared puppeteer-extra instance, so
// wrapping launch() lets each company's run own the browsers it opened and close any an
// engine left behind (e.g. after an error) once the company is finished.
// ---------------------------------------------------------------------------

const companyBrowsers = new AsyncLocalStorage<Set<Browser>>()
const originalLaunch = puppeteer.launch.bind(puppeteer)
;(puppeteer as { launch: typeof puppeteer.launch }).launch = async (...args) => {
  const browser = await originalLaunch(...args)
  companyBrowsers.getStore()?.add(browser)
  return browser
}

/** Puppeteer's temporary --user-data-dir for a launched browser, if it used one. */
function tempProfileDir(browser: Browser): string | undefined {
  const arg = browser.process()?.spawnargs.find((a) => a.startsWith("--user-data-dir="))
  const dir = arg?.slice("--user-data-dir=".length)
  return dir && path.basename(dir).startsWith("puppeteer_dev_") ? dir : undefined
}

async function closeBrowsers(browsers: Set<Browser>, companyName: string) {
  let closed = 0
  const profiles = new Set<string>()
  for (const browser of browsers) {
    const profile = tempProfileDir(browser)
    if (profile) profiles.add(profile)
    if (!browser.isConnected()) continue
    closed++
    await Promise.race([
      browser.close(),
      new Promise((resolve) => setTimeout(resolve, 10000)),
    ]).catch(() => undefined)
    if (browser.isConnected()) browser.process()?.kill("SIGKILL")
  }
  browsers.clear()
  if (closed > 0) log(`  Closed ${closed} leftover browser(s) for ${companyName}`)
  // Puppeteer often leaves its ~20 MB temp profile behind (headful Chrome on macOS, or a
  // SIGKILL), and 400+ of them filled the disk mid-run. Every browser here has exited.
  for (const dir of profiles) fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 })
}

// ---------------------------------------------------------------------------
// One-time preparation and final collection
// ---------------------------------------------------------------------------

function prepare(companies: CompanyRow[]) {
  const statusDir = path.join(PDF_BASE, "challan_status_results")
  const aside = path.join(PDF_BASE, "challan_status_results_pre_q2")
  if (fs.existsSync(statusDir) && !fs.existsSync(aside)) {
    fs.renameSync(statusDir, aside)
    log(`Moved ${path.relative(process.cwd(), statusDir)} → ${path.relative(process.cwd(), aside)}`)
  }
  const listDir = path.join(PDF_BASE, "unconsumed_challan_results")
  const listAside = path.join(PDF_BASE, "unconsumed_challan_results_pre_q2")
  if (fs.existsSync(listDir) && !fs.existsSync(listAside)) {
    fs.renameSync(listDir, listAside)
    log(`Moved ${path.relative(process.cwd(), listDir)} → ${path.relative(process.cwd(), listAside)}`)
  }

  // Earlier receipts drive amount matching in the status run; copy, never overwrite.
  const q1Base = path.join(PDF_BASE, "challans-1")
  let copied = 0
  for (const c of companies) {
    const q1Folder = findMatchingCompanyFolder(c.name, q1Base)
    const src = q1Folder && path.join(q1Folder, "PaymentHistory")
    if (!src || !fs.existsSync(src)) continue
    const dest = paymentHistoryDir(c.name)
    fs.mkdirSync(dest, { recursive: true })
    for (const f of fs.readdirSync(src)) {
      if (!/_ChallanReceipt\.pdf$/i.test(f) || fs.existsSync(path.join(dest, f))) continue
      fs.copyFileSync(path.join(src, f), path.join(dest, f))
      copied++
    }
  }
  log(`Seeded ${copied} earlier receipt PDF(s) into public/pdf/challans/<Company>/PaymentHistory`)
}

function collect(checkpoint: Checkpoint) {
  const rows = Object.values(checkpoint.companies)
    .sort((a, b) => a.companyName.localeCompare(b.companyName))
    .map((c) => {
      const ph = c.tasks.ph
      const csi = c.tasks.csi
      const st = c.tasks.status
      return {
        "Company Name": c.companyName,
        TAN: c.tan,
        "Payment History": ph.status,
        "Challans (Jul–Sep)": ph.verify?.expected ?? "",
        "Total Amount": ph.verify?.totalAmount ?? "",
        "CSI": csi.status,
        "CSI File": Array.isArray(csi.verify?.files) ? (csi.verify!.files as string[]).join(", ") : "",
        "Unconsumed Status": st.status,
        "Unconsumed Challans": st.verify?.unconsumedRows ?? "",
        "Outstanding Demand": c.tasks.demand.status,
        "Demand Amount": c.tasks.demand.verify?.total ?? "",
        Errors: TASKS.filter((t) => c.tasks[t].error && c.tasks[t].status === "Failed")
          .map((t) => `${t}: ${c.tasks[t].error}`)
          .join(" | "),
      }
    })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), "Summary")
  const dir = labelDir(checkpoint.config)
  const summaryPath = path.join(dir, `${checkpoint.label}_summary.xlsx`)
  XLSX.writeFile(wb, summaryPath)
  log(`Summary: ${path.relative(process.cwd(), summaryPath)}`)

  const zipPath = path.join(PDF_BASE, `${checkpoint.label}.zip`)
  fs.rmSync(zipPath, { force: true })
  execFileSync("zip", ["-qr", zipPath, checkpoint.label, "-x", "*/checkpoint.json*"], { cwd: PDF_BASE })
  log(`Zip: ${path.relative(process.cwd(), zipPath)} (${(fs.statSync(zipPath).size / 1e6).toFixed(1)} MB)`)
}

// ---------------------------------------------------------------------------

async function main() {
  const opts = parseCliArgs(process.argv.slice(2))
  const all = opts.companiesXlsx
    ? loadCompaniesXlsx(opts.companiesXlsx)
    : ((await db.company.findMany({
        where: { isTemporary: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true, tan: true, it_password: true, user_id: true, password: true },
      })) as CompanyRow[])

  let companies = all
  if (opts.companyId != null) companies = companies.filter((c) => c.id === opts.companyId)
  if (opts.tan) companies = companies.filter((c) => c.tan.toUpperCase() === opts.tan)
  if (opts.limit) companies = companies.slice(0, opts.limit)
  if (companies.length === 0) throw new Error("No companies matched the filters")

  if (opts.prepare) {
    prepare(all)
    return
  }

  // Load against every company so a filtered run never drops others from the checkpoint.
  const checkpoint = loadOrInitCheckpoint(all, opts)
  await persist(checkpoint)

  if (opts.collect) {
    collect(checkpoint)
    return
  }

  log(
    `${companies.length} compan${companies.length === 1 ? "y" : "ies"} · tasks ${opts.tasks.join(",")} · concurrency ${opts.concurrency}`
  )

  // Companies that only need outstanding demand (the rest is already Done) go last.
  const needsMain = (c: CompanyRow) =>
    opts.tasks.some((t) => {
      if (t === "demand") return false
      const status = checkpoint.companies[String(c.id)]!.tasks[t].status
      return status === "Pending" || (status === "Failed" && opts.retryFailed)
    })
  companies = [...companies.filter(needsMain), ...companies.filter((c) => !needsMain(c))]

  await runWithConcurrency(companies, opts.concurrency, async (company, index) => {
    const browsers = new Set<Browser>()
    await companyBrowsers.run(browsers, () => runCompany(company, index))
    await closeBrowsers(browsers, company.name)
  })

  async function runCompany(company: CompanyRow, index: number) {
    const state = checkpoint.companies[String(company.id)]!
    // Set once a TRACES login is rejected for bad credentials, so the other TRACES
    // task does not spend more password attempts (TRACES locks after 5 for 60 min).
    let tracesCredentialError: string | undefined
    const csiState = state.tasks.csi
    if (
      opts.tasks.includes("ph") &&
      opts.tasks.includes("csi") &&
      opts.csiAct === "new" &&
      (csiState.status === "Pending" || (csiState.status === "Failed" && opts.retryFailed))
    ) {
      csiViaPh.add(company.id)
    }
    for (const task of opts.tasks) {
      const t = state.tasks[task]
      if (t.status === "Done" || t.status === "NoData") continue
      if (t.status === "Failed" && !opts.retryFailed) continue
      if (tracesCredentialError && TRACES_TASKS.has(task)) {
        t.status = "Failed"
        t.error = `skipped after TRACES credential error: ${tracesCredentialError}`
        t.finishedAt = new Date().toISOString()
        log(`[${index + 1}/${companies.length}] ${task} SKIPPED ← ${company.name}: TRACES credentials rejected`)
        await persist(checkpoint)
        continue
      }

      log(`[${index + 1}/${companies.length}] ${task} → ${company.name} (${company.tan})`)
      t.status = "InProgress"
      t.attempts++
      t.startedAt = new Date().toISOString()
      t.error = undefined
      await persist(checkpoint)
      // One immediate retry absorbs transient portal errors (TRACES 404/5xx, slow menus).
      for (let attempt = 1; attempt <= 2; attempt++) {
        try {
          const { noData, ...verify } = await RUNNERS[task](company, opts)
          t.status = noData ? "NoData" : "Done"
          t.verify = verify
          t.error = undefined
          log(`[${index + 1}/${companies.length}] ${task} ${t.status} ← ${company.name} ${JSON.stringify(verify)}`)
          break
        } catch (err) {
          t.status = "Failed"
          t.error = errorMessage(err)
          if (TRACES_TASKS.has(task) && isTracesCredentialError(t.error)) {
            tracesCredentialError = t.error
            log(`[${index + 1}/${companies.length}] ${task} FAILED (credentials, not retried) ← ${company.name}: ${t.error}`)
            break
          }
          if (attempt < 2) {
            log(`[${index + 1}/${companies.length}] ${task} retrying ${company.name}: ${t.error}`)
            await new Promise((resolve) => setTimeout(resolve, 10000))
            continue
          }
          log(`[${index + 1}/${companies.length}] ${task} FAILED ← ${company.name}: ${t.error}`)
        }
      }
      t.finishedAt = new Date().toISOString()
      await persist(checkpoint)
    }
  }

  await persist(checkpoint)
  console.log("\n" + renderProgress(checkpoint))
}

main()
  .then(async () => {
    await db.$disconnect()
    process.exit(0)
  })
  .catch(async (err) => {
    console.error(err)
    await db.$disconnect().catch(() => undefined)
    process.exit(1)
  })
