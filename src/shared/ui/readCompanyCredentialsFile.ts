import * as XLSX from "xlsx"
import {
  COMPANY_CREDENTIAL_COLUMN_MAP,
  COMPANY_CREDENTIAL_HEADERS,
  parseCompanyCredentialRows,
  type CompanyCredentials,
} from "src/shared/excel/companyCredentials"

export type { CompanyCredentials }

/** Read first sheet of an Excel or CSV File into company credential rows. */
export async function readCompanyCredentialsFromFile(
  file: File
): Promise<CompanyCredentials[]> {
  const isCsv = /\.csv$/i.test(file.name)

  const jsonData = await new Promise<Record<string, unknown>[]>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        if (isCsv) {
          const text = (e.target?.result as string) || ""
          const workbook = XLSX.read(text, { type: "string", raw: false })
          const sheetName = workbook.SheetNames[0]
          if (!sheetName) throw new Error("No sheets found in file")
          const worksheet = workbook.Sheets[sheetName]
          resolve(XLSX.utils.sheet_to_json(worksheet!) as Record<string, unknown>[])
        } else {
          const data = new Uint8Array(e.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: "array" })
          const sheetName = workbook.SheetNames[0]
          if (!sheetName) throw new Error("No sheets found in Excel file")
          const worksheet = workbook.Sheets[sheetName]
          resolve(XLSX.utils.sheet_to_json(worksheet!) as Record<string, unknown>[])
        }
      } catch (err) {
        reject(err)
      }
    }
    reader.onerror = () => reject(new Error("Failed to read file"))
    if (isCsv) reader.readAsText(file, "UTF-8")
    else reader.readAsArrayBuffer(file)
  })

  return parseCompanyCredentialRows(jsonData, { ...COMPANY_CREDENTIAL_COLUMN_MAP })
}

/** A saved company as downloaded from the Companies page. */
export type CompanyCredentialsExportRow = CompanyCredentials & {
  dscCertificateName?: string | null
  emails?: string | null
}

/** Upload columns first (so the file can be uploaded back as-is), then the extra company fields. */
function companyCredentialsSheet(rows: CompanyCredentialsExportRow[]) {
  return XLSX.utils.aoa_to_sheet([
    [...COMPANY_CREDENTIAL_HEADERS, "DSC Certificate Name", "Emails"],
    ...rows.map((c) => [
      c.name,
      c.tan,
      c.it_password,
      c.user_id,
      c.password,
      c.dscCertificateName ?? "",
      c.emails ?? "",
    ]),
  ])
}

export function downloadCompanyCredentialsCsv(rows: CompanyCredentialsExportRow[]) {
  const csv = XLSX.utils.sheet_to_csv(companyCredentialsSheet(rows))
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
  const url = URL.createObjectURL(blob)
  const a = document.createElement("a")
  a.href = url
  a.download = "companies.csv"
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadCompanyCredentialsExcel(rows: CompanyCredentialsExportRow[]) {
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, companyCredentialsSheet(rows), "Companies")
  XLSX.writeFile(wb, "companies.xlsx")
}
