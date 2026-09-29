import fs from "fs"
import path from "path"
import * as XLSX from "xlsx"
import pdfParse from "pdf-parse"
import {
  paymentHistoryDir,
  paymentHistoryPdfPath,
  resolveCompanyChallanFolder,
} from "src/challan/utils/paymentHistoryFiles"

export type ChallanIdentity = {
  bsr: string
  csn: string
  challanAmount: number | string
  date?: string
  cin?: string
}

export type PdfChallanCoverageItem = {
  cin?: string
  bsr: string
  csn: string
  challanAmount: number
  date?: string
  pdfFileName: string
  pdfPath: string
  inChallanStatusExcel: boolean
}

export type ChallanStatusPdfCoverageReport = {
  companyName: string
  excelPath: string
  excelExists: boolean
  excelRowCount: number
  totalPdfsParsed: number
  inExcel: number
  notInExcel: number
  items: PdfChallanCoverageItem[]
  checkedAt: string
}

export function challanStatusExcelPath(companyName: string): string {
  const safeName = companyName.replace(/[/\\?%*:|"<>]/g, "_")
  return path.join(process.cwd(), "public", "pdf", "challan_status_results", `${safeName}_challan_status.xlsx`)
}

/** Portal unconsumed-list scrape (no View Amount) — used to drive PDF downloads. */
export function unconsumedListExcelPath(companyName: string): string {
  const safeName = companyName.replace(/[/\\?%*:|"<>]/g, "_")
  return path.join(
    process.cwd(),
    "public",
    "pdf",
    "unconsumed_challan_results",
    `${safeName}_unconsumed_list.xlsx`
  )
}

/** Excel for target-FY unconsumed portal rows whose challan amount could not be matched. */
export function unmatchedChallanStatusExcelPath(companyName: string): string {
  const safeName = companyName.replace(/[/\\?%*:|"<>]/g, "_")
  return path.join(
    process.cwd(),
    "public",
    "pdf",
    "challan_status_results",
    `${safeName}_challan_status_unmatched.xlsx`
  )
}

export function challanStatusCoverageJsonPath(companyName: string): string {
  return path.join(resolveCompanyChallanFolder(companyName), "challan_status_pdf_coverage.json")
}

export function normalizeChallanAmount(amount: number | string | undefined): string {
  if (amount == null || amount === "") return ""
  const n = parseFloat(String(amount).replace(/[₹,\s]/g, ""))
  return Number.isNaN(n) ? "" : String(n)
}

/**
 * Normalize challan serial numbers for matching across PDFs / Excels / TRACES.
 * Ignores leading zeros so "05488" (payment history) equals "5488" (TRACES portal).
 */
export function normalizeChallanSerialNo(csn: string | number | undefined): string {
  const raw = String(csn ?? "").trim()
  if (!raw) return ""
  // Prefer digit-only form when present (Excel numbers, PDF/portal text).
  const digits = raw.replace(/[^\d]/g, "")
  const source = digits || raw
  const stripped = source.replace(/^0+/, "")
  return stripped || "0"
}

/** Indian FY from deposit date like "05-Apr-2025" → "2025-26". */
export function financialYearFromDepositDate(dateStr: string | undefined): string | null {
  if (!dateStr) return null
  const raw = String(dateStr).trim()
  const months: Record<string, number> = {
    Jan: 0,
    Feb: 1,
    Mar: 2,
    Apr: 3,
    May: 4,
    Jun: 5,
    Jul: 6,
    Aug: 7,
    Sep: 8,
    Oct: 9,
    Nov: 10,
    Dec: 11,
  }
  // DD-MMM-YYYY
  const mmm = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (mmm) {
    const monToken = mmm[2]
    const yearToken = mmm[3]
    if (!monToken || !yearToken) return null
    const monKey = monToken[0]!.toUpperCase() + monToken.slice(1).toLowerCase()
    const month = months[monKey]
    const year = parseInt(yearToken, 10)
    if (month == null || Number.isNaN(year)) return null
    if (month >= 3) return `${year}-${String(year + 1).slice(-2)}`
    return `${year - 1}-${String(year).slice(-2)}`
  }
  // DD/MM/YYYY or DD-MM-YYYY
  const dmy = raw.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/)
  if (dmy) {
    const month = parseInt(dmy[2]!, 10) - 1
    const year = parseInt(dmy[3]!, 10)
    if (Number.isNaN(month) || Number.isNaN(year)) return null
    if (month >= 3) return `${year}-${String(year + 1).slice(-2)}`
    return `${year - 1}-${String(year).slice(-2)}`
  }
  return null
}

/** Prefer deposit-date FY; empty/undefined targetFys means accept all. */
export function isTargetFinancialYear(
  dateOfDeposit: string | undefined,
  targetFys?: string[] | null
): boolean {
  if (!targetFys || targetFys.length === 0) return true
  const fy = financialYearFromDepositDate(dateOfDeposit)
  return fy != null && targetFys.includes(fy)
}

/** Supplemental challan-status Excels used for View Amount CSN matching (e.g. Swiggy). */
export const SUPPLEMENTAL_CHALLAN_STATUS_EXCELS = [
  path.join(process.cwd(), "public", "pdf", "Swiggy_challan_status.xlsx"),
  path.join(process.cwd(), "public", "pdf", "Swiggy_challan_status_1.xlsx"),
]

export type SupplementalChallanAmount = {
  bsr: string
  csn: string
  challanAmount: number | string
  date?: string
  tan?: string
  financialYear?: string
  sourceFile: string
}

/**
 * Load unique CSN → amount rows from supplemental Excels for a TAN.
 * When targetFys is provided, prefer rows in those FYs for duplicate CSNs.
 */
export function loadSupplementalChallanAmountsForTan(
  tan: string,
  targetFys?: string[] | null
): SupplementalChallanAmount[] {
  const targetTan = String(tan || "")
    .trim()
    .toUpperCase()
  if (!targetTan) return []

  const byCsn = new Map<string, SupplementalChallanAmount>()
  const fys = targetFys && targetFys.length > 0 ? targetFys : null

  for (const excelPath of SUPPLEMENTAL_CHALLAN_STATUS_EXCELS) {
    if (!fs.existsSync(excelPath)) continue
    const workbook = XLSX.readFile(excelPath)
    const sheetName = workbook.SheetNames[0]
    if (!sheetName) continue
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue
    const rows = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]
    const sourceFile = path.basename(excelPath)

    for (const row of rows) {
      const rowTan = String(row["TAN"] ?? "")
        .trim()
        .toUpperCase()
      if (rowTan !== targetTan) continue

      const csn = String(row["Challan Serial No"] ?? "").trim()
      const bsr = String(row["BSR"] ?? "").trim()
      const challanAmount = row["Challan Amount"]
      const date = String(row["Date of Deposit"] ?? "").trim()
      const financialYear = String(row["Financial Year"] ?? "").trim()
      if (!csn || challanAmount == null || challanAmount === "") continue

      const csnKey = normalizeChallanSerialNo(csn)
      const inTargetFy =
        isTargetFinancialYear(date, fys) ||
        (fys != null && financialYear !== "" && fys.includes(financialYear))

      const entry: SupplementalChallanAmount = {
        bsr,
        csn,
        challanAmount: challanAmount as number | string,
        date: date || undefined,
        tan: rowTan,
        financialYear: financialYear || undefined,
        sourceFile,
      }

      const existing = byCsn.get(csnKey)
      if (!existing) {
        byCsn.set(csnKey, entry)
        continue
      }
      const existingInTarget =
        isTargetFinancialYear(existing.date, fys) ||
        (fys != null &&
          !!existing.financialYear &&
          fys.includes(existing.financialYear))
      if (inTargetFy && !existingInTarget) {
        byCsn.set(csnKey, entry)
      }
    }
  }

  return [...byCsn.values()]
}

/** Stable key: BSR + Challan Serial No + amount (CSN ignores leading zeros). */
export function challanIdentityKey(challan: ChallanIdentity): string {
  const bsr = String(challan.bsr ?? "").trim()
  const csn = normalizeChallanSerialNo(challan.csn)
  const amt = normalizeChallanAmount(challan.challanAmount)
  return `${bsr}|${csn}|${amt}`
}

export function challanIdentityKeyFromExcelRow(row: Record<string, unknown>): string | null {
  const bsr = row["BSR"]
  const csn = row["Challan Serial No"]
  const amt = row["Challan Amount"]
  if (bsr == null || csn == null || amt == null) return null
  return challanIdentityKey({
    bsr: String(bsr),
    csn: String(csn),
    challanAmount: amt as number | string,
  })
}

export function loadChallanStatusExcelRows(companyName: string): Record<string, unknown>[] {
  const excelPath = challanStatusExcelPath(companyName)
  if (!fs.existsSync(excelPath)) {
    return []
  }
  const workbook = XLSX.readFile(excelPath)
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]
}

export function getCoveredChallanKeysFromExcelRows(rows: Record<string, unknown>[]): Set<string> {
  const keys = new Set<string>()
  for (const row of rows) {
    const key = challanIdentityKeyFromExcelRow(row)
    if (key) keys.add(key)
  }
  return keys
}

export function isChallanInExcelRows(
  excelRows: Record<string, unknown>[],
  challan: ChallanIdentity
): boolean {
  const key = challanIdentityKey(challan)
  return getCoveredChallanKeysFromExcelRows(excelRows).has(key)
}

export function writeChallanStatusExcel(
  companyName: string,
  rows: Record<string, unknown>[]
): string {
  const outputPath = challanStatusExcelPath(companyName)
  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, "Challan Status")
  XLSX.writeFile(workbook, outputPath)
  return outputPath
}

export function writeUnconsumedListExcel(
  companyName: string,
  rows: Record<string, unknown>[]
): string {
  const outputPath = unconsumedListExcelPath(companyName)
  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, "Unconsumed List")
  XLSX.writeFile(workbook, outputPath)
  return outputPath
}

export function loadUnconsumedListExcelRows(
  companyName: string
): Record<string, unknown>[] {
  const excelPath = unconsumedListExcelPath(companyName)
  if (!fs.existsSync(excelPath)) return []
  const workbook = XLSX.readFile(excelPath)
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]
}

/** Normalize deposit/payment date to DD-MMM-YYYY (case-insensitive month). */
export function normalizeDepositDateKey(dateStr: string | undefined): string {
  if (!dateStr) return ""
  const raw = String(dateStr).trim().split(/\s+/)[0] || ""
  const mmm = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (mmm) {
    const day = mmm[1]!.padStart(2, "0")
    const mon = mmm[2]![0]!.toUpperCase() + mmm[2]!.slice(1).toLowerCase()
    return `${day}-${mon}-${mmm[3]}`
  }
  return raw
}

export function depositDateAmountMatchKey(
  dateStr: string | undefined,
  amount: number | string | undefined
): string {
  return `${normalizeDepositDateKey(dateStr)}|${normalizeChallanAmount(amount)}`
}

/**
 * Filter unconsumed-list Excel rows to selected FYs (empty = all).
 */
export function filterUnconsumedListRowsByFys(
  rows: Record<string, unknown>[],
  financialYears?: string[] | null
): Record<string, unknown>[] {
  if (!financialYears || financialYears.length === 0) return rows
  return rows.filter((row) =>
    isTargetFinancialYear(String(row["Date of Deposit"] ?? ""), financialYears)
  )
}

export function loadUnmatchedChallanStatusExcelRows(
  companyName: string
): Record<string, unknown>[] {
  const excelPath = unmatchedChallanStatusExcelPath(companyName)
  if (!fs.existsSync(excelPath)) return []
  const workbook = XLSX.readFile(excelPath)
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) return []
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) return []
  return XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]
}

export function writeUnmatchedChallanStatusExcel(
  companyName: string,
  rows: Record<string, unknown>[]
): string {
  const outputPath = unmatchedChallanStatusExcelPath(companyName)
  const outputDir = path.dirname(outputPath)
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true })
  }
  const workbook = XLSX.utils.book_new()
  const worksheet = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(workbook, worksheet, "Unmatched")
  XLSX.writeFile(workbook, outputPath)
  return outputPath
}

function extractPdfField(label: string, text: string): string {
  const regex = new RegExp(`${label}\\s*[:]?\\s*([^\\n]+)`, "i")
  const match = text.match(regex)
  return match && match[1] ? match[1].trim() : ""
}

/** Parse BSR/CSN/amount/CIN from a Payment History challan receipt PDF. */
export async function parseChallanFieldsFromPaymentPdf(pdfPath: string): Promise<{
  bsr: string
  csn: string
  date: string
  challanAmount: number
  cin: string
} | null> {
  try {
    const dataBuffer = fs.readFileSync(pdfPath)
    const pdfData = await pdfParse(dataBuffer)
    const text = pdfData.text
    const bsr = extractPdfField("BSR code", text)
    const csn = extractPdfField("Challan No", text)
    const date = extractPdfField("Date of Deposit", text)
    const amountRaw =
      extractPdfField("Amount \\(in Rs\\.\\)", text) || extractPdfField("Amount", text)
    const challanAmount = parseFloat(amountRaw.replace(/[₹,\s]/g, "")) || 0
    const cin = extractPdfField("CIN", text)
    if (!bsr || !csn || !date || !challanAmount) return null
    return { bsr, csn, date, challanAmount, cin }
  } catch {
    return null
  }
}

/** After challan status run (or on demand): which Payment History PDFs have rows in the status Excel. */
export async function auditPaymentPdfChallanStatusCoverage(
  companyName: string
): Promise<ChallanStatusPdfCoverageReport> {
  const excelPath = challanStatusExcelPath(companyName)
  const excelRows = loadChallanStatusExcelRows(companyName)
  const coveredKeys = getCoveredChallanKeysFromExcelRows(excelRows)

  const dir = paymentHistoryDir(companyName)
  const items: PdfChallanCoverageItem[] = []

  if (fs.existsSync(dir)) {
    const pdfFiles = fs
      .readdirSync(dir)
      .filter((f) => f.toLowerCase().endsWith(".pdf"))

    for (const pdfFileName of pdfFiles) {
      const pdfPath = path.join(dir, pdfFileName)
      const cinFromName = pdfFileName.replace(/_ChallanReceipt\.pdf$/i, "")
      const parsed = await parseChallanFieldsFromPaymentPdf(pdfPath)
      if (!parsed) continue

      const identity: ChallanIdentity = {
        bsr: parsed.bsr,
        csn: parsed.csn,
        challanAmount: parsed.challanAmount,
        date: parsed.date,
        cin: parsed.cin || cinFromName,
      }
      const inChallanStatusExcel = coveredKeys.has(challanIdentityKey(identity))

      items.push({
        cin: identity.cin,
        bsr: parsed.bsr,
        csn: parsed.csn,
        challanAmount: parsed.challanAmount,
        date: parsed.date,
        pdfFileName,
        pdfPath,
        inChallanStatusExcel,
      })
    }
  }

  const inExcel = items.filter((i) => i.inChallanStatusExcel).length

  return {
    companyName,
    excelPath,
    excelExists: fs.existsSync(excelPath),
    excelRowCount: excelRows.length,
    totalPdfsParsed: items.length,
    inExcel,
    notInExcel: items.length - inExcel,
    items,
    checkedAt: new Date().toISOString(),
  }
}

export function saveChallanStatusCoverageReport(
  companyName: string,
  report: ChallanStatusPdfCoverageReport
): string {
  const outPath = challanStatusCoverageJsonPath(companyName)
  const folder = path.dirname(outPath)
  if (!fs.existsSync(folder)) {
    fs.mkdirSync(folder, { recursive: true })
  }
  fs.writeFileSync(outPath, JSON.stringify(report, null, 2), "utf8")
  return outPath
}

export function loadChallanStatusCoverageReport(
  companyName: string
): ChallanStatusPdfCoverageReport | null {
  const p = challanStatusCoverageJsonPath(companyName)
  if (!fs.existsSync(p)) return null
  return JSON.parse(fs.readFileSync(p, "utf8")) as ChallanStatusPdfCoverageReport
}

/** Map CIN → coverage using PDF filename convention when parse not run. */
export function lookupCoverageByCin(
  report: ChallanStatusPdfCoverageReport | null,
  cin: string
): boolean | undefined {
  if (!report) return undefined
  const item = report.items.find((i) => i.cin === cin)
  return item?.inChallanStatusExcel
}
