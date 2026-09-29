/**
 * Create ₹10 (or CSV-driven) e-Pay challans from Input-Challan CSV, download
 * Generated Challans PDFs, verify each company got a PDF, then zip the set.
 *
 * Credentials: CSV Username/Password, optionally overridden from TAN Excel.
 *
 * CLI:
 *   --trial              First company only
 *   --create-only        Skip download / zip
 *   --download-only      Skip create (download + verify + zip)
 *   --concurrency=N      Create concurrency (default 3, max 7)
 *   --download-concurrency=N  Download concurrency (default 2, max 4)
 *   --csv=PATH           Override CSV path
 *   --credentials=PATH   Optional TAN credentials Excel override
 *   --fresh              Ignore checkpoint and start clean
 *   --retry-failed       Only re-run Failed companies from checkpoint
 *
 * Examples:
 *   node -r esbuild-register src/scripts/createAndDownloadGeneratedChallansBatch.ts --trial
 *   node -r esbuild-register src/scripts/createAndDownloadGeneratedChallansBatch.ts --concurrency=3
 */
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import AdmZip from "adm-zip"
import * as XLSX from "xlsx"
import { createChallan } from "./createChallan"
import { downloadGeneratedChallansWithFilters } from "./downloadChallanPayment"
import {
  parseCsvFileText,
  parseChallanCsvRow,
  buildEpayDownloadTargetsFromRow,
  type ParsedChallanCsvRow,
} from "../challan/utils/parseChallanCsv"
import { runWithConcurrency } from "../challan/utils/runWithConcurrency"
import pdf from "pdf-parse"

dotenv.config()

/**
 * TEMP: single-company download probe — download first DownloadFailed company only,
 * concurrency 1, then verify PDF text shows ₹10. Keep false for normal runs.
 */
const TEMP_PROBE_FIRST_FAILED_DOWNLOAD = false

const DEFAULT_CREATE_CONCURRENCY = 3
const MAX_CREATE_CONCURRENCY = 7
const DEFAULT_DOWNLOAD_CONCURRENCY = 2
const MAX_DOWNLOAD_CONCURRENCY = 4

const DEFAULT_CSV = path.join(process.cwd(), "public", "Input-Challan - final.csv")
const DEFAULT_CREDENTIALS = path.join(
  process.cwd(),
  "public",
  "pdf",
  "Tan Login Credential (2).xlsx"
)
const OUT_DIR = path.join(process.cwd(), "public", "pdf", "generated_challans_batch")
const CHECKPOINT_PATH = path.join(OUT_DIR, "checkpoint.json")
const REPORT_PATH = path.join(OUT_DIR, "report.json")
const ZIP_PATH = path.join(OUT_DIR, "GeneratedChallans_10rs.zip")

type CompanyStatus = "Pending" | "CreateOk" | "CreateFailed" | "DownloadOk" | "DownloadFailed"

type CompanyCheckpoint = {
  companyName: string
  tan: string
  assessmentYear: string
  act: string
  expectedAmount: number
  status: CompanyStatus
  pymntRefNum?: string
  createError?: string
  downloadError?: string
  pdfCount?: number
  pdfPaths?: string[]
  attempts: number
  updatedAt?: string
}

type CheckpointFile = {
  startedAt: string
  updatedAt: string
  csvPath: string
  companies: Record<string, CompanyCheckpoint>
  summary: {
    total: number
    createOk: number
    createFailed: number
    downloadOk: number
    downloadFailed: number
  }
}

type CliOptions = {
  trial: boolean
  createOnly: boolean
  downloadOnly: boolean
  fresh: boolean
  retryFailed: boolean
  concurrency: number
  downloadConcurrency: number
  csvPath: string
  credentialsPath: string
}

function parseCli(argv: string[]): CliOptions {
  const opts: CliOptions = {
    trial: false,
    createOnly: false,
    downloadOnly: false,
    fresh: false,
    retryFailed: false,
    concurrency: DEFAULT_CREATE_CONCURRENCY,
    downloadConcurrency: DEFAULT_DOWNLOAD_CONCURRENCY,
    csvPath: DEFAULT_CSV,
    credentialsPath: DEFAULT_CREDENTIALS,
  }
  for (const arg of argv) {
    if (arg === "--trial") opts.trial = true
    else if (arg === "--create-only") opts.createOnly = true
    else if (arg === "--download-only") opts.downloadOnly = true
    else if (arg === "--fresh") opts.fresh = true
    else if (arg === "--retry-failed") opts.retryFailed = true
    else if (arg.startsWith("--concurrency=")) {
      const n = parseInt(arg.split("=")[1] || "", 10)
      if (!Number.isNaN(n)) opts.concurrency = Math.min(MAX_CREATE_CONCURRENCY, Math.max(1, n))
    } else if (arg.startsWith("--download-concurrency=")) {
      const n = parseInt(arg.split("=")[1] || "", 10)
      if (!Number.isNaN(n))
        opts.downloadConcurrency = Math.min(MAX_DOWNLOAD_CONCURRENCY, Math.max(1, n))
    } else if (arg.startsWith("--csv=")) {
      opts.csvPath = path.resolve(arg.slice("--csv=".length))
    } else if (arg.startsWith("--credentials=")) {
      opts.credentialsPath = path.resolve(arg.slice("--credentials=".length))
    }
  }
  return opts
}

function loadCredentialsFromExcel(excelPath: string): Map<string, string> {
  const map = new Map<string, string>()
  if (!fs.existsSync(excelPath)) {
    console.warn(`[credentials] Excel not found: ${excelPath}`)
    return map
  }
  const wb = XLSX.readFile(excelPath)
  const sheet = wb.Sheets[wb.SheetNames[0]!]
  if (!sheet) return map
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet)
  for (const row of rows) {
    const tan = String(
      row["Tan Login User Id"] ?? row["Username"] ?? row["TAN"] ?? ""
    )
      .trim()
      .toUpperCase()
    const password = String(
      row["Tan Login Password"] ?? row["Password"] ?? row["IT Password"] ?? ""
    ).trim()
    if (tan && password) map.set(tan, password)
  }
  console.log(`[credentials] Loaded ${map.size} TAN password(s) from Excel`)
  return map
}

function loadCsvRows(csvPath: string, passwordOverrides: Map<string, string>): ParsedChallanCsvRow[] {
  const text = fs.readFileSync(csvPath, "utf8")
  const rawRows = parseCsvFileText(text)
  const rows: ParsedChallanCsvRow[] = []
  for (const raw of rawRows) {
    const parsed = parseChallanCsvRow(raw)
    if (!parsed) continue
    const tan = parsed.username.trim().toUpperCase()
    const override = passwordOverrides.get(tan)
    if (override) parsed.password = override
    if (!parsed.username || !parsed.password) {
      console.warn(`[csv] Skipping ${parsed.companyName}: missing username/password`)
      continue
    }
    if (parsed.sections.length === 0) continue
    rows.push(parsed)
  }
  return rows
}

function emptySummary(total: number): CheckpointFile["summary"] {
  return {
    total,
    createOk: 0,
    createFailed: 0,
    downloadOk: 0,
    downloadFailed: 0,
  }
}

function recomputeSummary(cp: CheckpointFile) {
  const vals = Object.values(cp.companies)
  cp.summary = {
    total: vals.length,
    createOk: vals.filter((c) =>
      ["CreateOk", "DownloadOk", "DownloadFailed"].includes(c.status)
    ).length,
    createFailed: vals.filter((c) => c.status === "CreateFailed").length,
    downloadOk: vals.filter((c) => c.status === "DownloadOk").length,
    downloadFailed: vals.filter((c) => c.status === "DownloadFailed").length,
  }
  cp.updatedAt = new Date().toISOString()
}

function saveCheckpoint(cp: CheckpointFile) {
  fs.mkdirSync(OUT_DIR, { recursive: true })
  recomputeSummary(cp)
  fs.writeFileSync(CHECKPOINT_PATH, JSON.stringify(cp, null, 2))
  fs.writeFileSync(REPORT_PATH, JSON.stringify(cp, null, 2))
}

function loadOrInitCheckpoint(
  rows: ParsedChallanCsvRow[],
  csvPath: string,
  fresh: boolean
): CheckpointFile {
  if (!fresh && fs.existsSync(CHECKPOINT_PATH)) {
    const existing = JSON.parse(fs.readFileSync(CHECKPOINT_PATH, "utf8")) as CheckpointFile
    console.log(`[checkpoint] Resuming from ${CHECKPOINT_PATH}`)
    return existing
  }
  const companies: Record<string, CompanyCheckpoint> = {}
  for (const row of rows) {
    const targets = buildEpayDownloadTargetsFromRow(row)
    const expectedAmount = targets[0]?.amount ?? 0
    const key = row.username.trim().toUpperCase()
    companies[key] = {
      companyName: row.companyName,
      tan: key,
      assessmentYear: row.assessmentYear,
      act: row.act,
      expectedAmount,
      status: "Pending",
      attempts: 0,
    }
  }
  const cp: CheckpointFile = {
    startedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    csvPath,
    companies,
    summary: emptySummary(rows.length),
  }
  saveCheckpoint(cp)
  return cp
}

function listPdfsForCompany(companyName: string, subdir: string): string[] {
  const dir = path.join(process.cwd(), "public", "pdf", "challans", companyName, subdir)
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .map((f) => path.join(dir, f))
}

function shouldRunCreate(status: CompanyStatus, retryFailed: boolean): boolean {
  if (status === "Pending") return true
  if (retryFailed && status === "CreateFailed") return true
  return false
}

function shouldRunDownload(
  status: CompanyStatus,
  opts: { downloadOnly: boolean; retryFailed: boolean }
): boolean {
  if (opts.downloadOnly) {
    if (opts.retryFailed) return status === "DownloadFailed" || status === "CreateOk"
    return status !== "DownloadOk"
  }
  if (status === "CreateOk" || status === "DownloadFailed") return true
  return false
}

async function verifyPdfIsTenRupees(pdfPath: string): Promise<{
  ok: boolean
  amountText?: string
  snippet?: string
}> {
  const buf = fs.readFileSync(pdfPath)
  const data = await pdf(buf)
  const text = String(data.text || "").replace(/\s+/g, " ")
  const amountMatch =
    text.match(/remit an amount of\s*₹\s*([0-9,]+)/i) ||
    text.match(/₹\s*([0-9,]+)/) ||
    text.match(/Rupees\s+([A-Za-z]+)\s+Only/i)
  const amountText = amountMatch?.[0]
  const numeric = amountMatch?.[1]?.replace(/,/g, "")
  const ok =
    numeric === "10" ||
    /₹\s*10\b/.test(text) ||
    /Rupees\s+Ten\s+Only/i.test(text)
  return { ok, amountText, snippet: text.slice(0, 400) }
}

async function main() {
  const cli = parseCli(process.argv.slice(2))
  console.log("[cli]", cli)

  const passwordOverrides = loadCredentialsFromExcel(cli.credentialsPath)
  let rows = loadCsvRows(cli.csvPath, passwordOverrides)
  if (rows.length === 0) {
    throw new Error(`No valid rows in CSV: ${cli.csvPath}`)
  }
  if (cli.trial) {
    rows = rows.slice(0, 1)
    console.log(`[trial] Processing only: ${rows[0]!.companyName}`)
  }

  // Load full checkpoint first so TEMP probe can pick the first DownloadFailed TAN
  const cpFullPath = CHECKPOINT_PATH
  let probeTan: string | undefined
  if (TEMP_PROBE_FIRST_FAILED_DOWNLOAD && fs.existsSync(cpFullPath)) {
    const existing = JSON.parse(fs.readFileSync(cpFullPath, "utf8")) as CheckpointFile
    const failedOrder = rows
      .map((r) => r.username.trim().toUpperCase())
      .filter((tan) => existing.companies[tan]?.status === "DownloadFailed")
    probeTan = failedOrder[0]
    if (!probeTan) {
      throw new Error("TEMP probe: no DownloadFailed company found in checkpoint")
    }
    cli.downloadOnly = true
    cli.retryFailed = true
    cli.downloadConcurrency = 1
    rows = rows.filter((r) => r.username.trim().toUpperCase() === probeTan)
    console.log(
      `[TEMP PROBE] download-only, concurrency=1, first failed TAN=${probeTan} (${rows[0]!.companyName})`
    )
    console.log(
      `[TEMP PROBE] keeping AY+amount filter targets (same as successful Continuum/Bothe/DJ downloads)`
    )
  }

  const cp = loadOrInitCheckpoint(rows, cli.csvPath, cli.fresh || !fs.existsSync(CHECKPOINT_PATH))
  // Ensure all current rows exist in checkpoint (fresh already filled; resume may need new keys)
  for (const row of rows) {
    const key = row.username.trim().toUpperCase()
    if (!cp.companies[key]) {
      const targets = buildEpayDownloadTargetsFromRow(row)
      cp.companies[key] = {
        companyName: row.companyName,
        tan: key,
        assessmentYear: row.assessmentYear,
        act: row.act,
        expectedAmount: targets[0]?.amount ?? 0,
        status: "Pending",
        attempts: 0,
      }
    }
  }
  // When probing, merge status from full checkpoint for this TAN so retry-failed works
  if (TEMP_PROBE_FIRST_FAILED_DOWNLOAD && probeTan && fs.existsSync(cpFullPath)) {
    const existing = JSON.parse(fs.readFileSync(cpFullPath, "utf8")) as CheckpointFile
    const full = existing.companies
    // Restore full company map so we don't wipe other companies' status when saving
    cp.companies = { ...full, ...cp.companies }
    const entry = cp.companies[probeTan]
    if (entry) {
      entry.status = "DownloadFailed"
      entry.downloadError = undefined
    }
  }
  saveCheckpoint(cp)

  // ── Phase 1: Create ──────────────────────────────────────────────
  if (!cli.downloadOnly) {
    const createItems = rows.filter((r) => {
      const st = cp.companies[r.username.trim().toUpperCase()]!.status
      return shouldRunCreate(st, cli.retryFailed)
    })
    console.log(`\n=== CREATE PHASE: ${createItems.length} compan(ies), concurrency=${cli.concurrency} ===\n`)

    await runWithConcurrency(createItems, cli.concurrency, async (row) => {
      const key = row.username.trim().toUpperCase()
      const entry = cp.companies[key]!
      entry.attempts += 1
      entry.updatedAt = new Date().toISOString()
      console.log(`[create] ${row.companyName} (${key}) sections=`, row.sections)

      try {
        const results = await createChallan({
          companyName: row.companyName,
          companyCode: row.companyCode || key,
          username: row.username,
          password: row.password,
          assessmentYear: row.assessmentYear,
          sections: row.sections.map((s) => ({
            sectionCode: s.sectionCode,
            amount: s.amount,
            actType: row.act,
          })),
          newRegimeChallanMode: row.newRegimeChallanMode,
          skipDownload: true,
        })

        const ok = results.filter((r) => r.success)
        if (ok.length === 0) {
          entry.status = "CreateFailed"
          entry.createError = results.map((r) => r.error || "unknown").join("; ") || "no success"
          console.error(`[create] FAILED ${row.companyName}: ${entry.createError}`)
        } else {
          entry.status = "CreateOk"
          entry.pymntRefNum = ok[0]?.pymntRefNum
          entry.createError = undefined
          console.log(
            `[create] OK ${row.companyName} pymntRefNum=${entry.pymntRefNum} (${ok.length}/${results.length} sections)`
          )
        }
      } catch (e: any) {
        entry.status = "CreateFailed"
        entry.createError = e?.message || String(e)
        console.error(`[create] ERROR ${row.companyName}:`, entry.createError)
      }
      saveCheckpoint(cp)
    })
  }

  // ── Phase 2: Download Generated Challans ─────────────────────────
  if (!cli.createOnly) {
    const downloadItems = rows.filter((r) => {
      const key = r.username.trim().toUpperCase()
      const st = cp.companies[key]!.status
      return shouldRunDownload(st, {
        downloadOnly: cli.downloadOnly,
        retryFailed: cli.retryFailed,
      })
    })

    console.log(
      `\n=== DOWNLOAD PHASE: ${downloadItems.length} compan(ies), concurrency=${cli.downloadConcurrency} ===\n`
    )

    await runWithConcurrency(downloadItems, cli.downloadConcurrency, async (row) => {
      const key = row.username.trim().toUpperCase()
      const entry = cp.companies[key]!
      const targets = buildEpayDownloadTargetsFromRow(row)
      entry.updatedAt = new Date().toISOString()
      console.log(`[download] ${row.companyName} targets=`, targets)

      try {
        // Pass no assessmentYear filter param — targeted download matches AY+amount on grid only.
        await downloadGeneratedChallansWithFilters(
          row.username,
          row.password,
          row.companyName,
          undefined,
          undefined,
          undefined,
          undefined,
          {
            skipNewActRadio: row.act !== "new",
            rowDownloadTargets: targets,
          }
        )

        let pdfs = listPdfsForCompany(row.companyName, "GeneratedChallansFiltered")
        if (pdfs.length === 0) {
          pdfs = listPdfsForCompany(row.companyName, "GeneratedChallans")
        }
        entry.pdfPaths = pdfs
        entry.pdfCount = pdfs.length

        if (pdfs.length === 0) {
          entry.status = "DownloadFailed"
          entry.downloadError = "No PDF found after download"
          console.error(`[download] FAILED ${row.companyName}: no PDF`)
        } else {
          // Prefer newest PDF (by mtime) for amount check
          const newest = [...pdfs].sort(
            (a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs
          )[0]!
          const check = await verifyPdfIsTenRupees(newest)
          console.log(`[verify] ${path.basename(newest)} amountText=${check.amountText || "n/a"}`)
          console.log(`[verify] snippet: ${check.snippet}`)
          if (!check.ok) {
            entry.status = "DownloadFailed"
            entry.downloadError = `PDF downloaded but amount is not ₹10 (${check.amountText || "no amount found"})`
            console.error(`[verify] FAIL ${row.companyName}: not ₹10`)
          } else {
            entry.status = "DownloadOk"
            entry.downloadError = undefined
            console.log(`[download] OK ${row.companyName}: ${pdfs.length} PDF(s), verified ₹10`)
          }
        }
      } catch (e: any) {
        entry.status = "DownloadFailed"
        entry.downloadError = e?.message || String(e)
        console.error(`[download] ERROR ${row.companyName}:`, entry.downloadError)
      }
      saveCheckpoint(cp)
    })
  }

  // ── Phase 3: Verify + Zip ────────────────────────────────────────
  recomputeSummary(cp)
  saveCheckpoint(cp)

  const allEntries = rows.map((r) => cp.companies[r.username.trim().toUpperCase()]!)
  const missingCreate = allEntries.filter((e) => e.status === "CreateFailed" || e.status === "Pending")
  const missingDownload = allEntries.filter((e) => e.status !== "DownloadOk")

  console.log("\n=== SUMMARY ===")
  console.log(JSON.stringify(cp.summary, null, 2))

  if (!cli.createOnly) {
    const zip = new AdmZip()
    let zipped = 0
    for (const entry of allEntries) {
      const paths =
        entry.pdfPaths && entry.pdfPaths.length > 0
          ? entry.pdfPaths
          : [
              ...listPdfsForCompany(entry.companyName, "GeneratedChallansFiltered"),
              ...listPdfsForCompany(entry.companyName, "GeneratedChallans"),
            ]
      const unique = Array.from(new Set(paths)).filter((p) => fs.existsSync(p))
      const folder = `${entry.tan}_${entry.companyName.replace(/[\/\\?%*:|"<>]/g, "_")}`
      for (const pdf of unique) {
        zip.addLocalFile(pdf, folder)
        zipped += 1
      }
    }
    if (zipped > 0) {
      zip.writeZip(ZIP_PATH)
      console.log(`[zip] Wrote ${zipped} PDF(s) → ${ZIP_PATH}`)
    } else {
      console.warn("[zip] No PDFs to zip")
    }
  }

  // Final verification table
  console.log("\n=== PER-COMPANY STATUS ===")
  for (const e of allEntries) {
    console.log(
      `${e.status.padEnd(14)} ${e.tan} | ${e.companyName} | ref=${e.pymntRefNum || "-"} | pdfs=${e.pdfCount ?? 0}`
    )
  }

  if (missingCreate.length > 0) {
    console.error(`\n❌ ${missingCreate.length} compan(ies) without successful create`)
  }
  if (!cli.createOnly && missingDownload.length > 0) {
    console.error(`\n❌ ${missingDownload.length} compan(ies) without successful download`)
  }
  if (
    missingCreate.length === 0 &&
    (cli.createOnly || missingDownload.length === 0)
  ) {
    console.log("\n✅ All requested companies completed successfully")
  } else {
    console.log(`\nReport: ${REPORT_PATH}`)
    console.log("Re-run with --retry-failed to retry failures")
    process.exitCode = 1
  }

}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
