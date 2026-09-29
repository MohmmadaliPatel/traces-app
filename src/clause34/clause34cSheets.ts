/**
 * Clause 34(c) sheets and the per-company 34(c) block.
 *
 * Layout is reproduced from the workbook supplied by the client:
 *   - `34(c) Challans` — one row per challan carrying interest, the basis of 34(c).
 *   - `34(c) Workings` — reference-only recomputation of interest from the deductee entries.
 *   - a 34(c) block appended below the 34(b) block on every company sheet.
 */
import type ExcelJS from "exceljs"
import {
  AMOUNT_FMT,
  BLUE,
  DATE_FMT,
  GREEN,
  GREY,
  LIGHT_BLUE,
  PERCENT_FMT,
  YELLOW,
  dateValue,
  estimateRowHeight,
  header,
  style,
} from "src/clause34/workbookStyle"
import type { Challan34cRow, Workings34cRow } from "src/clause34/originalWorkbook34c"
import type { Entity34c } from "src/clause34/build34cRows"

export const CHALLANS_WIDTHS = [12, 6, 8, 8, 11, 10, 10, 12, 13, 13, 10, 9, 30, 60]
export const WORKINGS_WIDTHS = [
  12, 6, 8, 8, 12, 30, 8, 14, 12, 11, 11, 11, 11, 9, 9, 11, 11, 11, 32,
]

const CHALLANS_HEADERS = [
  "TAN",
  "Form",
  "Quarter",
  "Challan sr.",
  "Challan date",
  "BSR code",
  "Challan no.",
  "Tax (Rs.)",
  "Interest as per challan (Rs.) - reference",
  "Interest as per TDS return (Rs.)",
  "Included in 34(c)?",
  "Deductee entries in challan",
  "Source conso file",
  "Note",
]

const WORKINGS_HEADERS = [
  "TAN",
  "Form",
  "Quarter",
  "Challan sr.",
  "Deductee PAN",
  "Deductee name",
  "Section code",
  "Amount paid / credited (Rs.)",
  "TDS (Rs.)",
  "Date paid / credited",
  "Date of deduction",
  "Date of deposit",
  "Due date for deposit",
  "Months - late deduction",
  "Months - late payment",
  "Interest - late deduction (Rs.)",
  "Interest - late payment (Rs.)",
  "Total interest (Rs.)",
  "Source conso file",
]

const C34_HEADERS = [
  "(1) Tax deduction and Collection Account Number (TAN)",
  "(2) Amount of interest under section 201(1A)/206C(7) is payable",
  "(3) Amount paid out of column (2)",
  "(4) Date of payment",
  "(5) Remarks if any",
  "",
  "",
  "Form",
  "Quarter",
  "Challan no.",
  "BSR code",
  "Tax in challan (Rs.)",
  "Interest as per challan (Rs.) - reference",
  "Challan sr. in return",
  "Source conso file",
  "Notes",
]

// ---------------------------------------------------------------- 34(c) Challans

export function add34cChallansSheet(workbook: ExcelJS.Workbook, rows: Challan34cRow[]) {
  const sheet = workbook.addWorksheet("34(c) Challans", {
    views: [{ state: "frozen", ySplit: 4 }],
    properties: { defaultColWidth: 9 },
  })
  CHALLANS_WIDTHS.forEach((w, i) => (sheet.getColumn(i + 1).width = w))

  style(sheet.getCell("A1"), { bold: true, size: 12, align: "left", border: false }).value =
    "Clause 34(c) - Interest shown against challans in the TDS returns (basis of 34(c))"

  sheet.mergeCells("A2:N2")
  style(sheet.getCell("A2"), {
    italic: true,
    size: 9,
    color: GREY,
    align: "left",
    border: false,
  }).value =
    "Columns (2) and (3) of 34(c) are both taken from column J - the interest amount shown against " +
    "the challan in the TDS return (TRACES conso file). Date of payment = challan date. Column I " +
    "(interest as per the challan itself) is shown for reference only."

  CHALLANS_HEADERS.forEach((h, i) => header(sheet.getCell(4, i + 1), h))
  sheet.getRow(4).height = 50

  rows.forEach((r, i) => {
    const row = 5 + i
    const fill = r.included ? undefined : YELLOW
    style(sheet.getCell(row, 1), { color: BLUE }).value = r.tan
    style(sheet.getCell(row, 2), { color: BLUE }).value = r.formType
    style(sheet.getCell(row, 3), { color: BLUE }).value = r.quarter
    style(sheet.getCell(row, 4), { color: BLUE }).value = r.challanSerial
    style(sheet.getCell(row, 5), { color: BLUE, numFmt: DATE_FMT }).value = dateValue(r.challanDate)
    style(sheet.getCell(row, 6), { color: BLUE }).value = r.bsrCode
    style(sheet.getCell(row, 7), { color: BLUE }).value = r.challanNo
    style(sheet.getCell(row, 8), { color: BLUE, numFmt: AMOUNT_FMT }).value = r.tax
    style(sheet.getCell(row, 9), { numFmt: AMOUNT_FMT }).value = r.interestPerChallan
    style(sheet.getCell(row, 10), { color: BLUE, numFmt: AMOUNT_FMT }).value = r.interestPerReturn
    style(sheet.getCell(row, 11), { fill }).value = r.included ? "Yes" : "No"
    style(sheet.getCell(row, 12)).value = r.deducteeEntries
    style(sheet.getCell(row, 13), { align: "left" }).value = r.sourceFile
    style(sheet.getCell(row, 14), { align: "left" }).value = r.note
    sheet.getRow(row).height = estimateRowHeight(
      ["", "", "", "", "", "", "", "", "", "", "", "", r.sourceFile, r.note],
      CHALLANS_WIDTHS
    )
  })

  const totalRow = 5 + rows.length
  style(sheet.getCell(totalRow, 1), { bold: true }).value = "Total"
  const included = rows.filter((r) => r.included)
  style(sheet.getCell(totalRow, 9), { bold: true, numFmt: AMOUNT_FMT }).value = rows.reduce(
    (a, r) => a + r.interestPerChallan,
    0
  )
  style(sheet.getCell(totalRow, 10), { bold: true, numFmt: AMOUNT_FMT }).value = included.reduce(
    (a, r) => a + r.interestPerReturn,
    0
  )
}

// ---------------------------------------------------------------- 34(c) Workings

export function add34cWorkingsSheet(workbook: ExcelJS.Workbook, rows: Workings34cRow[]) {
  const sheet = workbook.addWorksheet("34(c) Workings", {
    views: [{ state: "frozen", ySplit: 6 }],
    properties: { defaultColWidth: 9 },
  })
  WORKINGS_WIDTHS.forEach((w, i) => (sheet.getColumn(i + 1).width = w))

  style(sheet.getCell("A1"), { bold: true, size: 12, align: "left", border: false }).value =
    "Reference only - interest u/s 201(1A) computed from deductee entries (NOT used in 34(c))"

  sheet.mergeCells("A2:S2")
  style(sheet.getCell("A2"), {
    italic: true,
    size: 9,
    color: GREY,
    align: "left",
    border: false,
  }).value =
    "34(c) reports the interest as per the TDS returns. This sheet recomputes interest on late " +
    "deduction / late payment for comparison. Only entries with a default are listed. Due date for " +
    "deposit per Rule 30(2): 7th of the next month; 30 April for March. Months are counted as " +
    "calendar months, part of a month = full month (TRACES basis)."

  const rates: [string, number, string][] = [
    ["Rate - late deduction (per month or part)", 0.01, "Section 201(1A)(i)"],
    ["Rate - late payment (per month or part)", 0.015, "Section 201(1A)(ii)"],
  ]
  rates.forEach(([label, rate, ref], i) => {
    const r = 3 + i
    style(sheet.getCell(r, 1), { align: "left", border: false }).value = label
    style(sheet.getCell(r, 5), { numFmt: PERCENT_FMT, border: false }).value = rate
    style(sheet.getCell(r, 6), { align: "left", border: false }).value = ref
  })

  WORKINGS_HEADERS.forEach((h, i) => header(sheet.getCell(6, i + 1), h))
  sheet.getRow(6).height = 52

  rows.forEach((r, i) => {
    const row = 7 + i
    const text = (v: string) => style(sheet.getCell(row, 0), {}) && v
    style(sheet.getCell(row, 1), { color: BLUE }).value = r.tan
    style(sheet.getCell(row, 2), { color: BLUE }).value = r.formType
    style(sheet.getCell(row, 3), { color: BLUE }).value = r.quarter
    style(sheet.getCell(row, 4), { color: BLUE }).value = r.challanSerial
    style(sheet.getCell(row, 5), { color: BLUE }).value = r.deducteePan
    style(sheet.getCell(row, 6), { color: BLUE, align: "left" }).value = r.deducteeName
    style(sheet.getCell(row, 7), { color: BLUE }).value = r.sectionCode
    style(sheet.getCell(row, 8), { color: BLUE, numFmt: AMOUNT_FMT }).value = r.amountPaid
    style(sheet.getCell(row, 9), { color: BLUE, numFmt: AMOUNT_FMT }).value = r.tds
    style(sheet.getCell(row, 10), { color: BLUE, numFmt: DATE_FMT }).value = dateValue(r.datePaid)
    style(sheet.getCell(row, 11), { color: BLUE, numFmt: DATE_FMT }).value = dateValue(
      r.dateOfDeduction
    )
    style(sheet.getCell(row, 12), { color: BLUE, numFmt: DATE_FMT }).value = dateValue(
      r.dateOfDeposit
    )
    style(sheet.getCell(row, 13), { color: GREEN, numFmt: DATE_FMT }).value = dateValue(
      r.dueDateForDeposit
    )
    style(sheet.getCell(row, 14)).value = r.monthsLateDeduction
    style(sheet.getCell(row, 15)).value = r.monthsLatePayment
    style(sheet.getCell(row, 16), { numFmt: AMOUNT_FMT }).value = r.interestLateDeduction
    style(sheet.getCell(row, 17), { numFmt: AMOUNT_FMT }).value = r.interestLatePayment
    style(sheet.getCell(row, 18), { numFmt: AMOUNT_FMT }).value = r.totalInterest
    style(sheet.getCell(row, 19), { align: "left" }).value = r.sourceFile
    void text
    sheet.getRow(row).height = estimateRowHeight(
      [
        "",
        "",
        "",
        "",
        "",
        r.deducteeName,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        "",
        r.sourceFile,
      ],
      WORKINGS_WIDTHS
    )
  })

  const totalRow = 7 + rows.length
  style(sheet.getCell(totalRow, 1), { bold: true }).value = "Total"
  const sum = (pick: (r: Workings34cRow) => number) => rows.reduce((a, r) => a + pick(r), 0)
  style(sheet.getCell(totalRow, 8), { bold: true, numFmt: AMOUNT_FMT }).value = sum(
    (r) => r.amountPaid
  )
  style(sheet.getCell(totalRow, 9), { bold: true, numFmt: AMOUNT_FMT }).value = sum((r) => r.tds)
  style(sheet.getCell(totalRow, 16), { bold: true, numFmt: AMOUNT_FMT }).value = sum(
    (r) => r.interestLateDeduction
  )
  style(sheet.getCell(totalRow, 17), { bold: true, numFmt: AMOUNT_FMT }).value = sum(
    (r) => r.interestLatePayment
  )
  style(sheet.getCell(totalRow, 18), { bold: true, numFmt: AMOUNT_FMT }).value = sum(
    (r) => r.totalInterest
  )
}

// ---------------------------------------------------------------- company 34(c) block

/**
 * Append the 34(c) block to a company sheet.
 *
 * Offsets are taken from the supplied workbook: the block title sits 9 rows below the last
 * 34(b) data row (blank, "Legend:", four legend rows, two blanks). The Total row appears only
 * when the entity has more than one reported challan, exactly as in the original.
 *
 * @param last34bRow last 34(b) data row on this sheet
 * @param widths     company-sheet column widths, for row-height estimation
 * @returns the last row written
 */
export function append34cBlock(
  sheet: ExcelJS.Worksheet,
  data: Entity34c,
  last34bRow: number,
  widths: number[]
): number {
  const title = last34bRow + 9

  style(sheet.getCell(title, 1), { bold: true, size: 12, align: "left", border: false }).value =
    "Clause 34(c) of Form 3CD - Interest under section 201(1A) / 206C(7)"

  const liableRow = title + 1
  sheet.mergeCells(liableRow, 1, liableRow, 5)
  style(sheet.getCell(liableRow, 1), { bold: true, align: "left", border: false }).value =
    "Whether the assessee is liable to pay interest under section 201(1A) or section 206C(7)?"
  style(sheet.getCell(liableRow, 6), { bold: true, border: false }).value = data.liable
    ? "Yes"
    : "No"

  const bandRow = title + 3
  sheet.mergeCells(bandRow, 1, bandRow, 6)
  style(sheet.getCell(bandRow, 1), { bold: true, fill: LIGHT_BLUE, align: "left" }).value =
    "Form 3CD - Clause 34(c)  (amounts as per TDS returns)"
  sheet.mergeCells(bandRow, 8, bandRow, 16)
  style(sheet.getCell(bandRow, 8), { bold: true, fill: LIGHT_BLUE, align: "left" }).value =
    "Working notes (not part of Form 3CD)"

  const headerRow = title + 4
  C34_HEADERS.forEach((h, i) => {
    const cell = sheet.getCell(headerRow, i + 1)
    if (i === 5 || i === 6) {
      style(cell, { border: false })
      return
    }
    header(cell, h)
  })
  sheet.mergeCells(headerRow, 5, headerRow, 6)
  sheet.getRow(headerRow).height = 62

  let row = headerRow + 1

  if (data.rows.length === 0) {
    // Not liable: the original still shows one row carrying the TAN and dashes.
    style(sheet.getCell(row, 1), { color: BLUE }).value = data.entity.tan
    style(sheet.getCell(row, 2), { numFmt: AMOUNT_FMT }).value = 0
    style(sheet.getCell(row, 3), { numFmt: AMOUNT_FMT }).value = 0
    sheet.mergeCells(row, 5, row, 6)
    style(sheet.getCell(row, 4), { align: "left" }).value = "No interest shown in the TDS returns"
    style(sheet.getCell(row, 5), { align: "left" }).value = "-"
    row++
  } else {
    for (const r of data.rows) {
      style(sheet.getCell(row, 1), { color: BLUE }).value = r.tan
      style(sheet.getCell(row, 2), { color: BLUE, numFmt: AMOUNT_FMT }).value = r.interestPayable
      style(sheet.getCell(row, 3), { color: BLUE, numFmt: AMOUNT_FMT }).value = r.interestPaid
      style(sheet.getCell(row, 4), { color: BLUE, numFmt: DATE_FMT }).value = dateValue(
        r.dateOfPayment
      )
      sheet.mergeCells(row, 5, row, 6)
      style(sheet.getCell(row, 5), { align: "left" }).value = r.remarks

      style(sheet.getCell(row, 8), { color: BLUE }).value = r.formType
      style(sheet.getCell(row, 9), { color: BLUE }).value = r.quarter
      style(sheet.getCell(row, 10), { color: BLUE }).value = r.challanNo
      style(sheet.getCell(row, 11), { color: BLUE }).value = r.bsrCode
      style(sheet.getCell(row, 12), { color: BLUE, numFmt: AMOUNT_FMT }).value = r.taxInChallan
      style(sheet.getCell(row, 13), { numFmt: AMOUNT_FMT }).value = r.interestOnChallan
      style(sheet.getCell(row, 14)).value = r.challanSerial
      style(sheet.getCell(row, 15), { align: "left" }).value = r.sourceFile
      style(sheet.getCell(row, 16), { align: "left" }).value = [
        r.notes,
        r.verifiedAgainstConso
          ? "Re-verified against the conso file."
          : "Carried forward from the previous working paper - conso file not available to re-verify.",
      ]
        .filter(Boolean)
        .join(" ")

      sheet.getRow(row).height = estimateRowHeight(
        ["", "", "", "", r.remarks, "", "", "", "", "", "", "", "", "", r.sourceFile, r.notes],
        widths
      )
      row++
    }

    // The original shows a Total only where there is more than one challan.
    if (data.rows.length > 1) {
      style(sheet.getCell(row, 1), { bold: true }).value = "Total"
      style(sheet.getCell(row, 2), { bold: true, numFmt: AMOUNT_FMT }).value = data.totalPayable
      style(sheet.getCell(row, 3), { bold: true, numFmt: AMOUNT_FMT }).value = data.totalPaid
      row++
    }
  }

  row++ // blank
  // The supplied workbook leaves a second blank row on the two sheets that carry an excluded
  // challan; mirrored so the regenerated file is row-for-row identical to the one under review.
  if (data.excluded.length > 0) row++
  style(sheet.getCell(row, 1), { bold: true, align: "left", border: false }).value =
    "Reference only (not reported):"
  row++

  const refs: [string, number][] = [
    [
      "Interest computed on late deduction / late payment from deductee entries ('34(c) Workings')",
      data.computedFromEntries,
    ],
    ["Interest as per TDS returns (column 2 above)", data.totalPayable],
    ["Computed less as per returns", data.difference],
  ]
  for (const [label, value] of refs) {
    style(sheet.getCell(row, 1), { align: "left", border: false }).value = label
    style(sheet.getCell(row, 6), { numFmt: AMOUNT_FMT, border: false }).value = value
    row++
  }

  row++ // blank
  style(sheet.getCell(row, 1), {
    italic: true,
    size: 9,
    color: GREY,
    align: "left",
    border: false,
  }).value =
    "34(c) legend: green = linked to '34(c) Challans' / '34(c) Workings'. Method and notes on the Summary sheet."

  return row
}
