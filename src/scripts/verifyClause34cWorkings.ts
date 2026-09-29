/**
 * Independently recompute s.201(1A) interest from every deductee entry in every conso file and
 * compare against the '34(c) Workings' sheet.
 *
 *   node scripts/run-ts.js src/scripts/verifyClause34cWorkings.ts [consoRoot]
 *
 * Read-only.
 */
import path from "path"
import { CONTINUUM_GROUP } from "src/clause34/continuumGroup"
import { DEFAULT_CONSO_ROOT } from "src/clause34/build34cRows"
import { readWorkingsRows } from "src/clause34/originalWorkbook34c"
import { indexConsoFiles, parseConsoDeductees } from "src/clause34/consoTdsParser"
import { computeInterest } from "src/clause34/interest201_1A"
import { formatDdMmYyyy } from "src/clause34/dueDates"

type Computed = {
  tan: string
  entity: string
  formType: string
  quarter: string
  challanSerial: string
  pan: string
  tds: number
  monthsLatePayment: number
  interestLatePayment: number
  interestLateDeduction: number
  totalInterest: number
  file: string
}

function periodFromFilename(name: string) {
  const m = name.match(/_(\d{6})_(\d{2}[A-Z]{1,2})_(Q[1-4])/i)
  return {
    fy: m?.[1] ?? "",
    formType: m?.[2]?.toUpperCase() ?? "?",
    quarter: m?.[3]?.toUpperCase() ?? "?",
  }
}

function main() {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_CONSO_ROOT
  const index = indexConsoFiles(root)
  const byTan = new Map(CONTINUUM_GROUP.map((e) => [e.tan, e]))

  let entries = 0
  let skippedFy = 0
  const defaults: Computed[] = []

  for (const [name, file] of [...index].sort()) {
    const tan = name.split("_")[0]?.toUpperCase() ?? ""
    const { fy, formType, quarter } = periodFromFilename(name)
    if (fy !== "202526") {
      skippedFy++
      continue
    }

    for (const d of parseConsoDeductees(file)) {
      entries++
      const c = computeInterest(d)
      if (c.totalInterest === 0) continue
      defaults.push({
        tan,
        entity: byTan.get(tan)?.sheet ?? tan,
        formType,
        quarter,
        challanSerial: d.challanSerial,
        pan: d.pan,
        tds: d.tds,
        monthsLatePayment: c.monthsLatePayment,
        interestLatePayment: c.interestLatePayment,
        interestLateDeduction: c.interestLateDeduction,
        totalInterest: c.totalInterest,
        file: name,
      })
    }
  }

  const computedTotal = defaults.reduce((a, d) => a + d.totalInterest, 0)
  const sheet = readWorkingsRows()
  const sheetTotal = sheet.reduce((a, r) => a + r.totalInterest, 0)

  console.log(`[workings] ${index.size} file(s); ${skippedFy} from another FY skipped`)
  console.log(`deductee entries screened   ${entries.toLocaleString("en-IN")}`)
  console.log(`entries with a default      ${defaults.length}   (sheet: ${sheet.length})`)
  console.log(
    `interest computed           Rs.${computedTotal.toLocaleString(
      "en-IN"
    )}   (sheet: Rs.${sheetTotal.toLocaleString("en-IN")})`
  )
  console.log(
    `late-deduction interest     Rs.${defaults
      .reduce((a, d) => a + d.interestLateDeduction, 0)
      .toLocaleString("en-IN")}`
  )

  // Per-entry comparison, keyed TAN|form|quarter|challan serial|PAN.
  // The sheet rows name the PAN column `deducteePan`; the computed rows call it `pan`.
  const key = (x: {
    tan: string
    formType: string
    quarter: string
    challanSerial: string
    pan?: string
    deducteePan?: string
  }) => `${x.tan}|${x.formType}|${x.quarter}|${x.challanSerial}|${x.pan ?? x.deducteePan ?? ""}`

  // A challan can carry several entries for the same PAN (four XOCKINS rows, for instance), so
  // compare as a multiset on (key, interest) rather than a map keyed on identity alone.
  const tally = <T>(rows: T[], k: (r: T) => string) => {
    const m = new Map<string, number>()
    for (const r of rows) m.set(k(r), (m.get(k(r)) ?? 0) + 1)
    return m
  }
  const full = (x: { totalInterest: number; monthsLatePayment: number }, base: string) =>
    `${base}|${x.totalInterest}|${x.monthsLatePayment}`

  const mineTally = tally(defaults, (d) => full(d, key(d)))
  const sheetTally = tally(sheet, (r) => full(r, key(r)))

  const onlyMine = defaults.filter((d) => {
    const k = full(d, key(d))
    return (sheetTally.get(k) ?? 0) < (mineTally.get(k) ?? 0) && !sheetTally.has(k)
  })
  const onlySheet = sheet.filter((r) => !mineTally.has(full(r, key(r))))
  const differing: string[] = []
  for (const [k, n] of mineTally) {
    const m = sheetTally.get(k) ?? 0
    if (m !== n) differing.push(`${k}: computed x${n}, sheet x${m}`)
  }

  const matched = defaults.length - onlyMine.length - differing.length
  console.log(`\nper-entry match             ${matched}/${defaults.length}`)
  if (onlyMine.length) {
    console.log(`\n!! ${onlyMine.length} default(s) computed that the sheet does NOT list:`)
    onlyMine
      .sort((a, b) => b.totalInterest - a.totalInterest)
      .slice(0, 25)
      .forEach((d) =>
        console.log(
          `   ${d.entity.padEnd(26)} ${d.formType} ${d.quarter} sr${d.challanSerial.padStart(2)} ${
            d.pan
          } ` +
            `TDS ${d.tds
              .toLocaleString("en-IN")
              .padStart(12)}  interest ${d.totalInterest.toLocaleString("en-IN")}`
        )
      )
    console.log(
      `   additional interest: Rs.${onlyMine
        .reduce((a, d) => a + d.totalInterest, 0)
        .toLocaleString("en-IN")}`
    )
  }
  if (onlySheet.length) {
    console.log(`\n!! ${onlySheet.length} sheet row(s) NOT reproduced:`)
    onlySheet
      .slice(0, 25)
      .forEach((r) =>
        console.log(
          `   ${r.tan} ${r.formType} ${r.quarter} sr${r.challanSerial} ${r.deducteePan} interest ${r.totalInterest}`
        )
      )
  }
  if (differing.length) {
    console.log(`\n!! ${differing.length} entry(ies) differ:`)
    differing.slice(0, 25).forEach((d) => console.log("   " + d))
  }
  if (!onlyMine.length && !onlySheet.length && !differing.length) {
    console.log("\nOK  every default reproduces exactly, entry for entry")
  }
  void formatDdMmYyyy
}

main()
