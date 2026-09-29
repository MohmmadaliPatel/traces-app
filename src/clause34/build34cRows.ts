/**
 * Clause 34(c) — interest under section 201(1A) / 206C(7).
 *
 * Form 3CD asks for: (1) TAN, (2) amount of interest payable, (3) amount paid out of (2),
 * (4) date of payment, (5) remarks. Following the method already settled in the working paper,
 * (2) and (3) are both the interest shown against each challan **in the TDS return**, and (4) is
 * that challan's date. One reported row per challan.
 *
 * The challan data is carried forward from the prepared workbook, which is the extraction of
 * record — only 9 of the 20 TANs' conso files still exist locally. Where a conso file *is* held,
 * every field is re-parsed and compared, and each row is marked `verifiedAgainstConso` or not, so
 * the workbook never claims more assurance than it has.
 */
import path from "path"
import { CONTINUUM_GROUP, entityByTan, type Clause34Entity } from "src/clause34/continuumGroup"
import {
  readChallanRows,
  readWorkingsRows,
  readEntity34cSummary,
  type Challan34cRow,
  type Workings34cRow,
} from "src/clause34/originalWorkbook34c"
import { indexConsoFiles, parseConsoChallans } from "src/clause34/consoTdsParser"

/**
 * The conso extract behind clause 34(c) — the full 117-file set for FY 2025-26, 20 TANs.
 * Override with CLAUSE34_CONSO_ROOT for a different period or client.
 */
export const DEFAULT_CONSO_ROOT =
  process.env.CLAUSE34_CONSO_ROOT ??
  path.join(process.cwd(), "public", "pdf", "clause34", "temp_extract 2")

export type Clause34cRow = {
  entity: Clause34Entity

  // --- Form 3CD clause 34(c) columns ---
  /** (1) */ tan: string
  /** (2) */ interestPayable: number
  /** (3) */ interestPaid: number
  /** (4) */ dateOfPayment: Date | null
  /** (5) */ remarks: string

  // --- working notes ---
  formType: string
  quarter: string
  challanNo: string
  bsrCode: string
  challanSerial: string
  taxInChallan: number
  /** Interest carried on the challan itself — reference only; may differ from what was claimed. */
  interestOnChallan: number
  deducteeEntries: number
  sourceFile: string
  notes: string

  /** True when the row was re-parsed from a conso file held locally and every field agreed. */
  verifiedAgainstConso: boolean
}

export type Entity34c = {
  entity: Clause34Entity
  liable: boolean
  rows: Clause34cRow[]
  /** Challans carrying interest that the return did not claim — shown, but not reported. */
  excluded: Challan34cRow[]
  totalPayable: number
  totalPaid: number
  /** Reference-only recomputation from the deductee entries. */
  computedFromEntries: number
  /** computed − as per returns. Positive means the returns may have under-claimed. */
  difference: number
}

export type Clause34cBuildResult = {
  entities: Entity34c[]
  challanRows: Challan34cRow[]
  workingsRows: Workings34cRow[]
  totals: {
    payable: number
    paid: number
    computed: number
    liableCount: number
    verifiedRows: number
    carriedForwardRows: number
  }
  mismatches: string[]
}

/**
 * Re-parse a workbook challan row from its conso file and confirm every field.
 * Returns null when the file is not held; a string when it is held but disagrees.
 */
function verifyAgainstConso(
  row: Challan34cRow,
  consoIndex: Map<string, string>
): { verified: boolean; mismatch?: string } {
  const base = row.sourceFile.split(/[\\/]/).pop() ?? ""
  const file = consoIndex.get(base)
  if (!file) return { verified: false }

  const challan = parseConsoChallans(file).find((c) => c.serial === row.challanSerial)
  if (!challan) {
    return {
      verified: false,
      mismatch: `${row.tan} ${row.formType} ${row.quarter}: challan serial ${row.challanSerial} not found in ${base}`,
    }
  }

  const problems: string[] = []
  if (Number(challan.challanNo) !== Number(row.challanNo)) {
    problems.push(`challan no ${challan.challanNo} vs ${row.challanNo}`)
  }
  if (challan.bsrCode !== row.bsrCode) problems.push(`BSR ${challan.bsrCode} vs ${row.bsrCode}`)
  if (challan.tax !== row.tax) problems.push(`tax ${challan.tax} vs ${row.tax}`)
  if (challan.interestOnChallan !== row.interestPerChallan) {
    problems.push(`interest on challan ${challan.interestOnChallan} vs ${row.interestPerChallan}`)
  }
  if (challan.interestInReturn !== row.interestPerReturn) {
    problems.push(`interest in return ${challan.interestInReturn} vs ${row.interestPerReturn}`)
  }

  if (problems.length) {
    return {
      verified: false,
      mismatch: `${row.tan} ${row.formType} ${row.quarter} sr ${row.challanSerial}: ${problems.join(
        "; "
      )}`,
    }
  }
  return { verified: true }
}

export function buildClause34cRows(
  options: {
    consoRoot?: string
    entities?: Clause34Entity[]
  } = {}
): Clause34cBuildResult {
  const entities = options.entities ?? CONTINUUM_GROUP
  const consoIndex = indexConsoFiles(options.consoRoot ?? DEFAULT_CONSO_ROOT)

  // Loading tie-checks the totals; a drifted source workbook throws rather than reaching a
  // disclosure.
  const challanRows = readChallanRows()
  const workingsRows = readWorkingsRows()
  const summary = readEntity34cSummary()

  const mismatches: string[] = []
  let verifiedRows = 0
  let carriedForwardRows = 0

  const built: Entity34c[] = entities.map((entity) => {
    const mine = challanRows.filter((r) => r.tan === entity.tan)
    const included = mine.filter((r) => r.included)
    const excluded = mine.filter((r) => !r.included)

    const rows: Clause34cRow[] = included.map((r) => {
      const check = verifyAgainstConso(r, consoIndex)
      if (check.mismatch) mismatches.push(check.mismatch)
      if (check.verified) verifiedRows++
      else carriedForwardRows++

      const remarkBits = [
        `${r.formType} ${r.quarter} - interest as per TDS return (Challan No. ${r.challanNo}, BSR ${r.bsrCode})`,
      ]

      return {
        entity,
        tan: r.tan,
        interestPayable: r.interestPerReturn,
        interestPaid: r.interestPerReturn,
        dateOfPayment: r.challanDate,
        remarks: remarkBits.join(" "),
        formType: r.formType,
        quarter: r.quarter,
        challanNo: r.challanNo,
        bsrCode: r.bsrCode,
        challanSerial: r.challanSerial,
        taxInChallan: r.tax,
        interestOnChallan: r.interestPerChallan,
        deducteeEntries: r.deducteeEntries,
        sourceFile: r.sourceFile,
        notes: r.note,
        verifiedAgainstConso: check.verified,
      }
    })

    const fromSummary = summary.get(entity.tan)
    const totalPayable = rows.reduce((a, r) => a + r.interestPayable, 0)
    const totalPaid = rows.reduce((a, r) => a + r.interestPaid, 0)
    const computedFromEntries = workingsRows
      .filter((w) => w.tan === entity.tan)
      .reduce((a, w) => a + w.totalInterest, 0)

    // The Summary sheet is an independent statement of the same figures — disagreement means
    // the workbook is internally inconsistent and must not be regenerated silently.
    if (fromSummary && fromSummary.payable !== totalPayable) {
      mismatches.push(
        `${entity.tan}: Summary payable ${fromSummary.payable} vs challan rows ${totalPayable}`
      )
    }

    return {
      entity,
      liable: rows.length > 0,
      rows,
      excluded,
      totalPayable,
      totalPaid,
      computedFromEntries,
      difference: computedFromEntries - totalPayable,
    }
  })

  return {
    entities: built,
    challanRows,
    workingsRows,
    totals: {
      payable: built.reduce((a, e) => a + e.totalPayable, 0),
      paid: built.reduce((a, e) => a + e.totalPaid, 0),
      computed: built.reduce((a, e) => a + e.computedFromEntries, 0),
      liableCount: built.filter((e) => e.liable).length,
      verifiedRows,
      carriedForwardRows,
    },
    mismatches,
  }
}

export { entityByTan }
