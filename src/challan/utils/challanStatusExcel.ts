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

export function challanStatusCoverageJsonPath(companyName: string): string {
  return path.join(resolveCompanyChallanFolder(companyName), "challan_status_pdf_coverage.json")
}

export function normalizeChallanAmount(amount: number | string | undefined): string {
  if (amount == null || amount === "") return ""
  const n = parseFloat(String(amount).replace(/[₹,\s]/g, ""))
  return Number.isNaN(n) ? "" : String(n)
}

/** Stable key: BSR + Challan Serial No + amount */
export function challanIdentityKey(challan: ChallanIdentity): string {
  const bsr = String(challan.bsr ?? "").trim()
  const csn = String(challan.csn ?? "").trim()
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
