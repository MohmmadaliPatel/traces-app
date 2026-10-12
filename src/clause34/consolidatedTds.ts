/**
 * Consolidated TDS workbook — one file per deductor, rebuilt from the conso `.tds` files.
 *
 * This reproduces the layout of the consolidated export circulated for review, with three
 * defects in that export corrected:
 *
 *   1. **Challan Interest** was read from field `[37]`, which is a balance, not interest.
 *      Interest is field `[24]`. The two disagree on 107 of the group's 575 challans — the
 *      export showed 0 where a challan genuinely carried interest, and showed an unconsumed
 *      balance as though it were interest.
 *   2. **Challan Amount (OLTAS)** was read from `[21]` (the tax component) instead of `[26]`
 *      (the challan total), understating every interest-bearing challan by its interest.
 *   3. **Challans with no deductee rows were dropped**, because the export was built one row
 *      per deductee. A pure-interest challan has no deductees and vanished entirely.
 *
 * The arithmetic that settles which reading is right: on every challan record
 * `[21] tax + [22] surcharge + [23] cess + [24] interest + [25] fee = [26] total`. That
 * identity holds across all 575 challans; `[37]` plays no part in it.
 */
import fs from "fs"
import path from "path"
import ExcelJS from "exceljs"
import {
  indexConsoFiles,
  parseConsoBatch,
  parseConsoChallans,
  parseConsoDeductees,
  challanTotalsAgree,
  type ConsoChallan,
  type ConsoDeductee,
} from "src/clause34/consoTdsParser"
import { DATE_FMT, GREY, HEADER_BG, WHITE, dateValue, style } from "src/clause34/workbookStyle"

/** Consolidated amounts are carried to paise, so this file shows two decimals throughout. */
const MONEY_FMT = "#,##0.00"

const DETAIL_HEADERS = [
  "Deductor",
  "TAN",
  "Form",
  "FY",
  "Quarter",
  "Token No",
  "Challan Rec No",
  "Deductee Rec No",
  "Employee Sl No",
  "Deductee Type",
  "PAN of Deductee",
  "Name of Deductee",
  "Section Code",
  "Amount Paid/Credited",
  "Date of Payment/Credit",
  "Date of Deduction",
  "Rate (%)",
  "TDS",
  "Surcharge",
  "Education Cess",
  "Total Tax Deducted",
  "Total Tax Deposited",
  "Remarks (Reason Code)",
  "Cert No u/s 197",
  "Challan Serial No",
  "BSR Code",
  "Date of Deposit",
  "Challan Amount (OLTAS)",
  "Challan Amount Claimed",
  "Challan Interest (in challan)",
  "Interest Claimed in Return (34c)",
  "Challan Fee (234E)",
  "Unconsumed / Balance",
  "Minor Head",
  "Book Entry",
  "Source File",
]

const SUMMARY_HEADERS = [
  "Form",
  "FY",
  "Quarter",
  "Token No",
  "Line Items",
  "Amount Paid/Credited",
  "Total Tax Deducted",
  "Total Tax Deposited",
  "Challans",
  "Challan Amt Claimed",
  "Tie-out (Deductee vs Challan)",
  "Challan Amt (OLTAS)",
  "Interest (in challan)",
  "Interest Claimed in Return (34c)",
  "Fee 234E",
  "Unconsumed / Balance",
  "Source File",
]

type Statement = {
  formType: string
  financialYear: string
  quarter: string
  token: string
  deductorName: string
  tan: string
  pan: string
  challans: ConsoChallan[]
  deductees: ConsoDeductee[]
  sourceFile: string
}

/** Collect every FY-matching statement for one TAN, newest correction per period winning. */
export function loadStatements(consoRoot: string, tan: string, financialYear: string): Statement[] {
  const index = indexConsoFiles(consoRoot)
  const byPeriod = new Map<string, Statement>()

  for (const [name, file] of [...index].sort()) {
    if (!name.toUpperCase().startsWith(tan.toUpperCase() + "_")) continue
    const m = name.match(/_(\d{6})_(\d{2}[A-Z]{1,2})_(Q[1-4])/i)
    if (!m || m[1] !== financialYear) continue

    const batch = parseConsoBatch(file)
    const statement: Statement = {
      formType: (m[2] ?? "").toUpperCase(),
      financialYear,
      quarter: (m[3] ?? "").toUpperCase(),
      token: batch?.originalToken ?? "",
      deductorName: batch?.deductorName ?? "",
      tan: batch?.tan ?? tan,
      pan: batch?.pan ?? "",
      challans: parseConsoChallans(file),
      deductees: parseConsoDeductees(file),
      sourceFile: path.relative(consoRoot, file),
    }
    // Later files for the same period are later corrections; keep the latest.
    byPeriod.set(`${statement.formType}|${statement.quarter}`, statement)
  }

  const order = ["Q1", "Q2", "Q3", "Q4"]
  return [...byPeriod.values()].sort((a, b) =>
    a.formType === b.formType
      ? order.indexOf(a.quarter) - order.indexOf(b.quarter)
      : a.formType.localeCompare(b.formType)
  )
}

function header(sheet: ExcelJS.Worksheet, row: number, headers: string[]) {
  headers.forEach((h, i) => {
    const cell = sheet.getCell(row, i + 1)
    style(cell, { bold: true, color: WHITE, fill: HEADER_BG, wrap: true }).value = h
  })
  sheet.getRow(row).height = 34
}

export async function writeConsolidatedTds(options: {
  consoRoot: string
  tan: string
  financialYear: string
  outputPath: string
}): Promise<{
  path: string
  statements: number
  challans: number
  rows: number
  /** Interest deposited in the challans. */
  interest: number
  /** Interest the statements claimed — the clause 34(c) figure. */
  interestClaimed: number
}> {
  const statements = loadStatements(options.consoRoot, options.tan, options.financialYear)
  if (!statements.length)
    throw new Error(`No conso files for ${options.tan} FY ${options.financialYear}`)

  const workbook = new ExcelJS.Workbook()
  workbook.creator = "traces-app consolidated TDS (corrected field mapping)"
  const summary = workbook.addWorksheet("Summary", { views: [{ state: "frozen", ySplit: 4 }] })

  const first = statements[0]!
  style(summary.getCell("A1"), { bold: true, size: 12, align: "left", border: false }).value =
    first.deductorName
  style(summary.getCell("A2"), { bold: true, align: "left", border: false }).value = "TAN"
  style(summary.getCell("B2"), { align: "left", border: false }).value = first.tan
  style(summary.getCell("C2"), { bold: true, align: "left", border: false }).value = "PAN"
  style(summary.getCell("D2"), { align: "left", border: false }).value = first.pan
  header(summary, 4, SUMMARY_HEADERS)

  const byForm = new Map<string, Statement[]>()
  for (const s of statements) {
    byForm.set(s.formType, [...(byForm.get(s.formType) ?? []), s])
  }

  let totalChallans = 0
  let totalRows = 0
  let totalInterest = 0
  let totalInterestClaimed = 0
  let summaryRow = 5

  for (const s of statements) {
    const deducteeSum = s.deductees.reduce((a, d) => a + d.totalDeposited, 0)
    const claimed = s.challans.reduce((a, c) => a + c.claimed, 0)
    // OLTAS is the challan total — tax + surcharge + cess + interest + fee — not the tax alone.
    const oltas = s.challans.reduce((a, c) => a + c.totalDeposited, 0)
    const interest = s.challans.reduce((a, c) => a + c.interestOnChallan, 0)
    // What the return actually claimed as interest — this is the figure clause 34(c) reports,
    // and it differs from the challan's own interest whenever interest is drawn from a
    // challan's spare balance or only partly claimed.
    const interestClaimed = s.challans.reduce((a, c) => a + c.interestInReturn, 0)
    const fee = s.challans.reduce((a, c) => a + c.fee, 0)
    const balance = s.challans.reduce((a, c) => a + c.balance, 0)

    totalChallans += s.challans.length
    totalRows += s.deductees.length
    totalInterest += interest
    totalInterestClaimed += interestClaimed

    const vals: (string | number)[] = [
      s.formType,
      s.financialYear,
      s.quarter,
      s.token,
      s.deductees.length,
      s.deductees.reduce((a, d) => a + d.amountPaid, 0),
      s.deductees.reduce((a, d) => a + d.totalDeducted, 0),
      deducteeSum,
      s.challans.length,
      claimed,
      Math.abs(deducteeSum - claimed) < 0.01 ? "OK" : `DIFF ${(deducteeSum - claimed).toFixed(2)}`,
      oltas,
      interest,
      interestClaimed,
      fee,
      balance,
      s.sourceFile,
    ]
    vals.forEach((v, i) => {
      const numeric = i >= 5 && i <= 15 && i !== 10
      style(summary.getCell(summaryRow, i + 1), {
        numFmt: numeric ? MONEY_FMT : undefined,
        align: i === 16 ? "left" : "center",
      }).value = v
    })
    summaryRow++
  }

  const totalRowIdx = summaryRow + 1
  style(summary.getCell(totalRowIdx, 1), { bold: true }).value = "TOTAL"
  for (const col of [5, 6, 7, 8, 9, 10, 12, 13, 14, 15, 16]) {
    const letter = String.fromCharCode(64 + col)
    const sum = statements.reduce((a, _s, i) => {
      const v = summary.getCell(5 + i, col).value
      return a + (Number(v) || 0)
    }, 0)
    style(summary.getCell(totalRowIdx, col), {
      bold: true,
      numFmt: col === 5 || col === 9 ? undefined : MONEY_FMT,
    }).value = sum
  }

  const noteRow = totalRowIdx + 2
  summary.mergeCells(noteRow, 1, noteRow, 17)
  style(summary.getCell(noteRow, 1), {
    italic: true,
    size: 9,
    color: GREY,
    align: "left",
    border: false,
  }).value =
    "'Challan Amt (OLTAS)' is the full challan value (tax + surcharge + cess + interest + fee). " +
    "'Challan Amt Claimed' is the portion claimed in that statement and ties to 'Total Tax " +
    "Deposited'. TWO interest figures are shown and they are not the same thing: 'Interest (in " +
    "challan)' is the interest component deposited in the challan, while 'Interest Claimed in " +
    "Return (34c)' is what the statement actually claimed as interest against it — the latter is " +
    "the figure clause 34(c) reports. They differ where interest is drawn from a challan's spare " +
    "balance, or where only part of a challan's interest is claimed. 'Unconsumed / Balance' is " +
    "the challan's unallocated amount — it is NOT interest. A challan consumed across more than " +
    "one quarter appears in each of those statements, so its column total can double-count."

  // ---- one detail sheet per form type
  for (const [formType, forms] of byForm) {
    const sheet = workbook.addWorksheet(formType, { views: [{ state: "frozen", ySplit: 1 }] })
    header(sheet, 1, DETAIL_HEADERS)
    let r = 2

    for (const s of forms) {
      for (const c of s.challans) {
        const mine = s.deductees.filter((d) => d.challanSerial === c.serial)
        // A challan with no deductee entries (a pure-interest challan) still gets a row — the
        // export under review dropped these entirely.
        const entries: (ConsoDeductee | null)[] = mine.length ? mine : [null]

        for (const d of entries) {
          const vals: (string | number | Date | null)[] = [
            s.deductorName,
            s.tan,
            s.formType,
            s.financialYear,
            s.quarter,
            s.token,
            c.serial,
            d ? d.recordNo : "",
            d ? d.deducteeSl : "",
            d ? d.deducteeType : "",
            d ? d.pan : "",
            d ? d.name : "(no deductee entries against this challan)",
            d ? d.sectionCode : "",
            d ? d.amountPaid : 0,
            d ? dateValue(d.datePaid) : null,
            d ? dateValue(d.dateDeducted) : null,
            d ? d.rate : "",
            d ? d.tds : 0,
            d ? d.surcharge : 0,
            d ? d.cess : 0,
            d ? d.totalDeducted : 0,
            d ? d.totalDeposited : 0,
            d ? d.reasonCode : "",
            d ? d.cert197 : "",
            c.challanNo,
            c.bsrCode,
            dateValue(c.challanDate),
            c.totalDeposited,
            c.claimed,
            c.interestOnChallan,
            c.interestInReturn,
            c.fee,
            c.balance,
            c.minorHead,
            c.bookEntry,
            s.sourceFile,
          ]
          vals.forEach((v, i) => {
            const isDate = [14, 15, 26].includes(i)
            const isAmount = [13, 17, 18, 19, 20, 21, 27, 28, 29, 30, 31, 32].includes(i)
            style(sheet.getCell(r, i + 1), {
              numFmt: isDate ? DATE_FMT : isAmount ? MONEY_FMT : undefined,
              align: [0, 11, 35].includes(i) ? "left" : "center",
              wrap: false,
            }).value = v as any
          })
          r++
        }
      }
    }

    const widths = [
      30, 12, 7, 8, 8, 17, 9, 9, 9, 12, 13, 30, 9, 16, 13, 13, 9, 13, 11, 12, 14, 14, 10, 13, 11,
      11, 13, 16, 16, 15, 17, 13, 16, 9, 8, 46,
    ]
    widths.forEach((w, i) => (sheet.getColumn(i + 1).width = w))
  }

  const summaryWidths = [7, 8, 8, 17, 10, 18, 16, 17, 9, 17, 14, 17, 15, 17, 11, 16, 46]
  summaryWidths.forEach((w, i) => (summary.getColumn(i + 1).width = w))

  // Integrity gate: the components of every challan must sum to its stated total. If this
  // fails the field offsets are wrong, and the file must not be issued.
  const bad = statements.flatMap((s) => s.challans).filter((c) => !challanTotalsAgree(c))
  if (bad.length) {
    throw new Error(
      `${bad.length} challan(s) do not reconcile (tax+surcharge+cess+interest+fee != total) — ` +
        `field offsets are wrong, refusing to write ${path.basename(options.outputPath)}`
    )
  }

  if (!fs.existsSync(path.dirname(options.outputPath))) {
    fs.mkdirSync(path.dirname(options.outputPath), { recursive: true })
  }
  await workbook.xlsx.writeFile(options.outputPath)
  return {
    path: options.outputPath,
    statements: statements.length,
    challans: totalChallans,
    rows: totalRows,
    interest: totalInterest,
    interestClaimed: totalInterestClaimed,
  }
}
