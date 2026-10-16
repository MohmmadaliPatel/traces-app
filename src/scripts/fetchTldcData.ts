import path from "path"
import fs from "fs"
import db from "db" // Import database to check for existing records
import {
  isRedirectToNewPortal,
  legacyGet,
  openTraces61ApiSession,
  postLegacyServletJson,
  type Traces61ApiSession,
} from "../jobs/traces"
import pdfParse from "pdf-parse"
import { toPublicPath } from "../tldc/pdfPath"

/**
 * Keep a parsed certificate PDF as tldc-downloads/certificates/{certNumber}.pdf.
 * It must leave the download folder itself: new downloads are detected as "new .pdf
 * files in tldc-downloads", so a PDF left there would be mistaken for the next row's.
 */
function keepCertificatePdf(filePath: string, certNumber?: string): string | null {
  const safeCert = (certNumber || "").replace(/[^A-Za-z0-9]/g, "")
  try {
    if (!safeCert) {
      fs.unlinkSync(filePath)
      return null
    }
    const keepDir = path.join(path.dirname(filePath), "certificates")
    fs.mkdirSync(keepDir, { recursive: true })
    const target = path.join(keepDir, `${safeCert.toUpperCase()}.pdf`)
    fs.renameSync(filePath, target)
    return toPublicPath(target)
  } catch (error) {
    console.error(`⚠️ Failed to keep PDF ${filePath}:`, error)
    return null
  }
}

/**
 * Process downloaded PDF files to extract certificate numbers and PAN numbers
 * @param downloadedFiles Array of downloaded PDF files
 * @returns Array of downloaded files with extracted data
 */
export async function processPdfFiles(downloadedFiles: any[]): Promise<any[]> {
  const processedFiles: any[] = []

  for (const file of downloadedFiles) {
    try {
      if (!file.filePath || !fs.existsSync(file.filePath)) {
        processedFiles.push({
          certNumber: file.certNumber,
          din: file.din,
          fy: file.fy,
          pdfPath: null,
        })
        continue
      }
      // Read the PDF file
      const dataBuffer = fs.readFileSync(file.filePath)
      const pdfData = await pdfParse(dataBuffer)

      // Extract text content
      const text = pdfData.text

      // Extract certificate number - match patterns like "Certificate No: XYZABC123"
      const certNumberMatch = text.match(/Certificate\s*No\.\s*:\s*([A-Za-z0-9]+)/i)

      // Extract PAN number - standard 10-character alphanumeric PAN format
      const panNumberMatch =
        text.match(/PAN:?\s*([A-Z]{5}[0-9]{4}[A-Z])/i) ||
        text.match(/PAN\s*:\s*([A-Z]{5}[0-9]{4}[A-Z])/i) ||
        text.match(/Permanent\s*Account\s*Number:?\s*([A-Z]{5}[0-9]{4}[A-Z])/i)

      const certNumber = file.certNumber || (certNumberMatch ? certNumberMatch[1] : undefined)
      const processedFile = {
        certNumber,
        pan: panNumberMatch ? panNumberMatch[1] : undefined,
        din: file.din,
        fy: file.fy,
        pdfPath: keepCertificatePdf(file.filePath, certNumber),
      }
      console.log("PROCESSED FILE", processedFile)
      console.log("CERT NUMBER", processedFile.certNumber)
      console.log("PAN", processedFile.pan)
      console.log("DIN", processedFile.din)
      console.log("FY", processedFile.fy)

      processedFiles.push(processedFile)
    } catch (error) {
      console.error(`❌ Error processing PDF file ${file.fileName}:`, error)
      // Keep the original file data if processing fails; the inbox row still gives the cert number
      processedFiles.push({
        certNumber: file.certNumber,
        din: file.din,
        fy: file.fy,
        pdfPath: file.filePath ? keepCertificatePdf(file.filePath, file.certNumber) : null,
      })
    }
  }

  return processedFiles
}

/**
 * Check if a TLDC record with the given DIN and FY already exists in the database
 */
async function checkRecordExists(
  rowCertNumber: string,
  fy: string,
  companyId?: number
): Promise<boolean> {
  try {
    const where: any = {
      certNumber: rowCertNumber,
      fy: fy,
    }
    if (companyId) {
      where.companyId = companyId
    }
    const existingRecord = await db.tldcData.findFirst({
      where: where,
    })
    return !!existingRecord
  } catch (error) {
    console.error(`❌ Error checking database for Cert Number ${rowCertNumber}:`, error)
    return false
  }
}

/**
 * TLDC inbox row from CommInboxServlet (category 42 = Certificate U/S 197,206C).
 */
type InboxRow = {
  commRefNo?: string
  date?: string
  commcat?: string
  description?: string
  finYear?: string
  quarter?: string
  formType?: string
  commInbId?: string
  commMstrId?: string
  category?: string
  comcatid?: string
  hidFY?: string
  hidQT?: string
  certNum?: string
}

/**
 * Fetch TLDC Data for a specific TAN and year — API-only (no Puppeteer).
 *
 *   POST CommInboxServlet?reqtype=1&sdate=&edate=&category=42&finYear=&quarter=&commClassify=1
 *   → certificate inbox rows; each row's PDF is a plain GET:
 *   GET CommInboxServlet?commId=<commRefNo>&finYear=<hidFY>&formType=<formType>&reqtype=5
 *       &certNum=<certNum>&description=<description>
 */
export async function fetchTldcData({
  tan,
  year,
  credentials = { userId: "", password: "", tan: "" },
  companyId,
}: {
  tan: string
  year: string
  credentials: { userId: string; password: string; tan: string }
  companyId?: number
}): Promise<{ data: any; cached?: boolean }> {
  console.log("⏳ Fetching TLDC data via API for:", tan, year)

  const downloadDir = path.resolve(`./public/pdf/tldc-downloads`)
  fs.mkdirSync(downloadDir, { recursive: true })

  const allDownloads: any[] = []
  let currentPage = 1

  let session: Traces61ApiSession | undefined
  try {
    session = await openTraces61ApiSession(credentials)

    // --- list the certificate inbox (category 42 = Certificate U/S 197,206C) ---
    const inboxRows: InboxRow[] = []
    let totalpages = 1
    for (;;) {
      const data = await postLegacyServletJson(
        session,
        `app/ded/srv/CommInboxServlet?reqtype=1&sdate=&edate=&category=42&finYear=&quarter=&commClassify=1`,
        { body: `_search=false&nd=${Date.now()}&rows=100&page=${currentPage}&sidx=&sord=asc` }
      )
      const rows: InboxRow[] = Array.isArray(data?.rows) ? data.rows : []
      inboxRows.push(...rows)
      totalpages = Number(data?.totalpages) || 1
      if (currentPage >= totalpages || rows.length === 0) break
      currentPage++
    }

    console.log(`📥 Inbox: ${inboxRows.length} certificate communication row(s)`)

    // --- filter to certificate rows for the requested year ---
    const yearStart = String(year).split("-")[0]
    const matchesYear = (fy?: string) =>
      Boolean(fy) && (fy === year || (yearStart ? String(fy).startsWith(yearStart) : false))
    const certificateRows = inboxRows.filter((row) => {
      const desc = `${row.description ?? ""} ${row.category ?? ""} ${row.commcat ?? ""}`
      const isCert =
        desc.toLowerCase().includes("certificate") &&
        (desc.includes("197") || desc.includes("206C"))
      return Boolean(row.certNum) && isCert && (matchesYear(row.finYear) || matchesYear(row.hidFY))
    })

    console.log(`📄 ${certificateRows.length} certificate row(s) match FY ${year}`)

    for (const row of certificateRows) {
      const rowDin = row.commRefNo ?? ""
      const rowCertNumber = row.certNum ?? ""
      // Stored as TldcData.fy and used for de-duplication. The Puppeteer version kept only
      // rows whose FY text equalled `year`, so every stored row carried `year` itself —
      // keep that, whatever format the grid JSON uses (hidFY may be "2025" vs "2025-26").
      const rowFy = year
      // The certificate download link uses the portal's own FY value.
      const portalFy = row.hidFY ?? row.finYear ?? year

      if (!rowDin || !rowCertNumber) {
        console.log(`⚠️ Missing required data for inbox row, skipping...`)
        continue
      }

      const recordExists = await checkRecordExists(rowCertNumber, rowFy, companyId)
      console.log("Record Exists", rowDin, recordExists)

      if (recordExists) {
        allDownloads.push({
          fileName: `skipped_${rowDin}_${rowCertNumber}.pdf`,
          filePath: "",
          din: rowDin,
          certNumber: rowCertNumber,
          fy: rowFy,
        })
        continue
      }

      try {
        // Certificate PDF — plain GET (the page opens this URL in a new tab).
        const pdfUrl =
          `app/ded/srv/CommInboxServlet?commId=${encodeURIComponent(
            rowDin
          )}&finYear=${encodeURIComponent(portalFy)}&formType=${encodeURIComponent(
            row.formType ?? ""
          )}&reqtype=5&certNum=${encodeURIComponent(rowCertNumber)}&description=${encodeURIComponent(
            row.description ?? ""
          )}`
        // legacyGet does not follow a redirect to the new portal, so an expired session
        // shows up as a 302 here instead of an HTML page saved as the certificate.
        const res = await legacyGet(session, pdfUrl, { responseType: "arraybuffer", timeout: 120000 })
        if (res.status !== 200) {
          throw new Error(
            isRedirectToNewPortal(res.headers["location"])
              ? `TRACES session expired while downloading certificate PDF for ${rowCertNumber}`
              : `HTTP ${res.status} downloading certificate PDF for ${rowCertNumber}`
          )
        }
        const pdfBuffer = Buffer.from(res.data ?? [])
        if (!pdfBuffer.subarray(0, 1024).includes("%PDF-")) {
          throw new Error(
            `Certificate download for ${rowCertNumber} is not a PDF (${String(
              res.headers["content-type"] ?? "unknown type"
            )}, ${pdfBuffer.length} bytes): ${pdfBuffer.subarray(0, 120).toString("utf8")}`
          )
        }
        const pdfPath = path.join(downloadDir, `${rowCertNumber}.pdf`)
        fs.writeFileSync(pdfPath, pdfBuffer)
        allDownloads.push({
          fileName: `${rowCertNumber}.pdf`,
          filePath: pdfPath,
          din: rowDin,
          certNumber: rowCertNumber,
          fy: rowFy,
        })
      } catch (error) {
        console.error(`❌ Error downloading certificate ${rowCertNumber}:`, error)
      }
    }

    console.log(`🎉 Total certificates downloaded: ${allDownloads.length}`)

    const processedDownloads = await processPdfFiles(allDownloads)

    return {
      data: {
        success: true,
        totalDownloaded: processedDownloads.length,
        totalPages: currentPage,
        extractedData: processedDownloads,
      },
    }
  } catch (error) {
    console.error("❌ Error fetching TLDC data:", error)

    if (allDownloads.length > 0) {
      try {
        const processedDownloads = await processPdfFiles(allDownloads)
        return {
          data: {
            success: true,
            partialDownload: true,
            errorMessage: error instanceof Error ? error.message : String(error),
            totalDownloaded: processedDownloads.length,
            totalPages: currentPage,
            extractedData: processedDownloads,
          },
        }
      } catch (processingError) {
        console.error("❌ Error processing PDFs:", processingError)
        return {
          data: {
            success: true,
            partialDownload: true,
            errorMessage: error instanceof Error ? error.message : String(error),
            processingError:
              processingError instanceof Error ? processingError.message : String(processingError),
            totalDownloaded: allDownloads.length,
            totalPages: currentPage,
            downloadedFiles: allDownloads.map((d) => ({
              fileName: d.fileName,
              din: d.din,
              certNumber: d.certNumber,
              fy: d.fy,
              deleted: true,
            })),
          },
        }
      }
    }

    throw error
  } finally {
    await session?.close()
  }
}
