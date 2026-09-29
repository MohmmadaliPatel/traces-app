import {
  COMPANY_CREDENTIAL_COLUMN_MAP,
  COMPANY_CREDENTIAL_HEADERS,
  type CompanyCredentials,
} from "src/shared/types/companyCredentials"

export {
  COMPANY_CREDENTIAL_COLUMN_MAP,
  COMPANY_CREDENTIAL_HEADERS,
  type CompanyCredentials,
}

function pickField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = row[key]
    if (val != null && String(val).trim() !== "") return String(val).trim()
  }
  // Case-insensitive fallback
  const lowerMap = new Map(
    Object.keys(row).map((k) => [k.toLowerCase(), row[k]] as const)
  )
  for (const key of keys) {
    const val = lowerMap.get(key.toLowerCase())
    if (val != null && String(val).trim() !== "") return String(val).trim()
  }
  return ""
}

/**
 * Parse rows from SheetJS `sheet_to_json` (or CSV objects) using the canonical
 * 5-column company credentials template.
 */
export function parseCompanyCredentialRows(
  jsonData: Record<string, unknown>[],
  columnMap: Record<string, string> = { ...COMPANY_CREDENTIAL_COLUMN_MAP }
): CompanyCredentials[] {
  return jsonData.map((row, index) => {
    const name = row[columnMap.name || ""]
    const tan = row[columnMap.tan || ""]
    const it_password = row[columnMap.it_password || ""]
    const user_id = row[columnMap.user_id || ""]
    const password = row[columnMap.password || ""]
    if (!name || !tan || !it_password || !user_id || !password) {
      throw new Error(`Missing required fields in row ${index + 1}`)
    }
    return {
      name: String(name).trim(),
      tan: String(tan).trim().toUpperCase(),
      it_password: String(it_password).trim(),
      user_id: String(user_id).trim(),
      password: String(password).trim(),
    }
  })
}

export type FlexibleCompanyRow = {
  name: string
  tan: string
  it_password: string
  taxYear?: string
  quarter?: string
  formType?: string
}

/**
 * Alias-tolerant parser used by Extract Form 140 (and similar IT-portal tools).
 * Does not require TRACES User ID / Password columns.
 */
export function parseFlexibleCompanyRows(
  rows: Record<string, unknown>[]
): {
  companies: FlexibleCompanyRow[]
  taxYears: string[]
  quarters: string[]
} {
  const seen = new Set<string>()
  const yearSet = new Set<string>()
  const quarterSet = new Set<string>()
  const out: FlexibleCompanyRow[] = []

  for (const row of rows) {
    const name = pickField(row, [
      "company_name",
      "Company Name",
      "company name",
      "Company",
      "name",
    ])
    const tan = pickField(row, [
      "username",
      "Tan",
      "TAN",
      "tan",
      "Username",
      "User ID",
    ]).toUpperCase()
    const it_password = pickField(row, [
      "IT Password",
      "it_password",
      "IT password",
      "password",
    ])
    const taxYear = normalizeTaxYear(
      pickField(row, ["tax_year", "Tax Year", "financial year", "Financial Year", "FY"])
    )
    const quarter = normalizeQuarter(pickField(row, ["quarter", "Quarter", "Qtr", "qtr"]))
    const formType = pickField(row, ["form_type", "Form Type", "formType", "form"])

    if (!name || !tan || !it_password) continue
    if (seen.has(tan)) continue
    seen.add(tan)

    if (taxYear) yearSet.add(taxYear)
    if (quarter) quarterSet.add(quarter)

    out.push({
      name,
      tan,
      it_password,
      taxYear: taxYear || undefined,
      quarter: quarter || undefined,
      formType: formType || undefined,
    })
  }

  return {
    companies: out,
    taxYears: [...yearSet],
    quarters: [...quarterSet],
  }
}

function normalizeTaxYear(raw: string): string {
  const v = raw.trim()
  if (!v) return ""
  // Accept 2025-26, 2025-2026, FY2025-26
  const m = v.replace(/^FY\s*/i, "").match(/(\d{4})\s*[-/]\s*(\d{2,4})/)
  if (!m) return v
  const y1 = m[1]!
  const y2 = m[2]!.length === 4 ? m[2]!.slice(-2) : m[2]!
  return `${y1}-${y2}`
}

/** Extract calendar/ref year "2026" from FY labels like "2026-27" or "T.Y.2026-27". */
export function toAssessmentYearRef(value: string): string {
  const m = String(value || "").match(/(20\d{2})/)
  return m?.[1] || String(value || "").trim()
}

function normalizeQuarter(raw: string): string {
  const v = raw.trim().toUpperCase()
  if (!v) return ""
  if (/^Q[1-4]$/.test(v)) return v
  if (/^[1-4]$/.test(v)) return `Q${v}`
  return v
}

export const COMPANY_TEMPLATE_CSV =
  COMPANY_CREDENTIAL_HEADERS.join(",") +
  "\nABC Corporation Ltd,ABCD12345E,ITPass123,ABCD12345E,UserPass456"
