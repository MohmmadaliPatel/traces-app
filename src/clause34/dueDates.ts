/**
 * Statutory due dates for furnishing quarterly TDS statements — Rule 31A(2) of the
 * Income-tax Rules, 1962, for non-government deductors (Forms 24Q / 26Q / 27Q).
 *
 * Q1–Q3: 31st of the month following the quarter.
 * Q4:    31 May following the financial year.
 *
 * Form 27EQ (TCS) runs on a different rule (Rule 31AA: 15th of the month following the
 * quarter) and is reported separately, so it is not covered by this table.
 */
export type Quarter = "Q1" | "Q2" | "Q3" | "Q4"

export const QUARTERS: Quarter[] = ["Q1", "Q2", "Q3", "Q4"]

export type DueDateRow = {
  quarter: Quarter
  /** e.g. "Apr-Jun 2025" */
  period: string
  dueDate: Date
  basis: string
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** `2025` → `2025-26`. */
export function fyLabel(startYear: number): string {
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`
}

/** Due dates for a financial year given by its start year (2025 → FY 2025-26). */
export function dueDatesForFy(startYear: number): DueDateRow[] {
  const next = startYear + 1
  return [
    {
      quarter: "Q1",
      period: `Apr-Jun ${startYear}`,
      dueDate: new Date(Date.UTC(startYear, 6, 31)),
      basis: "31 July following the quarter",
    },
    {
      quarter: "Q2",
      period: `Jul-Sep ${startYear}`,
      dueDate: new Date(Date.UTC(startYear, 9, 31)),
      basis: "31 October following the quarter",
    },
    {
      quarter: "Q3",
      period: `Oct-Dec ${startYear}`,
      dueDate: new Date(Date.UTC(next, 0, 31)),
      basis: "31 January following the quarter",
    },
    {
      quarter: "Q4",
      period: `Jan-Mar ${next}`,
      dueDate: new Date(Date.UTC(next, 4, 31)),
      basis: "31 May following the financial year",
    },
  ]
}

/**
 * Rule 31AA(2) — Form 27EQ (TCS): 15th of the month following the quarter, and 15 May for Q4.
 * A different regime from Rule 31A(2), so 27EQ must never use the Due Dates sheet lookup.
 */
export function tcsDueDatesForFy(startYear: number): DueDateRow[] {
  const next = startYear + 1
  return [
    {
      quarter: "Q1",
      period: `Apr-Jun ${startYear}`,
      dueDate: new Date(Date.UTC(startYear, 6, 15)),
      basis: "15 July following the quarter",
    },
    {
      quarter: "Q2",
      period: `Jul-Sep ${startYear}`,
      dueDate: new Date(Date.UTC(startYear, 9, 15)),
      basis: "15 October following the quarter",
    },
    {
      quarter: "Q3",
      period: `Oct-Dec ${startYear}`,
      dueDate: new Date(Date.UTC(next, 0, 15)),
      basis: "15 January following the quarter",
    },
    {
      quarter: "Q4",
      period: `Jan-Mar ${next}`,
      dueDate: new Date(Date.UTC(next, 4, 15)),
      basis: "15 May following the financial year",
    },
  ]
}

export function isTcsForm(formType: string): boolean {
  return formType.toUpperCase() === "27EQ"
}

/**
 * Due date for a statement. `formType` selects the regime: 27EQ follows Rule 31AA, everything
 * else Rule 31A(2). Omitting it keeps the 31A(2) behaviour.
 */
export function dueDateFor(startYear: number, quarter: Quarter, formType?: string): Date {
  const table =
    formType && isTcsForm(formType) ? tcsDueDatesForFy(startYear) : dueDatesForFy(startYear)
  const row = table.find((r) => r.quarter === quarter)
  if (!row) throw new Error(`Unknown quarter ${quarter}`)
  return row.dueDate
}

/** Parse the portal's `dd-MMM-yyyy` (e.g. "25-May-2026"). Returns null for "-" or junk. */
export function parsePortalDate(value: string | null | undefined): Date | null {
  const raw = String(value ?? "").trim()
  if (!raw || raw === "-") return null

  let m = raw.match(/^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/)
  if (m) {
    const month = MONTHS.findIndex((x) => x.toLowerCase() === m![2]!.toLowerCase())
    if (month < 0) return null
    return new Date(Date.UTC(Number(m[3]), month, Number(m[1])))
  }
  // dd-mm-yyyy / dd/mm/yyyy, as the existing workbook and some portal surfaces use.
  m = raw.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})$/)
  if (m) return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])))

  return null
}

/** `dd-mm-yyyy`, the display format the clause 34(b) workbook uses. */
export function formatDdMmYyyy(date: Date | null): string {
  if (!date) return ""
  const d = String(date.getUTCDate()).padStart(2, "0")
  const m = String(date.getUTCMonth() + 1).padStart(2, "0")
  return `${d}-${m}-${date.getUTCFullYear()}`
}

export function daysBetween(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / 86400000)
}
