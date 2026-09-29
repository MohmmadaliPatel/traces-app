/**
 * Reconciliation for clause 34(b): turn the raw per-statement portal records into one row per
 * (TAN, form, quarter) — the shape Form 3CD clause 34(b) reports — and diff it against the
 * hand-prepared workbook.
 *
 * The central point: TRACES returns one record per *statement*, tagged `stmnttype` "Regular"
 * or "Correction". Clause 34(b)(d) asks for the date the statement was **furnished**, which is
 * the Regular statement's date. The conso file header cannot answer that once a correction
 * exists, which is why 24 rows of the original workbook were estimated or blank.
 */
import db from "db"
import { CONTINUUM_GROUP, entityByTan, type Clause34Entity } from "src/clause34/continuumGroup"
import {
  QUARTERS,
  dueDateFor,
  isTcsForm,
  parsePortalDate,
  formatDdMmYyyy,
  type Quarter,
} from "src/clause34/dueDates"
import {
  indexOriginalRows,
  readOriginalWorkbook,
  originalRowKey,
  type OriginalRow,
} from "src/clause34/originalWorkbook"
import { tokenMatches } from "src/clause34/fetchStatementStatus"

/** Which portal surface column (d) is taken from. */
export type DateSource = "stmtstatus" | "conso"

export type StatementRecord = {
  tokenno: string
  dtoffiling: string
  status: string
  dtofprcng: string
  stmnttype: string
  remarks?: string | null
  reason?: string | null
}

export type Clause34Row = {
  entity: Clause34Entity
  formType: string
  quarter: Quarter

  // --- Form 3CD clause 34(b) columns ---
  /** (c) */ dueDate: Date
  /** (d) */ dateOfFurnishing: Date | null
  /** (e) */ containsAllTransactions: string
  /** (f) */ notReported: string

  // --- working notes ---
  originalToken: string
  latestToken: string
  correctionFiled: string
  dateOfLatestStatement: Date | null
  /** Column M — where the column (d) date came from. */
  basis: string
  /** Portal processing status of the original statement. */
  status: string
  correctionCount: number
  rejectedCorrectionCount: number

  // --- reconciliation against the prepared workbook ---
  comparison: "match" | "changed" | "new-on-portal" | "missing-on-portal" | "not-filed"
  workbookDate: Date | null
  workbookBasis: string
  remarks: string
}

export const BASIS_TRACES = "Per TRACES statement status"
export const BASIS_CONSO = "Per TRACES conso file"
export const BASIS_NOT_FOUND = "Not found on portal"
export const BASIS_NOT_FILED = "No statement filed"

function fyString(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`
}

/** Pull the persisted TRACES records, keyed `TAN|FORM|QUARTER`. */
export async function loadStatementRecords(
  startYear: number,
  tans: string[]
): Promise<Map<string, StatementRecord[]>> {
  const finyear = fyString(startYear)
  const companies = await db.company.findMany({
    where: { tan: { in: tans.map((t) => t.toUpperCase()) } },
    select: { id: true, tan: true },
  })
  const tanById = new Map(companies.map((c) => [c.id, c.tan]))

  const rows = await db.returnStatus.findMany({
    where: { companyId: { in: companies.map((c) => c.id) }, finyear },
  })

  const grouped = new Map<string, StatementRecord[]>()
  for (const row of rows) {
    const tan = tanById.get(row.companyId)
    if (!tan) continue
    const key = originalRowKey(tan, row.formtype, row.quarter)
    const list = grouped.get(key) ?? []
    list.push({
      tokenno: row.tokenno,
      dtoffiling: row.dtoffiling,
      status: row.status,
      dtofprcng: row.dtofprcng,
      stmnttype: row.stmnttype,
      remarks: row.remarks,
      reason: row.reason,
    })
    grouped.set(key, list)
  }
  return grouped
}

/**
 * TRACES masks tokens (first four + last four). Where the previous working paper carried the
 * full number and it is consistent with the mask, keep the full number — it is the same token
 * and a masked PRN is not much use in a working paper.
 */
function preferFullToken(portalToken: string, workbookToken: string): string {
  if (!portalToken) return workbookToken || ""
  if (!portalToken.includes("X")) return portalToken
  if (workbookToken && tokenMatches(portalToken, workbookToken)) return workbookToken
  return portalToken
}

function isRegular(record: StatementRecord): boolean {
  return /regular/i.test(record.stmnttype || "")
}

function isRejected(record: StatementRecord): boolean {
  return /reject/i.test(record.status || "")
}

/**
 * Reduce one combination's statements to a clause 34(b) row.
 * `original` is the Regular statement; corrections only inform the working-note columns.
 */
function reconcileCombination(
  entity: Clause34Entity,
  formType: string,
  quarter: Quarter,
  startYear: number,
  records: StatementRecord[],
  workbookRow: OriginalRow | undefined,
  dateSource: DateSource
): Clause34Row {
  const dueDate = dueDateFor(startYear, quarter, formType)
  const notes: string[] = []

  if (isTcsForm(formType)) {
    notes.push(
      "Form 27EQ (TCS) follows Rule 31AA, not Rule 31A(2): the due date here is set directly and " +
        "is not the value on the 'Due Dates' sheet."
    )
  }

  const regulars = records
    .filter(isRegular)
    .sort(
      (a, b) =>
        (parsePortalDate(a.dtoffiling)?.getTime() ?? 0) -
        (parsePortalDate(b.dtoffiling)?.getTime() ?? 0)
    )
  const corrections = records.filter((r) => !isRegular(r))
  const rejectedCorrections = corrections.filter(isRejected)

  const original = regulars[0]
  const portalDate = original ? parsePortalDate(original.dtoffiling) : null

  const latest = [...records]
    .filter((r) => !isRejected(r))
    .sort(
      (a, b) =>
        (parsePortalDate(b.dtoffiling)?.getTime() ?? 0) -
        (parsePortalDate(a.dtoffiling)?.getTime() ?? 0)
    )[0]

  // Column (d): the Regular statement's date, unless we were asked to keep the conso value.
  let dateOfFurnishing: Date | null = portalDate
  let basis = BASIS_TRACES
  if (dateSource === "conso" && workbookRow?.dateOfFurnishing) {
    dateOfFurnishing = workbookRow.dateOfFurnishing
    basis = BASIS_CONSO
  }

  if (!records.length) {
    basis = workbookRow ? BASIS_NOT_FOUND : BASIS_NOT_FILED
    dateOfFurnishing = dateSource === "conso" ? workbookRow?.dateOfFurnishing ?? null : null
  } else if (!original) {
    // Corrections present but no Regular record — TRACES occasionally omits very old originals.
    basis = BASIS_NOT_FOUND
    notes.push(
      `Portal lists ${records.length} statement(s) but no "Regular" record, so the original filing date is not available from Statement Filed Status.`
    )
  }

  // Reconciliation verdict.
  let comparison: Clause34Row["comparison"]
  if (!workbookRow) {
    comparison = records.length ? "new-on-portal" : "not-filed"
  } else if (!records.length) {
    comparison = "missing-on-portal"
  } else if (!workbookRow.dateOfFurnishing) {
    comparison = "changed"
  } else if (portalDate && workbookRow.dateOfFurnishing.getTime() === portalDate.getTime()) {
    comparison = "match"
  } else {
    comparison = "changed"
  }

  if (comparison === "changed" && workbookRow) {
    if (workbookRow.dateOfFurnishing) {
      notes.push(
        `Workbook had ${formatDdMmYyyy(workbookRow.dateOfFurnishing)} (${
          workbookRow.basis
        }); Statement Filed Status reports ${formatDdMmYyyy(portalDate)} for the Regular statement.`
      )
    } else {
      notes.push(
        `Workbook left column (d) blank (${
          workbookRow.basis
        }); Statement Filed Status reports ${formatDdMmYyyy(portalDate)}.`
      )
    }
  }
  if (comparison === "missing-on-portal") {
    notes.push(
      `Workbook lists this statement (token ${
        workbookRow?.originalToken || "n/a"
      }) but TRACES Statement Filed Status returns no record for ${formType} ${quarter}. Confirm before reporting.`
    )
  }
  if (comparison === "new-on-portal") {
    notes.push(`Statement found on TRACES that the workbook did not list.`)
  }

  if (corrections.length) {
    notes.push(
      `${
        corrections.length
      } correction statement(s) on record; the latest accepted statement is dated ${formatDdMmYyyy(
        parsePortalDate(latest?.dtoffiling)
      )}.`
    )
  }
  if (rejectedCorrections.length) {
    notes.push(`${rejectedCorrections.length} correction(s) rejected by TRACES.`)
  }

  // Token cross-check: the portal masks tokens, so confirm the workbook's full token lines up.
  if (original && workbookRow?.originalToken) {
    if (!tokenMatches(original.tokenno, workbookRow.originalToken)) {
      notes.push(
        `Token mismatch: portal shows ${original.tokenno}, workbook shows ${workbookRow.originalToken}.`
      )
    }
  }

  return {
    entity,
    formType,
    quarter,
    dueDate,
    dateOfFurnishing,
    containsAllTransactions: "Yes",
    notReported: "NA",
    originalToken: preferFullToken(original?.tokenno ?? "", workbookRow?.originalToken ?? ""),
    latestToken: preferFullToken(latest?.tokenno ?? "", workbookRow?.latestToken ?? ""),
    correctionFiled: records.length ? (corrections.length ? "Yes" : "No") : "",
    dateOfLatestStatement: parsePortalDate(latest?.dtoffiling),
    basis,
    status: original?.status ?? "",
    correctionCount: corrections.length,
    rejectedCorrectionCount: rejectedCorrections.length,
    comparison,
    workbookDate: workbookRow?.dateOfFurnishing ?? null,
    workbookBasis: workbookRow?.basis ?? "",
    remarks: notes.join(" "),
  }
}

export type Clause34BuildResult = {
  rows: Clause34Row[]
  counts: Record<Clause34Row["comparison"], number>
  startYear: number
  dateSource: DateSource
}

export async function buildClause34Rows(options: {
  startYear: number
  dateSource?: DateSource
  entities?: Clause34Entity[]
}): Promise<Clause34BuildResult> {
  const { startYear } = options
  const dateSource = options.dateSource ?? "stmtstatus"
  const entities = options.entities ?? CONTINUUM_GROUP

  const statements = await loadStatementRecords(
    startYear,
    entities.map((e) => e.tan)
  )
  const workbookRows = readOriginalWorkbook()
  const workbookIndex = indexOriginalRows(workbookRows)

  const rows: Clause34Row[] = []

  for (const entity of entities) {
    // Cover every combination the portal knows about *and* every one the workbook claimed,
    // so nothing disappears just because one side is silent.
    const combos = new Set<string>()
    for (const key of statements.keys()) {
      if (key.startsWith(`${entity.tan}|`)) combos.add(key)
    }
    for (const row of workbookRows) {
      if (row.tan.toUpperCase() === entity.tan) {
        combos.add(originalRowKey(row.tan, row.formType, row.quarter))
      }
    }

    const parsed = [...combos]
      .map((key) => {
        const [, formType, quarter] = key.split("|")
        return { key, formType: formType ?? "", quarter: (quarter ?? "") as Quarter }
      })
      .filter((c) => c.formType && QUARTERS.includes(c.quarter))
      .sort((a, b) =>
        a.formType === b.formType
          ? a.quarter.localeCompare(b.quarter)
          : a.formType.localeCompare(b.formType)
      )

    for (const combo of parsed) {
      rows.push(
        reconcileCombination(
          entity,
          combo.formType,
          combo.quarter,
          startYear,
          statements.get(combo.key) ?? [],
          workbookIndex.get(combo.key),
          dateSource
        )
      )
    }
  }

  const counts = {
    match: 0,
    changed: 0,
    "new-on-portal": 0,
    "missing-on-portal": 0,
    "not-filed": 0,
  } as Record<Clause34Row["comparison"], number>
  for (const row of rows) counts[row.comparison]++

  return { rows, counts, startYear, dateSource }
}

export { entityByTan }
