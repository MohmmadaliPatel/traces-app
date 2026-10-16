import * as XLSX from "xlsx"

export type XlsxCompany = {
  id: number
  name: string
  tan: string
  it_password: string | null
  user_id: string | null
  password: string | null
  /** Not in the DB, so nothing is written to DB tables for it. */
  external: true
}

/**
 * Companies kept outside the DB (e.g. Continuum's sheet: Company Name, Tan, IT Password,
 * User ID, Password). Ids are synthetic (900000 + row) and only key checkpoints, so keep the
 * sheet's row order stable between resumes.
 */
export function loadCompaniesXlsx(file: string): XlsxCompany[] {
  const wb = XLSX.readFile(file)
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]!]!, { defval: "" })
  const cell = (r: Record<string, unknown>, name: string) => {
    const key = Object.keys(r).find((k) => k.trim().toLowerCase() === name.toLowerCase())
    const v = key ? String(r[key] ?? "").trim() : ""
    return v || null
  }
  const companies = rows
    .map((r, i) => ({
      id: 900000 + i + 1,
      name: cell(r, "Company Name") ?? "",
      tan: (cell(r, "Tan") ?? "").toUpperCase(),
      it_password: cell(r, "IT Password"),
      user_id: cell(r, "User ID"),
      password: cell(r, "Password"),
      external: true as const,
    }))
    .filter((c) => c.name && c.tan)
  if (companies.length === 0) throw new Error(`No companies (Company Name + Tan) found in ${file}`)
  return companies
}
