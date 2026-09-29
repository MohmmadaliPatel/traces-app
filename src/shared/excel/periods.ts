export type Period = {
  financialYear: string
  quarter: string
  formType: string
}

export type PeriodOptionalForm = {
  financialYear: string
  quarter: string
  formType: string | undefined
}

const DEFAULT_FORM_TYPES = ["24Q", "26Q", "27Q", "27EQ"] as const
const JUSTIFICATION_FORM_TYPES = ["24Q", "26Q", "27Q", "27EQ", "140"] as const
const QUARTERS = ["Q1", "Q2", "Q3", "Q4"] as const

export type GenerateAllPeriodsOptions = {
  /** How many FY years back from current calendar year (default 15). */
  yearCount?: number
  /** Form types to include (default TDS return forms without 140). */
  formTypes?: readonly string[]
}

/**
 * Generate FY × quarter × formType combinations for "send to all periods" batch jobs.
 * Financial year format: `YYYY-YY` (e.g. `2025-26`).
 */
export function generateAllPeriods(options: GenerateAllPeriodsOptions = {}): Period[] {
  const yearCount = options.yearCount ?? 15
  const formTypes = options.formTypes ?? DEFAULT_FORM_TYPES
  const currentYear = new Date().getFullYear()
  const periods: Period[] = []

  for (let i = 0; i < yearCount; i++) {
    const year = currentYear - i
    const financialYear = `${year}-${(year + 1).toString().slice(-2)}`
    for (const quarter of QUARTERS) {
      for (const formType of formTypes) {
        periods.push({ financialYear, quarter, formType })
      }
    }
  }

  return periods
}

/** Justification includes Form 140 in the all-periods matrix. */
export function generateAllJustificationPeriods(): Period[] {
  return generateAllPeriods({ formTypes: JUSTIFICATION_FORM_TYPES })
}

const FORM16A_NEW_ACT_FORM_TYPES = ["130", "131", "133"] as const
const FORM16A_NEW_ACT_FY = "2026-27"
const FORM16A_NEW_ACT_QUARTER = "Q1"

/** New Act Form 16A: FY 2026-27 × Q1 × forms 130/131/133. */
export function generateAllForm16aNewActPeriods(): Period[] {
  return FORM16A_NEW_ACT_FORM_TYPES.map((formType) => ({
    financialYear: FORM16A_NEW_ACT_FY,
    quarter: FORM16A_NEW_ACT_QUARTER,
    formType,
  }))
}

function toStringArray(value: string | string[] | undefined): string[] {
  if (Array.isArray(value)) return value.filter(Boolean)
  if (value) return [value]
  return []
}

/**
 * Expand selected FY / quarter / formType into a cartesian product of periods.
 * When `sendToAllPeriods` is true, uses generateAllPeriods (or custom generator).
 * When `downloadPlaceholder` is true and action is download-style, returns a single empty period.
 */
export function resolvePeriods(input: {
  financialYear?: string | string[]
  quarter?: string | string[]
  formType?: string | string[]
  sendToAllPeriods?: boolean
  /** When true, return one empty period (used for download_file on Conso/Form16). */
  downloadPlaceholder?: boolean
  /** Defaults when arrays are empty (Justification). */
  defaults?: { financialYear?: string; quarter?: string; formType?: string }
  allPeriodsFn?: () => Period[]
}): PeriodOptionalForm[] {
  if (input.downloadPlaceholder) {
    return [{ financialYear: "", quarter: "", formType: undefined }]
  }

  if (input.sendToAllPeriods) {
    return (input.allPeriodsFn ?? generateAllPeriods)()
  }

  let financialYears = toStringArray(input.financialYear)
  let quarters = toStringArray(input.quarter)
  let formTypes = input.formType
    ? toStringArray(input.formType)
    : input.defaults?.formType
      ? []
      : [undefined as unknown as string]

  if (input.defaults) {
    if (!financialYears.length && input.defaults.financialYear) {
      financialYears = [input.defaults.financialYear]
    }
    if (!quarters.length && input.defaults.quarter) {
      quarters = [input.defaults.quarter]
    }
    if ((!formTypes.length || (formTypes.length === 1 && formTypes[0] === undefined)) &&
      input.defaults.formType
    ) {
      formTypes = [input.defaults.formType]
    }
  }

  if (!formTypes.length) {
    formTypes = [undefined as unknown as string]
  }

  const periods: PeriodOptionalForm[] = []
  for (const fy of financialYears) {
    for (const q of quarters) {
      for (const ft of formTypes) {
        periods.push({
          financialYear: fy,
          quarter: q,
          formType: ft === undefined ? undefined : ft,
        })
      }
    }
  }
  return periods
}

/** Normalize Return Status portal quarter codes ("3"–"6") ↔ Q1–Q4. */
export function portalQuarterToQ(code: string): string {
  const map: Record<string, string> = { "3": "Q1", "4": "Q2", "5": "Q3", "6": "Q4" }
  return map[String(code).trim()] || String(code).trim()
}

export function qToPortalQuarter(q: string): string {
  const map: Record<string, string> = { Q1: "3", Q2: "4", Q3: "5", Q4: "6" }
  const key = String(q).trim().toUpperCase()
  return map[key] || String(q).trim()
}
