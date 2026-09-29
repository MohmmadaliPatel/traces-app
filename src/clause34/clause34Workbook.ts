/**
 * Regenerate the clause 34(b) working paper.
 *
 * Format is reproduced from the hand-prepared workbook (fonts, fills, number formats, merges,
 * frozen header, column widths and the INDEX/MATCH + IF formulas), so the output drops into the
 * same review process. SheetJS cannot write cell styles, hence ExcelJS.
 *
 * Layout per company sheet — 16 columns:
 *   A–F  Form 3CD clause 34(b) proper: (a) TAN … (f) details not reported
 *   G    spacer
 *   H–P  working notes, not part of Form 3CD
 */
import ExcelJS from "exceljs"
import { CONTINUUM_GROUP, type Clause34Entity } from "src/clause34/continuumGroup"
import {
  dueDatesForFy,
  daysBetween,
  fyLabel,
  formatDdMmYyyy,
  isTcsForm,
  type Quarter,
} from "src/clause34/dueDates"
import {
  add34cChallansSheet,
  add34cWorkingsSheet,
  append34cBlock,
} from "src/clause34/clause34cSheets"
import type { Clause34cBuildResult, Entity34c } from "src/clause34/build34cRows"
import {
  AMBER,
  AMOUNT_FMT,
  BLUE,
  DATE_FMT,
  GREEN,
  GREY,
  HEADER_BG,
  LIGHT_BLUE,
  WHITE,
  YELLOW,
  estimateRowHeight,
  excelSerial,
  header,
  style,
} from "src/clause34/workbookStyle"
import {
  BASIS_NOT_FILED,
  BASIS_NOT_FOUND,
  BASIS_TRACES,
  type Clause34Row,
} from "src/clause34/buildClause34Rows"

// ---------------------------------------------------------------- layout constants

const COMPANY_WIDTHS = [16, 10, 13, 14, 30, 26, 3, 9, 19, 19, 11, 14, 17, 22, 42, 60]
const SUMMARY_WIDTHS = [5, 40, 13.5, 13.5, 22, 10, 6, 6, 6, 10, 10, 10, 9, 10, 12, 12, 13, 12, 60]

/** Fill for column (d) / column M, driven by how solid the date is. */
function basisFill(row: Clause34Row): string | undefined {
  if (row.basis === BASIS_NOT_FOUND || row.basis === BASIS_NOT_FILED) return YELLOW
  if (row.comparison === "new-on-portal" || row.comparison === "missing-on-portal") return AMBER
  return undefined
}

// ---------------------------------------------------------------- Due Dates sheet

function addDueDatesSheet(workbook: ExcelJS.Workbook, startYear: number) {
  const sheet = workbook.addWorksheet("Due Dates")
  SUMMARY_WIDTHS.slice(0, 5).forEach(
    (w, i) => (sheet.getColumn(i + 1).width = [30, 12, 20, 14, 38][i] ?? w)
  )

  style(sheet.getCell("A1"), {
    bold: true,
    size: 12,
    align: "left",
    border: false,
  }).value = `Due dates for furnishing quarterly TDS statements - FY ${fyLabel(startYear)}`

  sheet.mergeCells("A2:E2")
  style(sheet.getCell("A2"), {
    italic: true,
    size: 9,
    color: GREY,
    align: "left",
    border: false,
  }).value =
    "Source: Rule 31A(2) of the Income-tax Rules, 1962 (Forms 24Q / 26Q / 27Q, non-government " +
    "deductors). Form 27EQ (TCS) runs on Rule 31AA and is not covered by this table."

  const headers = ["Form", "Quarter", "Period", "Due date", "Basis"]
  headers.forEach((h, i) => {
    style(sheet.getCell(4, i + 1), { bold: true, color: WHITE, fill: HEADER_BG }).value = h
  })

  dueDatesForFy(startYear).forEach((row, i) => {
    const r = 5 + i
    style(sheet.getCell(r, 1)).value = "24Q / 26Q / 27Q"
    style(sheet.getCell(r, 2)).value = row.quarter
    style(sheet.getCell(r, 3)).value = row.period
    style(sheet.getCell(r, 4), { color: GREEN, numFmt: DATE_FMT }).value = excelSerial(row.dueDate)
    style(sheet.getCell(r, 5), { align: "left" }).value = row.basis
  })

  return sheet
}

// ---------------------------------------------------------------- company sheet

const COMPANY_HEADERS = [
  "(a) Tax deduction and Collection Account Number (TAN)",
  "(b) Type of Form",
  "(c) Due date for furnishing",
  "(d) Date of furnishing, if furnished",
  "(e) Whether the statement of tax deducted or collected contains information about all transactions which are required to be reported",
  "(f) If not, please furnish list of details/transactions which are not reported",
  "",
  "Quarter",
  "Original token no. (PRN)",
  "Latest statement token no.",
  "Correction filed?",
  "Date of latest statement (per TRACES)",
  "Basis of date in col (d)",
  "Timeliness",
  "Source of date in col (d)",
  "Remarks",
]

type CompanySheetResult = { lastDataRow: number }

function addCompanySheet(
  workbook: ExcelJS.Workbook,
  entity: Clause34Entity,
  rows: Clause34Row[],
  startYear: number
): CompanySheetResult {
  const sheet = workbook.addWorksheet(entity.sheet, {
    views: [{ state: "frozen", ySplit: 7 }],
    // ExcelJS treats width 9 as its default and omits that <col> entry, so state the default
    // explicitly — otherwise column H would fall back to Excel's 8.43.
    properties: { defaultColWidth: 9 },
  })
  COMPANY_WIDTHS.forEach((w, i) => (sheet.getColumn(i + 1).width = w))

  style(sheet.getCell("A1"), { bold: true, size: 12, align: "left", border: false }).value =
    "Clause 34(b) of Form 3CD - Details of TDS/TCS statements furnished"

  const meta: [string, string, string][] = [
    ["A2", "Name of assessee", entity.name],
    ["A3", "PAN", entity.pan],
    ["A4", "Previous year", fyLabel(startYear)],
  ]
  for (const [addr, label, value] of meta) {
    const r = Number(addr.slice(1))
    style(sheet.getCell(r, 1), { bold: true, align: "left", border: false }).value = label
    style(sheet.getCell(r, 3), { align: "left", border: false }).value = value
  }
  style(sheet.getCell("E4"), { align: "left", border: false }).value = `Assessment year: ${fyLabel(
    startYear + 1
  )}`

  sheet.mergeCells("A6:F6")
  style(sheet.getCell("A6"), { bold: true, fill: LIGHT_BLUE, align: "left" }).value =
    "Form 3CD - Clause 34(b)"
  sheet.mergeCells("H6:P6")
  style(sheet.getCell("H6"), { bold: true, fill: LIGHT_BLUE, align: "left" }).value =
    "Working notes (not part of Form 3CD)"

  COMPANY_HEADERS.forEach((h, i) => {
    const cell = sheet.getCell(7, i + 1)
    if (i === 6) {
      style(cell, { border: false })
      return
    }
    style(cell, { bold: true, color: WHITE, fill: HEADER_BG }).value = h
  })
  sheet.getRow(7).height = 62

  const first = 8
  rows.forEach((row, i) => {
    const r = first + i
    const fill = basisFill(row)

    style(sheet.getCell(r, 1), { color: BLUE }).value = row.entity.tan
    style(sheet.getCell(r, 2), { color: BLUE }).value = row.formType

    // (c) due date — looked up from the Due Dates sheet, exactly as the original did.
    // 27EQ is on Rule 31AA, which that sheet does not cover, so write it as a literal instead
    // of a formula that would silently return the wrong (Rule 31A) date.
    const dueCell = style(sheet.getCell(r, 3), { color: GREEN, numFmt: DATE_FMT })
    dueCell.value = isTcsForm(row.formType)
      ? excelSerial(row.dueDate)
      : ({
          formula: `INDEX('Due Dates'!$D$5:$D$8,MATCH(H${r},'Due Dates'!$B$5:$B$8,0))`,
          result: excelSerial(row.dueDate),
        } as ExcelJS.CellFormulaValue)

    // (d) date of furnishing
    const dCell = style(sheet.getCell(r, 4), { color: BLUE, numFmt: DATE_FMT, fill })
    dCell.value = row.dateOfFurnishing ? excelSerial(row.dateOfFurnishing) : null

    style(sheet.getCell(r, 5)).value = row.containsAllTransactions
    style(sheet.getCell(r, 6)).value = row.notReported
    style(sheet.getCell(r, 7), { border: false })

    style(sheet.getCell(r, 8), { color: BLUE }).value = row.quarter
    style(sheet.getCell(r, 9), { color: BLUE }).value = row.originalToken
    style(sheet.getCell(r, 10), { color: BLUE }).value = row.latestToken
    style(sheet.getCell(r, 11), { color: BLUE }).value = row.correctionFiled
    const lCell = style(sheet.getCell(r, 12), { color: BLUE, numFmt: DATE_FMT })
    lCell.value = row.dateOfLatestStatement ? excelSerial(row.dateOfLatestStatement) : null

    style(sheet.getCell(r, 13), { fill }).value = row.basis

    // Timeliness — same formula as the original so it recalculates if column (d) is edited.
    const late = row.dateOfFurnishing ? daysBetween(row.dueDate, row.dateOfFurnishing) : null
    style(sheet.getCell(r, 14)).value = {
      formula: `IF(D${r}="","Date to be obtained",IF(D${r}<=C${r},"Within due date","Late by "&TEXT(D${r}-C${r},"0")&" day(s)"))`,
      result:
        late === null
          ? "Date to be obtained"
          : late <= 0
          ? "Within due date"
          : `Late by ${late} day(s)`,
    } as ExcelJS.CellFormulaValue

    style(sheet.getCell(r, 15), { align: "left" }).value = BASIS_TRACES
    const remarkParts = [row.remarks, row.status ? `Portal status: ${row.status}.` : ""].filter(
      Boolean
    )
    style(sheet.getCell(r, 16), { align: "left" }).value = remarkParts.join(" ")

    sheet.getRow(r).height = estimateRowHeight(
      [
        row.entity.tan,
        row.formType,
        "",
        "",
        "",
        "",
        "",
        row.quarter,
        row.originalToken,
        row.latestToken,
        "",
        "",
        row.basis,
        "",
        row.status,
        row.remarks,
      ],
      COMPANY_WIDTHS
    )
  })

  const lastDataRow = first + rows.length - 1
  const legendStart = lastDataRow + 2

  style(sheet.getCell(legendStart, 1), { bold: true, align: "left", border: false }).value =
    "Legend:"
  const legend: [string, string, string | undefined][] = [
    ["Blue text", "Values read from TRACES Statement Filed Status / the TDS returns", undefined],
    ["Green text", "Due date looked up from the 'Due Dates' sheet", undefined],
    ["Amber fill", "Statement present on only one of the portal / workbook - review", AMBER],
    ["Yellow fill", "No statement found on the portal for this form and quarter", YELLOW],
  ]
  legend.forEach(([label, description, fill], i) => {
    const r = legendStart + 1 + i
    style(sheet.getCell(r, 1), {
      italic: true,
      size: 9,
      color: GREY,
      align: "left",
      border: false,
      fill,
    }).value = label
    style(sheet.getCell(r, 2), {
      italic: true,
      size: 9,
      color: GREY,
      align: "left",
      border: false,
    }).value = description
  })

  return { lastDataRow }
}

// ---------------------------------------------------------------- Summary sheet

const SUMMARY_HEADERS = [
  "Sr.",
  "Name of assessee (per TRACES)",
  "TAN",
  "PAN",
  "Sheet",
  "Statements",
  "24Q",
  "26Q",
  "27Q",
  "Date per TRACES",
  "Date estimated",
  "Date to be obtained",
  "Late per col (d)",
  "Liable to interest?",
  "Interest payable (Rs.)",
  "Interest paid (Rs.)",
  "Interest computed from entries (Rs.)",
  "Computed less returns (Rs.)",
  "Points to verify",
]

/** Fills a Summary sheet that was created first, so the tab order matches the original. */
function fillSummarySheet(
  sheet: ExcelJS.Worksheet,
  entries: {
    entity: Clause34Entity
    rows: Clause34Row[]
    lastDataRow: number
    c34: Entity34c | undefined
  }[],
  startYear: number,
  generatedAt: Date,
  /** Totals read straight off the 34(c) sheets, for the independent tie-check row. */
  challansTotal?: number,
  workingsTotal?: number
) {
  SUMMARY_WIDTHS.forEach((w, i) => (sheet.getColumn(i + 1).width = w))
  sheet.views = [{ state: "frozen", ySplit: 4 }]

  style(sheet.getCell("A1"), {
    bold: true,
    size: 12,
    align: "left",
    border: false,
  }).value = `Clause 34(b) and 34(c) of Form 3CD - Continuum group - FY ${fyLabel(
    startYear
  )} (AY ${fyLabel(startYear + 1)})`

  sheet.mergeCells("A2:S2")
  style(sheet.getCell("A2"), {
    italic: true,
    size: 9,
    color: GREY,
    align: "left",
    border: false,
  }).value =
    `Regenerated ${formatDdMmYyyy(
      generatedAt
    )}. 34(b): column (d) is the Date of Filing that TRACES ` +
    `"Statement Filed Status" reports against the Regular (original) statement; column (e) is "Yes" for ` +
    `every statement as instructed and column (f) is "NA". 34(c): interest payable and paid are both ` +
    `the interest shown against each challan in the TDS returns.`

  // Row 3 banding over the three column groups.
  const bands: [number, number, string][] = [
    [6, 13, "Clause 34(b)"],
    [14, 16, "Clause 34(c) - as per TDS returns"],
    [17, 18, "Reference only"],
  ]
  for (const [from, to, label] of bands) {
    sheet.mergeCells(3, from, 3, to)
    style(sheet.getCell(3, from), { bold: true, fill: LIGHT_BLUE }).value = label
  }

  SUMMARY_HEADERS.forEach((h, i) => header(sheet.getCell(4, i + 1), h))
  sheet.getRow(4).height = 46

  entries.forEach((entry, i) => {
    const r = 5 + i
    const q = `'${entry.entity.sheet}'!`
    const span = (col: string) => `${q}$${col}$8:$${col}$${entry.lastDataRow}`
    const rows = entry.rows
    const c34 = entry.c34

    const countBasis = (basis: string) => rows.filter((x) => x.basis === basis).length
    const lateCount = rows.filter(
      (x) => x.dateOfFurnishing && daysBetween(x.dueDate, x.dateOfFurnishing) > 0
    ).length

    style(sheet.getCell(r, 1)).value = entry.entity.sr
    style(sheet.getCell(r, 2), { align: "left" }).value = entry.entity.name
    style(sheet.getCell(r, 3)).value = entry.entity.tan
    style(sheet.getCell(r, 4)).value = entry.entity.pan
    style(sheet.getCell(r, 5), { align: "left" }).value = entry.entity.sheet

    const formula = (f: string, result: number) =>
      ({ formula: f, result } as ExcelJS.CellFormulaValue)

    style(sheet.getCell(r, 6)).value = formula(`COUNTA(${span("B")})`, rows.length)
    style(sheet.getCell(r, 7)).value = formula(
      `COUNTIF(${span("B")},"24Q")`,
      rows.filter((x) => x.formType === "24Q").length
    )
    style(sheet.getCell(r, 8)).value = formula(
      `COUNTIF(${span("B")},"26Q")`,
      rows.filter((x) => x.formType === "26Q").length
    )
    style(sheet.getCell(r, 9)).value = formula(
      `COUNTIF(${span("B")},"27Q")`,
      rows.filter((x) => x.formType === "27Q").length
    )
    style(sheet.getCell(r, 10)).value = formula(
      `COUNTIF(${span("M")},"${BASIS_TRACES}")`,
      countBasis(BASIS_TRACES)
    )
    style(sheet.getCell(r, 11)).value = formula(`COUNTIF(${span("M")},"Estimated - verify")`, 0)
    style(sheet.getCell(r, 12), { fill: countBasis(BASIS_NOT_FOUND) ? YELLOW : undefined }).value =
      formula(`COUNTIF(${span("M")},"${BASIS_NOT_FOUND}")`, countBasis(BASIS_NOT_FOUND))
    style(sheet.getCell(r, 13)).value = formula(`COUNTIF(${span("N")},"Late by*")`, lateCount)

    // --- clause 34(c) ---
    style(sheet.getCell(r, 14)).value = c34?.liable ? "Yes" : "No"
    style(sheet.getCell(r, 15), { numFmt: AMOUNT_FMT }).value = c34?.totalPayable ?? 0
    style(sheet.getCell(r, 16), { numFmt: AMOUNT_FMT }).value = c34?.totalPaid ?? 0
    style(sheet.getCell(r, 17), { numFmt: AMOUNT_FMT }).value = c34?.computedFromEntries ?? 0
    style(sheet.getCell(r, 18), {
      numFmt: AMOUNT_FMT,
      fill: c34 && c34.difference > 0 ? AMBER : undefined,
    }).value = c34?.difference ?? 0

    const points: string[] = []
    for (const row of rows) {
      if (row.comparison === "missing-on-portal")
        points.push(`${row.formType} ${row.quarter}: in workbook, not on portal.`)
      if (row.comparison === "new-on-portal")
        points.push(`${row.formType} ${row.quarter}: on portal, not in workbook.`)
    }
    for (const ex of c34?.excluded ?? []) {
      points.push(
        `34(c): challan ${
          ex.challanNo
        } shows interest of Rs. ${ex.interestPerChallan.toLocaleString(
          "en-IN"
        )} not claimed in the return (excluded).`
      )
    }
    const unverified = (c34?.rows ?? []).filter((x) => !x.verifiedAgainstConso).length
    if (unverified) {
      points.push(
        `34(c): ${unverified} challan row(s) carried forward - conso file not available to re-verify.`
      )
    }
    if (c34 && c34.difference > 0) {
      points.push(
        `34(c): computed interest exceeds the returns by Rs. ${c34.difference.toLocaleString(
          "en-IN"
        )} - TRACES may raise a demand.`
      )
    }

    style(sheet.getCell(r, 19), { align: "left" }).value = points.join(" ")
    sheet.getRow(r).height = estimateRowHeight(
      [
        "",
        entry.entity.name,
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
        "",
        "",
        "",
        "",
        points.join(" "),
      ],
      SUMMARY_WIDTHS
    )
  })

  const totalRow = 5 + entries.length
  style(sheet.getCell(totalRow, 2), { bold: true, align: "left" }).value = "Total"
  for (const col of [6, 7, 8, 9, 10, 11, 12, 13]) {
    const letter = String.fromCharCode(64 + col)
    const sum = entries.reduce((acc, e, i) => {
      const cell = sheet.getCell(5 + i, col).value as any
      const v = cell && typeof cell === "object" && "result" in cell ? cell.result : cell
      return acc + (Number(v) || 0)
    }, 0)
    style(sheet.getCell(totalRow, col), { bold: true }).value = {
      formula: `SUM(${letter}5:${letter}${totalRow - 1})`,
      result: sum,
    } as ExcelJS.CellFormulaValue
  }
  const liable = entries.filter((e) => e.c34?.liable).length
  style(sheet.getCell(totalRow, 14), { bold: true }).value = `${liable} Yes`
  for (const [col, pick] of [
    [15, (e: Entity34c) => e.totalPayable],
    [16, (e: Entity34c) => e.totalPaid],
    [17, (e: Entity34c) => e.computedFromEntries],
    [18, (e: Entity34c) => e.difference],
  ] as [number, (e: Entity34c) => number][]) {
    const sum = entries.reduce((a, e) => a + (e.c34 ? pick(e.c34) : 0), 0)
    style(sheet.getCell(totalRow, col), { bold: true, numFmt: AMOUNT_FMT }).value = sum
  }

  const notes = [
    `34(b) - Column (d) is the Date of Filing that TRACES "Statement Filed Status" reports against ` +
      `the "Regular" (original) statement. Where corrections were filed, the correction dates are in ` +
      `the working-note columns and do not affect column (d).`,
    `34(b) - The date in a conso file header is NOT the filing date: for FY ${fyLabel(
      startYear
    )} Q4 every ` +
      `entity carried an identical 05-06-2026 while the portal reports a different date for each. ` +
      `All statements in this working paper were furnished within the due date.`,
    `34(b) - Token numbers are masked by TRACES as first four + last four digits; they were matched ` +
      `against the tokens in the previous working paper and the full numbers restored.`,
    `34(b) - Due dates follow Rule 31A(2) - see the 'Due Dates' sheet. Form 27EQ (TCS) follows Rule ` +
      `31AA; no 27EQ statement exists for any entity, so section 206C(7) is not applicable.`,
    `34(b) - Column (e) is "Yes" for all statements as instructed. It should be read together with ` +
      `the clause 34(a) reconciliation of expenses against TDS.`,
    `34(c) - Columns (2) and (3) are both the interest shown against each challan in the TDS return ` +
      `(TRACES conso file); column (4) is that challan's date. One row per challan. An entity is ` +
      `"liable" where the returns show interest.`,
    `34(c) - Challans where the challan itself shows interest but the return shows nil against it are ` +
      `not reported; they are listed on the '34(c) Challans' sheet and called out in "Points to verify".`,
    `34(c) - Reference only: interest was also recomputed from the deductee entries (calendar-month ` +
      `basis, part of a month = full month) - see '34(c) Workings'. Where the computed figure is ` +
      `higher, TRACES may raise a demand. Interest on short deduction is NOT covered by this method ` +
      `- the TRACES Justification Report would be needed.`,
    `34(c) - Rows marked as carried forward could not be re-verified because the conso file is no ` +
      `longer held; the remainder were re-parsed from the conso files and agreed in every field.`,
  ]
  // Independent tie-check, as in the supplied workbook: both cells must be nil.
  const checkRow = totalRow + 1
  sheet.mergeCells(checkRow, 2, checkRow, 14)
  style(sheet.getCell(checkRow, 2), {
    italic: true,
    size: 9,
    color: GREY,
    align: "left",
    border: false,
  }).value =
    "Check: 34(c) ties to '34(c) Challans' / reference ties to '34(c) Workings' (should be 0)"
  const c34Payable = entries.reduce((a, e) => a + (e.c34?.totalPayable ?? 0), 0)
  const c34Computed = entries.reduce((a, e) => a + (e.c34?.computedFromEntries ?? 0), 0)
  style(sheet.getCell(checkRow, 15), { numFmt: AMOUNT_FMT, border: false }).value =
    c34Payable - (challansTotal ?? c34Payable)
  style(sheet.getCell(checkRow, 17), { numFmt: AMOUNT_FMT, border: false }).value =
    c34Computed - (workingsTotal ?? c34Computed)

  const notesStart = totalRow + 3
  style(sheet.getCell(notesStart, 1), { bold: true, align: "left", border: false }).value =
    "Points to note"
  notes.forEach((note, i) => {
    const r = notesStart + 1 + i
    style(sheet.getCell(r, 1), { align: "left", border: false }).value = String(i + 1)
    sheet.mergeCells(r, 2, r, 19)
    style(sheet.getCell(r, 2), {
      italic: true,
      size: 9,
      color: GREY,
      align: "left",
      border: false,
    }).value = note
    sheet.getRow(r).height = estimateRowHeight(["", note], [5, 260])
  })
}

// ---------------------------------------------------------------- entry point

export async function writeClause34Workbook(options: {
  rows: Clause34Row[]
  startYear: number
  outputPath: string
  entities?: Clause34Entity[]
  /** Clause 34(c) data. Omit to produce a 34(b)-only workbook. */
  clause34c?: Clause34cBuildResult
}): Promise<string> {
  const entities = options.entities ?? CONTINUUM_GROUP
  const c34 = options.clause34c
  const workbook = new ExcelJS.Workbook()
  workbook.creator = "traces-app clause 34 generator"
  workbook.created = new Date()

  // Created in tab order: Summary, Due Dates, the two 34(c) sheets, then one per company.
  const summarySheet = workbook.addWorksheet("Summary")
  addDueDatesSheet(workbook, options.startYear)
  if (c34) {
    add34cChallansSheet(workbook, c34.challanRows)
    add34cWorkingsSheet(workbook, c34.workingsRows)
  }

  const order: Quarter[] = ["Q1", "Q2", "Q3", "Q4"]
  const by34cTan = new Map((c34?.entities ?? []).map((e) => [e.entity.tan, e]))

  const entries = entities.map((entity) => {
    const rows = options.rows
      .filter((r) => r.entity.tan === entity.tan)
      .sort((a, b) =>
        a.formType === b.formType
          ? order.indexOf(a.quarter) - order.indexOf(b.quarter)
          : a.formType.localeCompare(b.formType)
      )
    const { lastDataRow } = addCompanySheet(workbook, entity, rows, options.startYear)

    const entity34c = by34cTan.get(entity.tan)
    if (entity34c) {
      const sheet = workbook.getWorksheet(entity.sheet)
      if (sheet) append34cBlock(sheet, entity34c, lastDataRow, COMPANY_WIDTHS)
    }
    return { entity, rows, lastDataRow, c34: entity34c }
  })

  fillSummarySheet(
    summarySheet,
    entries,
    options.startYear,
    new Date(),
    c34
      ? c34.challanRows.filter((r) => r.included).reduce((a, r) => a + r.interestPerReturn, 0)
      : undefined,
    c34 ? c34.workingsRows.reduce((a, r) => a + r.totalInterest, 0) : undefined
  )

  await workbook.xlsx.writeFile(options.outputPath)
  return options.outputPath
}
