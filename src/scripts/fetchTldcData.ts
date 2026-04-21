import puppeteer, { Page } from "puppeteer"
import path from "path"
import fs from "fs"
import os from "os"
import db from "db" // Import database to check for existing records
import { loginWithTracesApiAndPreauth, traces61DedUrl } from "../jobs/traces"
import pdfParse from "pdf-parse"

// Utility function to wait for a specified time
const waitForSecs = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

// In-memory cache

let globalPage: Page | null = null

/**
 * Login to the TDSCPC portal
 * @returns {Promise<Page>} The authenticated Puppeteer page
 */
async function loginToTdsPortal(credentials: {
  userId: string
  password: string
  tan: string
}): Promise<Page> {
  if (globalPage) {
    console.log("🔐 Already logged in.")
    return globalPage
  }

  const browser = await puppeteer.launch({
    headless: false,
    defaultViewport: null,
    args: [
      "--start-maximized",
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--allow-file-access-from-files",
    ],
    // This should be configurable based on environment
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : undefined, // Use default for Linux
  })

  const page = await browser.newPage()

  // Set extra permissions for downloads
  const downloadClient = await page.target().createCDPSession()
  await downloadClient.send("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: path.join(os.tmpdir(), "tldc-downloads"),
    eventsEnabled: true,
  })

  await loginWithTracesApiAndPreauth(page, {
    userId: credentials.userId,
    password: credentials.password,
    tan: credentials.tan,
  })
  globalPage = page
  return globalPage
}

interface CertificateRow {
  index: number
  text: (string | undefined)[]
  din?: string
  date?: string
  certNumber?: string
  fy?: string
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
      // Read the PDF file
      const dataBuffer = fs.readFileSync(file.filePath)
      const pdfData = await pdfParse(dataBuffer)

      // Extract text content
      const text = pdfData.text

      // Extract certificate number - match patterns like "Certificate No: XYZABC123"
      const certNumberMatch =
        // text.match(/Certificate\s*No\.?:?\s*([A-Za-z0-9]+)/i) ||
        // text.match(/Certificate\s*Number:?\s*([A-Za-z0-9]+)/i) ||
        text.match(/Certificate\s*No\.\s*:\s*([A-Za-z0-9]+)/i)

      // Extract PAN number - standard 10-character alphanumeric PAN format
      const panNumberMatch =
        text.match(/PAN:?\s*([A-Z]{5}[0-9]{4}[A-Z])/i) ||
        text.match(/PAN\s*:\s*([A-Z]{5}[0-9]{4}[A-Z])/i) ||
        text.match(/Permanent\s*Account\s*Number:?\s*([A-Z]{5}[0-9]{4}[A-Z])/i)

      // Create a copy of the file object with the extracted data
      const processedFile = {
        certNumber: file.certNumber || (certNumberMatch ? certNumberMatch[1] : undefined),
        pan: panNumberMatch ? panNumberMatch[1] : undefined,
        din: file.din,
        fy: file.fy,
      }
      console.log("PROCESSED FILE", processedFile)
      console.log("CERT NUMBER", processedFile.certNumber)
      console.log("PAN", processedFile.pan)
      console.log("DIN", processedFile.din)
      console.log("FY", processedFile.fy)

      processedFiles.push(processedFile)

      // Delete the file after extracting data
      try {
        fs.unlinkSync(file.filePath)
      } catch (deleteError) {
        console.error(`⚠️ Failed to delete file ${file.filePath}:`, deleteError)
      }
    } catch (error) {
      console.error(`❌ Error processing PDF file ${file.fileName}:`, error)
      // Keep the original file data if processing fails
      processedFiles.push({
        certNumber: file.certNumber,
        din: file.din,
        fy: file.fy,
      })

      // Try to delete the file even if processing failed
      try {
        fs.unlinkSync(file.filePath)
      } catch (deleteError) {
        console.error(`⚠️ Failed to delete file ${file.filePath}:`, deleteError)
      }
    }
  }

  return processedFiles
}

/**
 * Check if a TLDC record with the given DIN and FY already exists in the database
 * @param rowCertNumber The Cert Number to check
 * @param fy The financial year
 * @param companyId The company ID
 * @returns Promise<boolean> True if record exists, false otherwise
 */
async function checkRecordExists(
  rowCertNumber: string,
  fy: string,
  companyId?: number
): Promise<boolean> {
  try {
    // Define where clause for database query
    const where: any = {
      certNumber: rowCertNumber,
      fy: fy,
    }

    // Add companyId to where clause if provided
    if (companyId) {
      where.companyId = companyId
    }

    // Check if record exists
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
 * Fetch TLDC Data for a specific TAN and year
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
  console.log("⏳ Launching Puppeteer for:", tan, year)

  // Create a download directory - use absolute path in temp directory
  const downloadDir = path.resolve(`./public/pdf/tldc-downloads`)
  fs.mkdirSync(downloadDir, { recursive: true })

  // Track all downloaded files
  const allDownloads: any[] = []
  let currentPage = 1
  let hasMorePages = true
  let certificateTableData = null

  // Counter for consecutive empty pages
  let emptyPagesCount = 0
  const MAX_EMPTY_PAGES = 3

  try {
    const page = await loginToTdsPortal(credentials)

    // Configure download behavior
    const client = await page.target().createCDPSession()
    await client.send("Page.setDownloadBehavior", {
      behavior: "allow",
      downloadPath: downloadDir,
    })

    // Process each page of results
    while (hasMorePages) {
      // Navigate to the DED inbox page (only needed for the first page)
      if (currentPage === 1) {
        await page.goto(traces61DedUrl("dedinbox.xhtml"), {
          waitUntil: "networkidle2",
        })

        // Wait for category dropdown and select Certificate
        await page.waitForSelector("#commCategory", { visible: true, timeout: 10000 })
        await page.select("#commCategory", "42") // 42 is Certificate

        // Click on go button
        await page.waitForSelector("#go", { visible: true, timeout: 10000 })
        await page.click("#go")
      }

      // Wait for the table to load
      await page.waitForSelector("table#viewcorrdettab", { visible: true, timeout: 30000 })
      await page.waitForSelector("table#viewcorrdettab tbody tr", { visible: true, timeout: 30000 })

      // Find all certificate rows using a robust selector
      // Wait for the table to fully load and ensure rows are present
      await waitForSecs(3000) // Add extra wait time to ensure DOM is fully loaded

      // Get the year value to pass into the evaluate function
      const certificateRows: CertificateRow[] = await page.evaluate((yearValue) => {
        const rows: any = Array.from(document.querySelectorAll("table#viewcorrdettab tbody tr"))
        const results: Array<{
          index: number
          text: (string | undefined)[]
          din?: string
          date?: string
          certNumber?: string
          fy?: string
        }> = []

        console.log("ROWS", rows)

        for (let i = 0; i < rows.length; i++) {
          const cells = Array.from(rows[i].querySelectorAll("td"))
          const cellText = cells.map((cell: any) => cell.textContent?.trim())
          console.log("Cell Text", cellText, "Year Value", yearValue)

          // Look for certificate text in any column (usually the 3rd)
          const hasCertificate = cellText.some(
            (text) =>
              text &&
              text.includes("Certificate") &&
              (text.includes("197") || text.includes("206C"))
          )

          // Check if the row contains the specified year
          const checkFy = cellText.some((text) => {
            return text && text.includes(yearValue)
          })

          console.log("Has Certificate", hasCertificate)
          console.log("Check FY", checkFy)

          if (hasCertificate && checkFy) {
            // Extract DIN (first element) and certificate number (last element)
            const din = cellText[0]
            const date = cellText[1]
            const certNumber = cellText[cellText.length - 1]
            // Extract FY (4th from the end, or -4 index)
            const fy = cellText[cellText.length - 3]
            console.log("fy", fy)
            console.log("yearValue", yearValue)
            if (fy == yearValue) {
              results.push({
                index: i,
                text: cellText,
                din,
                date,
                certNumber,
                fy,
              })
            }
          }
        }
        return results
      }, year) // Pass the year variable to the evaluate function

      console.log(`📄 Page ${currentPage}: Found ${certificateRows.length} certificate rows`)

      // Check if the current page has any certificate rows
      if (certificateRows.length === 0) {
        // Increment empty pages counter if no rows found
        emptyPagesCount++
        console.log(`⚠️ Empty page detected (${emptyPagesCount}/${MAX_EMPTY_PAGES})`)

        // Stop pagination if we've hit our limit of consecutive empty pages
        if (emptyPagesCount >= MAX_EMPTY_PAGES) {
          console.log(`🛑 Stopping pagination after ${MAX_EMPTY_PAGES} consecutive empty pages`)
          hasMorePages = false
          continue
        }
      } else {
        // Reset empty pages counter if rows found
        emptyPagesCount = 0
      }

      // Process each certificate row in this page
      for (let idx = 0; idx < certificateRows.length; idx++) {
        const rowIndex = certificateRows[idx]?.index
        const rowDin = certificateRows[idx]?.din
        const rowCertNumber = certificateRows[idx]?.certNumber
        const rowFy = certificateRows[idx]?.fy
        const rowDate = certificateRows[idx]?.date

        console.log("ROW INDEX", rowIndex)
        console.log("ROW DIN", rowDin)
        console.log("ROW CERT NUMBER", rowCertNumber)
        console.log("ROW FY", rowFy)
        console.log("ROW DATE", rowDate)

        if (rowIndex === undefined || !rowDin || !rowCertNumber) {
          console.log(`⚠️ Missing required data for row ${idx}, skipping...`)
          continue
        }
        // Check if record with this DIN already exists in the database for the given financial year
        const recordExists = await checkRecordExists(rowCertNumber, rowFy || year, companyId)
        console.log("Record Exists", rowDin)

        if (recordExists) {
          // Add to downloads without actually downloading (for tracking)
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
          // Click on the row to select it
          await page.evaluate((idx: number) => {
            const rows = document.querySelectorAll("table#viewcorrdettab tbody tr")
            const row = rows[idx]
            if (row) {
              const cell = row.querySelector("td")
              if (cell) cell.click()
            }
          }, rowIndex)

          // Wait for the row to be selected
          await waitForSecs(2000)

          // Get detailed info about this certificate
          const certInfo = await page.evaluate(() => {
            const detailsElements = document.querySelectorAll(".datacell")
            const details: Record<string, string> = {}

            detailsElements.forEach((elem) => {
              const label = elem.querySelector(".dataLabel")?.textContent?.trim()
              const value = elem.querySelector(".dataValue")?.textContent?.trim()
              if (label && value) {
                details[label.replace(":", "")] = value
              }
            })

            return details
          })

          // Wait for the download button to be available and click it
          await page.waitForSelector("#dwnldBtn", { visible: true, timeout: 10000 })
          await page.click("#dwnldBtn")

          // Wait for download to start and finish - increase timeout
          await waitForSecs(10000) // Increase from 5000 to 10000 ms

          // Check for new PDF files
          const beforeFiles = new Set(allDownloads.map((d) => d.fileName))
          const files = fs.readdirSync(downloadDir)
          const pdfFiles = files.filter(
            (file) => file.toLowerCase().endsWith(".pdf") && !beforeFiles.has(file)
          )

          if (pdfFiles.length === 0) {
            console.log("⚠️ No new PDF file was downloaded for this row")
          } else {
            // Process each newly downloaded PDF
            for (const pdfFile of pdfFiles) {
              const pdfPath = path.join(downloadDir, pdfFile)

              allDownloads.push({
                fileName: pdfFile,
                filePath: pdfPath,
                din: rowDin,
                certNumber: rowCertNumber,
                fy: rowFy,
              })
            }
          }
        } catch (error) {
          console.error(`❌ Error processing row ${rowIndex}:`, error)
          // Continue with next row even if this one fails
        }
      }

      // Check if there's a next page
      const hasNextPage = await page.evaluate(() => {
        const nextButton = document.querySelector("#next_pagernav1")
        return nextButton !== null && !nextButton.classList.contains("ui-state-disabled")
      })

      if (hasNextPage) {
        console.log(`✅ Moving to page ${currentPage + 1}`)
        await page.click("#next_pagernav1")
        // Wait for the new page to load
        await waitForSecs(3000)
        currentPage++
      } else {
        console.log("🏁 Reached the last page")
        hasMorePages = false
      }
    }

    console.log(`🎉 Total certificates downloaded: ${allDownloads.length}`)

    // Process downloaded PDFs to extract certificate numbers and PAN numbers
    const processedDownloads = await processPdfFiles(allDownloads)

    await page.close()
    globalPage = null

    // Return information about the downloaded certificates with extracted data
    return {
      data: {
        success: true,
        totalDownloaded: processedDownloads.length,
        totalPages: currentPage,
        extractedData: processedDownloads,
      },
    }
  } catch (error) {
    globalPage = null // Reset global page on error
    console.error("❌ Error fetching TLDC data:", error)

    // Try to process any PDFs that were downloaded before the error
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

        // Fall back to returning unprocessed downloads
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
  }
}

function delay(time) {
  return new Promise(function (resolve) {
    setTimeout(resolve, time)
  })
}
