/**
 * Side-by-side of the prepared clause 34(b) workbook against TRACES Statement Filed Status.
 *
 *   node scripts/run-ts.js src/scripts/clause34Compare.ts [startYear]
 *
 * Writes a CSV + Markdown report to public/pdf/clause34/reconciliation/ and prints a summary.
 * Read-only against the portal: it works off what the extractor already persisted.
 */
import fs from "fs"
import path from "path"
import { buildClause34Rows, type Clause34Row } from "src/clause34/buildClause34Rows"
import { formatDdMmYyyy, daysBetween } from "src/clause34/dueDates"

const OUT_DIR = path.join(process.cwd(), "public", "pdf", "clause34", "reconciliation")

function timeliness(row: Clause34Row): string {
  if (!row.dateOfFurnishing) return "Date not available"
  const late = daysBetween(row.dueDate, row.dateOfFurnishing)
  return late <= 0 ? "Within due date" : `Late by ${late} day(s)`
}

function csvCell(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

async function main() {
  const startYear = Number(process.argv[2] || 2025)
  const built = await buildClause34Rows({ startYear, dateSource: "stmtstatus" })
  const { rows, counts } = built

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })

  const headers = [
    "Entity",
    "TAN",
    "Form",
    "Quarter",
    "Due date",
    "Workbook date (conso)",
    "Workbook basis",
    "Workbook timeliness",
    "TRACES date (Regular stmt)",
    "TRACES timeliness",
    "Verdict",
    "Diff (days)",
    "Original token (portal)",
    "Corrections",
    "Status",
    "Remarks",
  ]

  const csv: string[] = [headers.join(",")]
  const flips: Clause34Row[] = []

  for (const row of rows) {
    const workbookLate = row.workbookDate ? daysBetween(row.dueDate, row.workbookDate) : null
    const portalLate = row.dateOfFurnishing ? daysBetween(row.dueDate, row.dateOfFurnishing) : null
    const diff =
      row.workbookDate && row.dateOfFurnishing
        ? daysBetween(row.dateOfFurnishing, row.workbookDate)
        : null

    // A "flip" is a row where the two sources disagree about whether the statement was late.
    if (workbookLate !== null && portalLate !== null && workbookLate > 0 !== portalLate > 0) {
      flips.push(row)
    }

    csv.push(
      [
        row.entity.name,
        row.entity.tan,
        row.formType,
        row.quarter,
        formatDdMmYyyy(row.dueDate),
        formatDdMmYyyy(row.workbookDate),
        row.workbookBasis,
        workbookLate === null
          ? ""
          : workbookLate <= 0
          ? "Within due date"
          : `Late by ${workbookLate} day(s)`,
        formatDdMmYyyy(row.dateOfFurnishing),
        timeliness(row),
        row.comparison,
        diff === null ? "" : String(diff),
        row.originalToken,
        String(row.correctionCount),
        row.status,
        row.remarks,
      ]
        .map((v) => csvCell(String(v ?? "")))
        .join(",")
    )
  }

  const csvPath = path.join(OUT_DIR, `clause34_reconciliation_${startYear}.csv`)
  fs.writeFileSync(csvPath, csv.join("\n"), "utf-8")

  // --- markdown ---
  const md: string[] = []
  md.push(
    `# Clause 34(b) reconciliation — FY ${startYear}-${String((startYear + 1) % 100).padStart(
      2,
      "0"
    )}`
  )
  md.push("")
  md.push(
    `Prepared workbook vs TRACES **Statement Filed Status** (\`stmtstatus.xhtml\`), ${new Date()
      .toISOString()
      .slice(0, 10)}.`
  )
  md.push("")
  md.push(`| Verdict | Rows |`)
  md.push(`|---|---|`)
  md.push(`| Date matches the workbook | ${counts.match} |`)
  md.push(`| Date differs from the workbook | ${counts.changed} |`)
  md.push(`| On the portal, absent from the workbook | ${counts["new-on-portal"]} |`)
  md.push(`| In the workbook, absent from the portal | ${counts["missing-on-portal"]} |`)
  md.push(`| **Total** | **${rows.length}** |`)
  md.push("")

  if (flips.length) {
    md.push(`## Rows where the two sources disagree on timeliness (${flips.length})`)
    md.push("")
    md.push(`These change the s.234E / late-filing conclusion, so they matter most.`)
    md.push("")
    md.push(`| Entity | Form | Qtr | Due date | Workbook | TRACES | Effect |`)
    md.push(`|---|---|---|---|---|---|---|`)
    for (const row of flips) {
      const wl = daysBetween(row.dueDate, row.workbookDate!)
      md.push(
        `| ${row.entity.name} | ${row.formType} | ${row.quarter} | ${formatDdMmYyyy(
          row.dueDate
        )} | ` +
          `${formatDdMmYyyy(row.workbookDate)} (${wl > 0 ? `late ${wl}d` : "on time"}) | ` +
          `${formatDdMmYyyy(row.dateOfFurnishing)} (${timeliness(row)}) | ` +
          `${wl > 0 ? "late → on time" : "on time → late"} |`
      )
    }
    md.push("")
  }

  const problems = rows.filter(
    (r) =>
      r.comparison === "missing-on-portal" ||
      r.comparison === "new-on-portal" ||
      !r.dateOfFurnishing
  )
  if (problems.length) {
    md.push(`## Rows needing attention (${problems.length})`)
    md.push("")
    md.push(`| Entity | Form | Qtr | Verdict | Note |`)
    md.push(`|---|---|---|---|---|`)
    for (const r of problems) {
      md.push(
        `| ${r.entity.name} | ${r.formType} | ${r.quarter} | ${r.comparison} | ${
          r.remarks || "—"
        } |`
      )
    }
    md.push("")
  }

  md.push(`## All rows`)
  md.push("")
  md.push(`| Entity | Form | Qtr | Due | Workbook | TRACES | Verdict | Corr. |`)
  md.push(`|---|---|---|---|---|---|---|---|`)
  for (const r of rows) {
    md.push(
      `| ${r.entity.sheet} | ${r.formType} | ${r.quarter} | ${formatDdMmYyyy(r.dueDate)} | ` +
        `${formatDdMmYyyy(r.workbookDate) || "—"} | ${
          formatDdMmYyyy(r.dateOfFurnishing) || "—"
        } | ` +
        `${r.comparison} | ${r.correctionCount} |`
    )
  }

  const mdPath = path.join(OUT_DIR, `clause34_reconciliation_${startYear}.md`)
  fs.writeFileSync(mdPath, md.join("\n"), "utf-8")

  console.log(`rows=${rows.length}`)
  console.log(`  match              ${counts.match}`)
  console.log(`  changed            ${counts.changed}`)
  console.log(`  new-on-portal      ${counts["new-on-portal"]}`)
  console.log(`  missing-on-portal  ${counts["missing-on-portal"]}`)
  console.log(`\ntimeliness flips: ${flips.length}`)
  for (const f of flips) {
    console.log(
      `  ${f.entity.sheet.padEnd(28)} ${f.formType} ${f.quarter}  workbook ${formatDdMmYyyy(
        f.workbookDate
      )} -> traces ${formatDdMmYyyy(f.dateOfFurnishing)}`
    )
  }
  console.log(`\n${csvPath}\n${mdPath}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[compare] failed:", e)
    process.exit(1)
  })
