/**
 * Verify the regenerated clause 34(b) workbook against the format captured from the
 * hand-prepared original, and against the reconciliation data.
 *
 *   node scripts/run-ts.js src/scripts/verifyClause34Workbook.ts [startYear]
 *
 * Exits non-zero if any check fails, so it can gate a release.
 */
import fs from "fs"
import path from "path"
import ExcelJS from "exceljs"
import { CONTINUUM_GROUP } from "src/clause34/continuumGroup"
import { readOriginalWorkbook } from "src/clause34/originalWorkbook"
import { fyLabel } from "src/clause34/dueDates"

const EXPECTED_WIDTHS = [16, 10, 13, 14, 30, 26, 3, 9, 19, 19, 11, 14, 17, 22, 42, 60]
const HEADER_BG = "FF1F3864"
const BLUE = "FF0000FF"
const GREEN = "FF008000"

let failures = 0
let checks = 0

function check(label: string, ok: boolean, detail = "") {
  checks++
  if (ok) {
    console.log(`  ok   ${label}`)
  } else {
    failures++
    console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ""}`)
  }
}

async function main() {
  const startYear = Number(process.argv[2] || 2025)
  const file = path.join(
    process.cwd(),
    "public",
    "pdf",
    "clause34",
    `Clause 34(b) and 34(c) - Continuum Group - FY ${fyLabel(startYear)} (verified).xlsx`
  )
  if (!fs.existsSync(file)) throw new Error(`Not found: ${file}`)

  const wb = new ExcelJS.Workbook()
  await wb.xlsx.readFile(file)

  console.log(`Verifying ${path.basename(file)}\n`)

  // ---- structure
  console.log("Structure")
  const names = wb.worksheets.map((w) => w.name)
  const expected = [
    "Summary",
    "Due Dates",
    "34(c) Challans",
    "34(c) Workings",
    ...CONTINUUM_GROUP.map((e) => e.sheet),
  ]
  check("24 sheets present", names.length === expected.length, `got ${names.length}`)
  check(
    "tab order matches the original",
    JSON.stringify(names) === JSON.stringify(expected),
    `got ${JSON.stringify(names.slice(0, 4))}…`
  )

  // ---- a representative company sheet
  const sample = wb.getWorksheet(CONTINUUM_GROUP[0]!.sheet)
  if (!sample) throw new Error("Sample company sheet missing")
  console.log(`\nCompany sheet format (${sample.name})`)

  // ExcelJS omits a <col> whose width equals its default of 9; the sheet declares
  // defaultColWidth 9 so those columns still render at the intended width.
  const defaultColWidth = (sample.properties as any)?.defaultColWidth
  check(
    "column widths",
    EXPECTED_WIDTHS.every((w, i) => {
      const actual = sample.getColumn(i + 1).width
      return actual === w || (actual === undefined && w === defaultColWidth)
    }),
    EXPECTED_WIDTHS.map((w, i) => `${w}/${sample.getColumn(i + 1).width}`).join(" ")
  )
  check("defaultColWidth declared as 9", defaultColWidth === 9, String(defaultColWidth))
  const view = sample.views?.[0] as any
  check(
    "header row frozen at row 7",
    view?.state === "frozen" && view?.ySplit === 7,
    JSON.stringify(view)
  )
  const merges = (sample as any).model?.merges ?? []
  check(
    "merges A6:F6 and H6:P6",
    merges.includes("A6:F6") && merges.includes("H6:P6"),
    JSON.stringify(merges)
  )

  const headerCell = sample.getCell(7, 1)
  check(
    "header font is bold white Arial",
    headerCell.font?.bold === true &&
      headerCell.font?.name === "Arial" &&
      headerCell.font?.color?.argb === "FFFFFFFF"
  )
  check(
    "header fill is the dark navy",
    (headerCell.fill as any)?.fgColor?.argb === HEADER_BG,
    JSON.stringify(headerCell.fill)
  )
  check(
    "header text is clause 34(b) column (a)",
    String(headerCell.value).startsWith("(a) Tax deduction")
  )

  // ---- first data row
  console.log("\nFirst data row (row 8)")
  const dueCell = sample.getCell(8, 3)
  const dCell = sample.getCell(8, 4)
  check(
    "col C carries the INDEX/MATCH due-date formula",
    typeof (dueCell.value as any)?.formula === "string" &&
      (dueCell.value as any).formula.includes("'Due Dates'!$D$5:$D$8"),
    JSON.stringify(dueCell.value)
  )
  check(
    "col C is dd-mm-yyyy and green",
    dueCell.numFmt === "dd-mm-yyyy" && dueCell.font?.color?.argb === GREEN
  )
  check(
    "col D is dd-mm-yyyy and blue",
    dCell.numFmt === "dd-mm-yyyy" && dCell.font?.color?.argb === BLUE
  )
  // ExcelJS hands back a Date for a numeric cell carrying a date number format; the stored
  // value is still a serial (verified against the raw XML), so accept either.
  check(
    "col D holds a real date, not text",
    dCell.value instanceof Date || typeof dCell.value === "number",
    `got ${Object.prototype.toString.call(dCell.value)}`
  )
  const nCell = sample.getCell(8, 14)
  check(
    "col N carries the timeliness formula",
    typeof (nCell.value as any)?.formula === "string" &&
      (nCell.value as any).formula.startsWith("IF(D8="),
    JSON.stringify(nCell.value)
  )
  check("col E is 'Yes'", sample.getCell(8, 5).value === "Yes")
  check("col F is 'NA'", sample.getCell(8, 6).value === "NA")

  // ---- Due Dates sheet
  console.log("\nDue Dates sheet")
  const dd = wb.getWorksheet("Due Dates")!
  const dueDates = [5, 6, 7, 8].map((r) => dd.getCell(r, 4).value)
  check(
    "four quarterly due dates stored as dates",
    dueDates.every((v) => v instanceof Date || typeof v === "number"),
    JSON.stringify(dueDates)
  )
  check(
    "quarters labelled Q1..Q4",
    [5, 6, 7, 8].map((r) => dd.getCell(r, 2).value).join(",") === "Q1,Q2,Q3,Q4"
  )

  // ---- Summary sheet
  console.log("\nSummary sheet")
  const summary = wb.getWorksheet("Summary")!
  check(
    "one row per entity",
    CONTINUUM_GROUP.every((e, i) => summary.getCell(5 + i, 3).value === e.tan)
  )
  const countaCell = summary.getCell(5, 6)
  check(
    "statement counts are COUNTA formulas",
    typeof (countaCell.value as any)?.formula === "string" &&
      (countaCell.value as any).formula.startsWith("COUNTA("),
    JSON.stringify(countaCell.value)
  )
  const totalRow = 5 + CONTINUUM_GROUP.length
  check(
    "total row is a SUM",
    typeof (summary.getCell(totalRow, 6).value as any)?.formula === "string"
  )

  // ---- data completeness vs the original workbook
  console.log("\nCompleteness")
  const original = readOriginalWorkbook()
  let generatedRows = 0
  const missing: string[] = []
  for (const entity of CONTINUUM_GROUP) {
    const sheet = wb.getWorksheet(entity.sheet)
    if (!sheet) {
      missing.push(entity.sheet)
      continue
    }
    for (let r = 8; r <= sheet.rowCount; r++) {
      const tan = sheet.getCell(r, 1).value
      if (!tan || String(tan) === "Legend:") break
      generatedRows++
    }
  }
  check("no entity sheet missing", missing.length === 0, missing.join(", "))
  check(
    `generated rows cover the original's ${original.length}`,
    generatedRows >= original.length,
    `generated ${generatedRows}`
  )

  // ---- clause 34(c) sheets
  console.log("\nClause 34(c) sheets")
  const challans = wb.getWorksheet("34(c) Challans")!
  const workings = wb.getWorksheet("34(c) Workings")!

  const CHALLAN_WIDTHS = [12, 6, 8, 8, 11, 10, 10, 12, 13, 13, 10, 9, 30, 60]
  check(
    "34(c) Challans column widths",
    CHALLAN_WIDTHS.every((w, i) => {
      const actual = challans.getColumn(i + 1).width
      return actual === w || (actual === undefined && w === 9)
    })
  )
  const cView = challans.views?.[0] as any
  check("34(c) Challans frozen at row 4", cView?.state === "frozen" && cView?.ySplit === 4)
  check("34(c) Challans header starts with TAN", challans.getCell(4, 1).value === "TAN")

  const wView = workings.views?.[0] as any
  check("34(c) Workings frozen at row 6", wView?.state === "frozen" && wView?.ySplit === 6)
  check(
    "34(c) Workings carries the 201(1A) rates as percentages",
    workings.getCell(3, 5).value === 0.01 &&
      workings.getCell(4, 5).value === 0.015 &&
      workings.getCell(3, 5).numFmt === "0.0%"
  )

  // Row counts and totals, read back off the written file.
  let challanRows = 0
  for (let r = 5; r <= challans.rowCount; r++) {
    const v = challans.getCell(r, 1).value
    if (!v || String(v) === "Total") break
    challanRows++
  }
  let workingRows = 0
  for (let r = 7; r <= workings.rowCount; r++) {
    const v = workings.getCell(r, 1).value
    if (!v || String(v) === "Total") break
    workingRows++
  }
  check("22 challan rows", challanRows === 22, `got ${challanRows}`)
  check("38 workings rows", workingRows === 38, `got ${workingRows}`)
  check(
    "challan interest total is 170,373",
    Number(challans.getCell(5 + challanRows, 10).value) === 170373,
    String(challans.getCell(5 + challanRows, 10).value)
  )
  check(
    "workings interest total is 217,096",
    Number(workings.getCell(7 + workingRows, 18).value) === 217096,
    String(workings.getCell(7 + workingRows, 18).value)
  )
  check(
    "amounts use the accounting format",
    challans.getCell(5, 8).numFmt === "#,##0;(#,##0);-",
    String(challans.getCell(5, 8).numFmt)
  )

  // ---- 34(c) block on a company sheet
  console.log("\n34(c) block on a company sheet")
  const dj = wb.getWorksheet("DJ Energy")!
  let titleRow = 0
  for (let r = 1; r <= dj.rowCount; r++) {
    if (String(dj.getCell(r, 1).value ?? "").startsWith("Clause 34(c)")) {
      titleRow = r
      break
    }
  }
  check("34(c) block present", titleRow > 0, `titleRow=${titleRow}`)
  check(
    "liability question answered",
    String(dj.getCell(titleRow + 1, 1).value ?? "").startsWith("Whether the assessee is liable") &&
      dj.getCell(titleRow + 1, 6).value === "Yes"
  )
  check(
    "34(c) column headers (1)-(5)",
    String(dj.getCell(titleRow + 4, 1).value ?? "").startsWith("(1) Tax deduction") &&
      String(dj.getCell(titleRow + 4, 2).value ?? "").startsWith("(2) Amount of interest") &&
      String(dj.getCell(titleRow + 4, 3).value ?? "").startsWith("(3) Amount paid") &&
      String(dj.getCell(titleRow + 4, 4).value ?? "").startsWith("(4) Date of payment") &&
      String(dj.getCell(titleRow + 4, 5).value ?? "").startsWith("(5) Remarks")
  )
  const djMerges = (dj as any).model?.merges ?? []
  check(
    "remarks cell merged E:F on the first data row",
    djMerges.includes(`E${titleRow + 5}:F${titleRow + 5}`),
    JSON.stringify(djMerges.slice(0, 8))
  )
  check(
    "date of payment is a real date",
    dj.getCell(titleRow + 5, 4).value instanceof Date ||
      typeof dj.getCell(titleRow + 5, 4).value === "number"
  )

  // ---- Summary 34(c) columns
  console.log("\nSummary — clause 34(c) columns")
  check("Summary has 19 columns of headers", summary.getCell(4, 19).value === "Points to verify")
  check(
    "band row names both clauses",
    String(summary.getCell(3, 6).value) === "Clause 34(b)" &&
      String(summary.getCell(3, 14).value).startsWith("Clause 34(c)")
  )
  const summaryTotalRow = 5 + CONTINUUM_GROUP.length
  check(
    "34(c) totals on the Total row",
    Number(summary.getCell(summaryTotalRow, 15).value) === 170373 &&
      Number(summary.getCell(summaryTotalRow, 17).value) === 217096,
    `${summary.getCell(summaryTotalRow, 15).value} / ${summary.getCell(summaryTotalRow, 17).value}`
  )
  check(
    "tie-check row is nil on both sides",
    Number(summary.getCell(summaryTotalRow + 1, 15).value) === 0 &&
      Number(summary.getCell(summaryTotalRow + 1, 17).value) === 0
  )

  console.log(`\n${checks - failures}/${checks} checks passed`)
  if (failures) {
    console.error(`${failures} check(s) FAILED`)
    process.exit(1)
  }
}

main().catch((e) => {
  console.error("[verify] failed:", e)
  process.exit(1)
})
