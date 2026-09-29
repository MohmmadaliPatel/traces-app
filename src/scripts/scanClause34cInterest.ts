/**
 * Independent sweep of every conso file for interest, to answer two questions the prepared
 * working paper cannot answer about itself:
 *
 *   1. Does any challan carry interest that the '34(c) Challans' sheet does not list?
 *   2. Do the listed rows reproduce exactly from the files?
 *
 *   node scripts/run-ts.js src/scripts/scanClause34cInterest.ts [consoRoot]
 *
 * Read-only. Reports; changes nothing.
 */
import path from "path"
import { CONTINUUM_GROUP } from "src/clause34/continuumGroup"
import { DEFAULT_CONSO_ROOT } from "src/clause34/build34cRows"
import { readChallanRows } from "src/clause34/originalWorkbook34c"
import {
  indexConsoFiles,
  parseConsoChallans,
  challanTotalsAgree,
} from "src/clause34/consoTdsParser"
import { formatDdMmYyyy } from "src/clause34/dueDates"

type Found = {
  tan: string
  entity: string
  formType: string
  quarter: string
  file: string
  serial: string
  challanNo: string
  bsr: string
  date: string
  tax: number
  interestOnChallan: number
  interestInReturn: number
}

/** `MUMW04565B_202526_24Q_Q2.tds` / `..._26Q_Q4_5.tds` → form type and quarter. */
function periodFromFilename(name: string): { formType: string; quarter: string } {
  const m = name.match(/_(\d{6})_(\d{2}[A-Z]{1,2})_(Q[1-4])/i)
  return { formType: m?.[2]?.toUpperCase() ?? "?", quarter: m?.[3]?.toUpperCase() ?? "?" }
}

function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CONSO_ROOT
  const index = indexConsoFiles(root)
  const tanByPrefix = new Map(CONTINUUM_GROUP.map((e) => [e.tan, e]))

  console.log(`[scan] ${index.size} conso file(s) under ${root}\n`)

  const withInterest: Found[] = []
  let challans = 0
  let badTotals = 0

  for (const [name, file] of [...index].sort()) {
    const tan = name.split("_")[0]?.toUpperCase() ?? ""
    const entity = tanByPrefix.get(tan)
    const { formType, quarter } = periodFromFilename(name)

    for (const c of parseConsoChallans(file)) {
      challans++
      if (!challanTotalsAgree(c)) badTotals++
      if (c.interestOnChallan === 0 && c.interestInReturn === 0) continue
      withInterest.push({
        tan,
        entity: entity?.sheet ?? tan,
        formType,
        quarter,
        file: name,
        serial: c.serial,
        challanNo: c.challanNo,
        bsr: c.bsrCode,
        date: formatDdMmYyyy(c.challanDate),
        tax: c.tax,
        interestOnChallan: c.interestOnChallan,
        interestInReturn: c.interestInReturn,
      })
    }
  }

  console.log(`challans parsed          ${challans}`)
  console.log(`component totals disagree ${badTotals}`)
  console.log(`challans carrying interest ${withInterest.length}\n`)

  // Compare against what the working paper lists.
  const listed = readChallanRows()
  const key = (tan: string, file: string, serial: string) =>
    `${tan}|${file.split(/[\\/]/).pop()}|${serial}`
  const listedKeys = new Set(listed.map((r) => key(r.tan, r.sourceFile, r.challanSerial)))

  const missing = withInterest.filter((f) => !listedKeys.has(key(f.tan, f.file, f.serial)))
  const foundKeys = new Set(withInterest.map((f) => key(f.tan, f.file, f.serial)))
  const orphaned = listed.filter((r) => !foundKeys.has(key(r.tan, r.sourceFile, r.challanSerial)))

  if (missing.length) {
    console.log(`!! ${missing.length} challan(s) carry interest but are NOT in '34(c) Challans':`)
    console.log(
      `   ${"entity".padEnd(26)}${"form qtr".padEnd(9)}${"challan".padEnd(10)}${"date".padEnd(
        12
      )}` + `${"on challan".padStart(12)}${"in return".padStart(12)}`
    )
    for (const f of missing.sort((a, b) => b.interestInReturn - a.interestInReturn)) {
      console.log(
        `   ${f.entity.padEnd(26)}${(f.formType + " " + f.quarter).padEnd(9)}${f.challanNo.padEnd(
          10
        )}` +
          `${f.date.padEnd(12)}${f.interestOnChallan.toLocaleString("en-IN").padStart(12)}` +
          `${f.interestInReturn.toLocaleString("en-IN").padStart(12)}`
      )
    }
    const addl = missing.reduce((a, f) => a + f.interestInReturn, 0)
    console.log(`   unreported interest claimed in returns: Rs.${addl.toLocaleString("en-IN")}`)
  } else {
    console.log("OK  every challan carrying interest is listed in '34(c) Challans'")
  }

  if (orphaned.length) {
    console.log(`\n!! ${orphaned.length} listed row(s) not found in the conso files:`)
    orphaned.forEach((r) =>
      console.log(`   ${r.tan} ${r.formType} ${r.quarter} challan ${r.challanNo} (${r.sourceFile})`)
    )
  } else {
    console.log("OK  every listed row was located in the conso files")
  }

  const totalInReturn = withInterest.reduce((a, f) => a + f.interestInReturn, 0)
  const listedInReturn = listed
    .filter((r) => r.included)
    .reduce((a, r) => a + r.interestPerReturn, 0)
  console.log(
    `\ninterest claimed in returns — conso sweep Rs.${totalInReturn.toLocaleString("en-IN")} ` +
      `vs working paper Rs.${listedInReturn.toLocaleString("en-IN")} ` +
      `${
        totalInReturn === listedInReturn
          ? "MATCH"
          : "DIFFERENCE Rs." + (totalInReturn - listedInReturn).toLocaleString("en-IN")
      }`
  )
}

main()
