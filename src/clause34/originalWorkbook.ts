/**
 * Reader for the hand-prepared clause 34(b) workbook.
 *
 * It is the baseline the regenerated workbook is diffed against: every row it already carries
 * must either be confirmed by the portal or be reported as changed. Reading it also tells us
 * which statements the preparer expected to exist, so a statement the portal does not know
 * about is visible rather than silently dropped.
 */
import fs from "fs"
import path from "path"
import XLSX from "xlsx"
import { parsePortalDate } from "src/clause34/dueDates"

export const ORIGINAL_WORKBOOK = path.join(
  process.cwd(),
  "public",
  "pdf",
  "clause34",
  "Clause 34(b) - Continuum Group - FY 2025-26.xlsx"
)

/** Sheets that hold group-level content rather than one assessee's statements. */
const NON_COMPANY_SHEETS = new Set(["Summary", "Due Dates"])

export type OriginalRow = {
  sheet: string
  tan: string
  formType: string
  quarter: string
  dueDate: Date | null
  /** Column (d) as prepared. */
  dateOfFurnishing: Date | null
  originalToken: string
  latestToken: string
  correctionFiled: string
  dateOfLatest: Date | null
  basis: string
  timeliness: string
  sourceFile: string
  remarks: string
}

export function readOriginalWorkbook(file: string = ORIGINAL_WORKBOOK): OriginalRow[] {
  if (!fs.existsSync(file)) throw new Error(`Original workbook not found: ${file}`)
  const workbook = XLSX.readFile(file)
  const rows: OriginalRow[] = []

  for (const sheetName of workbook.SheetNames) {
    if (NON_COMPANY_SHEETS.has(sheetName)) continue
    const sheet = workbook.Sheets[sheetName]
    if (!sheet) continue

    const grid = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    }) as string[][]

    // Row 7 is the header; data starts at row 8 and runs until the first blank TAN.
    for (let i = 7; i < grid.length; i++) {
      const r = grid[i]
      if (!r) break
      const tan = String(r[0] ?? "").trim()
      if (!tan || tan === "Legend:") break

      rows.push({
        sheet: sheetName,
        tan,
        formType: String(r[1] ?? "").trim(),
        quarter: String(r[7] ?? "").trim(),
        dueDate: parsePortalDate(r[2]),
        dateOfFurnishing: parsePortalDate(r[3]),
        originalToken: String(r[8] ?? "").trim(),
        latestToken: String(r[9] ?? "").trim(),
        correctionFiled: String(r[10] ?? "").trim(),
        dateOfLatest: parsePortalDate(r[11]),
        basis: String(r[12] ?? "").trim(),
        timeliness: String(r[13] ?? "").trim(),
        sourceFile: String(r[14] ?? "").trim(),
        remarks: String(r[15] ?? "").trim(),
      })
    }
  }

  return rows
}

export function originalRowKey(tan: string, formType: string, quarter: string): string {
  return `${tan.toUpperCase()}|${formType.toUpperCase()}|${quarter.toUpperCase()}`
}

export function indexOriginalRows(rows: OriginalRow[]): Map<string, OriginalRow> {
  return new Map(rows.map((r) => [originalRowKey(r.tan, r.formType, r.quarter), r]))
}
