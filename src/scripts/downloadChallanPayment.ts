import puppeteer from "puppeteer-extra"
import fs from "fs"
// add stealth plugin and use defaults (all evasion techniques)
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { Page } from "puppeteer"
import { waitForSecs } from "src/utils/promises"
import {
  clickContinueAfterEpayLanding,
  type DownloadChallansOptions,
  type EpayRowDownloadTarget,
} from "./downloadChallan"
import path from "path"
import pdfParse from "pdf-parse"
import * as XLSX from "xlsx"
import {
  buildMissingPaymentsDateRange,
  loadMissingFromGapsJson,
  paymentHistoryDir,
  paymentHistoryPdfExists as paymentHistoryPdfExistsForCompany,
} from "src/challan/utils/paymentHistoryFiles"
puppeteer.use(StealthPlugin())

const PAYMENT_HISTORY_API_PATH = "/paymentapi/auth/challan/paymenthistory"

type PaymentHistoryApiResponse = {
  successFlag?: boolean
  paymentList?: {
    content?: Array<{ cin?: string }>
    last?: boolean
    first?: boolean
    empty?: boolean
    totalPages?: number
    totalElements?: number
    number?: number
    numberOfElements?: number
    size?: number
    pageable?: {
      pageNumber?: number
      pageSize?: number
    }
  }
}

type PaymentHistoryPageCapture = {
  cins: string[]
  pageNumber: number
  totalPages: number
  totalElements: number
  last: boolean
  empty: boolean
  numberOfElements: number
}

function parsePaymentHistoryPage(json: unknown): PaymentHistoryPageCapture {
  const data = json as PaymentHistoryApiResponse
  const list = data?.paymentList
  const content = list?.content
  const cins = Array.isArray(content)
    ? content
        .map((item) => item.cin)
        .filter((cin): cin is string => typeof cin === "string" && cin.length > 0)
    : []

  const pageNumber =
    typeof list?.pageable?.pageNumber === "number"
      ? list.pageable.pageNumber
      : typeof list?.number === "number"
      ? list.number
      : 0
  const totalPages = typeof list?.totalPages === "number" ? list.totalPages : 0
  const totalElements = typeof list?.totalElements === "number" ? list.totalElements : cins.length
  const last =
    list?.last === true ||
    (totalPages > 0 && pageNumber >= totalPages - 1) ||
    list?.empty === true ||
    (Array.isArray(content) && content.length === 0)
  const empty = list?.empty === true || cins.length === 0
  const numberOfElements =
    typeof list?.numberOfElements === "number" ? list.numberOfElements : cins.length

  return {
    cins,
    pageNumber,
    totalPages,
    totalElements,
    last,
    empty,
    numberOfElements,
  }
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

function cleanMoney(value: string): string {
  return (value || "").replace(/[₹,\s]/g, "").trim()
}

/** Label may be followed by value on the same line or the next non-empty line. */
function extractLabeledValue(text: string, label: string): string {
  const sameLine = text.match(new RegExp(`${label}\\s*[:]\\s*([^\\n]+)`, "i"))
  if (sameLine?.[1]?.trim()) return sameLine[1].trim()

  const nextLine = text.match(new RegExp(`${label}\\s*[:]?\\s*\\n\\s*([^\\n]+)`, "i"))
  if (nextLine?.[1]?.trim()) return nextLine[1].trim()

  const loose = text.match(new RegExp(`${label}\\s+([^\\n]+)`, "i"))
  return loose?.[1]?.trim() || ""
}

function extractBreakupAmount(breakupText: string, pattern: RegExp): string {
  const match = breakupText.match(pattern)
  return match?.[1] ? cleanMoney(match[1]) : ""
}

type SectionWiseRow = {
  sno: string
  sectionDescription: string
  section: string
  sectionCode: string
  sectionTax: string
  sectionSurcharge: string
  sectionEduCess: string
  sectionTotal: string
}

/** Parse TDS/TCS Section-Wise Payment Details (Description / Section / Code / amounts). */
function parseSectionWiseRows(text: string): SectionWiseRow[] {
  const start = text.search(/TDS\/TCS\s*Section-Wise\s*Payment\s*Details/i)
  if (start < 0) return []

  const remaining = text.slice(start)
  const endRel = remaining.search(/Tax\s*Breakup\s*Details/i)
  const block = endRel > 0 ? remaining.slice(0, endRel) : remaining

  // Portal PDF text glues Section+Code, e.g. "-1022₹ 3,31,950₹ 0₹ 0₹ 3,31,950"
  const rowRegex =
    /(\d+)([\s\S]*?)\n(-?)(\d{3,4})₹\s*([\d,]+(?:\.\d+)?)₹\s*([\d,]+(?:\.\d+)?)₹\s*([\d,]+(?:\.\d+)?)₹\s*([\d,]+(?:\.\d+)?)/g

  const rows: SectionWiseRow[] = []
  let match: RegExpExecArray | null
  while ((match = rowRegex.exec(block)) !== null) {
    const sno = match[1] || ""
    const description = (match[2] || "")
      .replace(/DescriptionSectionCodeTax[\s\S]*?Total\s*\(a\+b\+c\)/i, "")
      .replace(/\s+/g, " ")
      .trim()
    rows.push({
      sno,
      sectionDescription: description,
      section: (match[3] || "").trim() || "-",
      sectionCode: (match[4] || "").trim(),
      sectionTax: cleanMoney(match[5] || ""),
      sectionSurcharge: cleanMoney(match[6] || ""),
      sectionEduCess: cleanMoney(match[7] || ""),
      sectionTotal: cleanMoney(match[8] || ""),
    })
  }

  return rows
}

/**
 * Parse challan receipt PDF and extract all details (header + section-wise + tax breakup).
 * One Excel row per section-wise line when present; otherwise a single challan row.
 */
async function parsePaymentHistoryPdf(
  pdfPath: string,
  options?: { quiet?: boolean }
): Promise<any[]> {
  const log = (...args: unknown[]) => {
    if (!options?.quiet) console.log(...args)
  }
  try {
    const dataBuffer = fs.readFileSync(pdfPath)
    const pdfData = await pdfParse(dataBuffer)
    const text = pdfData.text

    const amountRaw =
      extractLabeledValue(text, "Amount \\(in Rs\\.\\)") ||
      extractLabeledValue(text, "Amount \\(in Rs\\)") ||
      extractLabeledValue(text, "Amount")

    const base: any = {
      itnsNo: extractLabeledValue(text, "ITNS No\\.?") || extractLabeledValue(text, "ITNS"),
      tan: extractLabeledValue(text, "TAN"),
      name: extractLabeledValue(text, "Name"),
      taxYear: extractLabeledValue(text, "Tax Year"),
      assessmentYear: extractLabeledValue(text, "Assessment Year"),
      financialYear: extractLabeledValue(text, "Financial Year"),
      majorHead: extractLabeledValue(text, "Major Head"),
      minorHead: extractLabeledValue(text, "Minor Head"),
      residentialStatus: extractLabeledValue(text, "Residential Status"),
      natureOfPayment: extractLabeledValue(text, "Nature of Payment"),
      amount: cleanMoney(amountRaw),
      amountInWords:
        extractLabeledValue(text, "Amount \\(in words\\)") ||
        (text.match(/Rupees[\s\S]*?Only/i)?.[0] || "").replace(/\s+/g, " ").trim(),
      cin: extractLabeledValue(text, "CIN"),
      modeOfPayment: extractLabeledValue(text, "Mode of Payment"),
      bankName: extractLabeledValue(text, "Bank Name"),
      bankReferenceNumber: extractLabeledValue(text, "Bank Reference Number"),
      dateOfDeposit: extractLabeledValue(text, "Date of Deposit"),
      bsrCode: extractLabeledValue(text, "BSR code") || extractLabeledValue(text, "BSR"),
      challanNo: extractLabeledValue(text, "Challan No"),
      tenderDate: extractLabeledValue(text, "Tender Date"),
      tax: "",
      surcharge: "",
      cess: "",
      interest: "",
      penalty: "",
      feeUnderSection: "",
      others: "",
      total: "",
      totalInWords: "",
      sourcePdf: path.basename(pdfPath),
    }

    // Newer receipts use Tax Year; keep Assessment Year filled for Excel consumers.
    if (!base.assessmentYear && base.taxYear) {
      base.assessmentYear = base.taxYear
    }

    const taxBreakupStart = text.search(/Tax\s*Breakup\s*Details/i)
    if (taxBreakupStart >= 0) {
      const remainingText = text.substring(taxBreakupStart)
      const taxBreakupEnd = remainingText.search(/Total\s*\(In Words\)|Thanks for being/i)
      const breakupText =
        taxBreakupEnd > 0 ? remainingText.substring(0, taxBreakupEnd) : remainingText

      base.tax = extractBreakupAmount(breakupText, /\bA\s*Tax\s*₹?\s*([\d,]+(?:\.\d+)?)/i)
      base.surcharge = extractBreakupAmount(
        breakupText,
        /\bB\s*Surcharge\s*₹?\s*([\d,]+(?:\.\d+)?)/i
      )
      base.cess = extractBreakupAmount(
        breakupText,
        /\bC\s*(?:Education\s*)?Cess\s*₹?\s*([\d,]+(?:\.\d+)?)/i
      )
      base.interest = extractBreakupAmount(
        breakupText,
        /\bD\s*Interest\s*₹?\s*([\d,]+(?:\.\d+)?)/i
      )
      base.penalty = extractBreakupAmount(breakupText, /\bE\s*Penalty\s*₹?\s*([\d,]+(?:\.\d+)?)/i)
      base.feeUnderSection = extractBreakupAmount(
        breakupText,
        /\bF\s*Fee[^\n₹]*₹?\s*([\d,]+(?:\.\d+)?)/i
      )
      base.others = extractBreakupAmount(breakupText, /\bG\s*Others\s*₹?\s*([\d,]+(?:\.\d+)?)/i)
      base.total = extractBreakupAmount(
        breakupText,
        /Total\s*\([^)]*\)\s*₹?\s*([\d,]+(?:\.\d+)?)/i
      )

      const wordsMatch = text.match(/Total\s*\(In Words\)\s*([^\n]+)/i)
      base.totalInWords = wordsMatch?.[1]?.trim() || base.amountInWords || ""

      if (!base.tax && !base.total) {
        log(
          `⚠️ Tax breakup section found but values not extracted from ${path.basename(pdfPath)}`
        )
        log(`Breakup text sample (first 400 chars):\n${breakupText.substring(0, 400)}`)
      } else {
        log(
          `✓ Tax breakup extracted from ${path.basename(pdfPath)}: Tax=${
            base.tax || "0"
          }, Total=${base.total || "0"}`
        )
      }
    } else {
      log(`⚠️ No tax breakup section found in ${path.basename(pdfPath)}`)
    }

    const sectionRows = parseSectionWiseRows(text)
    if (sectionRows.length > 0) {
      log(
        `✓ Section-wise rows from ${path.basename(pdfPath)}: ${sectionRows
          .map((s) => `${s.sectionCode || s.section}`)
          .join(", ")}`
      )
      return sectionRows.map((section) => ({
        ...base,
        sno: section.sno,
        sectionDescription: section.sectionDescription,
        section: section.section,
        sectionCode: section.sectionCode,
        sectionTax: section.sectionTax,
        sectionSurcharge: section.sectionSurcharge,
        sectionEduCess: section.sectionEduCess,
        sectionTotal: section.sectionTotal,
        // Prefer section code as nature when legacy Nature of Payment is absent
        natureOfPayment:
          base.natureOfPayment ||
          (section.sectionCode
            ? `${section.sectionCode}${
                section.sectionDescription ? ` — ${section.sectionDescription}` : ""
              }`
            : ""),
      }))
    }

    if (base.tan || base.cin || base.challanNo) {
      return [
        {
          ...base,
          sno: "",
          sectionDescription: "",
          section: "",
          sectionCode: "",
          sectionTax: "",
          sectionSurcharge: "",
          sectionEduCess: "",
          sectionTotal: "",
        },
      ]
    }

    log(`No valid challan data found in ${path.basename(pdfPath)}`)
    return []
  } catch (error) {
    console.error(`Error parsing PDF ${pdfPath}:`, error)
    return []
  }
}

/**
 * Convert PDF files to Excel
 */
export async function convertPdfsToExcel(
  downloadPath: string,
  companyName: string,
  options?: { skipWait?: boolean; excelFileName?: string; quiet?: boolean }
): Promise<string | null> {
  try {
    const log = (...args: unknown[]) => {
      if (!options?.quiet) console.log(...args)
    }

    log(`Converting PDFs to Excel in: ${downloadPath}`)

    if (!options?.skipWait) {
      // Wait a bit for all downloads to complete
      await waitForSecs(5000)
    }

    // Find all PDF files in the download directory
    const files = fs.readdirSync(downloadPath)
    const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"))

    if (pdfFiles.length === 0) {
      log("No PDF files found to convert")
      return null
    }

    log(`Found ${pdfFiles.length} PDF files to process`)

    // Parse all PDFs and collect data
    const allRows: any[] = []
    for (const pdfFile of pdfFiles) {
      const pdfPath = path.join(downloadPath, pdfFile)
      log(`Parsing PDF: ${pdfFile}`)
      const rows = await parsePaymentHistoryPdf(pdfPath, { quiet: options?.quiet })
      allRows.push(...rows)
      log(`Extracted ${rows.length} rows from ${pdfFile}`)
    }

    if (allRows.length === 0) {
      log("No data extracted from PDFs")
      return null
    }

    // Create Excel workbook
    const workbook = XLSX.utils.book_new()

    // All challan receipt fields, including TDS/TCS section-wise Code
    const headers = [
      "ITNS No",
      "TAN",
      "Name",
      "Tax Year",
      "Assessment Year",
      "Financial Year",
      "Major Head",
      "Minor Head",
      "Residential Status",
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
      "S. No",
      "Section Description",
      "Section",
      "Section Code",
      "Section Tax (a)",
      "Section Surcharge (b)",
      "Section Edu. Cess (c)",
      "Section Total (a+b+c)",
      "Tax",
      "Surcharge",
      "Education Cess",
      "Interest",
      "Penalty",
      "Fee under section",
      "Others",
      "Total",
      "Total (In Words)",
      "Source PDF",
    ]

    // Prepare data for Excel
    const excelData = [headers]
    for (const row of allRows) {
      excelData.push([
        row.itnsNo || "",
        row.tan || "",
        row.name || "",
        row.taxYear || "",
        row.assessmentYear || "",
        row.financialYear || "",
        row.majorHead || "",
        row.minorHead || "",
        row.residentialStatus || "",
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
        row.sno || "",
        row.sectionDescription || "",
        row.section || "",
        row.sectionCode || "",
        row.sectionTax || "",
        row.sectionSurcharge || "",
        row.sectionEduCess || "",
        row.sectionTotal || "",
        row.tax || "",
        row.surcharge || "",
        row.cess || "",
        row.interest || "",
        row.penalty || "",
        row.feeUnderSection || "",
        row.others || "",
        row.total || "",
        row.totalInWords || "",
        row.sourcePdf || "",
      ])
    }

    // Create worksheet
    const worksheet = XLSX.utils.aoa_to_sheet(excelData)

    worksheet["!cols"] = [
      { wch: 10 }, // ITNS No
      { wch: 12 }, // TAN
      { wch: 40 }, // Name
      { wch: 12 }, // Tax Year
      { wch: 15 }, // Assessment Year
      { wch: 15 }, // Financial Year
      { wch: 32 }, // Major Head
      { wch: 36 }, // Minor Head
      { wch: 20 }, // Residential Status
      { wch: 40 }, // Nature of Payment
      { wch: 14 }, // Amount (Rs)
      { wch: 45 }, // Amount (in words)
      { wch: 22 }, // CIN
      { wch: 14 }, // Mode of Payment
      { wch: 16 }, // Bank Name
      { wch: 24 }, // Bank Reference Number
      { wch: 14 }, // Date of Deposit
      { wch: 12 }, // BSR Code
      { wch: 12 }, // Challan No
      { wch: 12 }, // Tender Date
      { wch: 8 }, // S. No
      { wch: 50 }, // Section Description
      { wch: 10 }, // Section
      { wch: 12 }, // Section Code
      { wch: 14 }, // Section Tax
      { wch: 16 }, // Section Surcharge
      { wch: 16 }, // Section Edu Cess
      { wch: 16 }, // Section Total
      { wch: 12 }, // Tax
      { wch: 12 }, // Surcharge
      { wch: 14 }, // Education Cess
      { wch: 12 }, // Interest
      { wch: 12 }, // Penalty
      { wch: 16 }, // Fee under section
      { wch: 10 }, // Others
      { wch: 12 }, // Total
      { wch: 45 }, // Total (In Words)
      { wch: 36 }, // Source PDF
    ]

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Payment History")

    // Remove older PaymentHistory_*.xlsx so rebuild doesn't leave stale files
    for (const file of files) {
      if (/^PaymentHistory_.*\.xlsx?$/i.test(file) && !file.startsWith("~$")) {
        try {
          fs.unlinkSync(path.join(downloadPath, file))
        } catch {
          /* ignore */
        }
      }
    }

    const excelFileName =
      options?.excelFileName ||
      `PaymentHistory_${companyName}_${new Date().toISOString().split("T")[0]}.xlsx`
    const excelPath = path.join(downloadPath, excelFileName)
    XLSX.writeFile(workbook, excelPath)

    log(`Excel file created: ${excelPath}`)
    log(`Total rows exported: ${allRows.length}`)

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

type EpayGridRow = {
  taxYear: string
  amount: number
  crn: string
  chlnCreDt: string
}

function parseChlnCreDtMs(raw: string): number {
  const cleaned = raw.replace(/\s+/g, " ").trim()
  const match = cleaned.match(/(\d{2}-\w{3}-\d{4})\s*(\d{2}:\d{2}:\d{2})/)
  if (!match) return 0
  const parsed = Date.parse(`${match[1]} ${match[2]} UTC`)
  return Number.isNaN(parsed) ? 0 : parsed
}

async function scrapeEpayGridRows(page: Page): Promise<EpayGridRow[]> {
  return page.evaluate(() => {
    const rows = Array.from(
      document.querySelectorAll("ag-grid-angular .ag-row")
    ) as HTMLElement[]
    return rows.map((row) => {
      const cellText = (colId: string) =>
        row.querySelector(`[col-id="${colId}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
      const amountRaw = cellText("amount")
      const amount = parseInt(amountRaw.replace(/[,₹\s]/g, ""), 10)
      return {
        taxYear: cellText("taxYear"),
        amount: Number.isNaN(amount) ? 0 : amount,
        crn: cellText("crn"),
        chlnCreDt: cellText("chlnCreDt"),
      }
    })
  })
}

async function downloadEpayGridRowByCrn(page: Page, crn: string): Promise<boolean> {
  return page.evaluate(async (targetCrn) => {
    function waitForSecs(timeout = 5000) {
      return new Promise((resolve) => setTimeout(() => resolve(true), timeout))
    }

    const rows = Array.from(
      document.querySelectorAll("ag-grid-angular .ag-row")
    ) as HTMLElement[]
    const row = rows.find((r) => {
      const crnCell = r.querySelector('[col-id="crn"]')
      return (crnCell?.textContent || "").replace(/\s+/g, "").includes(targetCrn)
    })
    if (!row) return false

    const actionButton = row.querySelector(
      "app-e-pay-tax-actions .mat-mdc-icon-button"
    ) as HTMLElement | null
    if (!actionButton) return false

    actionButton.click()
    await waitForSecs(500)
    ;(
      document.querySelector(".mat-mdc-menu-item.mat-focus-indicator") as HTMLElement | null
    )?.click()
    await waitForSecs(5000)
    return true
  }, crn)
}

export type EpayTargetedDownloadStats = PaymentHistoryDownloadStats & {
  matched: number
  notFound: number
}

async function findAndDownloadEpayGridRowByCrn(
  page: Page,
  crn: string,
  _assessmentYear?: string,
  _filterDom?: EpayFilterModalDomIds,
  _paymentType?: string
): Promise<boolean> {
  // Do not open the e-Pay filter modal — AY filter is slow/flaky on Generated Challans.
  // Match CRN on the already-loaded grid (paginate if needed).
  while (true) {
    const found = await downloadEpayGridRowByCrn(page, crn)
    if (found) return true

    const hasNext = await clickNextPaymentHistoryPage(page)
    if (!hasNext) return false
    await waitForSecs(3000)
  }
}

/** Download only e-Pay grid rows matching CSV targets (assessment year + amount). */
async function runEpayTargetedRowDownload(
  page: Page,
  targets: EpayRowDownloadTarget[],
  _filterDom: EpayFilterModalDomIds,
  _paymentType?: string
): Promise<EpayTargetedDownloadStats> {
  const stats: EpayTargetedDownloadStats = {
    totalSeen: 0,
    skipped: 0,
    downloaded: 0,
    pages: 0,
    matched: 0,
    notFound: 0,
  }

  if (targets.length === 0) return stats

  type PendingTarget = EpayRowDownloadTarget & { key: string }
  const pending = new Map<string, PendingTarget>()
  for (const target of targets) {
    pending.set(`${target.assessmentYear}:${target.amount}`, {
      ...target,
      key: `${target.assessmentYear}:${target.amount}`,
    })
  }

  // Skip portal AY filter modal (wastes time / often fails). Match year+amount on grid rows.
  console.log(
    `CSV-targeted download: no AY filter modal — matching ${pending.size} target(s) on grid`
  )

  const candidates = new Map<string, EpayGridRow & { chlnCreDtMs: number }>()

  let pageNum = 0
  while (true) {
    pageNum++
    stats.pages = pageNum
    await waitForSecs(2000)

    const rows = await scrapeEpayGridRows(page)
    stats.totalSeen += rows.length

    for (const row of rows) {
      const key = `${row.taxYear}:${row.amount}`
      if (!pending.has(key)) continue
      const existing = candidates.get(key)
      const chlnCreDtMs = parseChlnCreDtMs(row.chlnCreDt)
      if (!existing || chlnCreDtMs >= existing.chlnCreDtMs) {
        candidates.set(key, { ...row, chlnCreDtMs })
      }
    }

    const allTargetsSeen = Array.from(pending.keys()).every((k) => candidates.has(k))
    if (allTargetsSeen) break
    const hasNext = await clickNextPaymentHistoryPage(page)
    if (!hasNext) break
    await waitForSecs(3000)
  }

  const toDownload = Array.from(pending.values())
  for (const target of toDownload) {
    const match = candidates.get(target.key)
    if (!match?.crn) {
      stats.notFound += 1
      console.log(
        `No portal row for CSV target: ${target.assessmentYear} / amount ${target.amount}`
      )
      continue
    }

    stats.matched += 1
    console.log(
      `Downloading CRN ${match.crn} for ${target.assessmentYear} / amount ${target.amount}`
    )
    const ok = await findAndDownloadEpayGridRowByCrn(page, match.crn)
    if (ok) {
      stats.downloaded += 1
      pending.delete(target.key)
    } else {
      stats.notFound += 1
      console.log(`Failed to download CRN ${match.crn}`)
    }
  }

  console.log(
    `CSV-targeted download summary: ${stats.matched} matched, ${stats.downloaded} downloaded, ${stats.notFound} not found`
  )
  return stats
}

function listPdfFilesInDir(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".pdf"))
    .filter((f) => !f.endsWith(".crdownload") && !f.endsWith(".tmp"))
}

function getPdfMtimes(dir: string): Map<string, number> {
  const mtimes = new Map<string, number>()
  for (const name of listPdfFilesInDir(dir)) {
    try {
      mtimes.set(name, fs.statSync(path.join(dir, name)).mtimeMs)
    } catch {
      /* ignore */
    }
  }
  return mtimes
}

/** Wait for a new/changed PDF after a download click. */
async function waitForNewPdfDownload(
  dir: string,
  beforeMtimes: Map<string, number>,
  timeoutMs = 30000
): Promise<string | null> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < timeoutMs) {
    const stillDownloading = fs.existsSync(dir)
      ? fs.readdirSync(dir).some((f) => f.endsWith(".crdownload") || f.endsWith(".tmp"))
      : false

    if (!stillDownloading) {
      const afterMtimes = getPdfMtimes(dir)
      const changedOrNew = Array.from(afterMtimes.entries())
        .filter(([name, mtime]) => {
          const prev = beforeMtimes.get(name)
          return prev === undefined || mtime > prev + 50
        })
        .sort((a, b) => b[1] - a[1])

      if (changedOrNew.length > 0) {
        return changedOrNew[0]![0]
      }
    }
    await waitForSecs(400)
  }
  return null
}

/** Rename a downloaded PDF to `{cin}_ChallanReceipt.pdf`. */
function renameDownloadedPdfToCin(downloadDir: string, cin: string, downloadedFileName: string): string {
  const expectedName = `${cin}_ChallanReceipt.pdf`
  const src = path.join(downloadDir, downloadedFileName)
  const dest = path.join(downloadDir, expectedName)

  if (downloadedFileName === expectedName) {
    return dest
  }

  if (fs.existsSync(dest) && path.resolve(src) !== path.resolve(dest)) {
    // Keep existing correct file; remove the newly downloaded duplicate name
    try {
      fs.unlinkSync(src)
    } catch {
      /* ignore */
    }
    return dest
  }

  fs.renameSync(src, dest)
  return dest
}

/** Click download for one CIN row in the Payment History grid (match by CIN only). */
async function clickDownloadPaymentHistoryRowForCin(
  page: Page,
  target: PaymentHistoryDownloadTarget
): Promise<boolean> {
  return page.evaluate(async (t) => {
    function waitForSecs(timeout = 5000) {
      return new Promise((resolve) => setTimeout(() => resolve(true), timeout))
    }

    const cin = t.cin
    const rows = Array.from(document.querySelectorAll("ag-grid-angular .ag-row")) as HTMLElement[]
    // Prefer exact CIN match in row text; date is not required (wide date-range filter).
    const row = rows.find((r) => (r.textContent || "").includes(cin))
    if (!row) return false

    const actionButton = row.querySelector(
      "app-e-pay-tax-actions .mat-mdc-icon-button"
    ) as HTMLElement | null
    if (!actionButton) return false

    actionButton.click()
    await waitForSecs(500)
    ;(
      document.querySelector(".mat-mdc-menu-item.mat-focus-indicator") as HTMLElement | null
    )?.click()
    return true
  }, target)
}

/**
 * Download challan receipts for specific rows (match by payment date text + CIN),
 * then rename each new PDF to `{cin}_ChallanReceipt.pdf`.
 */
async function downloadPaymentHistoryRowsForCins(
  page: Page,
  targets: PaymentHistoryDownloadTarget[],
  downloadDir: string
): Promise<{ downloaded: number; notFound: string[]; renamedCins: string[] }> {
  if (targets.length === 0) return { downloaded: 0, notFound: [], renamedCins: [] }

  if (!fs.existsSync(downloadDir)) {
    fs.mkdirSync(downloadDir, { recursive: true })
  }

  const notFound: string[] = []
  const renamedCins: string[] = []
  let downloaded = 0

  for (const target of targets) {
    const destPath = path.join(downloadDir, `${target.cin}_ChallanReceipt.pdf`)
    if (fs.existsSync(destPath)) {
      continue
    }

    const beforeMtimes = getPdfMtimes(downloadDir)
    const clicked = await clickDownloadPaymentHistoryRowForCin(page, target)
    if (!clicked) {
      notFound.push(target.cin)
      continue
    }

    const newFile = await waitForNewPdfDownload(downloadDir, beforeMtimes)
    if (!newFile) {
      notFound.push(target.cin)
      console.log(`[download] Timed out waiting for PDF for CIN ${target.cin}`)
      continue
    }

    renameDownloadedPdfToCin(downloadDir, target.cin, newFile)
    renamedCins.push(target.cin)
    downloaded++
    await waitForSecs(800)
  }

  return { downloaded, notFound, renamedCins }
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

  const take = async (timeoutMs = 60000): Promise<PaymentHistoryPageCapture | null> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (pending && pending.url !== lastConsumedUrl) {
        lastConsumedUrl = pending.url
        const json = pending.json
        pending = null
        return parsePaymentHistoryPage(json)
      }
      await waitForSecs(200)
    }
    return null
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
  options?: PaymentHistoryInterceptOptions & { downloadDir?: string }
): Promise<PaymentHistoryDownloadStats> {
  const stats: PaymentHistoryDownloadStats = {
    totalSeen: 0,
    skipped: 0,
    downloaded: 0,
    pages: 0,
  }

  const downloadDir = options?.downloadDir ?? paymentHistoryDir(companyName)

  let uiPage = 0
  while (true) {
    uiPage++
    stats.pages = uiPage
    console.log(`Processing Payment History page ${uiPage}...`)

    const pageData = await capture.take(uiPage === 1 ? 60000 : 30000)

    if (!pageData) {
      console.log(
        `No paymenthistory API response on page ${uiPage} — falling back to download all rows, then stop`
      )
      await downloadAllPaymentHistoryRowsOnPage(page)
      const rowCount = await page.evaluate(
        () => document.querySelectorAll("app-e-pay-tax-actions .mat-mdc-icon-button").length
      )
      stats.downloaded += rowCount
      stats.totalSeen += rowCount
      break
    }

    const {
      cins,
      pageNumber,
      totalPages,
      totalElements,
      last: isLastPage,
      empty,
      numberOfElements,
    } = pageData

    console.log(
      `API page ${pageNumber + 1}/${Math.max(totalPages, 1)} (pageNumber=${pageNumber}, totalElements=${totalElements}, last=${isLastPage}, rows=${numberOfElements})`
    )

    if (empty || cins.length === 0) {
      console.log(`Empty paymenthistory page (pageNumber=${pageNumber}) — stopping pagination`)
      break
    }

    stats.totalSeen += cins.length
    let missingCins = cins.filter((cin) => !paymentHistoryPdfExistsForCompany(companyName, cin))
    if (options?.targetCins) {
      missingCins = missingCins.filter((cin) => options.targetCins!.has(cin))
    }
    const skippedOnPage = cins.length - missingCins.length
    stats.skipped += skippedOnPage

    console.log(
      `Page ${uiPage}: ${cins.length} payments, ${skippedOnPage} skipped, ${missingCins.length} to download`
    )

    if (missingCins.length > 0) {
      const targets: PaymentHistoryDownloadTarget[] = missingCins.map((cin) => ({
        cin,
        paymentTime: options?.targetPaymentTimes?.get(cin),
      }))
      const result = await downloadPaymentHistoryRowsForCins(page, targets, downloadDir)
      stats.downloaded += result.downloaded
      if (result.notFound.length > 0) {
        console.log(
          `Warning: CIN(s) not found in grid on page ${uiPage}: ${result.notFound.join(", ")}`
        )
      }
    }

    if (options?.targetCins) {
      const pending = targetsStillMissing(companyName, options.targetCins)
      if (pending.length === 0) {
        console.log("All target CINs have PDFs — stopping pagination")
        break
      }
    }

    if (isLastPage || (totalPages > 0 && pageNumber >= totalPages - 1)) {
      console.log(
        `Reached last paymenthistory page (pageNumber=${pageNumber}, totalPages=${totalPages}) — stop`
      )
      break
    }

    const hasNext = await clickNextPaymentHistoryPage(page)
    if (!hasNext) {
      console.log("Next-page button unavailable — stopping pagination")
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

async function waitForVisibleMatOptions(page: Page, timeoutMs = 8000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const visible = await page.evaluate(() => {
      const options = Array.from(
        document.querySelectorAll(".cdk-overlay-container mat-option")
      ) as HTMLElement[]
      return options.some((opt) => opt.offsetParent !== null)
    })
    if (visible) return true
    await waitForSecs(200)
  }
  return false
}

async function waitForEpayFilterModal(page: Page, timeoutMs = 10000): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const open = await page.evaluate(() => {
      if (document.querySelector(".modal.show")) return true
      if (document.querySelector("#atPaymentFilter")) return true
      return Array.from(document.querySelectorAll(".modal-content.filterAlign")).some((el) => {
        const modal = el.closest(".modal")
        return modal?.classList.contains("show")
      })
    })
    if (open) return true
    await waitForSecs(200)
  }
  return false
}

/** Apply e-Pay filter modal (Payment History + Generated Challans tabs). */
async function applyEpayFilterModal(
  page: Page,
  params: {
    fromDate?: string
    toDate?: string
    assessmentYear?: string
    paymentType?: string
  },
  dom: EpayFilterModalDomIds
) {
  const { fromDate, toDate, assessmentYear, paymentType } = params

  if (!assessmentYear && !paymentType && !(fromDate && toDate)) {
    return
  }

  console.log("Applying e-Pay filters...", { fromDate, toDate, assessmentYear, paymentType })

  await page.waitForSelector("button.defaultButton.filterButton")
  await page.click("button.defaultButton.filterButton")
  await waitForSecs(500)
  const modalReady = await waitForEpayFilterModal(page)
  if (!modalReady) {
    console.log("Warning: filter modal did not appear after clicking filter button")
  }
  await waitForSecs(500)

  const openMatSelectInFilterModal = async (formControlNames: string[]) => {
    const opened = await page.evaluate((names) => {
      const modalBody =
        document.querySelector(".modal.show .modal-body") ??
        Array.from(document.querySelectorAll(".modal-content.filterAlign .modal-body")).find((b) => {
          const modal = b.closest(".modal")
          return modal?.classList.contains("show")
        }) ??
        Array.from(document.querySelectorAll(".modal-body")).find(
          (b) => (b as HTMLElement).offsetParent !== null
        ) ??
        null
      for (const name of names) {
        const sel = modalBody?.querySelector(
          `mat-select[formcontrolname="${name}"]`
        ) as HTMLElement | null
        if (sel) {
          sel.click()
          return name
        }
      }
      return null
    }, formControlNames)
    if (!opened) {
      console.log(
        `Warning: mat-select not found in filter modal for ${formControlNames.join(" | ")}`
      )
    }
    await waitForSecs(400)
    const optionsVisible = await waitForVisibleMatOptions(page)
    if (!optionsVisible) {
      console.log(`Warning: mat-option panel did not appear for ${formControlNames.join(" | ")}`)
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
    await openMatSelectInFilterModal(["taxYear", "assessmentYear"])
    await clickMatOptionByExactLabel(assessmentYear)
  }

  if (paymentType) {
    await openMatSelectInFilterModal(["typeOfPayment"])
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
    const clickFilterInRoot = (root: ParentNode) => {
      const modalFooter = root.querySelector(".modal-footer")
      if (modalFooter) {
        const buttons = Array.from(modalFooter.querySelectorAll("button"))
        const filterButton = buttons.find((btn) => btn.textContent?.trim() === "Filter")
        if (filterButton) {
          ;(filterButton as HTMLElement).click()
          return true
        }
      }
      const filterButtons = Array.from(
        root.querySelectorAll("button.defaultButton.primaryButton")
      )
      const filterButton = filterButtons.find((btn) => btn.textContent?.trim() === "Filter")
      if (filterButton) {
        ;(filterButton as HTMLElement).click()
        return true
      }
      return false
    }

    const modalContent =
      document.querySelector(".modal.show .modal-content.filterAlign") ??
      document.querySelector(".modal.show .modal-content")
    if (modalContent && clickFilterInRoot(modalContent)) return true

    const filterSection = Array.from(document.querySelectorAll(".filter-section.mt-3.mr-3")).find(
      (el) => !el.hasAttribute("hidden") && (el as HTMLElement).offsetParent !== null
    )
    if (filterSection && clickFilterInRoot(filterSection)) return true

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

  const downloadPath = path.resolve(`./public/pdf/challans/${companyName}/${kind.storageSubdir}`)
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }

  let paymentHistoryStats: PaymentHistoryDownloadStats | EpayTargetedDownloadStats | undefined
  let paymentHistoryCapture: PaymentHistoryCapture | null = null

  try {
    // Open a new page
    const page = await browser.newPage()

    // Set the download behavior to use the custom download path
    const client = await page.createCDPSession()
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
    paymentHistoryCapture = isPaymentHistory
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

    const csvTargets = options?.rowDownloadTargets?.filter(
      (t) => t.assessmentYear && t.amount > 0
    )

    if (!csvTargets?.length) {
      if (isPaymentHistory || assessmentYear || paymentType || (fromDate && toDate)) {
        await applyEpayFilterModal(page, { fromDate, toDate, assessmentYear, paymentType }, dom)
      }
    }

    await page.evaluate(() => {
      ;[...Array.from(document.querySelectorAll("ag-grid-angular .ag-row.ag-row-first"))].forEach(
        (e) => {
          e.children[e.children.length - 1]?.scrollIntoView()
        }
      )
    })

    if (csvTargets?.length) {
      console.log(
        `CSV-targeted ${kind.flowLabel}: ${csvTargets.length} amount/year target(s) for ${companyName}`
      )
      paymentHistoryStats = await runEpayTargetedRowDownload(page, csvTargets, dom, paymentType)
    } else if (isPaymentHistory && paymentHistoryCapture) {
      paymentHistoryStats = await runPaymentHistoryDownloadWithIntercept(
        page,
        companyName,
        paymentHistoryCapture
      )
    } else {
      await runGeneratedChallansDownloadAllPages(page)
    }

    // Wait a bit for all downloads to complete
    await waitForSecs(10000)
  } finally {
    paymentHistoryCapture?.dispose()
    await browser.close()
  }

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
  downloadedCins: string[]
}

/**
 * Download missing Payment History PDFs.
 *
 * Default (Old Act): apply From/To range covering missing paymentTimes, then match by CIN.
 * New Act (`skipDateFilter: true`): no filter — paginate Payment History and download every
 * PDF that is not already present locally.
 */
export async function downloadMissingPaymentHistoryPdfs(
  Username: string,
  Password: string,
  companyName: string,
  options?: DownloadChallansOptions & {
    missing?: Array<{ cin: string; paymentTime?: string; assessmentYear?: string; paymentType?: string }>
    /** When true (New Act): do not apply date filter; download all available missing PDFs. */
    skipDateFilter?: boolean
  }
): Promise<MissingPaymentPdfDownloadResult> {
  const skipNewActRadio = options?.skipNewActRadio === true
  const skipDateFilter = options?.skipDateFilter === true

  let missingRows = options?.missing ?? (skipDateFilter ? [] : loadMissingFromGapsJson(companyName))
  missingRows = missingRows.filter((r) => !paymentHistoryPdfExistsForCompany(companyName, r.cin))

  const hasExplicitMissing = Array.isArray(options?.missing)

  if (!skipDateFilter && missingRows.length === 0) {
    console.log("[downloadMissingPaymentHistoryPdfs] No missing PDFs to download")
    return {
      totalSeen: 0,
      skipped: 0,
      downloaded: 0,
      pages: 0,
      dateRangesProcessed: 0,
      stillMissing: 0,
      dayGroups: [],
      downloadedCins: [],
    }
  }

  if (skipDateFilter && hasExplicitMissing && missingRows.length === 0) {
    console.log("[downloadMissingPaymentHistoryPdfs] No missing PDFs to download (explicit list empty)")
    return {
      totalSeen: 0,
      skipped: 0,
      downloaded: 0,
      pages: 0,
      dateRangesProcessed: 0,
      stillMissing: 0,
      dayGroups: [],
      downloadedCins: [],
    }
  }

  const dateRange = skipDateFilter ? null : buildMissingPaymentsDateRange(missingRows)
  if (!skipDateFilter && !dateRange) {
    throw new Error(
      "[downloadMissingPaymentHistoryPdfs] Missing rows have no usable paymentTime for date range"
    )
  }

  // When an explicit missing list is provided, always restrict to those CINs
  // (including New Act / skipDateFilter runs).
  const targetCins =
    hasExplicitMissing || !skipDateFilter
      ? new Set(
          missingRows
            .map((r) => r.cin)
            .filter((cin) => !paymentHistoryPdfExistsForCompany(companyName, cin))
        )
      : undefined
  const targetPaymentTimes = new Map<string, string>()
  for (const item of missingRows) {
    if (item.paymentTime) targetPaymentTimes.set(item.cin, item.paymentTime)
  }

  if (skipDateFilter) {
    console.log(
      targetCins
        ? `[downloadMissingPaymentHistoryPdfs] New Act — no date filter; target ${targetCins.size} CIN(s)`
        : `[downloadMissingPaymentHistoryPdfs] New Act — no date filter; download all available missing PDFs`
    )
  } else {
    console.log(
      `[downloadMissingPaymentHistoryPdfs] ${targetCins!.size} missing PDFs | date range ${dateRange!.fromDayKey} → ${dateRange!.toDayKey}`
    )
  }

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
  const downloadPath = paymentHistoryDir(companyName)
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
  const pdfsBefore = new Set(
    fs.existsSync(downloadPath)
      ? fs
          .readdirSync(downloadPath)
          .filter((f) => f.toLowerCase().endsWith(".pdf") && f.includes("_ChallanReceipt.pdf"))
          .map((f) => f.replace(/_ChallanReceipt\.pdf$/i, ""))
      : []
  )

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

    capture.reset()

    if (!skipDateFilter && dateRange) {
      // Old Act: date range only — do not set assessmentYear/paymentType.
      console.log(
        `\n[downloadMissingPaymentHistoryPdfs] Filtering ${dateRange.fromDate} → ${dateRange.toDate} then matching ${targetCins!.size} CIN(s)`
      )
      await applyEpayFilterModal(
        page,
        {
          fromDate: dateRange.fromDate,
          toDate: dateRange.toDate,
        },
        PAYMENT_HISTORY_FILTER_DOM
      )
    } else {
      console.log(
        `\n[downloadMissingPaymentHistoryPdfs] No filter — paginating Payment History and downloading missing PDFs`
      )
    }

    // Best-effort scroll nudge. The e-Pay SPA can re-render right after the filter modal
    // applies, detaching the frame mid-evaluate; that must not abort the whole download.
    try {
      await waitForSecs(2000)
      await page.evaluate(() => {
        ;[
          ...Array.from(document.querySelectorAll("ag-grid-angular .ag-row.ag-row-first")),
        ].forEach((e) => {
          e.children[e.children.length - 1]?.scrollIntoView()
        })
      })
    } catch (err: any) {
      console.log(
        `[downloadMissingPaymentHistoryPdfs] scroll nudge skipped: ${err?.message || err}`
      )
    }

    const rangeStats = await runPaymentHistoryDownloadWithIntercept(page, companyName, capture, {
      ...(targetCins ? { targetCins } : {}),
      targetPaymentTimes,
      downloadDir: downloadPath,
    })

    aggregate.totalSeen += rangeStats.totalSeen
    aggregate.skipped += rangeStats.skipped
    aggregate.downloaded += rangeStats.downloaded
    aggregate.pages += rangeStats.pages

    await waitForSecs(10000)
    await convertPdfsToExcel(downloadPath, companyName)
  } finally {
    capture.dispose()
    await browser.close()
  }

  const downloadedCins: string[] = []
  if (fs.existsSync(downloadPath)) {
    for (const f of fs.readdirSync(downloadPath)) {
      if (!f.toLowerCase().endsWith(".pdf") || !f.includes("_ChallanReceipt.pdf")) continue
      const cin = f.replace(/_ChallanReceipt\.pdf$/i, "")
      if (!pdfsBefore.has(cin)) downloadedCins.push(cin)
    }
  }

  const stillMissing = skipDateFilter
    ? 0
    : missingRows.filter((r) => !paymentHistoryPdfExistsForCompany(companyName, r.cin)).length

  console.log(
    `[downloadMissingPaymentHistoryPdfs] Done: downloaded ${aggregate.downloaded}, newly named CINs ${downloadedCins.length}, still missing ${stillMissing}`
  )

  return {
    ...aggregate,
    dateRangesProcessed: skipDateFilter ? 0 : 1,
    stillMissing,
    dayGroups: skipDateFilter
      ? [{ dayKey: "all_no_filter", count: downloadedCins.length }]
      : [
          {
            dayKey: `${dateRange!.fromDayKey}_to_${dateRange!.toDayKey}`,
            count: targetCins!.size,
          },
        ],
    downloadedCins,
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

const CSI_TAB_LABEL = "Challan Status Inquiry (CSI) File"

async function openMatDatepickerForSelector(page: Page, inputSelector: string) {
  const opened = await page.evaluate((sel) => {
    const input = document.querySelector(sel)
    if (!input) return false
    const parent = input.closest("mat-form-field")
    const calendarButton = parent?.querySelector(
      'mat-datepicker-toggle button[aria-label="Open calendar"]'
    )
    if (calendarButton) {
      ;(calendarButton as HTMLElement).click()
      return true
    }
    return false
  }, inputSelector)
  if (!opened) {
    throw new Error(`Could not open Material datepicker for selector: ${inputSelector}`)
  }
}

async function clickEpayTabByLabel(page: Page, tabLabel: string) {
  const clicked = await page.evaluate((want) => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim()
    const wantNorm = norm(want)
    const tabs = Array.from(document.querySelectorAll(".mdc-tab__text-label")) as HTMLElement[]
    const exact = tabs.find((el) => norm(el.textContent || "") === wantNorm)
    if (exact) {
      exact.click()
      return true
    }
    const loose = tabs.find((el) => norm(el.textContent || "").includes(wantNorm))
    if (loose) {
      loose.click()
      return true
    }
    // Also match when the UI shortens the label but still contains "CSI"
    if (/CSI/i.test(wantNorm)) {
      const csi = tabs.find((el) => /CSI/i.test(el.textContent || ""))
      if (csi) {
        csi.click()
        return true
      }
    }
    return false
  }, tabLabel)
  if (!clicked) {
    throw new Error(`Could not find e-Pay tab: "${tabLabel}"`)
  }
}

/** Set From/To dates on the CSI File tab (page-level datepickers, not the filter modal). */
async function setCsiFileDates(page: Page, fromDate: string, toDate: string) {
  await page.waitForSelector('input[formcontrolname="csiFileFromDate"]', {
    visible: true,
    timeout: 30000,
  })
  await page.waitForSelector('input[formcontrolname="csiFileToDate"]', {
    visible: true,
    timeout: 30000,
  })

  await openMatDatepickerForSelector(page, 'input[formcontrolname="csiFileFromDate"]')
  await waitForSecs(1000)
  await selectDateInOpenMatCalendar(page, fromDate)
  await waitForSecs(500)

  await openMatDatepickerForSelector(page, 'input[formcontrolname="csiFileToDate"]')
  await waitForSecs(1000)
  await selectDateInOpenMatCalendar(page, toDate)
  await waitForSecs(500)
}

async function clickDownloadCsiChallanFileButton(page: Page) {
  const clicked = await page.evaluate(() => {
    const norm = (s: string) => s.replace(/\s+/g, " ").trim()
    const buttons = Array.from(
      document.querySelectorAll("button.normal-button-secondary.downloadIcon")
    ) as HTMLElement[]
    const match = buttons.find((btn) => /Download Challan File/i.test(norm(btn.textContent || "")))
    if (match) {
      match.click()
      return true
    }
    const fallback = Array.from(document.querySelectorAll("button")).find((btn) =>
      /Download Challan File/i.test(norm(btn.textContent || ""))
    ) as HTMLElement | undefined
    if (fallback) {
      fallback.click()
      return true
    }
    return false
  })
  if (!clicked) {
    throw new Error('Could not find "Download Challan File" button on CSI tab')
  }
}

function listCompletedDownloadFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => !f.startsWith("."))
    .filter((f) => !f.endsWith(".crdownload") && !f.endsWith(".tmp"))
}

function getDownloadFileMtimes(dir: string): Map<string, number> {
  const mtimes = new Map<string, number>()
  for (const name of listCompletedDownloadFiles(dir)) {
    try {
      mtimes.set(name, fs.statSync(path.join(dir, name)).mtimeMs)
    } catch {
      /* ignore */
    }
  }
  return mtimes
}

/**
 * Wait for CSI download to finish. Handles overwrite of the same filename
 * (portal often reuses TAN+date names) via mtime, plus CDP download events.
 */
async function waitForCsiDownloadComplete(
  dir: string,
  beforeMtimes: Map<string, number>,
  client: Awaited<ReturnType<Page["createCDPSession"]>>,
  timeoutMs = 60000
): Promise<string[]> {
  let cdpCompletedGuid: string | null = null
  let cdpSuggestedFilename: string | null = null

  const onWillBegin = (event: { guid?: string; suggestedFilename?: string }) => {
    if (event.guid) {
      console.log(`CDP download started: ${event.suggestedFilename || event.guid}`)
      cdpSuggestedFilename = event.suggestedFilename || null
    }
  }
  const onProgress = (event: { guid?: string; state?: string }) => {
    if (event.state === "completed" && event.guid) {
      cdpCompletedGuid = event.guid
      console.log("CDP download completed event received")
    } else if (event.state === "canceled") {
      console.log("CDP download canceled")
    }
  }

  client.on("Browser.downloadWillBegin", onWillBegin)
  client.on("Browser.downloadProgress", onProgress)

  const startedAt = Date.now()
  try {
    while (Date.now() - startedAt < timeoutMs) {
      const stillDownloading = fs.existsSync(dir)
        ? fs.readdirSync(dir).some((f) => f.endsWith(".crdownload") || f.endsWith(".tmp"))
        : false

      const afterMtimes = getDownloadFileMtimes(dir)
      const changedOrNew = Array.from(afterMtimes.entries())
        .filter(([name, mtime]) => {
          const prev = beforeMtimes.get(name)
          return prev === undefined || mtime > prev + 50
        })
        .map(([name]) => name)

      if (!stillDownloading && (changedOrNew.length > 0 || cdpCompletedGuid)) {
        if (changedOrNew.length > 0) return changedOrNew
        if (cdpSuggestedFilename && afterMtimes.has(cdpSuggestedFilename)) {
          return [cdpSuggestedFilename]
        }
        // CDP said completed but filename may differ — return newest file in folder
        const newest = Array.from(afterMtimes.entries()).sort((a, b) => b[1] - a[1])[0]
        if (newest && newest[1] >= startedAt - 1000) return [newest[0]]
      }

      await waitForSecs(500)
    }
  } finally {
    client.off("Browser.downloadWillBegin", onWillBegin)
    client.off("Browser.downloadProgress", onProgress)
  }

  // Last-chance: any completed file modified since we clicked download
  const afterMtimes = getDownloadFileMtimes(dir)
  const changedOrNew = Array.from(afterMtimes.entries())
    .filter(([name, mtime]) => {
      const prev = beforeMtimes.get(name)
      return prev === undefined || mtime > prev + 50
    })
    .map(([name]) => name)
  if (changedOrNew.length > 0) return changedOrNew

  throw new Error(`CSI file download did not complete within ${timeoutMs / 1000}s in ${dir}`)
}

/**
 * Open e-Pay → **Challan Status Inquiry (CSI) File** tab, set from/to dates, and click
 * "Download Challan File". Saves under `public/pdf/challans/{company}/CSI`.
 */
export async function downloadCsiFiles(
  Username: string,
  Password: string,
  companyName: string,
  fromDate: string,
  toDate: string,
  options?: DownloadChallansOptions
) {
  if (!fromDate || !toDate) {
    throw new Error("From date and to date are required to download CSI files")
  }

  const skipNewActRadio = options?.skipNewActRadio === true
  console.log(`Downloading CSI File for company:`, companyName)
  console.log(`e-pay CSI flow: skip Income-tax Act 2025 radio (old only):`, skipNewActRadio)
  console.log("Username:", Username)
  console.log("From Date:", fromDate)
  console.log("To Date:", toDate)

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

  const downloadPath = path.resolve(`./public/pdf/challans/${companyName}/CSI`)
  if (!fs.existsSync(downloadPath)) {
    fs.mkdirSync(downloadPath, { recursive: true })
  }

  try {
    const page = await browser.newPage()
    const client = await page.createCDPSession()
    // Prefer Browser.setDownloadBehavior (events) so we know when the file finishes.
    try {
      await client.send("Browser.setDownloadBehavior", {
        behavior: "allow",
        downloadPath,
        eventsEnabled: true,
      })
    } catch {
      await client.send("Page.setDownloadBehavior", {
        behavior: "allow",
        downloadPath,
      })
    }

    await page.goto("https://eportal.incometax.gov.in/iec/foservices/#/login")
    await login(page, Username, Password)
    await navigateToEpayTaxViaMenu(page)

    if (skipNewActRadio) {
      console.log("Old Act — skipping #mat-radio-0, Continue only (CSI File)")
      await clickContinueAfterEpayLanding(page)
    } else {
      console.log("Waiting for Income-tax Act 2025 radio (#mat-radio-0) (CSI File)")
      await page.waitForSelector("#mat-radio-0", { visible: true, timeout: 120000 })
      await page.click("#mat-radio-0")
      console.log("Clicked on the radio button (CSI File)")
      await clickContinueAfterEpayLanding(page)
    }

    await page.waitForSelector(".mdc-tab__text-label", { visible: true, timeout: 60000 })
    await waitForSecs(6000)
    await clickEpayTabByLabel(page, CSI_TAB_LABEL)
    await waitForSecs(3000)

    await setCsiFileDates(page, fromDate, toDate)

    const beforeMtimes = getDownloadFileMtimes(downloadPath)
    await clickDownloadCsiChallanFileButton(page)
    console.log("Clicked Download Challan File — waiting for file to finish downloading...")
    const files = await waitForCsiDownloadComplete(downloadPath, beforeMtimes, client)
    console.log(`CSI file downloaded: ${files.join(", ")}`)

    return { downloadPath, files }
  } finally {
    console.log("Closing browser after CSI download...")
    try {
      await browser.close()
    } catch (err) {
      console.log("browser.close() failed, forcing process kill of browser:", err)
      try {
        browser.process()?.kill("SIGKILL")
      } catch {
        /* ignore */
      }
    }
  }
}
