/**
 * Build the clause 34(b) working paper from the portal data already pulled into ReturnStatus.
 *
 *   node scripts/run-ts.js src/scripts/buildClause34Workbook.ts [startYear] [--conso]
 *
 * --conso keeps the previous working paper's conso-file dates in column (d) and uses the portal
 * only for the rows that were blank. The default takes column (d) from TRACES Statement Filed
 * Status for every row.
 *
 * Writes public/pdf/clause34/Clause 34(b) - Continuum Group - FY <fy> (verified).xlsx.
 * The hand-prepared workbook is read but never modified.
 */
import fs from "fs"
import path from "path"
import { buildClause34Rows, type DateSource } from "src/clause34/buildClause34Rows"
import { buildClause34cRows } from "src/clause34/build34cRows"
import { writeClause34Workbook } from "src/clause34/clause34Workbook"
import { fyLabel, formatDdMmYyyy, daysBetween } from "src/clause34/dueDates"

async function main() {
  const startYear = Number(
    process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : 2025
  )
  const dateSource: DateSource = process.argv.includes("--conso") ? "conso" : "stmtstatus"

  console.log(`[build] FY ${fyLabel(startYear)} · column (d) from ${dateSource}`)

  const { rows, counts } = await buildClause34Rows({ startYear, dateSource })
  if (!rows.length) throw new Error("No rows built — run fetchClause34StatementStatus.ts first")

  // Clause 34(c) is carried forward from the prepared workbook (the extraction of record) and
  // re-verified against any conso file still held. Loading tie-checks the totals.
  const clause34c = buildClause34cRows()
  if (clause34c.mismatches.length) {
    console.log(`\n!! ${clause34c.mismatches.length} clause 34(c) mismatch(es):`)
    clause34c.mismatches.forEach((m) => console.log("   " + m))
  }

  const outDir = path.join(process.cwd(), "public", "pdf", "clause34")
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })
  const outputPath = path.join(
    outDir,
    `Clause 34(b) and 34(c) - Continuum Group - FY ${fyLabel(startYear)} (verified).xlsx`
  )

  await writeClause34Workbook({ rows, startYear, outputPath, clause34c })

  const late = rows.filter(
    (r) => r.dateOfFurnishing && daysBetween(r.dueDate, r.dateOfFurnishing) > 0
  )
  const noDate = rows.filter((r) => !r.dateOfFurnishing)

  console.log(`\nrows                 ${rows.length}`)
  console.log(`  matches workbook   ${counts.match}`)
  console.log(`  differs            ${counts.changed}`)
  console.log(`  new on portal      ${counts["new-on-portal"]}`)
  console.log(`  missing on portal  ${counts["missing-on-portal"]}`)
  console.log(`  no date available  ${noDate.length}`)
  console.log(`\nlate filings (per column d): ${late.length}`)
  for (const r of late) {
    console.log(
      `  ${r.entity.sheet.padEnd(28)} ${r.formType} ${r.quarter}  ` +
        `due ${formatDdMmYyyy(r.dueDate)}  filed ${formatDdMmYyyy(r.dateOfFurnishing)}  ` +
        `late ${daysBetween(r.dueDate, r.dateOfFurnishing!)}d`
    )
  }
  console.log(`\nclause 34(c)`)
  console.log(`  entities liable    ${clause34c.totals.liableCount}`)
  console.log(`  interest payable   ${clause34c.totals.payable.toLocaleString("en-IN")}`)
  console.log(`  interest paid      ${clause34c.totals.paid.toLocaleString("en-IN")}`)
  console.log(`  computed (ref)     ${clause34c.totals.computed.toLocaleString("en-IN")}`)
  console.log(`  rows re-verified   ${clause34c.totals.verifiedRows}`)
  console.log(`  rows carried fwd   ${clause34c.totals.carriedForwardRows}`)

  console.log(`\nwritten: ${outputPath}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[build] failed:", e)
    process.exit(1)
  })
