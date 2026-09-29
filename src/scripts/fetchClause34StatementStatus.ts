/**
 * Pull TRACES "Statement Filed Status" for the clause 34(b) group.
 *
 *   node scripts/run-ts.js src/scripts/fetchClause34StatementStatus.ts [FY] [TAN,TAN,...]
 *
 * FY is the start year, as the portal wants it: "2025" = FY 2025-26. With no TAN list it runs
 * the whole Continuum group. Raw per-company JSON lands in
 * public/pdf/clause34/statement-status/, and rows are upserted into ReturnStatus.
 */
import { CONTINUUM_TANS } from "src/clause34/continuumGroup"
import { fetchStatementStatusBatch } from "src/clause34/fetchStatementStatus"

async function main() {
  const financialYear = process.argv[2] || "2025"
  const tans = process.argv[3]
    ? process.argv[3]
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : CONTINUUM_TANS

  console.log(`[stmt] FY ${financialYear} · ${tans.length} TAN(s)`)
  const results = await fetchStatementStatusBatch({ tans, financialYear })

  console.log("\n================ SUMMARY ================")
  let totalRows = 0
  let totalOriginals = 0
  const problems: string[] = []
  for (const r of results) {
    const originals = r.rows.filter((x) => /regular/i.test(x.stmnttype || "")).length
    totalRows += r.rows.length
    totalOriginals += originals
    console.log(
      `${r.success ? "ok  " : "FAIL"} ${r.tan} ${r.companyName.slice(0, 44).padEnd(44)} ` +
        `rows=${String(r.rows.length).padStart(3)} originals=${String(originals).padStart(2)} ` +
        `empty=${r.emptyCombinations.length} failed=${r.failedCombinations.length}`
    )
    if (r.error) problems.push(`${r.tan}: ${r.error}`)
    for (const f of r.failedCombinations) problems.push(`${r.tan} ${f.combination}: ${f.error}`)
  }
  console.log(`\ntotal statements=${totalRows} originals=${totalOriginals}`)
  if (problems.length) {
    console.log(`\n!! ${problems.length} problem(s) — these are NOT "no statement filed":`)
    problems.forEach((p) => console.log("   " + p))
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[stmt] failed:", e)
    process.exit(1)
  })
