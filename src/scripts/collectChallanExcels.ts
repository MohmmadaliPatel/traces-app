/**
 * Temporary script: collect PaymentHistory Excel files from
 * public/pdf/challans/{Company}/ into a separate folder, and build a
 * combined Excel list with company name.
 *
 * Run: node -r esbuild-register src/scripts/collectChallanExcels.ts
 */
import fs from "fs"
import path from "path"
import XLSX from "xlsx"

const SOURCE_ROOT = path.join(process.cwd(), "public", "pdf", "challans")
const OUTPUT_ROOT = path.join(process.cwd(), "public", "pdf", "challans-excel-export")
const COMBINED_FILE = path.join(OUTPUT_ROOT, "combined-payment-history.xlsx")
const COMPANY_LIST_FILE = path.join(OUTPUT_ROOT, "company-list.xlsx")

const EXCEL_RE = /\.xlsx?$/i

type CollectedRow = Record<string, unknown> & {
  "Company Folder": string
  "Source File": string
}

function listCompanyDirs(root: string): string[] {
  if (!fs.existsSync(root)) {
    throw new Error(`Source folder not found: ${root}`)
  }
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b))
}

function findExcelFiles(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findExcelFiles(full))
    } else if (EXCEL_RE.test(entry.name) && !entry.name.startsWith("~$")) {
      results.push(full)
    }
  }
  return results
}

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function copyFileSafe(src: string, dest: string) {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
}

function main() {
  console.log(`Source: ${SOURCE_ROOT}`)
  console.log(`Output: ${OUTPUT_ROOT}`)

  if (fs.existsSync(OUTPUT_ROOT)) {
    fs.rmSync(OUTPUT_ROOT, { recursive: true, force: true })
  }
  ensureDir(OUTPUT_ROOT)

  const companies = listCompanyDirs(SOURCE_ROOT)
  const companyList: Array<{
    "S.No": number
    "Company Name": string
    "Excel Count": number
    "Row Count": number
    Files: string
  }> = []
  const combinedRows: CollectedRow[] = []

  let companiesWithExcel = 0
  let filesCopied = 0

  for (const company of companies) {
    const companySrc = path.join(SOURCE_ROOT, company)
    const excelFiles = findExcelFiles(companySrc)

    if (excelFiles.length === 0) {
      companyList.push({
        "S.No": companyList.length + 1,
        "Company Name": company,
        "Excel Count": 0,
        "Row Count": 0,
        Files: "",
      })
      continue
    }

    companiesWithExcel++
    const companyOut = path.join(OUTPUT_ROOT, company)
    ensureDir(companyOut)

    let rowCount = 0
    const fileNames: string[] = []

    for (const excelPath of excelFiles) {
      const fileName = path.basename(excelPath)
      const destPath = path.join(companyOut, fileName)
      copyFileSafe(excelPath, destPath)
      filesCopied++
      fileNames.push(fileName)

      try {
        const wb = XLSX.readFile(excelPath)
        const sheetName = wb.SheetNames[0]
        if (!sheetName) continue
        const sheet = wb.Sheets[sheetName]
        if (!sheet) continue
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
          defval: "",
        })
        for (const row of rows) {
          combinedRows.push({
            "Company Folder": company,
            "Source File": fileName,
            ...row,
          })
          rowCount++
        }
      } catch (err) {
        console.warn(`Failed to read ${excelPath}:`, err)
      }
    }

    companyList.push({
      "S.No": companyList.length + 1,
      "Company Name": company,
      "Excel Count": excelFiles.length,
      "Row Count": rowCount,
      Files: fileNames.join("; "),
    })

    console.log(`✓ ${company} — ${excelFiles.length} file(s), ${rowCount} row(s)`)
  }

  // Combined payment history with company name
  const combinedWb = XLSX.utils.book_new()
  const combinedSheet = XLSX.utils.json_to_sheet(combinedRows)
  XLSX.utils.book_append_sheet(combinedWb, combinedSheet, "Combined")
  XLSX.writeFile(combinedWb, COMBINED_FILE)

  // Company list
  const listWb = XLSX.utils.book_new()
  const listSheet = XLSX.utils.json_to_sheet(companyList)
  XLSX.utils.book_append_sheet(listWb, listSheet, "Companies")
  XLSX.writeFile(listWb, COMPANY_LIST_FILE)

  console.log("\nDone.")
  console.log(`Companies scanned: ${companies.length}`)
  console.log(`Companies with Excel: ${companiesWithExcel}`)
  console.log(`Files copied: ${filesCopied}`)
  console.log(`Combined rows: ${combinedRows.length}`)
  console.log(`Copied folder: ${OUTPUT_ROOT}`)
  console.log(`Combined Excel: ${COMBINED_FILE}`)
  console.log(`Company list: ${COMPANY_LIST_FILE}`)
}

main()
