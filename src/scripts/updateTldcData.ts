import puppeteer, { Page } from "puppeteer"
import path from "path"
import fs from "fs"
import os from "os"
import { loginWithTracesApiAndPreauth, traces61DedUrl } from "../jobs/traces"

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
  const downloadPath = path.resolve(`./public/pdf/tldc-downloads`)
  const downloadClient = await page.createCDPSession()
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }
  await downloadClient.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath,
  })

  await loginWithTracesApiAndPreauth(page, {
    userId: credentials.userId,
    password: credentials.password,
    tan: credentials.tan,
  })
  globalPage = page
  return globalPage
}

/**
 * Fetch TLDC Data for a specific TAN, year and quarter
 * @param {Object} params - The parameters
 * @param {string} params.tan - The TAN number
 * @param {string} params.year - The financial year
 * @param {string} params.quarter - The quarter
 * @param {Object} params.credentials - The login credentials
 * @returns {Promise<any>} The fetched TLDC data
 */
export async function updateTldcData({
  year,
  tldcData,
  credentials = { userId: "", password: "", tan: "" }, // Should be provided by the caller
}: {
  year: string
  tldcData: any[]
  credentials: { userId: string; password: string; tan: string }
}): Promise<{ data: any; cached?: boolean }> {
  console.log("⏳ No cache. Launching Puppeteer for:", year)

  try {
    const page = await loginToTdsPortal(credentials)
    const processedData: any[] = []

    console.log("tldcData to update:", tldcData)

    if (!tldcData || tldcData.length === 0) {
      console.log("⚠️ No TLDC data to update")
      return { data: [] }
    }

    // Navigate to the certificate verification page
    await page.goto(traces61DedUrl("197certiverfication.xhtml"), {
      waitUntil: "networkidle2",
    })
    console.log("✅ Navigated to certificate verification page")

    // Process each TLDC record
    for (const tldc of tldcData) {
      console.log(`🔍 Processing certificate: ${tldc.certNumber}, PAN: ${tldc.pan}`)

      try {
        // Clear any existing values first
        await page.evaluate(() => {
          const panInput = document.querySelector("#deducteePan") as HTMLInputElement
          const certInput = document.querySelector("#certiNo") as HTMLInputElement
          if (panInput) panInput.value = ""
          if (certInput) certInput.value = ""
        })

        // Type the values
        await page.waitForSelector("#deducteePan", { visible: true, timeout: 5000 })
        await page.type("#deducteePan", tldc.pan)
        console.log(`✅ Entered PAN: ${tldc.pan}`)

        await page.waitForSelector("#financialYear", { visible: true, timeout: 5000 })
        await page.select("#financialYear", year.split("-")[0] || "")
        console.log(`✅ Selected financial year: ${year}`)

        await page.waitForSelector("#certiNo", { visible: true, timeout: 5000 })
        await page.type("#certiNo", tldc.certNumber)
        console.log(`✅ Entered certificate number: ${tldc.certNumber}`)

        // Click the Go button
        await page.waitForSelector("#clickGo", { visible: true, timeout: 5000 })
        await page.click("#clickGo")
        console.log("✅ Clicked Go button")

        // Wait longer for the table to load
        await waitForSecs(5000)

        // Check if the table exists
        const tableExists = await page.evaluate(() => {
          const table = document.getElementById("certiVerifyTab")
          return !!table
        })

        if (!tableExists) {
          console.log("⚠️ Table #certiVerifyTab not found, checking for error messages")

          // Check for error messages
          const errorMessage = await page.evaluate(() => {
            const errorElements = document.querySelectorAll(
              ".ui-messages-error, .ui-message-error, .error"
            )
            return Array.from(errorElements)
              .map((el) => el.textContent?.trim())
              .join(" ")
          })

          if (errorMessage) {
            console.log(`❌ Error message found: ${errorMessage}`)

            // Add error info to the data
            processedData.push({
              certNumber: tldc.certNumber,
              pan: tldc.pan,
              error: errorMessage || "Table not found",
            })

            // Continue with next certificate
            continue
          }
        }

        // Try multiple approaches to extract the table data
        const tableData = await page.evaluate(() => {
          // First try with getElementById
          let table = document.getElementById("certiVerifyTab")

          // If that fails, try querySelector
          if (!table) {
            table = document.querySelector("table#certiVerifyTab") as HTMLTableElement
          }

          // If still no table, try a broader selector
          if (!table) {
            table = document.querySelector('table[role="grid"]') as HTMLTableElement
          }

          console.log("Table found:", !!table)

          if (!table) {
            // Log all table elements for debugging
            const allTables = document.querySelectorAll("table")
            console.log(`Found ${allTables.length} tables on page`)

            // Try to get the first table as a fallback
            if (allTables.length > 0) {
              table = allTables[0] as HTMLTableElement
              console.log("Using first table as fallback")
            } else {
              return null
            }
          }

          // Get table rows
          const rows = Array.from(table.querySelectorAll("tbody tr")).filter(
            (row) => !row.classList.contains("jqgfirstrow")
          )

          console.log(`Found ${rows.length} data rows in table`)

          if (rows.length === 0) {
            return null
          }

          // Process all rows (should typically be just one)
          return rows.map((row) => {
            const cells = Array.from(row.querySelectorAll("td"))
            console.log(`Row has ${cells.length} cells`)

            // Try two approaches to get cell content
            const getCellContent = (cell: Element, index: number) => {
              // First try title attribute as it's often more reliable
              const titleAttr = cell.getAttribute("title")
              if (titleAttr && titleAttr.trim() !== "") {
                return titleAttr.trim()
              }

              // Fallback to text content
              return cell.textContent?.trim() || ""
            }

            // Build the data object
            const rowData: Record<string, string> = {}

            // Map columns by position - be flexible about minimum cells
            if (cells.length >= 1 && cells[0]) rowData.serialNo = getCellContent(cells[0], 0)
            if (cells.length >= 2 && cells[1]) rowData.certNumber = getCellContent(cells[1], 1)
            if (cells.length >= 3 && cells[2]) rowData.fy = getCellContent(cells[2], 2)
            if (cells.length >= 4 && cells[3]) rowData.pan = getCellContent(cells[3], 3)
            if (cells.length >= 5 && cells[4]) rowData.panName = getCellContent(cells[4], 4)
            if (cells.length >= 6 && cells[5]) rowData.validFrom = getCellContent(cells[5], 5)
            if (cells.length >= 7 && cells[6]) rowData.cancelDate = getCellContent(cells[6], 6)
            if (cells.length >= 8 && cells[7]) rowData.validTo = getCellContent(cells[7], 7)
            if (cells.length >= 9 && cells[8]) rowData.section = getCellContent(cells[8], 8)
            if (cells.length >= 10 && cells[9])
              rowData.NatureOfPayment = getCellContent(cells[9], 9)
            if (cells.length >= 11 && cells[10]) rowData.tdsRate = getCellContent(cells[10], 10)
            if (cells.length >= 12 && cells[11])
              rowData.tdsAmountLimit = getCellContent(cells[11], 11)
            if (cells.length >= 13 && cells[12])
              rowData.tdsAmountConsumed = getCellContent(cells[12], 12)
            if (cells.length >= 14 && cells[13]) rowData.issueDate = getCellContent(cells[13], 13)

            // Include HTML of the row for debugging if needed
            rowData._rowHtml = row.outerHTML

            return rowData
          })
        })

        if (!tableData || tableData.length === 0) {
          console.log(`⚠️ No data found in table for certificate ${tldc.certNumber}`)

          // Add the original data with empty values
          processedData.push({
            certNumber: tldc.certNumber,
            pan: tldc.pan,
            error: "No data found in certificate verification table",
          })
        } else {
          console.log(
            `✅ Successfully extracted data for certificate ${tldc.certNumber}:`,
            tableData
          )

          // Add the extracted data to our results
          for (const data of tableData) {
            processedData.push(data)
          }
        }
      } catch (certError) {
        console.error(`❌ Error processing certificate ${tldc.certNumber}:`, certError)

        // Add error info to the data
        processedData.push({
          certNumber: tldc.certNumber,
          pan: tldc.pan,
          error: certError instanceof Error ? certError.message : String(certError),
        })
      }

      // Wait between requests to avoid overloading the server
      await waitForSecs(2000)
    }

    console.log(`✅ Processing complete. Found data for ${processedData.length} certificates`)

    return { data: processedData }
  } catch (error) {
    globalPage = null // Reset global page on error
    console.error("❌ Error in updateTldcData:", error)
    throw error
  }
}
