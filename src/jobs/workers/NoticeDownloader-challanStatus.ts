import { AxiosInstance } from "axios"
import { Company } from "@prisma/client"
import db from "db"
import { getAxiostClient } from "../helper"
import { waitForSecs } from "src/utils/promises"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import * as fs from "fs"
import * as path from "path"
import pdfParse from "pdf-parse"
import { loginWithTracesApiAndPreauth, traces61DedUrl } from "../traces"
import {
  auditPaymentPdfChallanStatusCoverage,
  financialYearFromDepositDate,
  isTargetFinancialYear,
  loadChallanStatusExcelRows,
  loadSupplementalChallanAmountsForTan,
  loadUnmatchedChallanStatusExcelRows,
  normalizeChallanSerialNo,
  saveChallanStatusCoverageReport,
  writeChallanStatusExcel,
  writeUnconsumedListExcel,
  writeUnmatchedChallanStatusExcel,
} from "src/challan/utils/challanStatusExcel"
import {
  addMessageToTask as appendTaskMessage,
  findMatchingCompanyFolder as matchCompanyFolder,
  findTxtFilesRecursively as collectTxtFiles,
} from "src/shared/jobs/workers/taskHelpers"
puppeteer.use(StealthPlugin())

export type ChallanStatusJobOptions = {
  onlyPaymentPdfNotInExcel?: boolean
  /** Indian FYs like "2025-26". Empty/undefined = no FY filter. */
  targetFinancialYears?: string[]
  /**
   * list — scrape portal unconsumed table to Excel only (no View Amount)
   * full — reveal amounts + write status/unmatched Excels
   */
  mode?: "list" | "full"
}

export default class NoticeDownloaderChallanStatus {
  axiosClient: AxiosInstance

  constructor(
    private company: Company,
    private logger: { log: (msg: string) => void },
    private taskId: number,
    private options: ChallanStatusJobOptions = {}
  ) {
    this.axiosClient = getAxiostClient()
  }

  async addMessageToTask(msg: string) {
    return appendTaskMessage(this.taskId, msg)
  }

  findTxtFilesRecursively(dirPath: string): string[] {
    return collectTxtFiles(dirPath)
  }

  findMatchingCompanyFolder(companyName: string, baseFolder: string): string | null {
    return matchCompanyFolder(companyName, baseFolder)
  }

  get Pan() {
    return this.company.tan.toUpperCase()
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
          const cin = extractField("CIN", text)
          // Date is already "DD-MMM-YYYY" (e.g. "04-Dec-2025").
          // formatDate() returns the string unchanged when it is not 8 chars,
          // so we can store it as-is and it will be typed directly into the portal.
          const date = extractField("Date of Deposit", text)
          const amountRaw =
            extractField("Amount \\(in Rs\\.\\)", text) || extractField("Amount", text)
          const challanAmount = parseFloat(amountRaw.replace(/[₹,\s]/g, "")) || 0
          const cinFromFile = path.basename(pdfPath).replace(/_ChallanReceipt\.pdf$/i, "")

          if (bsr && csn && date && challanAmount) {
            challanDetails.push({
              bsr,
              date,
              csn,
              challanAmount,
              cin: cin || cinFromFile,
            })
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

  /** True when TRACES redirected to maintenance / page-not-found. */
  private async isTracesPageNotFound(page: import("puppeteer").Page): Promise<boolean> {
    const url = page.url()
    if (/err_pgntfound|page.?not.?found|maint\//i.test(url)) return true
    try {
      return await page.evaluate(() => {
        const body = document.body?.innerText || ""
        return /Requested resource could not be found/i.test(body)
      })
    } catch {
      return false
    }
  }

  /** Normalize challan serial numbers for PDF ↔ portal matching (ignore leading zeros). */
  private normalizeCsn(csn: string | number | undefined): string {
    return normalizeChallanSerialNo(csn)
  }

  /** True when the unconsumed cell still needs a View Amount click. */
  private needsViewAmountClick(unconsumedText: string): boolean {
    return /view\s*amount/i.test((unconsumedText || "").trim())
  }

  /**
   * Navigate to Unconsumed Challan Detail after login. Waits for session settle,
   * retries if TRACES returns "Page Not Found" while still loading.
   */
  private async navigateToUnconsumedChallanPage(
    page: import("puppeteer").Page,
    maxAttempts = 4
  ): Promise<void> {
    const targetUrl = traces61DedUrl("unconschallandetail.xhtml")

    // Session cookies need a moment after API login before ded pages work.
    this.logger.log("Waiting for TRACES session to settle before navigation...")
    await waitForSecs(5000)

    let lastError: Error | null = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      this.logger.log(
        `Navigating to unconsumed challan detail page (attempt ${attempt}/${maxAttempts})...`
      )
      try {
        await page.goto(targetUrl, {
          waitUntil: "networkidle2",
          timeout: 120000,
        })
        await waitForSecs(4000)

        if (await this.isTracesPageNotFound(page)) {
          lastError = new Error(`TRACES page not found after goto (url=${page.url()})`)
          this.logger.log(`⚠ ${lastError.message} — waiting and retrying...`)
          await waitForSecs(5000 + attempt * 2000)
          continue
        }

        await page.waitForSelector("#viewunconchlntab", {
          visible: true,
          timeout: 60000,
        })
        this.logger.log("Unconsumed challan detail page ready")
        return
      } catch (err: any) {
        lastError = err instanceof Error ? err : new Error(String(err?.message || err))
        this.logger.log(
          `⚠ Navigation attempt ${attempt} failed: ${lastError.message} — retrying...`
        )
        await waitForSecs(5000 + attempt * 2000)
      }
    }

    throw lastError || new Error("Failed to open unconsumed challan detail page")
  }

  /** Read visible data rows from #viewunconchlntab on the current page. */
  private async readUnconsumedTableRows(page: import("puppeteer").Page): Promise<
    Array<{
      rowId: string
      receiptNo: string
      bsr: string
      dateOfDeposit: string
      challanSerialNo: string
      challanAmount: string
      unconsumedAmount: string
    }>
  > {
    return page.evaluate(() => {
      const rows = document.querySelectorAll(
        "#viewunconchlntab tr[role='row']:not(.jqgfirstrow)"
      )
      return Array.from(rows).map((row) => {
        const cell = (attr: string) =>
          row.querySelector(`[aria-describedby='${attr}']`)?.textContent?.trim() || ""
        return {
          rowId: (row as HTMLElement).id || "",
          receiptNo: cell("viewunconchlntab_recptNo"),
          bsr: cell("viewunconchlntab_chlnbsrcode"),
          dateOfDeposit: cell("viewunconchlntab_dateofdep"),
          challanSerialNo: cell("viewunconchlntab_chlnsrno"),
          challanAmount: cell("viewunconchlntab_chlnamt"),
          unconsumedAmount: cell("viewunconchlntab_unconschlnamt"),
        }
      })
    })
  }

  /**
   * Total record count the jqGrid pager reports (e.g. "View 1 - 10 of 43" -> 43).
   * Returns null when the pager has not rendered a count.
   */
  private async readUnconsumedGridTotal(
    page: import("puppeteer").Page
  ): Promise<{ total: number | null; pagerText: string }> {
    return page.evaluate(() => {
      const el = document.querySelector(
        "#pager_left .ui-paging-info, .ui-paging-info, [id*='pager'] .ui-paging-info"
      )
      const pagerText = (el?.textContent || "").trim()
      const m = /of\s+([\d,]+)/i.exec(pagerText)
      const total = m && m[1] ? parseInt(m[1].replace(/,/g, ""), 10) : null
      return { total: Number.isNaN(total as number) ? null : total, pagerText }
    })
  }

  /**
   * Wait for grid rows, retrying a slow render before concluding the grid is empty.
   * Distinguishes "still loading" from "genuinely no more rows" so a slow page does
   * not silently truncate pagination.
   */
  private async waitForUnconsumedRows(
    page: import("puppeteer").Page,
    attempts = 4
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        await page.waitForSelector("#viewunconchlntab tr[role='row']:not(.jqgfirstrow)", {
          timeout: 20000,
        })
        return true
      } catch {
        // Rows are not there yet. Decide between "grid is genuinely empty" (stop),
        // "session is gone" (stop) and "portal is just slow" (retry).
        let emptyState = false
        try {
          emptyState = await page.evaluate(() => {
            const grid = document.querySelector("#viewunconchlntab")
            if (!grid) return false
            const body = (document.body.textContent || "").toLowerCase()
            return body.includes("no records") || body.includes("no data")
          })
        } catch (probeErr: any) {
          const msg = String(probeErr?.message || probeErr)
          // Only a dead session means "no more data". A protocol/eval timeout is the
          // portal being slow — retrying that is what keeps pagination from truncating.
          if (
            /detached|target closed|session closed|connection closed|disconnected/i.test(msg)
          ) {
            this.logger.log(`  session gone (${msg}) — stopping pagination`)
            return false
          }
          this.logger.log(
            `  grid probe timed out (attempt ${attempt}/${attempts}: ${msg}) — retrying`
          )
        }
        if (emptyState) return false
        if (attempt < attempts) {
          this.logger.log(
            `  grid not ready (attempt ${attempt}/${attempts}) — waiting and retrying...`
          )
          await waitForSecs(5000 + attempt * 3000)
        }
      }
    }
    this.logger.log(`  grid still not ready after ${attempts} attempts — stopping pagination`)
    return false
  }

  /**
   * Click "View Amount" for a row, enter the matched challan amount, Proceed,
   * then return the revealed unconsumed amount text.
   */
  private async revealUnconsumedAmount(
    page: import("puppeteer").Page,
    rowId: string,
    challanAmount: string | number
  ): Promise<string> {
    const amountStr = String(challanAmount).trim()

    const clicked = await page.evaluate((id) => {
      const row = id
        ? document.getElementById(id)
        : null
      if (!row) return false
      const cell = row.querySelector(
        "[aria-describedby='viewunconchlntab_unconschlnamt']"
      ) as HTMLElement | null
      if (!cell) return false
      cell.click()
      return true
    }, rowId)

    if (!clicked) {
      throw new Error(`Could not click View Amount for row id=${rowId}`)
    }

    await page.waitForSelector("#challanamnt", { visible: true, timeout: 15000 })
    await waitForSecs(500)

    await page.click("#challanamnt", { clickCount: 3 })
    await page.type("#challanamnt", amountStr, { delay: 20 })
    // Ensure jQuery validators see the value
    await page.evaluate((amt) => {
      const input = document.querySelector("#challanamnt") as HTMLInputElement | null
      if (!input) return
      input.value = amt
      input.dispatchEvent(new Event("input", { bubbles: true }))
      input.dispatchEvent(new Event("change", { bubbles: true }))
      input.dispatchEvent(new Event("keyup", { bubbles: true }))
    }, amountStr)
    await waitForSecs(300)

    const proceeded = await page.evaluate(() => {
      const buttons = document.querySelectorAll(".ui-dialog-buttonset button")
      for (const btn of Array.from(buttons)) {
        if ((btn.textContent || "").trim() === "Proceed") {
          ;(btn as HTMLElement).click()
          return true
        }
      }
      return false
    })
    if (!proceeded) {
      throw new Error("Proceed button not found in Challan Amount Details dialog")
    }

    // Wait until the cell no longer shows "View Amount"
    const deadline = Date.now() + 20000
    let unconsumed = ""
    while (Date.now() < deadline) {
      await waitForSecs(500)
      unconsumed = await page.evaluate((id) => {
        const row = document.getElementById(id)
        if (!row) return ""
        return (
          row
            .querySelector("[aria-describedby='viewunconchlntab_unconschlnamt']")
            ?.textContent?.trim() || ""
        )
      }, rowId)
      if (unconsumed && !/view\s*amount/i.test(unconsumed)) {
        break
      }
    }

    if (!unconsumed || /view\s*amount/i.test(unconsumed)) {
      // Best-effort close dialog so later rows can proceed
      try {
        await page.evaluate(() => {
          const closeBtn = document.querySelector(
            ".ui-dialog[aria-describedby='challanamount'] .ui-dialog-titlebar-close"
          ) as HTMLElement | null
          closeBtn?.click()
        })
      } catch {
        /* ignore */
      }
      throw new Error(`Unconsumed amount not revealed after Proceed (got "${unconsumed}")`)
    }

    return unconsumed
  }

  /**
   * Main puppeteer function: scrape Unconsumed Challan Detail table,
   * reveal amounts via View Amount + PDF/Excel-matched challan amounts, paginate.
   * Keeps portal rows whose Date of Deposit falls in options.targetFinancialYears
   * (empty = all FYs).
   */
  async queryChallanStatusPuppeteer() {
    try {
      this.logger.log(`Starting unconsumed challan scrape for ${this.company.name}`)
      const targetFinancialYears = this.options.targetFinancialYears || []
      this.logger.log(
        targetFinancialYears.length > 0
          ? `Target deposit FYs: ${targetFinancialYears.join(", ")}`
          : "Target deposit FYs: all (no filter)"
      )

      const onlyPaymentPdfNotInExcel = this.options.onlyPaymentPdfNotInExcel === true

      // PDF (or txt) amounts + supplemental Excels are used to fill View Amount by CSN
      let challanDetails = await this.getAllChallanDetailsFromPaymentPdfs()

      if (onlyPaymentPdfNotInExcel) {
        this.logger.log(
          "Mode: payment PDFs only — skipping TDS return txt fallback"
        )
      } else if (challanDetails.length === 0) {
        this.logger.log("No PDF challan data found – falling back to TDS return txt files...")
        challanDetails = await this.getAllChallanDetailsForCompany()
      } else {
        this.logger.log(`Using ${challanDetails.length} challan(s) extracted from PDFs`)
      }

      const supplemental = loadSupplementalChallanAmountsForTan(
        this.company.tan,
        targetFinancialYears
      )
      this.logger.log(
        `Loaded ${supplemental.length} supplemental challan amount(s) from Swiggy status Excels for TAN ${this.company.tan}`
      )

      const amountByCsn = new Map<
        string,
        { bsr: string; csn: string; challanAmount: number | string; date?: string; cin?: string }
      >()

      // Supplemental Excel amounts first; PDF/txt overwrite when present (fresher)
      for (const c of supplemental) {
        const key = this.normalizeCsn(c.csn)
        if (!key) continue
        amountByCsn.set(key, {
          bsr: c.bsr,
          csn: c.csn,
          challanAmount: c.challanAmount,
          date: c.date,
        })
      }
      for (const c of challanDetails) {
        const key = this.normalizeCsn(c.csn)
        if (!key) continue
        amountByCsn.set(key, {
          bsr: c.bsr,
          csn: c.csn,
          challanAmount: c.challanAmount,
          date: c.date,
          cin: c.cin,
        })
      }

      if (amountByCsn.size === 0) {
        this.logger.log(
          "⚠ No challan amount matches found — will still scrape portal and write target-FY rows to unmatched Excel"
        )
      }

      const existingExcelRows = loadChallanStatusExcelRows(this.company.name)
      const existingUnmatchedRows = loadUnmatchedChallanStatusExcelRows(this.company.name)

      const alreadyCoveredCsns = new Set<string>()
      for (const row of existingExcelRows) {
        const csn = this.normalizeCsn(row["Challan Serial No"] as string)
        const unconsumed = String(row["Unconsumed Amount"] ?? "").trim()
        const date = String(row["Date of Deposit"] ?? "")
        if (
          csn &&
          unconsumed &&
          !this.needsViewAmountClick(unconsumed) &&
          isTargetFinancialYear(date, targetFinancialYears)
        ) {
          alreadyCoveredCsns.add(csn)
        }
      }

      this.logger.log(`Amount lookup CSNs: ${amountByCsn.size}`)
      this.logger.log(
        `${alreadyCoveredCsns.size} target-FY CSN(s) already have Unconsumed Amount in Excel`
      )

      const results: Record<string, unknown>[] = []
      const unmatchedResults: Record<string, unknown>[] = []
      let rowsProcessed = 0
      let skippedOutsideFy = 0
      let viewAmountClicks = 0
      let skippedAlreadyInExcel = 0
      let unmatchedCount = 0

      let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null
      try {
        browser = await puppeteer.launch({
          headless: false,
          args: ["--start-maximized"],
          // TRACES grid renders can exceed the 180s CDP default on slow evenings.
          protocolTimeout: 300000,
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

        await this.navigateToUnconsumedChallanPage(page)

        let hasNextPage = true
        let currentPage = 1

        // Keep whatever has been scraped if the portal drops the session mid-run;
        // the Excel write below must still receive the partial results.
        try {
          while (hasNextPage) {
            this.logger.log(`\n=== Unconsumed table page ${currentPage} ===`)
            if (!(await this.waitForUnconsumedRows(page))) {
              this.logger.log("No data rows found in unconsumed challan table")
              break
            }
            await waitForSecs(1000)

            if (currentPage === 1) {
              const { total, pagerText } = await this.readUnconsumedGridTotal(page)
              this.logger.log(
                `Portal reports ${total ?? "unknown"} total unconsumed row(s)${pagerText ? ` ("${pagerText}")` : ""}`
              )
            }

            const tableRows = await this.readUnconsumedTableRows(page)
            this.logger.log(`Found ${tableRows.length} row(s) on page ${currentPage}`)

            for (const row of tableRows) {
              rowsProcessed++
              const csnKey = this.normalizeCsn(row.challanSerialNo)
              const matched = amountByCsn.get(csnKey)

              this.logger.log(
                `Row CSN=${row.challanSerialNo} Date=${row.dateOfDeposit} ` +
                  `Unconsumed="${row.unconsumedAmount}" matchedAmount=${matched ? "yes" : "no"}`
              )

              if (!isTargetFinancialYear(row.dateOfDeposit, targetFinancialYears)) {
                skippedOutsideFy++
                this.logger.log(
                  `  ⏭ Skipping — deposit date not in selected FYs (${targetFinancialYears.join(", ")})`
                )
                continue
              }

              if (csnKey && alreadyCoveredCsns.has(csnKey)) {
                skippedAlreadyInExcel++
                this.logger.log(`  ⏭ Skipping — CSN ${row.challanSerialNo} already in Excel`)
                continue
              }

              // Target FY but no PDF/Excel amount match → record in unmatched Excel only
              if (!matched) {
                unmatchedCount++
                let unconsumedAmount = row.unconsumedAmount
                const portalAmount = (row.challanAmount || "").replace(/\u00a0/g, " ").trim()

                if (this.needsViewAmountClick(unconsumedAmount) && portalAmount) {
                  try {
                    this.logger.log(
                      `  Unmatched CSN — trying portal amount ${portalAmount} for View Amount...`
                    )
                    unconsumedAmount = await this.revealUnconsumedAmount(
                      page,
                      row.rowId,
                      portalAmount
                    )
                    viewAmountClicks++
                    this.logger.log(`  ✓ Unconsumed amount (unmatched): ${unconsumedAmount}`)
                  } catch (err: any) {
                    this.logger.log(
                      `  ✗ View Amount failed for unmatched CSN ${row.challanSerialNo}: ${err.message}`
                    )
                  }
                }

                unmatchedResults.push({
                  "Company Name": this.company.name,
                  TAN: this.company.tan,
                  BSR: row.bsr,
                  "Challan Serial No": row.challanSerialNo,
                  "Challan Amount": portalAmount,
                  "Receipt Number": row.receiptNo,
                  "Date of Deposit": row.dateOfDeposit,
                  "Financial Year": financialYearFromDepositDate(row.dateOfDeposit) || "",
                  "Unconsumed Amount": unconsumedAmount,
                  Reason: "Challan amount not matched",
                })
                this.logger.log(
                  `  ⚠ Added to unmatched Excel (CSN ${row.challanSerialNo})`
                )
                continue
              }

              let unconsumedAmount = row.unconsumedAmount
              const portalAmount = (row.challanAmount || "").replace(/\u00a0/g, " ").trim()
              let challanAmount: string | number =
                portalAmount || matched?.challanAmount || ""

              if (this.needsViewAmountClick(unconsumedAmount)) {
                if (challanAmount === "" || challanAmount == null) {
                  this.logger.log(
                    `  ⚠ Cannot reveal amount — no challan amount for CSN ${row.challanSerialNo}`
                  )
                  continue
                }

                try {
                  this.logger.log(
                    `  Clicking View Amount and entering challan amount ${challanAmount}...`
                  )
                  unconsumedAmount = await this.revealUnconsumedAmount(
                    page,
                    row.rowId,
                    challanAmount
                  )
                  viewAmountClicks++
                  this.logger.log(`  ✓ Unconsumed amount: ${unconsumedAmount}`)
                } catch (err: any) {
                  this.logger.log(
                    `  ✗ View Amount failed for CSN ${row.challanSerialNo}: ${err.message}`
                  )
                  continue
                }
              }

              const bsrForExcel = matched?.bsr || row.bsr
              const amountForExcel = matched?.challanAmount ?? challanAmount

              results.push({
                "Company Name": this.company.name,
                TAN: this.company.tan,
                BSR: bsrForExcel,
                "Challan Serial No": matched?.csn || row.challanSerialNo,
                "Challan Amount": amountForExcel,
                "Receipt Number": row.receiptNo,
                "Date of Deposit": row.dateOfDeposit,
                "Unconsumed Amount": unconsumedAmount,
              })
            }

            const nextPageInfo = await page.evaluate(() => {
              const nextButton = document.querySelector("#next_pager")
              if (!nextButton) return { exists: false, disabled: true }
              const classList = nextButton.className || ""
              return {
                exists: true,
                disabled: classList.includes("ui-state-disabled"),
              }
            })

            this.logger.log(
              `Next button — exists: ${nextPageInfo.exists}, disabled: ${nextPageInfo.disabled}`
            )

            if (nextPageInfo.exists && !nextPageInfo.disabled) {
              try {
                await page.click("#next_pager")
                this.logger.log("Clicked next page")
                await waitForSecs(2500)
                currentPage++
              } catch (error: any) {
                this.logger.log(`Failed to click next page: ${error.message}`)
                hasNextPage = false
              }
            } else {
              hasNextPage = false
            }
          }
        } catch (scrapeErr: any) {
          this.logger.log(
            `⚠ Scrape interrupted: ${scrapeErr?.message || scrapeErr} — keeping ${results.length} revealed and ${unmatchedResults.length} unmatched row(s) collected so far`
          )
        }

        this.logger.log(`\nProcessed ${currentPage} page(s) in total`)
      } finally {
        if (browser) {
          try {
            await browser.close()
            this.logger.log("Browser closed")
          } catch (closeErr: any) {
            this.logger.log(`Browser close warning: ${closeErr?.message || closeErr}`)
            try {
              browser.process()?.kill("SIGKILL")
            } catch {
              /* ignore */
            }
          }
        }
      }

      // Replace existing Excel rows for CSNs we just scraped; keep the rest
      const scrapedCsnKeys = new Set(
        results.map((r) => this.normalizeCsn(r["Challan Serial No"] as string)).filter(Boolean)
      )
      const keptExisting = existingExcelRows.filter((row) => {
        const key = this.normalizeCsn(row["Challan Serial No"] as string)
        return !key || !scrapedCsnKeys.has(key)
      })
      const mergedRows = [...keptExisting, ...results] as Record<string, unknown>[]

      if (mergedRows.length > 0) {
        this.logger.log(`\n=== Writing Excel File ===`)
        this.logger.log(
          `Rows: ${keptExisting.length} kept + ${results.length} scraped = ${mergedRows.length} total`
        )
        const outputFilePath = writeChallanStatusExcel(this.company.name, mergedRows)
        this.logger.log(`✓ Excel file saved: ${outputFilePath}`)
      } else {
        this.logger.log(`⚠ No Excel rows to write`)
      }

      // Merge unmatched (target FY, amount not matched) into separate Excel
      const unmatchedCsnKeys = new Set(
        unmatchedResults
          .map((r) => this.normalizeCsn(r["Challan Serial No"] as string))
          .filter(Boolean)
      )
      const keptUnmatched = existingUnmatchedRows.filter((row) => {
        const key = this.normalizeCsn(row["Challan Serial No"] as string)
        return !key || !unmatchedCsnKeys.has(key)
      })
      const mergedUnmatched = [...keptUnmatched, ...unmatchedResults] as Record<
        string,
        unknown
      >[]
      if (mergedUnmatched.length > 0) {
        this.logger.log(`\n=== Writing Unmatched Excel File ===`)
        this.logger.log(
          `Unmatched rows: ${keptUnmatched.length} kept + ${unmatchedResults.length} new = ${mergedUnmatched.length} total`
        )
        const unmatchedPath = writeUnmatchedChallanStatusExcel(
          this.company.name,
          mergedUnmatched
        )
        this.logger.log(`✓ Unmatched Excel saved: ${unmatchedPath}`)
      } else {
        this.logger.log(`⚠ No unmatched Excel rows to write`)
      }

      this.logger.log(`\n=== Auditing PDF vs Excel coverage ===`)
      const coverageReport = await auditPaymentPdfChallanStatusCoverage(this.company.name)
      saveChallanStatusCoverageReport(this.company.name, coverageReport)
      this.logger.log(
        `PDFs parsed: ${coverageReport.totalPdfsParsed}, in Excel: ${coverageReport.inExcel}, not in Excel: ${coverageReport.notInExcel}`
      )

      this.logger.log(`\n=== Query Summary ===`)
      this.logger.log(`PDF challans: ${challanDetails.length}`)
      this.logger.log(`Supplemental Excel challans: ${supplemental.length}`)
      this.logger.log(`Portal rows processed: ${rowsProcessed}`)
      this.logger.log(`Skipped (outside target FY): ${skippedOutsideFy}`)
      this.logger.log(`Skipped (already in Excel): ${skippedAlreadyInExcel}`)
      this.logger.log(`Unmatched amount (target FY): ${unmatchedCount}`)
      this.logger.log(`View Amount clicks: ${viewAmountClicks}`)
      this.logger.log(`New / updated records: ${results.length}`)

      return {
        success: true,
        company: this.company.name,
        tan: this.company.tan,
        totalChallans: amountByCsn.size,
        skippedAlreadyInExcel,
        skippedOutsideFy,
        unmatchedAmount: unmatchedCount,
        queriedOnTraces: viewAmountClicks,
        totalRecords: mergedRows.length,
        newRecords: results.length,
        unmatchedRecords: unmatchedResults.length,
        coverage: {
          totalPdfsParsed: coverageReport.totalPdfsParsed,
          inExcel: coverageReport.inExcel,
          notInExcel: coverageReport.notInExcel,
        },
      }
    } catch (error) {
      this.logger.log(`Error in queryChallanStatusPuppeteer: ${error.message}`)
      throw error
    }
  }

  /**
   * List-only: scrape unconsumed portal table into Excel (no View Amount).
   * Filtered by options.targetFinancialYears when provided.
   */
  async scrapeUnconsumedListPuppeteer() {
    const targetFinancialYears = this.options.targetFinancialYears || []
    this.logger.log(`Starting unconsumed LIST scrape for ${this.company.name}`)
    this.logger.log(
      targetFinancialYears.length > 0
        ? `Target deposit FYs: ${targetFinancialYears.join(", ")}`
        : "Target deposit FYs: all (no filter)"
    )

    const results: Record<string, unknown>[] = []
    let rowsProcessed = 0
    let skippedOutsideFy = 0
    let portalTotal: number | null = null
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null

    try {
      browser = await puppeteer.launch({
        headless: false,
        args: ["--start-maximized"],
        protocolTimeout: 300000,
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

      await this.navigateToUnconsumedChallanPage(page)

      let hasNextPage = true
      let currentPage = 1

      while (hasNextPage) {
        this.logger.log(`\n=== Unconsumed list page ${currentPage} ===`)
        if (!(await this.waitForUnconsumedRows(page))) {
          this.logger.log("No data rows found in unconsumed challan table")
          break
        }
        await waitForSecs(1000)

        if (currentPage === 1) {
          const { total, pagerText } = await this.readUnconsumedGridTotal(page)
          portalTotal = total
          this.logger.log(
            `Portal reports ${total ?? "unknown"} total unconsumed row(s)${pagerText ? ` ("${pagerText}")` : ""}`
          )
        }

        const tableRows = await this.readUnconsumedTableRows(page)
        this.logger.log(`Found ${tableRows.length} row(s) on page ${currentPage}`)

        for (const row of tableRows) {
          rowsProcessed++
          if (!isTargetFinancialYear(row.dateOfDeposit, targetFinancialYears)) {
            skippedOutsideFy++
            continue
          }

          const portalAmount = (row.challanAmount || "").replace(/\u00a0/g, " ").trim()
          results.push({
            "Company Name": this.company.name,
            TAN: this.company.tan,
            BSR: row.bsr,
            "Challan Serial No": row.challanSerialNo,
            "Challan Amount": portalAmount,
            "Receipt Number": row.receiptNo,
            "Date of Deposit": row.dateOfDeposit,
            "Financial Year": financialYearFromDepositDate(row.dateOfDeposit) || "",
            "Unconsumed Amount": row.unconsumedAmount,
          })
        }

        const nextPageInfo = await page.evaluate(() => {
          const nextButton = document.querySelector("#next_pager")
          if (!nextButton) return { exists: false, disabled: true }
          const classList = nextButton.className || ""
          return {
            exists: true,
            disabled: classList.includes("ui-state-disabled"),
          }
        })

        if (nextPageInfo.exists && !nextPageInfo.disabled) {
          try {
            await page.click("#next_pager")
            await waitForSecs(2500)
            currentPage++
          } catch (error: any) {
            this.logger.log(`Failed to click next page: ${error.message}`)
            hasNextPage = false
          }
        } else {
          hasNextPage = false
        }
      }

      this.logger.log(`Processed ${currentPage} page(s); kept ${results.length} row(s)`)
    } finally {
      if (browser) {
        try {
          await browser.close()
        } catch {
          try {
            browser.process()?.kill("SIGKILL")
          } catch {
            /* ignore */
          }
        }
      }
    }

    let excelPath: string | null = null
    if (results.length > 0) {
      excelPath = writeUnconsumedListExcel(this.company.name, results)
      this.logger.log(`✓ Unconsumed list Excel saved: ${excelPath}`)
    } else {
      this.logger.log("⚠ No unconsumed list rows to write")
    }

    return {
      success: true,
      mode: "list" as const,
      company: this.company.name,
      tan: this.company.tan,
      rowsProcessed,
      skippedOutsideFy,
      newRecords: results.length,
      /** Row count the portal's own pager reported; compare against rowsProcessed to spot truncation. */
      portalTotal,
      complete: portalTotal == null ? null : rowsProcessed >= portalTotal,
      excelPath,
    }
  }

  async process() {
    const mode = this.options.mode === "list" ? "list" : "full"
    this.logger.log(
      `Starting Unconsumed Challan Status (${mode}) for ${this.company.name} - ${this.Pan}`
    )

    try {
      if (mode === "list") {
        await this.scrapeUnconsumedListPuppeteer()
      } else {
        await this.queryChallanStatusPuppeteer()
      }
    } catch (error) {
      this.logger.log(`Error in process: ${error.message}`)
      throw error
    }

    return
  }
}
