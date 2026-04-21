import { AxiosInstance } from "axios"
import { Company } from "@prisma/client"
import db from "db"
import { getAxiostClient } from "./helper"
import { waitForSecs } from "src/utils/promises"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import * as fs from "fs"
import * as path from "path"
import * as XLSX from "xlsx"
import pdfParse from "pdf-parse"
import { loginWithTracesApiAndPreauth, traces61DedUrl } from "./traces"
puppeteer.use(StealthPlugin())

export default class NoticeDownloaderChallanStatus {
  axiosClient: AxiosInstance

  constructor(
    private company: Company,
    private logger: { log: (msg: string) => void },
    private taskId: number
  ) {
    this.axiosClient = getAxiostClient()
  }

  get Pan() {
    return this.company.tan.toUpperCase()
  }

  async addMessageToTask(msg: string) {
    const task = await db.task.findUnique({
      where: { id: this.taskId },
      select: { message: true },
    })

    if (task?.message?.includes(msg)) {
      return // Skip if message already exists
    }

    const updatedMessage = task?.message ? `${task.message}\n${msg}` : msg

    return db.task.update({
      where: { id: this.taskId },
      data: {
        message: { set: updatedMessage },
      },
    })
  }

  /**
   * Find all text files in company folder across all quarters and form types
   * and extract challan details from them
   */
  async getAllChallanDetailsForCompany(): Promise<any[]> {
    try {
      this.logger.log(`Searching for all challan details for ${this.company.name}`)

      const baseFolder = path.join(process.cwd(), "public", "pdf", "data", "2025-26")
      const allChallanDetails: any[] = []

      // Find company folder
      const companyFolder = this.findMatchingCompanyFolder(this.company.name, baseFolder)

      if (!companyFolder) {
        this.logger.log(`❌ Company folder not found for: ${this.company.name}`)
        return []
      }

      this.logger.log(`Found company folder: ${companyFolder}`)

      // Recursively find all .txt files
      const txtFiles = this.findTxtFilesRecursively(companyFolder)

      if (txtFiles.length === 0) {
        this.logger.log(`No txt files found in ${companyFolder}`)
        return []
      }

      this.logger.log(`Found ${txtFiles.length} txt files for ${this.company.name}`)

      // Process each txt file
      for (const txtFilePath of txtFiles) {
        try {
          this.logger.log(`Processing: ${txtFilePath}`)

          const txtContent = fs.readFileSync(txtFilePath, "utf8")

          // Parse the txt file to extract challan details
          const challans = this.parseTxtFileForChallans(txtContent)

          if (challans.length > 0) {
            this.logger.log(`✓ Found ${challans.length} challans in ${txtFilePath}`)
            allChallanDetails.push(...challans)
          }
        } catch (error) {
          this.logger.log(`Error processing txt file ${txtFilePath}: ${error.message}`)
        }
      }

      this.logger.log(`\n✓ Total challan details found: ${allChallanDetails.length}`)

      // Save challan details to JSON file
      const outputPath = path.join(companyFolder, "challan_details.json")
      const challanData = {
        companyName: this.company.name,
        tan: this.company.tan,
        userId: this.company.user_id,
        password: this.company.password,
        challanDetails: allChallanDetails.map((challan) => ({
          bsr: challan.bsr || "",
          date: challan.dtoftaxdep || "",
          csn: challan.csn || "",
          challanAmount: challan.chlnamt || "",
        })),
      }

      fs.writeFileSync(outputPath, JSON.stringify(challanData, null, 2), "utf8")
      this.logger.log(`✓ Saved challan details to ${outputPath}`)

      return challanData.challanDetails
    } catch (error) {
      this.logger.log(`Error in getAllChallanDetailsForCompany: ${error.message}`)
      throw error
    }
  }

  /**
   * Extract challan details from PDFs in the challan management download path:
   * public/pdf/challans/<CompanyName>/PaymentHistory/*.pdf
   * Returns the same shape as getAllChallanDetailsForCompany() so the rest of
   * the flow works unchanged.
   */
  async getAllChallanDetailsFromPaymentPdfs(): Promise<any[]> {
    try {
      this.logger.log(`Looking for challan PDFs for ${this.company.name}`)

      const challansBase = path.join(process.cwd(), "public", "pdf", "challans")
      const companyFolder = this.findMatchingCompanyFolder(this.company.name, challansBase)

      if (!companyFolder) {
        this.logger.log(`No challan management folder found for ${this.company.name}`)
        return []
      }

      // Prefer the PaymentHistory subfolder; fall back to the company root
      const paymentHistoryFolder = path.join(companyFolder, "PaymentHistory")
      const searchFolder = fs.existsSync(paymentHistoryFolder) ? paymentHistoryFolder : companyFolder

      const pdfFiles = fs
        .readdirSync(searchFolder)
        .filter((f) => f.toLowerCase().endsWith(".pdf"))
        .map((f) => path.join(searchFolder, f))

      if (pdfFiles.length === 0) {
        this.logger.log(`No PDF files found in ${searchFolder}`)
        return []
      }

      this.logger.log(`Found ${pdfFiles.length} challan PDF(s) in ${searchFolder}`)

      // Reusable field extractor matching the pattern used in downloadChallanPayment.ts
      const extractField = (label: string, text: string): string => {
        const regex = new RegExp(`${label}\\s*[:]?\\s*([^\\n]+)`, "i")
        const match = text.match(regex)
        return match && match[1] ? match[1].trim() : ""
      }

      const challanDetails: any[] = []

      for (const pdfPath of pdfFiles) {
        try {
          this.logger.log(`Parsing: ${path.basename(pdfPath)}`)
          const dataBuffer = fs.readFileSync(pdfPath)
          const pdfData = await pdfParse(dataBuffer)
          const text = pdfData.text

          const bsr = extractField("BSR code", text)
          const csn = extractField("Challan No", text)
          // Date is already "DD-MMM-YYYY" (e.g. "04-Dec-2025").
          // formatDate() returns the string unchanged when it is not 8 chars,
          // so we can store it as-is and it will be typed directly into the portal.
          const date = extractField("Date of Deposit", text)
          const amountRaw =
            extractField("Amount \\(in Rs\\.\\)", text) || extractField("Amount", text)
          const challanAmount = parseFloat(amountRaw.replace(/[₹,\s]/g, "")) || 0

          if (bsr && csn && date && challanAmount) {
            challanDetails.push({ bsr, date, csn, challanAmount })
            this.logger.log(
              `  ✓ BSR=${bsr}  CSN=${csn}  Date=${date}  Amount=${challanAmount}`
            )
          } else {
            this.logger.log(
              `  ⚠ Skipped ${path.basename(pdfPath)} – missing fields ` +
                `(bsr=${bsr}, csn=${csn}, date=${date}, amount=${challanAmount})`
            )
          }
        } catch (err: any) {
          this.logger.log(`  ✗ Error parsing ${path.basename(pdfPath)}: ${err.message}`)
        }
      }

      this.logger.log(`Total challan details from PDFs: ${challanDetails.length}`)
      return challanDetails
    } catch (error: any) {
      this.logger.log(`Error in getAllChallanDetailsFromPaymentPdfs: ${error.message}`)
      return []
    }
  }

  /**
   * Recursively find all .txt files in a directory
   */
  findTxtFilesRecursively(dirPath: string): string[] {
    const txtFiles: string[] = []

    function scanDirectory(currentPath: string) {
      try {
        const items = fs.readdirSync(currentPath, { withFileTypes: true })

        for (const item of items) {
          const fullPath = path.join(currentPath, item.name)

          if (item.isDirectory()) {
            scanDirectory(fullPath)
          } else if (item.isFile() && item.name.endsWith(".txt")) {
            txtFiles.push(fullPath)
          }
        }
      } catch (error) {
        // Skip directories we can't read
      }
    }

    scanDirectory(dirPath)
    return txtFiles
  }

  /**
   * Parse txt file to extract challan details (BSR, Date, CSN, Amount)
   */
  parseTxtFileForChallans(txtContent: string): any[] {
    const lines = txtContent.split("\n")
    const allChallans: any[] = []

    for (const line of lines) {
      const normalizedLine = line.replace(/\^{2,}/g, "^")
      const fields = normalizedLine.split("^")

      // Check if this is a CD (Challan Details) row
      if (fields.length > 1 && fields[1] === "CD") {
        const challan = {
          bsr: fields[7] || "", // BSR code
          dtoftaxdep: fields[8] || "", // Date
          csn: fields[6] || "", // CSN
          chlnamt: fields[9] ? parseFloat(fields[9]) : 0, // Amount
        }

        // Only add if all required fields are present
        if (challan.bsr && challan.dtoftaxdep && challan.csn && challan.chlnamt) {
          allChallans.push(challan)
        }
      }
    }

    return allChallans
  }

  /**
   * Find matching company folder (handles case variations)
   */
  findMatchingCompanyFolder(companyName: string, baseFolder: string): string | null {
    try {
      if (!fs.existsSync(baseFolder)) {
        return null
      }

      const folders = fs
        .readdirSync(baseFolder, { withFileTypes: true })
        .filter((dirent: any) => dirent.isDirectory())
        .map((dirent: any) => dirent.name)

      // Normalize company name for comparison
      const normalizeName = (name: string) =>
        (name || "")
          .toLowerCase()
          .replace(/private limited/gi, "pvt ltd")
          .replace(/pvt\./gi, "pvt")
          .replace(/ltd\./gi, "ltd")
          .replace(/\s+/g, " ")
          .trim()

      const normalizedTarget = normalizeName(companyName)

      for (const folder of folders) {
        const normalizedFolder = normalizeName(folder)
        if (
          normalizedFolder.includes(normalizedTarget) ||
          normalizedTarget.includes(normalizedFolder)
        ) {
          return path.join(baseFolder, folder)
        }
      }
    } catch (error) {
      // Base folder doesn't exist or can't be read
    }

    return null
  }

  /**
   * Format date from DDMMYYYY to DD-MMM-YYYY
   */
  formatDate(dateStr: string): string {
    if (!dateStr || dateStr.length !== 8) return dateStr

    const day = dateStr.slice(0, 2)
    const monthNum = parseInt(dateStr.slice(2, 4))
    const monthNames = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ]
    const monthName = monthNames[monthNum - 1] || ""
    const year = dateStr.slice(4, 8)

    return `${day}-${monthName}-${year}`
  }

  /**
   * Main puppeteer function to query challan status
   */
  async queryChallanStatusPuppeteer() {
    try {
      this.logger.log(`Starting challan status query for ${this.company.name}`)

      // Try challan management PDFs first (public/pdf/challans/<Company>/PaymentHistory/)
      let challanDetails = await this.getAllChallanDetailsFromPaymentPdfs()

      if (challanDetails.length === 0) {
        this.logger.log("No PDF challan data found – falling back to TDS return txt files...")
        challanDetails = await this.getAllChallanDetailsForCompany()
      } else {
        this.logger.log(`Using ${challanDetails.length} challan(s) extracted from PDFs`)
      }

      if (challanDetails.length === 0) {
        this.logger.log("No challan details found for this company")
        return {
          success: false,
          reason: "No challan details found",
          company: this.company.name,
        }
      }

      this.logger.log(`Found ${challanDetails.length} challan details to query`)

      const browser = await puppeteer.launch({
        headless: false,
        args: ["--start-maximized"],
      })

      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })

      this.logger.log("TRACES API login + preauth (traces61)…")
      await loginWithTracesApiAndPreauth(page, {
        userId: this.company.user_id,
        password: this.company.password,
        tan: this.company.tan,
      })
      this.logger.log("Login successful")

      // Navigate to challan status query page
      this.logger.log("Navigating to challan status query page...")
      await page.goto(traces61DedUrl("challanstatusquery.xhtml"), {
        waitUntil: "networkidle2",
      })

      // Click search particular
      this.logger.log("Clicking search particular...")
      await page.waitForSelector("#searchParticular")
      await page.click("#searchParticular")
      await waitForSecs(1000)

      // Step 7: Click initial Go button
      this.logger.log("Clicking initial Go button...")
      await page.waitForSelector("#ClickGo")
      await page.click("#ClickGo")
      await waitForSecs(2000)

      // Step 8: Loop through all challan details and query status
      const results: any[] = []

      for (let i = 0; i < challanDetails.length; i++) {
        const challan = challanDetails[i]
        this.logger.log(`\nQuerying challan ${i + 1}/${challanDetails.length}`)
        this.logger.log(
          `BSR: ${challan.bsr}, Date: ${challan.date}, CSN: ${challan.csn}, Amount: ${challan.challanAmount}`
        )

        try {
          // Clear previous inputs if not the first iteration
          if (i > 0) {
            await page.evaluate(() => {
              const bsrInput = document.querySelector("#bsrCode") as HTMLInputElement
              const dateInput = document.querySelector("#dateOfDep") as HTMLInputElement
              const csnInput = document.querySelector("#chlnSNo") as HTMLInputElement
              const amtInput = document.querySelector("#chlnAmt") as HTMLInputElement

              if (bsrInput) bsrInput.value = ""
              if (dateInput) dateInput.value = ""
              if (csnInput) csnInput.value = ""
              if (amtInput) amtInput.value = ""
            })
          }

          // Fill in challan details
          await page.waitForSelector("#bsrCode")
          await page.type("#bsrCode", challan.bsr)
          await page.type("#dateOfDep", this.formatDate(challan.date))
          await page.type("#chlnSNo", challan.csn)
          await page.type("#chlnAmt", String(challan.challanAmount))

          // Click Go to query
          await page.waitForSelector("#clickGo3")
          await page.click("#clickGo3")
          await waitForSecs(5000)

          // Click on the first result row in the challan details list
          this.logger.log("Clicking on result row...")
          try {
            await page.waitForSelector("#chlnDetList1 tr[role='row']:not(.jqgfirstrow)", {
              timeout: 5000,
            })
            await page.click("#chlnDetList1 tr[role='row']:not(.jqgfirstrow)")
            await waitForSecs(1000)

            // Click on "View Consumption Details" button
            this.logger.log("Clicking View Consumption Details...")
            await page.waitForSelector("#viewConsDet1", { timeout: 5000 })
            await page.click("#viewConsDet1")
            await waitForSecs(5000)

            // Extract data from the clicked row (challan details)
            const challanRowData = await page.evaluate(() => {
              const row = document.querySelector(
                "#chlnDetList1 tr.ui-state-highlight"
              ) as HTMLTableRowElement
              if (!row) return null

              return {
                receiptNum:
                  row
                    .querySelector("[aria-describedby='chlnDetList1_recptNum']")
                    ?.textContent?.trim() || "",
                dateOfDeposit:
                  row
                    .querySelector("[aria-describedby='chlnDetList1_dateOfDep']")
                    ?.textContent?.trim() || "",
                challanSerialNo:
                  row
                    .querySelector("[aria-describedby='chlnDetList1_chlnSNo']")
                    ?.textContent?.trim() || "",
                challanStatus:
                  row
                    .querySelector("[aria-describedby='chlnDetList1_chlnStatus']")
                    ?.textContent?.trim() || "",
                challanAmount:
                  row
                    .querySelector("[aria-describedby='chlnDetList1_chlnAmt']")
                    ?.textContent?.trim() || "",
                bankCode:
                  row
                    .querySelector("[aria-describedby='chlnDetList1_bankCode']")
                    ?.textContent?.trim() || "",
                branchCode:
                  row
                    .querySelector("[aria-describedby='chlnDetList1_branchCode']")
                    ?.textContent?.trim() || "",
              }
            })

            // Extract data from consumption details table
            const consumptionData = await page.evaluate(() => {
              const rows = document.querySelectorAll(
                "#viewDetList tr[role='row']:not(.jqgfirstrow)"
              )
              const data: any[] = []

              rows.forEach((row) => {
                data.push({
                  tokenNum:
                    row
                      .querySelector("[aria-describedby='viewDetList_tokenNum']")
                      ?.textContent?.trim() || "",
                  financialYear:
                    row
                      .querySelector("[aria-describedby='viewDetList_finYr']")
                      ?.textContent?.trim() || "",
                  quarter:
                    row
                      .querySelector("[aria-describedby='viewDetList_qtr']")
                      ?.textContent?.trim() || "",
                  formType:
                    row
                      .querySelector("[aria-describedby='viewDetList_formType']")
                      ?.textContent?.trim() || "",
                  claimAmount:
                    row
                      .querySelector("[aria-describedby='viewDetList_claimAmt']")
                      ?.textContent?.trim() || "",
                  claimInterestAmount:
                    row
                      .querySelector("[aria-describedby='viewDetList_claimIntAmt']")
                      ?.textContent?.trim() || "",
                  claimOtherAmount:
                    row
                      .querySelector("[aria-describedby='viewDetList_claimOthAmt']")
                      ?.textContent?.trim() || "",
                  challanStatus:
                    row
                      .querySelector("[aria-describedby='viewDetList_chlnStatus']")
                      ?.textContent?.trim() || "",
                  excessAmount:
                    row
                      .querySelector("[aria-describedby='viewDetList_excessAmt']")
                      ?.textContent?.trim() || "",
                })
              })

              return data
            })

            // Combine all data
            if (challanRowData && consumptionData.length > 0) {
              // Add each consumption row as a separate entry with company and challan info
              consumptionData.forEach((consumption) => {
                results.push({
                  "Company Name": this.company.name,
                  TAN: this.company.tan,
                  BSR: challan.bsr,
                  "Challan Serial No": challan.csn,
                  "Challan Amount": challan.challanAmount,
                  "Receipt Number": challanRowData.receiptNum,
                  "Date of Deposit": challanRowData.dateOfDeposit,
                  "Challan Status": challanRowData.challanStatus,
                  "Bank Code": challanRowData.bankCode,
                  "Branch Code": challanRowData.branchCode,
                  "Token Number": consumption.tokenNum,
                  "Financial Year": consumption.financialYear,
                  Quarter: consumption.quarter,
                  "Form Type": consumption.formType,
                  "Claim Amount": consumption.claimAmount,
                  "Claim Interest Amount": consumption.claimInterestAmount,
                  "Claim Other Amount": consumption.claimOtherAmount,
                  "Consumption Status": consumption.challanStatus,
                  "Excess Amount": consumption.excessAmount,
                })
              })

              this.logger.log(
                `✓ Extracted data for challan ${i + 1} - Found ${
                  consumptionData.length
                } consumption records`
              )
            } else {
              this.logger.log(`⚠ No consumption data found for challan ${i + 1}`)
            }

            // Close the popup/dialog if needed
            try {
              const closeButton = await page.$("#ui-id-2 .ui-dialog-titlebar-close")
              if (closeButton) {
                await closeButton.click()
                await waitForSecs(500)
              }
            } catch (e) {
              // Ignore if close button not found
            }
          } catch (error) {
            this.logger.log(`⚠ Could not extract details for challan ${i + 1}: ${error.message}`)
          }

          // Small delay between queries
          await waitForSecs(1000)
        } catch (error) {
          this.logger.log(`✗ Failed to query challan ${i + 1}: ${error.message}`)
          results.push({
            challan: challan,
            status: "Failed",
            error: error.message,
            index: i + 1,
          })
        }
      }

      // Close browser
      await browser.close()

      // Create Excel file with all challan data
      if (results.length > 0) {
        this.logger.log(`\n=== Creating Excel File ===`)
        this.logger.log(`Total records: ${results.length}`)

        const outputDir = path.join(process.cwd(), "public", "pdf", "challan_status_results")
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true })
        }

        const workbook = XLSX.utils.book_new()
        const worksheet = XLSX.utils.json_to_sheet(results)
        XLSX.utils.book_append_sheet(workbook, worksheet, "Challan Status")

        const outputFilePath = path.join(
          outputDir,
          `${this.company.name.replace(/[/\\?%*:|"<>]/g, "_")}_challan_status.xlsx`
        )
        XLSX.writeFile(workbook, outputFilePath)

        this.logger.log(`✓ Excel file created: ${outputFilePath}`)
      } else {
        this.logger.log(`⚠ No data extracted, Excel file not created`)
      }

      this.logger.log(`\n=== Query Summary ===`)
      this.logger.log(`Total challans queried: ${challanDetails.length}`)
      this.logger.log(`Total records extracted: ${results.length}`)

      return {
        success: true,
        company: this.company.name,
        tan: this.company.tan,
        totalChallans: challanDetails.length,
        totalRecords: results.length,
      }
    } catch (error) {
      this.logger.log(`Error in queryChallanStatusPuppeteer: ${error.message}`)
      throw error
    }
  }

  async process() {
    this.logger.log(`Starting Challan Status Query for ${this.company.name} - ${this.Pan}`)

    try {
      await this.queryChallanStatusPuppeteer()
    } catch (error) {
      this.logger.log(`Error in process: ${error.message}`)
      throw error
    }

    return
  }
}
