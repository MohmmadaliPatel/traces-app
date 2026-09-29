import fs from "fs"
import path from "path"
import { glob } from "glob"
import { isPdfSigned } from "./pdfSignatureInfo"

/**
 * Locates certificate PDFs already written to disk, so they can be signed after the fact.
 *
 * Layout written by generatePdfsFromZipFolder / NoticeDownloader-form16:
 *   public/pdf/<form16|form16a>/<Company Name>/<formType>_FY<financialYear>_<quarter>/*.pdf
 * e.g. public/pdf/form16a/Clean Max Aero Private Limited/131_FY2026-27_Q1/AAGCN8510R_131_2026-27_Q1.pdf
 */

export type FindPdfsFilter = {
  companyName?: string
  financialYear?: string
  quarter?: string
  formType?: string
  form16Type?: "form16" | "form16a"
}

/** Same sanitisation generatePdfsFromZipFolder applies when creating the folder. */
export function sanitizeCompanyFolder(companyName: string): string {
  return companyName.replace(/[/\\?%*:|"<>]/g, "_")
}

export function periodFolderName(formType: string, financialYear: string, quarter: string): string {
  return `${formType}_FY${financialYear}_${quarter}`
}

export async function findGeneratedPdfs(filter: FindPdfsFilter = {}): Promise<string[]> {
  const roots =
    filter.form16Type === "form16"
      ? ["form16"]
      : filter.form16Type === "form16a"
        ? ["form16a"]
        : ["form16a", "form16"]

  const results: string[] = []

  for (const root of roots) {
    const base = path.join(process.cwd(), "public", "pdf", root)
    if (!fs.existsSync(base)) continue

    const companyDir = filter.companyName
      ? path.join(base, sanitizeCompanyFolder(filter.companyName))
      : base
    if (!fs.existsSync(companyDir)) continue

    const found = await glob("**/*.pdf", { cwd: companyDir, absolute: true })
    for (const p of found) {
      // The period folder is the immediate parent: <formType>_FY<fy>_<quarter>
      const period = path.basename(path.dirname(p))
      if (filter.formType && !period.startsWith(`${filter.formType}_`)) continue
      if (filter.financialYear && !period.includes(`_FY${filter.financialYear}_`)) continue
      if (filter.quarter && !period.endsWith(`_${filter.quarter}`)) continue
      results.push(p)
    }
  }

  return results.sort()
}

/** Split a list into those already carrying a signature and those still unsigned. */
export function partitionBySignature(pdfPaths: string[]): { signed: string[]; unsigned: string[] } {
  const signed: string[] = []
  const unsigned: string[] = []
  for (const p of pdfPaths) {
    if (isPdfSigned(p)) signed.push(p)
    else unsigned.push(p)
  }
  return { signed, unsigned }
}
