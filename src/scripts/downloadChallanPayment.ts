import puppeteer from "puppeteer-extra"
import fs from "fs"
// add stealth plugin and use defaults (all evasion techniques)
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { Page } from "puppeteer"
import { waitForSecs } from "src/utils/promises"
import {
  clickContinueAfterEpayLanding,
  type DownloadChallansOptions,
} from "./downloadChallan"
import path from "path"
import pdfParse from "pdf-parse"
import * as XLSX from "xlsx"
import {
  groupMissingByPaymentDay,
  loadMissingFromGapsJson,
  paymentHistoryPdfExists as paymentHistoryPdfExistsForCompany,
} from "src/challan/utils/paymentHistoryFiles"
puppeteer.use(StealthPlugin())

const PAYMENT_HISTORY_API_PATH = "/paymentapi/auth/challan/paymenthistory"

type PaymentHistoryApiResponse = {
  paymentList?: {
    content?: Array<{ cin?: string }>
    last?: boolean
  }
}

function parsePaymentHistoryCins(json: unknown): string[] {
  const data = json as PaymentHistoryApiResponse
  const content = data?.paymentList?.content
  if (!Array.isArray(content)) return []
  return content
    .map((item) => item.cin)
    .filter((cin): cin is string => typeof cin === "string" && cin.length > 0)
}

function isPaymentHistoryApiUrl(url: string): boolean {
  return url.includes(PAYMENT_HISTORY_API_PATH)
}

async function login(page: Page, username: string, password: string) {
  await page.waitForSelector('input[name="panAdhaarUserId"]') // Replace with your button selector
  await waitForSecs(2000)
  await page.type('input[name="panAdhaarUserId"]', username.toUpperCase())
  await page.click(".large-button-primary.width.marTop16")
  await page.waitForSelector("#passwordCheckBox-input") // Replace with your button selector
  await page.click("#passwordCheckBox-input")
  await page.type('input[name="loginPasswordField"]', password)
  await waitForSecs(5000)
  await page.click(".large-button-primary.width.marTop26")
  try {
    await waitForSecs(5000)
    const loginHereElement = await page.$("::-p-xpath(//button[text()=' Login Here '])")
    if (loginHereElement) {
      ;(loginHereElement as any).click()
    }
  } catch (error) {}
}

/** Open e-File → e-Pay Tax from the header menu (no hash navigation). */
async function navigateToEpayTaxViaMenu(page: Page) {
  await waitForSecs(2000)
  await page.evaluate(() => {
    try {
      window["$"]?.("#securityReasonPopup")?.modal?.("hide")
    } catch {
      /* ignore */
    }
  })

  await page.waitForSelector("#e-File", { visible: true, timeout: 60000 })
  await page.click("#e-File")

  await page.waitForSelector('.mat-mdc-menu-panel[role="menu"]', { visible: true, timeout: 15000 })
  await waitForSecs(400)

  const clicked = await page.evaluate(() => {
    const items = Array.from(
      document.querySelectorAll('button.mat-mdc-menu-item[role="menuitem"]')
    ) as HTMLElement[]
    const epay = items.find((b) => {
      const label = (b.textContent || "").replace(/\s+/g, " ").trim()
      if (!/e-Pay\s*Tax/i.test(label)) return false
      // Prefer leaf item, not "Income Tax Forms" submenu trigger
      if (b.classList.contains("mat-mdc-menu-item-submenu-trigger")) return false
      return true
    })
    if (epay) {
      epay.click()
      return true
    }
    const fallback = items.find((b) => /e-Pay\s*Tax/i.test((b.textContent || "").replace(/\s+/g, " ").trim()))
    if (fallback) {
      fallback.click()
      return true
    }
    return false
  })

  if (!clicked) {
    throw new Error(
      'Opened e-File menu but could not find "e-Pay Tax" (button.mat-mdc-menu-item).'
    )
  }

  await waitForSecs(3000)
}

const CAL_HEADER_MONTHS = [
  "JAN",
  "FEB",
  "MAR",
  "APR",
  "MAY",
  "JUN",
  "JUL",
  "AUG",
  "SEP",
  "OCT",
  "NOV",
  "DEC",
] as const

const ABBR_TO_MONTH_INDEX: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

const MONTH_INDEX_TO_FULL_NAME = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const

function parseTracesPaymentDateString(dateStr: string) {
  const datePart = dateStr.split(" ")[0]
  if (!datePart) throw new Error(`Invalid payment date (empty): ${dateStr}`)
  const parts = datePart.split("-")
  const day = parseInt(parts[0]!, 10)
  const monRaw = parts[1]?.toLowerCase().replace(/\./g, "") ?? ""
  const monKey = monRaw.slice(0, 3)
  const year = parseInt(parts[2]!, 10)
  const monthIndex = ABBR_TO_MONTH_INDEX[monKey]
  if (Number.isNaN(day) || monthIndex === undefined || Number.isNaN(year)) {
    throw new Error(`Invalid payment date: ${dateStr}`)
  }
  return {
    day,
    monthIndex,
    year,
    fullMonth: MONTH_INDEX_TO_FULL_NAME[monthIndex],
  }
}

function parseMatCalendarPeriodLabel(label: string): { monthIndex: number; year: number } | null {
  const m = label.trim().match(/^([A-Za-z]+)\s+(\d{4})$/)
  if (!m) return null
  const tok = m[1]!.toUpperCase().slice(0, 3)
  const idx = CAL_HEADER_MONTHS.indexOf(tok as (typeof CAL_HEADER_MONTHS)[number])
  const year = parseInt(m[2]!, 10)
  if (idx < 0 || Number.isNaN(year)) return null
  return { monthIndex: idx, year }
}

/**
 * The TRACES filter uses Angular Material datepickers that open on the current month.
 * Day cells for other months are not present (or not the right month), so we must
 * navigate with prev/next until the target month/year is visible, then click the day.
 */
async function selectDateInOpenMatCalendar(page: Page, dateStr: string) {
  const { day, monthIndex, year, fullMonth } = parseTracesPaymentDateString(dateStr)
  const maxSteps = 120

  for (let step = 0; step < maxSteps; step++) {
    const headerText = await page.evaluate(() => {
      const span = document.querySelector(
        ".mat-datepicker-content .mat-calendar-period-button .mdc-button__label span[aria-hidden='true']"
      )
      return span?.textContent?.trim() ?? null
    })
    if (!headerText) {
      throw new Error("Material datepicker calendar header not found (is the popup open?)")
    }

    const view = parseMatCalendarPeriodLabel(headerText)
    if (!view) {
      throw new Error(`Could not parse Material calendar period: "${headerText}"`)
    }

    if (view.monthIndex === monthIndex && view.year === year) {
      const clicked = await page.evaluate(
        ({ fullMonth, day: d, year: y }) => {
          const targetLabel = `${fullMonth} ${d}, ${y}`
          const buttons = Array.from(
            document.querySelectorAll(
              ".mat-datepicker-content button.mat-calendar-body-cell[aria-label]"
            )
          ) as HTMLButtonElement[]
          const match = buttons.find((b) => b.getAttribute("aria-label") === targetLabel)
          if (match && !match.disabled && !match.classList.contains("mat-calendar-body-disabled")) {
            match.click()
            return true
          }
          if (match) {
            match.click()
            return true
          }
          return false
        },
        { fullMonth, day, year }
      )
      if (!clicked) {
        throw new Error(
          `Could not find selectable calendar day ${fullMonth} ${day}, ${year} (header ${headerText})`
        )
      }
      return
    }

    const viewOrdinal = view.year * 12 + view.monthIndex
    const targetOrdinal = year * 12 + monthIndex
    const prev = await page.$(
      ".mat-datepicker-content .mat-calendar-previous-button:not(.mat-mdc-button-disabled)"
    )
    const next = await page.$(
      ".mat-datepicker-content .mat-calendar-next-button:not(.mat-mdc-button-disabled)"
    )

    if (viewOrdinal > targetOrdinal) {
      if (!prev) {
        throw new Error(
          `Cannot go to earlier month for ${dateStr}: previous control disabled at ${headerText}`
        )
      }
      await prev.click()
    } else {
      if (!next) {
        throw new Error(
          `Cannot go to later month for ${dateStr}: next control disabled at ${headerText}`
        )
      }
      await next.click()
    }
    await waitForSecs(300)
  }

  throw new Error(`Material calendar navigation exceeded ${maxSteps} steps for ${dateStr}`)
}

/**
 * Parse challan receipt PDF and extract all details
 */
async function parsePaymentHistoryPdf(pdfPath: string): Promise<any[]> {
  try {
    const dataBuffer = fs.readFileSync(pdfPath)
    const pdfData = await pdfParse(dataBuffer)
    const text = pdfData.text

    // Helper function to extract value after a label
    const extractValue = (label: string, text: string): string => {
      // Try pattern with colon first
      let regex = new RegExp(`${label}\\s*[:]\\s*([^\\n]+)`, "i")
      let match = text.match(regex)
      if (match && match[1]) {
        return match[1].trim()
      }
      // Try pattern without colon
      regex = new RegExp(`${label}\\s+([^\\n]+)`, "i")
      match = text.match(regex)
      return match && match[1] ? match[1].trim() : ""
    }

    // Extract all fields from the challan receipt
    const row: any = {
      // Basic Information
      itnsNo: extractValue("ITNS No", text) || extractValue("ITNS", text),
      tan: extractValue("TAN", text),
      name: extractValue("Name", text),
      assessmentYear: extractValue("Assessment Year", text),
      financialYear: extractValue("Financial Year", text),

      // Payment Details
      majorHead: extractValue("Major Head", text),
      minorHead: extractValue("Minor Head", text),
      natureOfPayment: extractValue("Nature of Payment", text),
      amount: (() => {
        const amountText =
          extractValue("Amount \\(in Rs\\.\\)", text) ||
          extractValue("Amount.*Rs", text) ||
          extractValue("Amount", text)
        // Remove currency symbols, commas, and extract just the number
        return amountText.replace(/[₹,]/g, "").replace(/\s+/g, "").trim()
      })(),
      amountInWords:
        extractValue("Amount \\(in words\\)", text) ||
        extractValue("Amount.*words", text) ||
        extractValue("Rupees.*Only", text),

      // Transaction Details
      cin: extractValue("CIN", text),
      modeOfPayment: extractValue("Mode of Payment", text),
      bankName: extractValue("Bank Name", text),
      bankReferenceNumber: extractValue("Bank Reference Number", text),
      dateOfDeposit: extractValue("Date of Deposit", text),
      bsrCode: extractValue("BSR code", text) || extractValue("BSR", text),
      challanNo: extractValue("Challan No", text) || extractValue("Challan", text),
      tenderDate: extractValue("Tender Date", text),

      // Tax Breakup Details
      tax: "",
      surcharge: "",
      cess: "",
      interest: "",
      penalty: "",
      feeUnderSection234E: "",
      total: "",
      totalInWords: "",
    }

    // Extract Tax Breakup Details
    // Look for the section starting with "Tax Breakup Details"
    const taxBreakupStart = text.search(/Tax Breakup Details/i)
    if (taxBreakupStart >= 0) {
      // Get text from "Tax Breakup Details" to "Total (In Words)" or end of relevant section
      const remainingText = text.substring(taxBreakupStart)
      const taxBreakupEnd = remainingText.search(/Total.*?In Words|Thanks for being/i)
      const breakupText =
        taxBreakupEnd > 0 ? remainingText.substring(0, taxBreakupEnd) : remainingText

      // Split into lines for better parsing
      const lines = breakupText
        .split(/\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0)

      // Parse each line
      for (const line of lines) {
        // Extract Tax - Pattern: "A Tax ₹ 11,09,789" or "A Tax 11,09,789"
        // More flexible: allow optional leading whitespace and handle various formats
        if (/A\s+Tax/i.test(line) && !row.tax) {
          const match = line.match(/A\s+Tax[^0-9]*[₹]?\s*([\d,]+(?:\.[\d]{2,3})*)/i)
          if (match && match[1]) {
            row.tax = match[1].replace(/,/g, "").trim()
          }
        }

        // Extract Surcharge - Pattern: "B Surcharge ₹ 0" or "B Surcharge 0"
        if (/B\s+Surcharge/i.test(line) && !row.surcharge) {
          const match = line.match(/B\s+Surcharge[^0-9]*[₹]?\s*([\d,]+(?:\.[\d]{2,3})*)/i)
          if (match && match[1]) {
            row.surcharge = match[1].replace(/,/g, "").trim()
          }
        }

        // Extract Cess - Pattern: "C Cess ₹ 0" or "C Cess 0"
        if (/C\s+Cess/i.test(line) && !row.cess) {
          const match = line.match(/C\s+Cess[^0-9]*[₹]?\s*([\d,]+(?:\.[\d]{2,3})*)/i)
          if (match && match[1]) {
            row.cess = match[1].replace(/,/g, "").trim()
          }
        }

        // Extract Interest - Pattern: "D Interest ₹ 0" or "D Interest 0"
        if (/D\s+Interest/i.test(line) && !row.interest) {
          const match = line.match(/D\s+Interest[^0-9]*[₹]?\s*([\d,]+(?:\.[\d]{2,3})*)/i)
          if (match && match[1]) {
            row.interest = match[1].replace(/,/g, "").trim()
          }
        }

        // Extract Penalty - Pattern: "E Penalty ₹ 0" or "E Penalty 0"
        if (/E\s+Penalty/i.test(line) && !row.penalty) {
          const match = line.match(/E\s+Penalty[^0-9]*[₹]?\s*([\d,]+(?:\.[\d]{2,3})*)/i)
          if (match && match[1]) {
            row.penalty = match[1].replace(/,/g, "").trim()
          }
        }

        // Extract Fee under section 234E - Pattern: "F Fee under section 234E ₹ 0"
        if (/F\s+Fee/i.test(line) && !row.feeUnderSection234E) {
          const match = line.match(/F\s+Fee[^0-9]*234E[^0-9]*[₹]?\s*([\d,]+(?:\.[\d]{2,3})*)/i)
          if (match && match[1]) {
            row.feeUnderSection234E = match[1].replace(/,/g, "").trim()
          }
        }

        // Extract Total - Pattern: "Total (A+B+C+D+E+F) ₹ 11,09,789"
        if (/Total\s*\(/i.test(line) && !row.total) {
          const match = line.match(/Total\s*\([^)]+\)[^0-9]*[₹]?\s*([\d,]+(?:\.[\d]{2,3})*)/i)
          if (match && match[1]) {
            row.total = match[1].replace(/,/g, "").trim()
          }
        }
      }

      // Extract Total in Words - Look for it separately as it might be on a different line
      const totalWordsMatch = breakupText.match(/Total.*?Words.*?([A-Za-z][^T]*?Only)/i)
      row.totalInWords = totalWordsMatch && totalWordsMatch[1] ? totalWordsMatch[1].trim() : ""

      // If still no values, try alternative patterns (more flexible)
      if (!row.tax) {
        // Try pattern: "A Tax" followed by any amount
        const altTaxMatch = breakupText.match(/A\s*Tax[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i)
        row.tax = altTaxMatch && altTaxMatch[1] ? altTaxMatch[1].replace(/,/g, "").trim() : ""
      }
      if (!row.surcharge) {
        const altMatch = breakupText.match(/B\s*Surcharge[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i)
        row.surcharge = altMatch && altMatch[1] ? altMatch[1].replace(/,/g, "").trim() : ""
      }
      if (!row.cess) {
        const altMatch = breakupText.match(/C\s*Cess[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i)
        row.cess = altMatch && altMatch[1] ? altMatch[1].replace(/,/g, "").trim() : ""
      }
      if (!row.interest) {
        const altMatch = breakupText.match(/D\s*Interest[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i)
        row.interest = altMatch && altMatch[1] ? altMatch[1].replace(/,/g, "").trim() : ""
      }
      if (!row.penalty) {
        const altMatch = breakupText.match(/E\s*Penalty[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i)
        row.penalty = altMatch && altMatch[1] ? altMatch[1].replace(/,/g, "").trim() : ""
      }
      if (!row.feeUnderSection234E) {
        const altMatch = breakupText.match(
          /F\s*Fee[^A-Za-z0-9]*234E[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i
        )
        row.feeUnderSection234E =
          altMatch && altMatch[1] ? altMatch[1].replace(/,/g, "").trim() : ""
      }
      if (!row.total) {
        // Try multiple patterns for Total
        let altTotalMatch = breakupText.match(
          /Total\s*\([^)]+\)[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i
        )
        if (!altTotalMatch) {
          altTotalMatch = breakupText.match(/Total[^A-Za-z0-9]*([\d,]+(?:\.[\d]{2,3})*)/i)
        }
        row.total =
          altTotalMatch && altTotalMatch[1] ? altTotalMatch[1].replace(/,/g, "").trim() : ""
      }

      // Debug: Log extraction results
      if (!row.tax && !row.total) {
        console.log(
          `⚠️ Tax breakup section found but values not extracted from ${path.basename(pdfPath)}`
        )
        console.log(`Breakup text sample (first 400 chars):\n${breakupText.substring(0, 400)}`)
      } else {
        console.log(
          `✓ Tax breakup extracted from ${path.basename(pdfPath)}: Tax=${
            row.tax || "0"
          }, Surcharge=${row.surcharge || "0"}, Cess=${row.cess || "0"}, Total=${row.total || "0"}`
        )
      }
    } else {
      console.log(`⚠️ No tax breakup section found in ${path.basename(pdfPath)}`)
    }

    // Clean up amount field - remove currency symbols and commas
    if (row.amount) {
      row.amount = row.amount.replace(/[₹,]/g, "").trim()
    }

    // If we have at least TAN or CIN, consider it a valid challan
    if (row.tan || row.cin || row.challanNo) {
      return [row]
    }

    console.log(`No valid challan data found in ${path.basename(pdfPath)}`)
    return []
  } catch (error) {
    console.error(`Error parsing PDF ${pdfPath}:`, error)
    return []
  }
}

/**
 * Convert PDF files to Excel
 */
async function convertPdfsToExcel(
  downloadPath: string,
  companyName: string
): Promise<string | null> {
  try {
    console.log(`Converting PDFs to Excel in: ${downloadPath}`)

    // Wait a bit for all downloads to complete
    await waitForSecs(5000)

    // Find all PDF files in the download directory
    const files = fs.readdirSync(downloadPath)
    const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"))

    if (pdfFiles.length === 0) {
      console.log("No PDF files found to convert")
      return null
    }

    console.log(`Found ${pdfFiles.length} PDF files to process`)

    // Parse all PDFs and collect data
    const allRows: any[] = []
    for (const pdfFile of pdfFiles) {
      const pdfPath = path.join(downloadPath, pdfFile)
      console.log(`Parsing PDF: ${pdfFile}`)
      const rows = await parsePaymentHistoryPdf(pdfPath)
      allRows.push(...rows)
      console.log(`Extracted ${rows.length} rows from ${pdfFile}`)
    }

    if (allRows.length === 0) {
      console.log("No data extracted from PDFs")
      return null
    }

    // Create Excel workbook
    const workbook = XLSX.utils.book_new()

    // Define headers based on extracted data - all challan receipt fields
    const headers = [
      "TAN",
      "Name",
      "Assessment Year",
      "Financial Year",
      "Major Head",
      "Minor Head",
      "Nature of Payment",
      "Amount (Rs)",
      "Amount (in words)",
      "CIN",
      "Mode of Payment",
      "Bank Name",
      "Bank Reference Number",
      "Date of Deposit",
      "BSR Code",
      "Challan No",
      "Tender Date",
      "Tax",
      "Surcharge",
      "Cess",
      "Interest",
      "Penalty",
      "Fee under section 234E",
      "Total",
      "Total (In Words)",
    ]

    // Prepare data for Excel
    const excelData = [headers]
    for (const row of allRows) {
      excelData.push([
        row.tan || "",
        row.name || "",
        row.assessmentYear || "",
        row.financialYear || "",
        row.majorHead || "",
        row.minorHead || "",
        row.natureOfPayment || "",
        row.amount || "",
        row.amountInWords || "",
        row.cin || "",
        row.modeOfPayment || "",
        row.bankName || "",
        row.bankReferenceNumber || "",
        row.dateOfDeposit || "",
        row.bsrCode || "",
        row.challanNo || "",
        row.tenderDate || "",
        row.tax || "",
        row.surcharge || "",
        row.cess || "",
        row.interest || "",
        row.penalty || "",
        row.feeUnderSection234E || "",
        row.total || "",
        row.totalInWords || "",
      ])
    }

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData)

    // Set column widths for better readability
    worksheet["!cols"] = [
      { wch: 12 }, // TAN
      { wch: 35 }, // Name
      { wch: 15 }, // Assessment Year
      { wch: 15 }, // Financial Year
      { wch: 30 }, // Major Head
      { wch: 35 }, // Minor Head
      { wch: 15 }, // Nature of Payment
      { wch: 15 }, // Amount (Rs)
      { wch: 40 }, // Amount (in words)
      { wch: 20 }, // CIN
      { wch: 15 }, // Mode of Payment
      { wch: 20 }, // Bank Name
      { wch: 25 }, // Bank Reference Number
      { wch: 15 }, // Date of Deposit
      { wch: 12 }, // BSR Code
      { wch: 12 }, // Challan No
      { wch: 15 }, // Tender Date
      { wch: 15 }, // Tax
      { wch: 12 }, // Surcharge
      { wch: 12 }, // Cess
      { wch: 12 }, // Interest
      { wch: 12 }, // Penalty
      { wch: 20 }, // Fee under section 234E
      { wch: 15 }, // Total
      { wch: 40 }, // Total (In Words)
    ]

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payment History")

    // Save Excel file
    const excelFileName = `PaymentHistory_${companyName}_${
      new Date().toISOString().split("T")[0]
    }.xlsx`
    const excelPath = path.join(downloadPath, excelFileName)
    XLSX.writeFile(workbook, excelPath)

    console.log(`Excel file created: ${excelPath}`)
    console.log(`Total rows exported: ${allRows.length}`)

    return excelPath
  } catch (error) {
    console.error("Error converting PDFs to Excel:", error)
    return null
  }
}

/** Date input ids differ by tab (creation vs payment dates). Mat-selects use formcontrolname — not mat-select-value-N (unstable). */
export type EpayFilterModalDomIds = {
  fromDateInputId: string
  toDateInputId: string
}

/** Tab + output folder for the shared e-Pay filter + pagination + PDF download flow. */
export type EpayFilteredDownloadTabConfig = {
  tabText: "Payment History" | "Generated Challans"
  storageSubdir: string
  flowLabel: string
  filterModalDomIds: EpayFilterModalDomIds
}

export type PaymentHistoryDownloadStats = {
  totalSeen: number
  skipped: number
  downloaded: number
  pages: number
}

export type PaymentHistoryDownloadTarget = {
  cin: string
  paymentTime?: string
}

/** Download challan receipts for specific rows (match by payment date text + CIN in row). */
async function downloadPaymentHistoryRowsForCins(
  page: Page,
  targets: PaymentHistoryDownloadTarget[]
): Promise<{ downloaded: number; notFound: string[] }> {
  if (targets.length === 0) return { downloaded: 0, notFound: [] }

  return page.evaluate(async (missingTargets) => {
    function waitForSecs(timeout = 5000) {
      return new Promise((resolve) => setTimeout(() => resolve(true), timeout))
    }

    const notFound: string[] = []
    let downloaded = 0

    for (const target of missingTargets) {
      const cin = target.cin
      const datePart = target.paymentTime?.trim().split(/\s+/)[0] ?? ""
      const rows = Array.from(
        document.querySelectorAll("ag-grid-angular .ag-row")
      ) as HTMLElement[]
      const row = rows.find((r) => {
        const text = r.textContent || ""
        if (datePart && !text.includes(datePart)) return false
        return text.includes(cin)
      })
      if (!row) {
        notFound.push(cin)
        continue
      }
      const actionButton = row.querySelector(
        "app-e-pay-tax-actions .mat-mdc-icon-button"
      ) as HTMLElement | null
      if (!actionButton) {
        notFound.push(cin)
        continue
      }
      actionButton.click()
      await waitForSecs(500)
      ;(
        document.querySelector(".mat-mdc-menu-item.mat-focus-indicator") as HTMLElement | null
      )?.click()
      await waitForSecs(5000)
      downloaded++
    }

    return { downloaded, notFound }
  }, targets)
}

/** Fallback: download every row on the current page (legacy behavior). */
async function downloadAllPaymentHistoryRowsOnPage(page: Page): Promise<void> {
  await page.evaluate(async () => {
    function waitForSecs(timeout = 5000) {
      return new Promise((resolve) => setTimeout(() => resolve(true), timeout))
    }

    const actionButtons = [
      ...Array.from(
        document.querySelectorAll("app-e-pay-tax-actions .mat-mdc-icon-button")
      ),
    ]

    for (const btn of actionButtons) {
      ;(btn as HTMLElement).click()
      await waitForSecs(500)
      ;(
        document.querySelector(".mat-mdc-menu-item.mat-focus-indicator") as HTMLElement | null
      )?.click()
      await waitForSecs(5000)
    }
  })
}

async function clickNextPaymentHistoryPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const nextPageButtons = Array.from(
      document.querySelectorAll("button.buttonPag.mdc-icon-button.mat-mdc-icon-button")
    )
    const nextButton = nextPageButtons.find((btn) => {
      const img = btn.querySelector('img[alt="right arrow"]')
      return img !== null && !btn.hasAttribute("disabled")
    })
    if (nextButton) {
      ;(nextButton as HTMLElement).click()
      return true
    }
    return false
  })
}

type PaymentHistoryCapture = ReturnType<typeof createPaymentHistoryResponseCapture>

function createPaymentHistoryResponseCapture(page: Page) {
  let pending: { url: string; json: unknown } | null = null
  let lastConsumedUrl = ""

  const onResponse = async (response: { url: () => string; json: () => Promise<unknown> }) => {
    const url = response.url()
    if (!isPaymentHistoryApiUrl(url)) return
    try {
      pending = { url, json: await response.json() }
    } catch {
      /* ignore parse errors */
    }
  }

  page.on("response", onResponse)

  const take = async (timeoutMs = 60000): Promise<string[]> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (pending && pending.url !== lastConsumedUrl) {
        lastConsumedUrl = pending.url
        const json = pending.json
        pending = null
        return parsePaymentHistoryCins(json)
      }
      await waitForSecs(200)
    }
    return []
  }

  const reset = () => {
    pending = null
    lastConsumedUrl = ""
  }

  const dispose = () => page.off("response", onResponse)

  return { take, dispose, reset }
}

type PaymentHistoryInterceptOptions = {
  /** Only attempt downloads for these CINs (used with payment-date filter batches). */
  targetCins?: Set<string>
  /** Map CIN → paymentTime from gaps JSON for row matching. */
  targetPaymentTimes?: Map<string, string>
}

function targetsStillMissing(companyName: string, cins: Set<string>): PaymentHistoryDownloadTarget[] {
  return Array.from(cins)
    .filter((cin) => !paymentHistoryPdfExistsForCompany(companyName, cin))
    .map((cin) => ({ cin }))
}

/** Payment History: intercept API for CINs, skip existing PDFs, download only missing. */
async function runPaymentHistoryDownloadWithIntercept(
  page: Page,
  companyName: string,
  capture: PaymentHistoryCapture,
  options?: PaymentHistoryInterceptOptions
): Promise<PaymentHistoryDownloadStats> {
  const stats: PaymentHistoryDownloadStats = {
    totalSeen: 0,
    skipped: 0,
    downloaded: 0,
    pages: 0,
  }

  let pageNum = 0
  while (true) {
    pageNum++
    stats.pages = pageNum
    console.log(`Processing Payment History page ${pageNum}...`)

    const cins = await capture.take(pageNum === 1 ? 60000 : 30000)

    if (cins.length === 0) {
      console.log(
        `No CINs from paymenthistory intercept on page ${pageNum} — falling back to download all rows`
      )
      await downloadAllPaymentHistoryRowsOnPage(page)
      const rowCount = await page.evaluate(
        () => document.querySelectorAll("app-e-pay-tax-actions .mat-mdc-icon-button").length
      )
      stats.downloaded += rowCount
      stats.totalSeen += rowCount
    } else {
      stats.totalSeen += cins.length
      let missingCins = cins.filter((cin) => !paymentHistoryPdfExistsForCompany(companyName, cin))
      if (options?.targetCins) {
        missingCins = missingCins.filter((cin) => options.targetCins!.has(cin))
      }
      const skippedOnPage = cins.length - missingCins.length
      stats.skipped += skippedOnPage

      console.log(
        `Page ${pageNum}: ${cins.length} payments, ${skippedOnPage} skipped on page, ${missingCins.length} to download`
      )

      if (missingCins.length > 0) {
        const targets: PaymentHistoryDownloadTarget[] = missingCins.map((cin) => ({
          cin,
          paymentTime: options?.targetPaymentTimes?.get(cin),
        }))
        const result = await downloadPaymentHistoryRowsForCins(page, targets)
        stats.downloaded += result.downloaded
        if (result.notFound.length > 0) {
          console.log(
            `Warning: CIN(s) not found in grid on page ${pageNum}: ${result.notFound.join(", ")}`
          )
        }
      }

      if (options?.targetCins) {
        const pending = targetsStillMissing(companyName, options.targetCins)
        if (pending.length === 0) {
          console.log("All target CINs for this date range have PDFs — stopping pagination")
          break
        }
      }
    }

    const hasNext = await clickNextPaymentHistoryPage(page)
    if (!hasNext) {
      console.log("No more Payment History pages")
      break
    }
    await waitForSecs(3000)
  }

  console.log(
    `Payment History summary: ${stats.totalSeen} seen, ${stats.skipped} skipped (existing PDF), ${stats.downloaded} downloaded, ${stats.pages} pages`
  )
  return stats
}

const PAYMENT_HISTORY_FILTER_DOM: EpayFilterModalDomIds = {
  fromDateInputId: "frompayment",
  toDateInputId: "topayment",
}

/** Apply Payment History tab filters (payment date range required for missing-PDF batch downloads). */
async function applyPaymentHistoryFilters(
  page: Page,
  params: {
    fromDate?: string
    toDate?: string
    assessmentYear?: string
    paymentType?: string
  }
) {
  const { fromDate, toDate, assessmentYear, paymentType } = params
  const dom = PAYMENT_HISTORY_FILTER_DOM

  if (!assessmentYear && !paymentType && !(fromDate && toDate)) {
    return
  }

  console.log("Applying Payment History filters...", { fromDate, toDate, assessmentYear, paymentType })

  await page.waitForSelector("button.defaultButton.filterButton")
  await page.click("button.defaultButton.filterButton")
  await waitForSecs(2000)

  const openMatSelectInFilterModal = async (formControlName: "assessmentYear" | "typeOfPayment") => {
    const opened = await page.evaluate((name) => {
      const modalBody =
        document.querySelector(".modal.show .modal-body") ??
        Array.from(document.querySelectorAll(".modal-body")).find(
          (b) => (b as HTMLElement).offsetParent !== null
        ) ??
        null
      const sel = modalBody?.querySelector(
        `mat-select[formcontrolname="${name}"]`
      ) as HTMLElement | null
      if (!sel) return false
      sel.click()
      return true
    }, formControlName)
    if (!opened) {
      console.log(`Warning: mat-select[formcontrolname=${formControlName}] not found in filter modal`)
    }
    await waitForSecs(400)
    try {
      await page.waitForSelector(".cdk-overlay-container mat-option", { visible: true, timeout: 8000 })
    } catch {
      console.log(`Warning: mat-option panel did not appear for ${formControlName}`)
    }
  }

  const clickMatOptionByExactLabel = async (label: string) => {
    const clicked = await page.evaluate((want) => {
      const norm = (s: string) => s.replace(/\s+/g, " ").trim()
      const wantNorm = norm(want)
      const options = Array.from(
        document.querySelectorAll(".cdk-overlay-container mat-option")
      ) as HTMLElement[]
      const target = options.find((opt) => norm(opt.textContent || "") === wantNorm)
      if (target) {
        target.click()
        return true
      }
      const loose = options.find((opt) => norm(opt.textContent || "").includes(wantNorm))
      if (loose) {
        loose.click()
        return true
      }
      return false
    }, label)
    if (!clicked) {
      console.log(`Warning: no mat-option matched label: "${label}"`)
    }
    await waitForSecs(600)
  }

  if (assessmentYear) {
    await openMatSelectInFilterModal("assessmentYear")
    await clickMatOptionByExactLabel(assessmentYear)
  }

  if (paymentType) {
    await openMatSelectInFilterModal("typeOfPayment")
    await clickMatOptionByExactLabel(paymentType)
  }

  if (fromDate && toDate) {
    const fromInputId = dom.fromDateInputId
    const toInputId = dom.toDateInputId

    await page.evaluate((inputId) => {
      const fromInput = document.getElementById(inputId)
      if (fromInput) {
        const parent = fromInput.closest("mat-form-field")
        const calendarButton = parent?.querySelector(
          'mat-datepicker-toggle button[aria-label="Open calendar"]'
        )
        if (calendarButton) {
          ;(calendarButton as HTMLElement).click()
        }
      }
    }, fromInputId)
    await waitForSecs(1000)
    await selectDateInOpenMatCalendar(page, fromDate)
    await waitForSecs(500)

    await page.evaluate((inputId) => {
      const toInput = document.getElementById(inputId)
      if (toInput) {
        const parent = toInput.closest("mat-form-field")
        const calendarButton = parent?.querySelector(
          'mat-datepicker-toggle button[aria-label="Open calendar"]'
        )
        if (calendarButton) {
          ;(calendarButton as HTMLElement).click()
        }
      }
    }, toInputId)
    await waitForSecs(1000)
    await selectDateInOpenMatCalendar(page, toDate)
    await waitForSecs(500)
  }

  await waitForSecs(1000)
  const filterClicked = await page.evaluate(() => {
    const filterSection = Array.from(document.querySelectorAll(".filter-section.mt-3.mr-3")).find(
      (el) => !el.hasAttribute("hidden") && ((el as HTMLElement).offsetParent !== null)
    )
    if (!filterSection) return false

    const modalFooter = filterSection.querySelector(".modal-footer")
    if (modalFooter) {
      const buttons = Array.from(modalFooter.querySelectorAll("button"))
      const filterButton = buttons.find((btn) => btn.textContent?.trim() === "Filter")
      if (filterButton) {
        ;(filterButton as HTMLElement).click()
        return true
      }
    }

    const filterButtons = Array.from(
      filterSection.querySelectorAll("button.defaultButton.primaryButton")
    )
    const filterButton = filterButtons.find((btn) => btn.textContent?.trim() === "Filter")
    if (filterButton) {
      ;(filterButton as HTMLElement).click()
      return true
    }
    return false
  })

  if (!filterClicked) {
    console.log("Warning: Could not click Filter in modal")
  }
  await waitForSecs(3000)
}

/** Generated Challans: download all rows on every page (unchanged legacy behavior). */
async function runGeneratedChallansDownloadAllPages(page: Page): Promise<void> {
  await page.evaluate(async () => {
    function waitForSecs(timeout = 5000) {
      return new Promise((resolve) => {
        setTimeout(() => resolve(true), timeout)
      })
    }

    let pageCount = 0
    while (true) {
      pageCount++
      console.log(`Processing page ${pageCount}...`)

      const actionButtons = [
        ...Array.from(
          document.querySelectorAll("app-e-pay-tax-actions .mat-mdc-icon-button")
        ),
      ]

      if (actionButtons.length === 0) {
        console.log("No records found on this page")
        break
      }

      console.log(`Found ${actionButtons.length} records on page ${pageCount}`)

      for (const btn of actionButtons) {
        ;(btn as HTMLElement).click()
        await waitForSecs(500)
        ;(
          document.querySelector(".mat-mdc-menu-item.mat-focus-indicator") as HTMLElement | null
        )?.click()
        await waitForSecs(5000)
      }

      const nextPageButtons = Array.from(
        document.querySelectorAll("button.buttonPag.mdc-icon-button.mat-mdc-icon-button")
      )

      const nextButton = nextPageButtons.find((btn) => {
        const img = btn.querySelector('img[alt="right arrow"]')
        return img !== null && !btn.hasAttribute("disabled")
      })

      if (nextButton) {
        console.log("Moving to next page...")
        ;(nextButton as HTMLElement).click()
        await waitForSecs(3000)
      } else {
        console.log("No more pages or next button is disabled")
        break
      }
    }

    console.log(`Completed processing ${pageCount} pages`)
  })
}

async function runChallanEpayFilterDownload(
  Username: string,
  Password: string,
  companyName: string,
  fromDate: string | undefined,
  toDate: string | undefined,
  assessmentYear: string | undefined,
  paymentType: string | undefined,
  options: DownloadChallansOptions | undefined,
  kind: EpayFilteredDownloadTabConfig
): Promise<PaymentHistoryDownloadStats | void> {
  const skipNewActRadio = options?.skipNewActRadio === true
  const dom = kind.filterModalDomIds
  console.log(`Downloading e-Pay (${kind.flowLabel}) for company:`, companyName)
  console.log(
    `e-pay ${kind.flowLabel} flow: skip Income-tax Act 2025 radio (old only):`,
    skipNewActRadio
  )
  console.log("Username:", Username)
  console.log("Password:", Password)
  console.log("From Date:", fromDate)
  console.log("To Date:", toDate)
  console.log("Assessment Year:", assessmentYear)
  console.log("Payment Type:", paymentType)

  // Launch a headless browser
  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
    process.platform === "darwin"
      ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
      : process.platform === "win32"
      ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
      : undefined, // Use default for Linux
    args: [
      "--start-maximized", // you can also use '--start-fullscreen'
    ],
  })

  // Open a new page
  const page = await browser.newPage()

  // Set the download behavior to use the custom download path
  const downloadPath = path.resolve(`./public/pdf/challans/${companyName}/${kind.storageSubdir}`)
  const client = await page.createCDPSession()
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }
  await client.send("Page.setDownloadBehavior", {
    behavior: "allow",
    downloadPath,
  })

  // Navigate to a website
  await page.goto("https://eportal.incometax.gov.in/iec/foservices/#/login")

  // Click a button that triggers XHR requests
  await login(page, Username, Password)
  
  await navigateToEpayTaxViaMenu(page)
  if (skipNewActRadio) {
    console.log(`Old Act — skipping #mat-radio-0, Continue only (${kind.flowLabel})`)
    await clickContinueAfterEpayLanding(page)
  } else {
    console.log(`Waiting for Income-tax Act 2025 radio (#mat-radio-0) (${kind.flowLabel})`)
    await page.waitForSelector("#mat-radio-0", { visible: true, timeout: 120000 })
    await page.click("#mat-radio-0")
    console.log(`Clicked on the radio button (${kind.flowLabel})`)
    await clickContinueAfterEpayLanding(page)
  }
  await page.waitForSelector(".mdc-tab__text-label")
  const elements = await page.$$(".mdc-tab__text-label")

  const isPaymentHistory = kind.tabText === "Payment History"
  const paymentHistoryCapture = isPaymentHistory
    ? createPaymentHistoryResponseCapture(page)
    : null

  await waitForSecs(6000)
  for (let element of elements) {
    // Get the text content of each element
    const text = await page.evaluate((el) => el.textContent?.trim(), element)

    if (text === kind.tabText) {
      await element.click()
    }
  }

  await waitForSecs(5000)

  if (isPaymentHistory) {
    await applyPaymentHistoryFilters(page, { fromDate, toDate, assessmentYear, paymentType })
  } else if (assessmentYear || paymentType || (fromDate && toDate)) {
    console.log("Applying filters using the portal's filter modal...")
    await page.waitForSelector("button.defaultButton.filterButton")
    await page.click("button.defaultButton.filterButton")
    await waitForSecs(2000)
    // Generated Challans tab keeps inline filter logic (different date input ids via dom)
    const openMatSelectInFilterModal = async (formControlName: "assessmentYear" | "typeOfPayment") => {
      const opened = await page.evaluate((name) => {
        const modalBody =
          document.querySelector(".modal.show .modal-body") ??
          Array.from(document.querySelectorAll(".modal-body")).find(
            (b) => (b as HTMLElement).offsetParent !== null
          ) ??
          null
        const sel = modalBody?.querySelector(
          `mat-select[formcontrolname="${name}"]`
        ) as HTMLElement | null
        if (!sel) return false
        sel.click()
        return true
      }, formControlName)
      if (!opened) {
        console.log(`Warning: mat-select[formcontrolname=${formControlName}] not found in filter modal`)
      }
      await waitForSecs(400)
      try {
        await page.waitForSelector(".cdk-overlay-container mat-option", { visible: true, timeout: 8000 })
      } catch {
        console.log(`Warning: mat-option panel did not appear for ${formControlName}`)
      }
    }

    const clickMatOptionByExactLabel = async (label: string) => {
      const clicked = await page.evaluate((want) => {
        const norm = (s: string) => s.replace(/\s+/g, " ").trim()
        const wantNorm = norm(want)
        const options = Array.from(
          document.querySelectorAll(".cdk-overlay-container mat-option")
        ) as HTMLElement[]
        const target = options.find((opt) => norm(opt.textContent || "") === wantNorm)
        if (target) {
          target.click()
          return true
        }
        const loose = options.find((opt) => norm(opt.textContent || "").includes(wantNorm))
        if (loose) {
          loose.click()
          return true
        }
        return false
      }, label)
      if (!clicked) {
        console.log(`Warning: no mat-option matched label: "${label}"`)
      }
      await waitForSecs(600)
    }

    if (assessmentYear) {
      await openMatSelectInFilterModal("assessmentYear")
      await clickMatOptionByExactLabel(assessmentYear)
    }
    if (paymentType) {
      await openMatSelectInFilterModal("typeOfPayment")
      await clickMatOptionByExactLabel(paymentType)
    }
    if (fromDate && toDate) {
      const fromInputId = dom.fromDateInputId
      const toInputId = dom.toDateInputId
      await page.evaluate((inputId) => {
        const fromInput = document.getElementById(inputId)
        if (fromInput) {
          const parent = fromInput.closest("mat-form-field")
          const calendarButton = parent?.querySelector(
            'mat-datepicker-toggle button[aria-label="Open calendar"]'
          )
          if (calendarButton) {
            ;(calendarButton as HTMLElement).click()
          }
        }
      }, fromInputId)
      await waitForSecs(1000)
      await selectDateInOpenMatCalendar(page, fromDate)
      await waitForSecs(500)
      await page.evaluate((inputId) => {
        const toInput = document.getElementById(inputId)
        if (toInput) {
          const parent = toInput.closest("mat-form-field")
          const calendarButton = parent?.querySelector(
            'mat-datepicker-toggle button[aria-label="Open calendar"]'
          )
          if (calendarButton) {
            ;(calendarButton as HTMLElement).click()
          }
        }
      }, toInputId)
      await waitForSecs(1000)
      await selectDateInOpenMatCalendar(page, toDate)
      await waitForSecs(500)
    }

    await waitForSecs(1000)
    const filterClicked = await page.evaluate(() => {
      const filterSection = Array.from(document.querySelectorAll(".filter-section.mt-3.mr-3")).find(
        (el) => !el.hasAttribute("hidden") && ((el as HTMLElement).offsetParent !== null)
      )
      if (!filterSection) return false
      const modalFooter = filterSection.querySelector(".modal-footer")
      if (modalFooter) {
        const buttons = Array.from(modalFooter.querySelectorAll("button"))
        const filterButton = buttons.find((btn) => btn.textContent?.trim() === "Filter")
        if (filterButton) {
          ;(filterButton as HTMLElement).click()
          return true
        }
      }
      const filterButtons = Array.from(
        filterSection.querySelectorAll("button.defaultButton.primaryButton")
      )
      const filterButton = filterButtons.find((btn) => btn.textContent?.trim() === "Filter")
      if (filterButton) {
        ;(filterButton as HTMLElement).click()
        return true
      }
      return false
    })
    if (!filterClicked) {
      console.log("Warning: Could not find filter button")
    }
    await waitForSecs(3000)
  }

  await page.evaluate(() => {
    ;[...Array.from(document.querySelectorAll("ag-grid-angular .ag-row.ag-row-first"))].forEach(
      (e) => {
        e.children[e.children.length - 1]?.scrollIntoView()
      }
    )
  })

  let paymentHistoryStats: PaymentHistoryDownloadStats | undefined
  if (isPaymentHistory && paymentHistoryCapture) {
    paymentHistoryStats = await runPaymentHistoryDownloadWithIntercept(
      page,
      companyName,
      paymentHistoryCapture
    )
    paymentHistoryCapture.dispose()
  } else {
    await runGeneratedChallansDownloadAllPages(page)
  }

  // Wait a bit for all downloads to complete
  await waitForSecs(10000)

  // browser.close()

  // Convert downloaded PDFs to Excel
  console.log("Starting PDF to Excel conversion...")
  const excelPath = await convertPdfsToExcel(downloadPath, companyName)
  if (excelPath) {
    console.log(`✅ Successfully converted PDFs to Excel: ${excelPath}`)
  } else {
    console.log("⚠️ Could not convert PDFs to Excel")
  }

  return paymentHistoryStats
}

export type MissingPaymentPdfDownloadResult = PaymentHistoryDownloadStats & {
  dateRangesProcessed: number
  stillMissing: number
  dayGroups: Array<{ dayKey: string; count: number }>
}

/**
 * Download only missing Payment History PDFs using payment-date filters per day
 * (from payment_history_gaps.json `paymentTime` field). No CIN search on portal.
 */
export async function downloadMissingPaymentHistoryPdfs(
  Username: string,
  Password: string,
  companyName: string,
  options?: DownloadChallansOptions & {
    missing?: Array<{ cin: string; paymentTime?: string; assessmentYear?: string; paymentType?: string }>
  }
): Promise<MissingPaymentPdfDownloadResult> {
  const skipNewActRadio = options?.skipNewActRadio === true

  let missingRows = options?.missing ?? loadMissingFromGapsJson(companyName)
  missingRows = missingRows.filter((r) => !paymentHistoryPdfExistsForCompany(companyName, r.cin))

  if (missingRows.length === 0) {
    console.log("[downloadMissingPaymentHistoryPdfs] No missing PDFs to download")
    return {
      totalSeen: 0,
      skipped: 0,
      downloaded: 0,
      pages: 0,
      dateRangesProcessed: 0,
      stillMissing: 0,
      dayGroups: [],
    }
  }

  const dayGroups = groupMissingByPaymentDay(companyName, missingRows).map((g) => ({
    ...g,
    items: g.items.filter((i) => !paymentHistoryPdfExistsForCompany(companyName, i.cin)),
    cins: g.cins.filter((cin) => !paymentHistoryPdfExistsForCompany(companyName, cin)),
  })).filter((g) => g.cins.length > 0)

  console.log(
    `[downloadMissingPaymentHistoryPdfs] ${missingRows.length} missing PDFs across ${dayGroups.length} payment date(s)`
  )

  const browser = await puppeteer.launch({
    headless: false,
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : undefined,
    args: ["--start-maximized"],
  })

  const page = await browser.newPage()
  const downloadPath = path.resolve(`./public/pdf/challans/${companyName}/PaymentHistory`)
  const client = await page.createCDPSession()
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }
  await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath })

  const capture = createPaymentHistoryResponseCapture(page)
  const aggregate: PaymentHistoryDownloadStats = {
    totalSeen: 0,
    skipped: 0,
    downloaded: 0,
    pages: 0,
  }

  try {
    await page.goto("https://eportal.incometax.gov.in/iec/foservices/#/login")
    await login(page, Username, Password)
    await navigateToEpayTaxViaMenu(page)

    if (skipNewActRadio) {
      await clickContinueAfterEpayLanding(page)
    } else {
      await page.waitForSelector("#mat-radio-0", { visible: true, timeout: 120000 })
      await page.click("#mat-radio-0")
      await clickContinueAfterEpayLanding(page)
    }

    await page.waitForSelector(".mdc-tab__text-label")
    const elements = await page.$$(".mdc-tab__text-label")
    await waitForSecs(6000)
    for (const element of elements) {
      const text = await page.evaluate((el) => el.textContent?.trim(), element)
      if (text === "Payment History") {
        await element.click()
      }
    }
    await waitForSecs(5000)

    for (let i = 0; i < dayGroups.length; i++) {
      const group = dayGroups[i]!
      console.log(
        `\n[downloadMissingPaymentHistoryPdfs] Date batch ${i + 1}/${dayGroups.length}: ${group.dayKey} (${group.cins.length} CINs)`
      )

      capture.reset()
      await applyPaymentHistoryFilters(page, {
        fromDate: group.fromDate,
        toDate: group.toDate,
        assessmentYear: group.assessmentYear,
        paymentType: group.paymentType,
      })

      await page.evaluate(() => {
        ;[...Array.from(document.querySelectorAll("ag-grid-angular .ag-row.ag-row-first"))].forEach(
          (e) => {
            e.children[e.children.length - 1]?.scrollIntoView()
          }
        )
      })

      const targetPaymentTimes = new Map<string, string>()
      for (const item of group.items) {
        if (item.paymentTime) {
          targetPaymentTimes.set(item.cin, item.paymentTime)
        }
      }

      const dayStats = await runPaymentHistoryDownloadWithIntercept(page, companyName, capture, {
        targetCins: new Set(group.cins),
        targetPaymentTimes,
      })

      aggregate.totalSeen += dayStats.totalSeen
      aggregate.skipped += dayStats.skipped
      aggregate.downloaded += dayStats.downloaded
      aggregate.pages += dayStats.pages
    }

    await waitForSecs(10000)
    await convertPdfsToExcel(downloadPath, companyName)
  } finally {
    capture.dispose()
    await browser.close()
  }

  const stillMissing = missingRows.filter(
    (r) => !paymentHistoryPdfExistsForCompany(companyName, r.cin)
  ).length

  console.log(
    `[downloadMissingPaymentHistoryPdfs] Done: downloaded ${aggregate.downloaded}, still missing ${stillMissing}`
  )

  return {
    ...aggregate,
    dateRangesProcessed: dayGroups.length,
    stillMissing,
    dayGroups: dayGroups.map((g) => ({ dayKey: g.dayKey, count: g.cins.length })),
  }
}

/** Payment History tab: same filters, pagination, PDF download, and Excel merge as legacy flow. */
export async function downloadChallanPayments(
  Username: string,
  Password: string,
  companyName: string,
  fromDate?: string,
  toDate?: string,
  assessmentYear?: string,
  paymentType?: string,
  options?: DownloadChallansOptions
) {
  return runChallanEpayFilterDownload(
    Username,
    Password,
    companyName,
    fromDate,
    toDate,
    assessmentYear,
    paymentType,
    options,
    {
      tabText: "Payment History",
      storageSubdir: "PaymentHistory",
      flowLabel: "Payment History",
      filterModalDomIds: {
        fromDateInputId: "frompayment",
        toDateInputId: "topayment",
      },
    }
  )
}

/**
 * Same as {@link downloadChallanPayments} (filters, date range, assessment year, payment type,
 * `skipNewActRadio`, multi-page PDF downloads, PDF→Excel) but opens the **Generated Challans** tab.
 */
export async function downloadGeneratedChallansWithFilters(
  Username: string,
  Password: string,
  companyName: string,
  fromDate?: string,
  toDate?: string,
  assessmentYear?: string,
  paymentType?: string,
  options?: DownloadChallansOptions
) {
  return runChallanEpayFilterDownload(
    Username,
    Password,
    companyName,
    fromDate,
    toDate,
    assessmentYear,
    paymentType,
    options,
    {
      tabText: "Generated Challans",
      storageSubdir: "GeneratedChallansFiltered",
      flowLabel: "Generated Challans",
      filterModalDomIds: {
        fromDateInputId: "fromchallan",
        toDateInputId: "tochallan",
      },
    }
  )
}
