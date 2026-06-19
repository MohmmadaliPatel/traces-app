import fs from "fs"
import path from "path"
import { execSync } from "child_process"
import { parseForm16AFile } from "./form16AParserExact"
import {
  generateForm16APdfBatch,
  closeForm16ABrowser,
  defaultForm16AConcurrency,
} from "./form16APdfGeneratorExact"

export interface GenerateFromZipsParams {
  sourceFolder: string
  companyName: string
  tan: string
  financialYear: string
  quarter: string
  formType: string // "24Q" | "26Q" | ...
  form16Type: "form16" | "form16a"
  logger?: (msg: string) => void
  /** PDFs rendered in parallel within this process (page-pool size). Defaults to CPU-based. */
  pageConcurrency?: number
  /** For multi-process / multi-machine runs: this worker's shard id (0-based). */
  shardIndex?: number
  /** For multi-process / multi-machine runs: total number of shards. Zips are split round-robin. */
  shardCount?: number
  /** Called once per generated PDF (ok=false on failure). Used for live progress aggregation. */
  onPdf?: (ok: boolean) => void
}

export interface GenerateFromZipsResult {
  success: boolean
  processedZips: number
  generatedPdfs: number
  generatedExcel?: string
  outputDir?: string
  errors: string[]
  message: string
}

function log(logger: ((msg: string) => void) | undefined, msg: string) {
  if (logger) logger(msg)
  else console.log(msg)
}

/**
 * Extracts a password-protected TRACES ZIP and returns the .txt content.
 * Tries 7-Zip, unzip, then AdmZip fallback.
 */
async function extractZipToTxt(zipPath: string, password: string, workDir: string, logger?: (m: string) => void): Promise<string> {
  const zipFileName = path.basename(zipPath, path.extname(zipPath))
  const sanitized = zipFileName.replace(/[^a-zA-Z0-9]/g, "_")
  const tempDir = path.join(workDir, sanitized)
  fs.mkdirSync(tempDir, { recursive: true })

  let txtContent = ""
  let extractSuccess = false

  const platform = process.platform

  try {
    if (platform === "win32") {
      const sevenZipCandidates = [
        "C:\\Program Files\\7-Zip\\7z.exe",
        "C:\\Program Files (x86)\\7-Zip\\7z.exe",
        path.join(process.cwd(), "7z", "7z.exe"),
        path.join(process.cwd(), "7z", "7za.exe"),
      ]
      let sevenZipPath: string | null = null
      for (const p of sevenZipCandidates) {
        if (fs.existsSync(p)) {
          sevenZipPath = p
          break
        }
      }
      if (sevenZipPath) {
        const cmd = `"${sevenZipPath}" x -p${password} -y -o"${tempDir}" "${zipPath}"`
        execSync(cmd, { stdio: "pipe" })
        extractSuccess = true
        log(logger, `✓ Extracted using 7-Zip`)
      }
    } else {
      // Unix / mac
      try {
        const cmd = `unzip -P "${password}" -o "${zipPath}" -d "${tempDir}"`
        execSync(cmd, { stdio: "pipe" })
        extractSuccess = true
        log(logger, `✓ Extracted using unzip`)
      } catch (e) {
        log(logger, `unzip failed, will try AdmZip fallback`)
      }
    }
  } catch (e: any) {
    log(logger, `Primary extraction failed: ${e.message}`)
  }

  // Fallback to AdmZip (works for some non-strict password zips or if above failed)
  if (!extractSuccess) {
    try {
      const AdmZip = require("adm-zip")
      const zip = new AdmZip(zipPath)
      zip.extractAllTo(tempDir, true)
      extractSuccess = true
      log(logger, `✓ Extracted using AdmZip (fallback)`)
    } catch (admErr: any) {
      throw new Error(`Failed to extract ZIP: ${admErr.message}`)
    }
  }

  // Find .txt file inside the extracted folder
  const findTxt = (dir: string): string | null => {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        const found = findTxt(full)
        if (found) return found
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
        return full
      }
    }
    return null
  }

  const txtFile = findTxt(tempDir)
  if (!txtFile) {
    // Some zips contain a single .txt at root after extraction
    const files = fs.readdirSync(tempDir).filter((f) => f.toLowerCase().endsWith(".txt"))
    if (files.length > 0 && files[0]) {
      const candidate = path.join(tempDir, files[0])
      txtContent = fs.readFileSync(candidate, "utf8")
    }
  } else {
    txtContent = fs.readFileSync(txtFile, "utf8")
  }

  if (!txtContent || txtContent.trim().length === 0) {
    throw new Error("No .txt content found after extracting the ZIP")
  }

  return txtContent
}

/**
 * Main entry: given a folder of ZIPs, extract + generate PDFs (and Excel sidecar).
 */
export async function generatePdfsFromZipFolder(params: GenerateFromZipsParams): Promise<GenerateFromZipsResult> {
  const {
    sourceFolder,
    companyName,
    tan,
    financialYear,
    quarter,
    formType,
    form16Type,
    logger,
    pageConcurrency,
    shardIndex,
    shardCount,
    onPdf,
  } = params

  const errors: string[] = []
  let processedZips = 0
  let generatedPdfs = 0
  let generatedExcel: string | undefined
  let outputDir: string | undefined

  const logg = (m: string) => log(logger, m)

  try {
    if (!fs.existsSync(sourceFolder)) {
      throw new Error(`Source folder does not exist: ${sourceFolder}`)
    }

    const entries = fs.readdirSync(sourceFolder)
    let zipFiles = entries
      .filter((f) => f.toLowerCase().endsWith(".zip"))
      .map((f) => path.join(sourceFolder, f))
      .sort() // deterministic order so sharding is consistent across processes/machines

    if (zipFiles.length === 0) {
      throw new Error("No .zip files found in the provided folder")
    }

    const totalZipCount = zipFiles.length

    // Optional sharding: when running as one of many worker processes/machines, each
    // worker handles a round-robin slice of the zip files so they never collide.
    if (shardCount && shardCount > 1) {
      const idx = shardIndex ?? 0
      zipFiles = zipFiles.filter((_, i) => i % shardCount === idx)
      logg(`Shard ${idx + 1}/${shardCount}: handling ${zipFiles.length} of ${totalZipCount} zip(s)`)
    } else {
      logg(`Found ${zipFiles.length} zip file(s) in ${sourceFolder}`)
    }

    const password = tan.trim()
    if (!password) {
      throw new Error("TAN (used as ZIP password) is required")
    }

    const sanitizedCompany = companyName.replace(/[/\\?%*:|"<>]/g, "_")
    const finYrShort = financialYear.replace("-", "") // or keep as-is; current code uses "2025-26"

    // Output locations
    const pdfBase = path.join(process.cwd(), "public", "pdf", form16Type === "form16a" ? "form16a" : "form16", sanitizedCompany)
    const periodFolder = `${formType}_FY${financialYear}_${quarter}`
    const finalPdfDir = path.join(pdfBase, periodFolder)
    fs.mkdirSync(finalPdfDir, { recursive: true })
    outputDir = finalPdfDir

    // Also prepare traces_excel style output for the CD/DD data
    const excelDir = path.join(process.cwd(), "public", "pdf", "traces_excel", sanitizedCompany)
    fs.mkdirSync(excelDir, { recursive: true })

    const XLSX = require("xlsx")

    for (const zipPath of zipFiles) {
      processedZips++
      const zipBase = path.basename(zipPath)
      logg(`\n=== Processing ${zipBase} ===`)

      try {
        const workDir = path.join(process.cwd(), "public", "pdf", "temp_extract", sanitizedCompany)
        fs.mkdirSync(workDir, { recursive: true })

        const txtContent = await extractZipToTxt(zipPath, password, workDir, logg)

        // Always create the CD / DD Excel (same as main flow)
        const lines = txtContent.split("\n")
        const cdRows: any[] = []
        const ddRows: any[] = []
        let currentCDData: any = null

        for (const line of lines) {
          const fields = line.split("^")
          if (fields.length > 1 && fields[1] === "CD") {
            currentCDData = {
              "Challan Date": fields[10] && /^\d{8}$/.test(fields[10])
                ? `${fields[10].slice(0,2)}-${fields[10].slice(2,4)}-${fields[10].slice(4)}`
                : fields[10] || "",
              Tax: fields[11] ? fields[11].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              Interest: fields[12] ? fields[12].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              Fee: fields[13] ? fields[13].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              "Other Amount": fields[14] ? fields[14].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              "Total Amount Deposited": fields[16] ? fields[16].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              "Challan No": fields[8] || "",
              BSR: fields[9] || "",
            }
            cdRows.push(currentCDData)
          } else if (fields.length > 1 && fields[1] === "DD") {
            let currentDDData: any = {
              Name: fields[8] || "",
              PAN: fields[7] || "",
              "Amount Paid/Credited": fields[14] ? fields[14].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              "Paid/Credited date": fields[15] && /^\d{8}$/.test(fields[15])
                ? `${fields[15].slice(0,2)}-${fields[15].slice(2,4)}-${fields[15].slice(4)}`
                : fields[15] || "",
              "Deduction Date": fields[16] && /^\d{8}$/.test(fields[16])
                ? `${fields[16].slice(0,2)}-${fields[16].slice(2,4)}-${fields[16].slice(4)}`
                : fields[16] || "",
              "Tax Deducted & Deposited": fields[9] ? fields[9].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              "Deduction Rate": fields[18] ? fields[18].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
              Section: (formType === "27Q" ? fields[22] : fields[21]) || "",
            }
            if (currentCDData) {
              currentDDData["challanDate"] = currentCDData["Challan Date"] || ""
              currentDDData["Tax"] = currentCDData["Tax"] || ""
              currentDDData["Interest"] = currentCDData["Interest"] || ""
              currentDDData["Fee"] = currentCDData["Fee"] || ""
              currentDDData["Other Amount"] = currentCDData["Other Amount"] || ""
              currentDDData["Total Amount Deposited"] = currentCDData["Total Amount Deposited"] || ""
              currentDDData["challanNo"] = currentCDData["Challan No"] || ""
              currentDDData["BSR"] = currentCDData["BSR"] || ""
            }
            ddRows.push(currentDDData)
          }
        }

        // Write per-zip Excel
        const wb = XLSX.utils.book_new()
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(cdRows), "Challan Details")
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(ddRows), "Deductee Details")
        const excelName = `${path.basename(zipPath, ".zip")}.xlsx`
        const excelPath = path.join(excelDir, excelName)
        XLSX.writeFile(wb, excelPath)
        generatedExcel = excelPath
        logg(`✓ Excel written: ${excelPath}`)

        // PDF generation (primarily for form16a using the exact parser)
        if (form16Type === "form16a") {
          try {
            const form16AData = parseForm16AFile(txtContent)
            if (form16AData.length === 0) {
              logg("⚠ No Form 16A records parsed from the file")
            } else {
              const concurrency = pageConcurrency ?? defaultForm16AConcurrency()
              logg(
                `✓ Parsed ${form16AData.length} Form 16A record(s) — generating PDFs (${concurrency} in parallel)`
              )

              const items = form16AData.map((rec) => {
                const pan = rec?.deducteeData?.pan || "UNKNOWN"
                const pdfName = `${pan}_${formType}_${financialYear}_${quarter}.pdf`
                return { outputPath: path.join(finalPdfDir, pdfName), data: rec }
              })

              const batch = await generateForm16APdfBatch(items, {
                concurrency,
                keepBrowserOpen: true, // reuse the browser across all zips in this folder
                onProgress: (doneCount, total, last) => {
                  if (onPdf) onPdf(last.ok)
                  if (doneCount === total || doneCount % 25 === 0) {
                    logg(`  ✓ PDFs ${doneCount}/${total}${last.ok ? "" : " (last failed)"}`)
                  }
                },
              })

              generatedPdfs += batch.success
              if (batch.failed > 0) {
                logg(`  ⚠ ${batch.failed}/${batch.total} PDF(s) failed in ${zipBase}`)
                for (const e of batch.errors.slice(0, 5)) {
                  errors.push(`PDF error (${path.basename(e.outputPath)}): ${e.error}`)
                }
              }
            }
          } catch (pdfErr: any) {
            errors.push(`PDF generation error for ${zipBase}: ${pdfErr.message}`)
            logg(`❌ PDF generation failed: ${pdfErr.message}`)
          }
        } else {
          // form16 (regular) — we have the Excel. Full PDF generation for classic Form 16 not implemented in the exact style yet.
          logg("ℹ Form 16 (non-A) PDF generation not yet wired to the exact generator. Excel + extracted data produced.")
        }

        // Optional: cleanup temp (commented in original too)
        // fs.rmSync(tempDir, { recursive: true, force: true })

      } catch (zipErr: any) {
        const msg = `Failed processing ${zipBase}: ${zipErr.message}`
        errors.push(msg)
        logg(`❌ ${msg}`)
      }
    }

    const success = processedZips > 0 && errors.length < processedZips
    return {
      success,
      processedZips,
      generatedPdfs,
      generatedExcel,
      outputDir,
      errors,
      message: success
        ? `Processed ${processedZips} zip(s). Generated ${generatedPdfs} PDF(s).`
        : `Completed with errors. See details.`,
    }
  } catch (fatal: any) {
    return {
      success: false,
      processedZips,
      generatedPdfs,
      errors: [...errors, fatal.message],
      message: fatal.message,
    }
  } finally {
    // We kept the shared browser open across all zips; close it now that we're done.
    await closeForm16ABrowser()
  }
}
