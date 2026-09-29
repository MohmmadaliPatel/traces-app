/**
 * Reader for the clause 34(c) half of the prepared working paper.
 *
 * Unlike 34(b) — which we re-derive from TRACES — 34(c) is *carried forward* from this workbook:
 * it is the extraction of record, taken from the conso (.tds) files at the time they were held.
 * Only 9 of the 20 TANs' conso files still exist locally, so the workbook is the only complete
 * source. Every load therefore tie-checks the totals: a silent drift here would corrupt a tax
 * audit disclosure, so it fails loudly instead.
 */
import fs from "fs"
import path from "path"
import XLSX from "xlsx"
import { parsePortalDate } from "src/clause34/dueDates"

export const WORKBOOK_34BC = path.join(
  process.cwd(),
  "public",
  "pdf",
  "clause34",
  "Clause 34(b) and 34(c) - Continuum Group - FY 2025-26.xlsx"
)

export const SHEET_CHALLANS = "34(c) Challans"
export const SHEET_WORKINGS = "34(c) Workings"

/** Totals the supplied workbook reports; asserted on every load. */
export const EXPECTED_INTEREST_PER_RETURNS = 170373
export const EXPECTED_INTEREST_COMPUTED = 217096

export type Challan34cRow = {
  tan: string
  formType: string
  quarter: string
  challanSerial: string
  challanDate: Date | null
  bsrCode: string
  challanNo: string
  /** Tax in the challan. */
  tax: number
  /** Interest shown on the challan itself — reference only. */
  interestPerChallan: number
  /** Interest shown against the challan in the TDS return — this is what 34(c) reports. */
  interestPerReturn: number
  included: boolean
  deducteeEntries: number
  sourceFile: string
  note: string
}

export type Workings34cRow = {
  tan: string
  formType: string
  quarter: string
  challanSerial: string
  deducteePan: string
  deducteeName: string
  sectionCode: string
  amountPaid: number
  tds: number
  datePaid: Date | null
  dateOfDeduction: Date | null
  dateOfDeposit: Date | null
  dueDateForDeposit: Date | null
  monthsLateDeduction: number
  monthsLatePayment: number
  interestLateDeduction: number
  interestLatePayment: number
  totalInterest: number
  sourceFile: string
}

export type Entity34cSummary = {
  tan: string
  liable: boolean
  payable: number
  paid: number
  computed: number
}

/**
 * Parse the workbook's accounting format `#,##0;(#,##0);-` — brackets mean negative, a bare
 * dash means nil. Returns 0 for anything unparseable rather than NaN.
 */
export function parseAmount(value: unknown): number {
  const raw = String(value ?? "").trim()
  if (!raw || raw === "-") return 0
  const negative = /^\(.*\)$/.test(raw)
  const digits = raw.replace(/[(),\s₹]/g, "")
  const n = Number(digits)
  if (!Number.isFinite(n)) return 0
  return negative ? -n : n
}

function grid(file: string, sheetName: string): string[][] {
  if (!fs.existsSync(file)) throw new Error(`Workbook not found: ${file}`)
  const workbook = XLSX.readFile(file)
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Sheet "${sheetName}" not found in ${path.basename(file)}`)
  return XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: "" }) as string[][]
}

/** `34(c) Challans` — header on row 4, data from row 5 until the Total row. */
export function readChallanRows(file: string = WORKBOOK_34BC): Challan34cRow[] {
  const rows: Challan34cRow[] = []
  const g = grid(file, SHEET_CHALLANS)

  for (let i = 4; i < g.length; i++) {
    const r = g[i]
    if (!r) break
    const tan = String(r[0] ?? "").trim()
    if (!tan || tan === "Total") break

    rows.push({
      tan,
      formType: String(r[1] ?? "").trim(),
      quarter: String(r[2] ?? "").trim(),
      challanSerial: String(r[3] ?? "").trim(),
      challanDate: parsePortalDate(r[4]),
      bsrCode: String(r[5] ?? "").trim(),
      challanNo: String(r[6] ?? "").trim(),
      tax: parseAmount(r[7]),
      interestPerChallan: parseAmount(r[8]),
      interestPerReturn: parseAmount(r[9]),
      included: /^yes$/i.test(String(r[10] ?? "").trim()),
      deducteeEntries: parseAmount(r[11]),
      sourceFile: String(r[12] ?? "").trim(),
      note: String(r[13] ?? "").trim(),
    })
  }

  const total = rows.filter((x) => x.included).reduce((a, x) => a + x.interestPerReturn, 0)
  if (total !== EXPECTED_INTEREST_PER_RETURNS) {
    throw new Error(
      `34(c) tie-out failed: included challan interest is ${total}, expected ${EXPECTED_INTEREST_PER_RETURNS}. ` +
        `The source workbook has changed — re-check before regenerating.`
    )
  }
  return rows
}

/** `34(c) Workings` — header on row 6, data from row 7 until the Total row. */
export function readWorkingsRows(file: string = WORKBOOK_34BC): Workings34cRow[] {
  const rows: Workings34cRow[] = []
  const g = grid(file, SHEET_WORKINGS)

  for (let i = 6; i < g.length; i++) {
    const r = g[i]
    if (!r) break
    const tan = String(r[0] ?? "").trim()
    if (!tan || tan === "Total") break

    rows.push({
      tan,
      formType: String(r[1] ?? "").trim(),
      quarter: String(r[2] ?? "").trim(),
      challanSerial: String(r[3] ?? "").trim(),
      deducteePan: String(r[4] ?? "").trim(),
      deducteeName: String(r[5] ?? "").trim(),
      sectionCode: String(r[6] ?? "").trim(),
      amountPaid: parseAmount(r[7]),
      tds: parseAmount(r[8]),
      datePaid: parsePortalDate(r[9]),
      dateOfDeduction: parsePortalDate(r[10]),
      dateOfDeposit: parsePortalDate(r[11]),
      dueDateForDeposit: parsePortalDate(r[12]),
      monthsLateDeduction: parseAmount(r[13]),
      monthsLatePayment: parseAmount(r[14]),
      interestLateDeduction: parseAmount(r[15]),
      interestLatePayment: parseAmount(r[16]),
      totalInterest: parseAmount(r[17]),
      sourceFile: String(r[18] ?? "").trim(),
    })
  }

  const total = rows.reduce((a, x) => a + x.totalInterest, 0)
  if (total !== EXPECTED_INTEREST_COMPUTED) {
    throw new Error(
      `34(c) workings tie-out failed: computed interest is ${total}, expected ${EXPECTED_INTEREST_COMPUTED}. ` +
        `The source workbook has changed — re-check before regenerating.`
    )
  }
  return rows
}

/** Per-entity 34(c) figures from the Summary sheet (columns N–Q). */
export function readEntity34cSummary(file: string = WORKBOOK_34BC): Map<string, Entity34cSummary> {
  const g = grid(file, "Summary")
  const out = new Map<string, Entity34cSummary>()

  for (let i = 4; i < g.length; i++) {
    const r = g[i]
    if (!r) break
    const tan = String(r[2] ?? "").trim()
    if (!/^[A-Z]{4}[0-9]{5}[A-Z]$/.test(tan)) continue
    out.set(tan, {
      tan,
      liable: /^yes$/i.test(String(r[13] ?? "").trim()),
      payable: parseAmount(r[14]),
      paid: parseAmount(r[15]),
      computed: parseAmount(r[16]),
    })
  }
  return out
}
