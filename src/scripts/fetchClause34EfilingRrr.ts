/**
 * Independent cross-check for clause 34(b): the Income Tax e-filing portal's
 * "View Filed Forms" service, which reports each TDS statement with its
 * filingTypeCd (Original / Correction), ackDt and RRR number.
 *
 *   node scripts/run-ts.js src/scripts/fetchClause34EfilingRrr.ts [FY] [TAN,TAN,...]
 *
 * FY is the start year ("2025" = FY 2025-26). Reuses the existing batch extractor, so results
 * also land in public/pdf/return/rrr-extract/rrr_extract.{json,csv}. A per-run copy is written
 * to public/pdf/clause34/efiling-rrr/ so the clause 34 build has a stable snapshot.
 */
import fs from "fs"
import path from "path"
import db from "db"
import { CONTINUUM_TANS } from "src/clause34/continuumGroup"
import { fetchRrrNumbersBatch } from "src/scripts/fetchRrrNumbers"

const OUT_DIR = path.join(process.cwd(), "public", "pdf", "clause34", "efiling-rrr")

async function main() {
  const financialYear = process.argv[2] || "2025"
  const tans = process.argv[3]
    ? process.argv[3]
        .split(",")
        .map((t) => t.trim().toUpperCase())
        .filter(Boolean)
    : CONTINUUM_TANS

  const companies = await db.company.findMany({
    where: { tan: { in: tans } },
    select: { id: true, name: true, tan: true, it_password: true },
  })
  const byTan = new Map(companies.map((c) => [c.tan, c]))
  const ordered = tans.map((t) => byTan.get(t)).filter((c): c is NonNullable<typeof c> => !!c)

  const missing = tans.filter((t) => !byTan.has(t))
  if (missing.length) console.log(`[rrr] WARNING not in database: ${missing.join(", ")}`)

  console.log(`[rrr] FY ${financialYear} · ${ordered.length} company(ies)`)

  const batch = await fetchRrrNumbersBatch({
    companies: ordered,
    formTypes: ["24Q", "26Q", "27Q", "27EQ"],
    financialYears: [financialYear],
    quarters: ["Q1", "Q2", "Q3", "Q4"],
    concurrency: 2,
  })

  if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
  const snapshot = path.join(OUT_DIR, `efiling_rrr_${financialYear}.json`)
  fs.writeFileSync(snapshot, JSON.stringify(batch.rows, null, 2), "utf-8")

  console.log("\n================ SUMMARY ================")
  const problems: string[] = []
  for (const r of batch.results) {
    const originals = r.rows.filter((x) => /^o/i.test(String(x["Filing Type"] || ""))).length
    console.log(
      `${r.success ? "ok  " : "FAIL"} ${String(r.companyName).slice(0, 48).padEnd(48)} ` +
        `rows=${String(r.rows.length).padStart(3)} originals=${String(originals).padStart(2)}` +
        (r.error ? `  :: ${r.error}` : "")
    )
    if (!r.success) problems.push(`${r.companyName}: ${r.error}`)
  }
  console.log(`\ntotal rows=${batch.rows.length}`)
  console.log(`snapshot: ${snapshot}`)
  if (problems.length) {
    console.log(`\n!! ${problems.length} company(ies) failed:`)
    problems.forEach((p) => console.log("   " + p))
  }

  const filingTypes = [...new Set(batch.rows.map((r) => String(r["Filing Type"])))]
  console.log(`\nobserved Filing Type values: ${JSON.stringify(filingTypes)}`)
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[rrr] failed:", e)
    process.exit(1)
  })
