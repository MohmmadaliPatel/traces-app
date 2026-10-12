/**
 * Rebuild the per-deductor Consolidated TDS workbook from the conso files, with the challan
 * field mapping corrected.
 *
 *   node scripts/run-ts.js src/scripts/buildConsolidatedTds.ts [TAN,TAN,...] [FY]
 *
 * FY is the conso file's own six-digit form, e.g. 202526. With no TANs it does the three
 * companies raised in review.
 */
import path from "path"
import { CONTINUUM_GROUP, entityByTan } from "src/clause34/continuumGroup"
import { DEFAULT_CONSO_ROOT } from "src/clause34/build34cRows"
import { writeConsolidatedTds } from "src/clause34/consolidatedTds"

const OUT_DIR = path.join(process.cwd(), "public", "pdf", "clause34", "consolidated-corrected")

async function main() {
  const tans = (process.argv[2] || "MUMW04565B,MUMC21400B,MUMC27789G")
    .split(",")
    .map((t) => t.trim().toUpperCase())
    .filter(Boolean)
  const fy = process.argv[3] || "202526"

  console.log(`[conso] ${tans.length} TAN(s), FY ${fy}`)
  console.log(`[conso] source: ${DEFAULT_CONSO_ROOT}\n`)

  for (const tan of tans) {
    const entity = entityByTan(tan) ?? CONTINUUM_GROUP.find((e) => e.tan === tan)
    const name = (entity?.name ?? tan).replace(/[/\\?%*:|"<>]/g, "_")
    const out = path.join(OUT_DIR, `${name}_${tan}_Consolidated_TDS (corrected).xlsx`)
    try {
      const r = await writeConsolidatedTds({
        consoRoot: DEFAULT_CONSO_ROOT,
        tan,
        financialYear: fy,
        outputPath: out,
      })
      console.log(
        `ok   ${tan}  statements=${String(r.statements).padStart(2)}  challans=${String(
          r.challans
        ).padStart(3)}  ` +
          `rows=${String(r.rows).padStart(4)}  interest-in-challan=Rs.${r.interest.toLocaleString(
            "en-IN"
          )}  ` +
          `claimed-in-return=Rs.${r.interestClaimed.toLocaleString("en-IN")}`
      )
      console.log(`     ${r.path}`)
    } catch (e: any) {
      console.log(`FAIL ${tan}  ${String(e?.message || e)}`)
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[conso] failed:", e)
    process.exit(1)
  })
