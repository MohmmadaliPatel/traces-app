/**
 * Rebuild Payment History Excels from existing PDFs (with section code, etc.),
 * then collect:
 *   - public/pdf/challans-excel-export/{Company}/*.xlsx + combined workbook
 *   - public/pdf/challans-csi/{Company}/*.csi
 *
 * Run: node -r esbuild-register src/scripts/rebuildAndCollectChallanExports.ts
 */
import fs from "fs"
import path from "path"
import XLSX from "xlsx"
import { convertPdfsToExcel } from "./downloadChallanPayment"

const CHALLANS_ROOT = path.join(process.cwd(), "public", "pdf", "challans")
const EXCEL_EXPORT_ROOT = path.join(process.cwd(), "public", "pdf", "challans-excel-export")
const CSI_EXPORT_ROOT = path.join(process.cwd(), "public", "pdf", "challans-csi")
const COMBINED_FILE = path.join(EXCEL_EXPORT_ROOT, "combined-payment-history.xlsx")
const COMPANY_LIST_FILE = path.join(EXCEL_EXPORT_ROOT, "company-list.xlsx")
const CSI_LIST_FILE = path.join(CSI_EXPORT_ROOT, "company-list.xlsx")

function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

function resetDir(dir: string) {
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true })
  }
  ensureDir(dir)
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

function paymentHistoryDir(company: string): string {
  return path.join(CHALLANS_ROOT, company, "PaymentHistory")
}

function csiDir(company: string): string {
  return path.join(CHALLANS_ROOT, company, "CSI")
}

function listPdfs(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs.readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".pdf") && !f.startsWith("~$"))
}

function listCsiFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".csi") && !f.startsWith("~$") && !f.startsWith("."))
}

function copyFileSafe(src: string, dest: string) {
  ensureDir(path.dirname(dest))
  fs.copyFileSync(src, dest)
}

async function rebuildCompanyExcel(company: string): Promise<{
  excelPath: string | null
  pdfCount: number
  rowCount: number
}> {
  const phDir = paymentHistoryDir(company)
  const pdfs = listPdfs(phDir)
  if (pdfs.length === 0) {
    return { excelPath: null, pdfCount: 0, rowCount: 0 }
  }

  const excelPath = await convertPdfsToExcel(phDir, company, {
    skipWait: true,
    quiet: true,
    excelFileName: `PaymentHistory_${company}.xlsx`,
  })

  let rowCount = 0
  if (excelPath && fs.existsSync(excelPath)) {
    try {
      const wb = XLSX.readFile(excelPath)
      const sheetName = wb.SheetNames[0]
      const sheet = sheetName ? wb.Sheets[sheetName] : undefined
      rowCount = sheet ? XLSX.utils.sheet_to_json(sheet).length : 0
    } catch {
      /* ignore */
    }
  }

  return { excelPath, pdfCount: pdfs.length, rowCount }
}

async function main() {
  console.log("=== Rebuild challan Excels + collect Excel/CSI exports ===")
  console.log(`Challans root: ${CHALLANS_ROOT}`)
  console.log(`Excel export:  ${EXCEL_EXPORT_ROOT}`)
  console.log(`CSI export:    ${CSI_EXPORT_ROOT}`)

  const companies = listCompanyDirs(CHALLANS_ROOT)
  resetDir(EXCEL_EXPORT_ROOT)
  resetDir(CSI_EXPORT_ROOT)

  const excelCompanyList: Array<{
    "S.No": number
    "Company Name": string
    "PDF Count": number
    "Excel Rows": number
    "Excel File": string
  }> = []
  const csiCompanyList: Array<{
    "S.No": number
    "Company Name": string
    "CSI Count": number
    Files: string
  }> = []
  const combinedRows: Array<Record<string, unknown>> = []

  let companiesWithExcel = 0
  let companiesWithCsi = 0
  let excelFilesCopied = 0
  let csiFilesCopied = 0
  let totalPdfs = 0

  for (let i = 0; i < companies.length; i++) {
    const company = companies[i]!
    console.log(`\n[${i + 1}/${companies.length}] ${company}`)

    // 1) Rebuild Excel from PaymentHistory PDFs
    const rebuilt = await rebuildCompanyExcel(company)
    totalPdfs += rebuilt.pdfCount

    if (rebuilt.excelPath && fs.existsSync(rebuilt.excelPath)) {
      companiesWithExcel++
      const fileName = path.basename(rebuilt.excelPath)
      const dest = path.join(EXCEL_EXPORT_ROOT, company, fileName)
      copyFileSafe(rebuilt.excelPath, dest)
      excelFilesCopied++

      try {
        const wb = XLSX.readFile(rebuilt.excelPath)
        const sheetName = wb.SheetNames[0]
        const sheet = sheetName ? wb.Sheets[sheetName] : undefined
        if (!sheet) throw new Error("No sheet in rebuilt excel")
        const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: "" })
        for (const row of rows) {
          combinedRows.push({
            "Company Folder": company,
            "Source File": fileName,
            ...row,
          })
        }
      } catch (err) {
        console.warn(`Failed to read rebuilt excel for ${company}:`, err)
      }

      excelCompanyList.push({
        "S.No": excelCompanyList.length + 1,
        "Company Name": company,
        "PDF Count": rebuilt.pdfCount,
        "Excel Rows": rebuilt.rowCount,
        "Excel File": fileName,
      })
      console.log(`  ✓ Excel: ${rebuilt.pdfCount} PDF(s) → ${rebuilt.rowCount} row(s)`)
    } else if (rebuilt.pdfCount > 0) {
      excelCompanyList.push({
        "S.No": excelCompanyList.length + 1,
        "Company Name": company,
        "PDF Count": rebuilt.pdfCount,
        "Excel Rows": 0,
        "Excel File": "",
      })
      console.log(`  ⚠ ${rebuilt.pdfCount} PDF(s) but no Excel produced`)
    } else {
      console.log(`  · No PaymentHistory PDFs`)
    }

    // 2) Collect company CSI files into separate folder
    const csiFiles = listCsiFiles(csiDir(company))
    if (csiFiles.length > 0) {
      companiesWithCsi++
      const companyCsiOut = path.join(CSI_EXPORT_ROOT, company)
      ensureDir(companyCsiOut)
      for (const name of csiFiles) {
        copyFileSafe(path.join(csiDir(company), name), path.join(companyCsiOut, name))
        csiFilesCopied++
      }
      csiCompanyList.push({
        "S.No": csiCompanyList.length + 1,
        "Company Name": company,
        "CSI Count": csiFiles.length,
        Files: csiFiles.join("; "),
      })
      console.log(`  ✓ CSI: ${csiFiles.length} file(s)`)
    }
  }

  // Combined payment history
  const combinedWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    combinedWb,
    XLSX.utils.json_to_sheet(combinedRows),
    "Combined"
  )
  XLSX.writeFile(combinedWb, COMBINED_FILE)

  const listWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    listWb,
    XLSX.utils.json_to_sheet(excelCompanyList),
    "Companies"
  )
  XLSX.writeFile(listWb, COMPANY_LIST_FILE)

  const csiListWb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(
    csiListWb,
    XLSX.utils.json_to_sheet(csiCompanyList),
    "Companies"
  )
  XLSX.writeFile(csiListWb, CSI_LIST_FILE)

  console.log("\n=== Done ===")
  console.log(`Companies scanned: ${companies.length}`)
  console.log(`PDFs parsed: ${totalPdfs}`)
  console.log(`Companies with Excel: ${companiesWithExcel} (${excelFilesCopied} files)`)
  console.log(`Combined Excel rows: ${combinedRows.length}`)
  console.log(`Companies with CSI: ${companiesWithCsi} (${csiFilesCopied} files)`)
  console.log(`Excel export folder: ${EXCEL_EXPORT_ROOT}`)
  console.log(`Combined Excel: ${COMBINED_FILE}`)
  console.log(`CSI export folder: ${CSI_EXPORT_ROOT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
