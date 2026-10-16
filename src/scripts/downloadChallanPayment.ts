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
  // Right after login the header can ignore the first click (still hydrating, or a
  // post-login popup on top), so retry opening the menu a few times.
  for (let attempt = 1; ; attempt++) {
    await page.keyboard.press("Escape").catch(() => undefined)
    await page.click("#e-File")
    try {
      await page.waitForSelector('.mat-mdc-menu-panel[role="menu"]', { visible: true, timeout: 15000 })
      break
    } catch (err) {
      if (attempt >= 4) throw err
      console.log(`[navigateToEpayTaxViaMenu] e-File menu did not open (attempt ${attempt}) — retrying`)
      await waitForSecs(5000)
    }
  }
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
  /** ag-grid `row-index` — stable across horizontal scroll and pinned/center row containers. */
  rowKey: string
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

type EpayGridScrollInfo = {
  scrollLeft: number
  maxScrollLeft: number
  viewportWidth: number
}

/**
 * ag-grid only keeps columns inside the horizontal viewport in the DOM. CRN / Tax Year /
 * Amount sit on the left and Actions on the far right, so they are not reliably rendered
 * together — and the grid can scroll between clicks (e.g. the actions menu refocusing its
 * button on close), dropping the CRN column. Scroll explicitly before every read or click.
 */
async function scrollEpayGridTo(
  page: Page,
  target: number | "start" | "end"
): Promise<EpayGridScrollInfo> {
  const info = await page.evaluate((to) => {
    const viewports = Array.from(
      document.querySelectorAll(
        "ag-grid-angular .ag-center-cols-viewport, ag-grid-angular .ag-body-horizontal-scroll-viewport"
      )
    ) as HTMLElement[]
    let maxScrollLeft = 0
    let viewportWidth = 0
    for (const vp of viewports) {
      maxScrollLeft = Math.max(maxScrollLeft, vp.scrollWidth - vp.clientWidth)
      viewportWidth = Math.max(viewportWidth, vp.clientWidth)
    }
    const left =
      to === "start"
        ? 0
        : to === "end"
        ? maxScrollLeft
        : Math.min(Math.max(to, 0), maxScrollLeft)
    for (const vp of viewports) vp.scrollLeft = left
    return { scrollLeft: left, maxScrollLeft, viewportWidth }
  }, target)
  // ag-grid renders newly visible columns on the following animation frames
  await waitForSecs(600)
  return info
}

type EpayGridRowFragment = {
  rowKey: string
  taxYear: string
  amountRaw: string
  crn: string
  chlnCreDt: string
}

async function scrapeRenderedEpayGridCells(page: Page): Promise<EpayGridRowFragment[]> {
  return page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("ag-grid-angular .ag-row")) as HTMLElement[]
    return rows.map((row, i) => {
      const cellText = (colId: string) =>
        row.querySelector(`[col-id="${colId}"]`)?.textContent?.replace(/\s+/g, " ").trim() ?? ""
      return {
        rowKey:
          row.getAttribute("row-index") ??
          row.getAttribute("aria-rowindex") ??
          row.getAttribute("row-id") ??
          `dom-${i}`,
        taxYear: cellText("taxYear"),
        amountRaw: cellText("amount"),
        crn: cellText("crn"),
        chlnCreDt: cellText("chlnCreDt"),
      }
    })
  })
}

/** Read every row on the current grid page, scrolling across so all needed columns render. */
async function scrapeEpayGridRows(page: Page): Promise<EpayGridRow[]> {
  const info = await scrollEpayGridTo(page, "start")
  const positions = [0]
  if (info.maxScrollLeft > 0) {
    const step = Math.max(200, Math.floor(info.viewportWidth * 0.75))
    for (let x = step; x < info.maxScrollLeft; x += step) positions.push(x)
    positions.push(info.maxScrollLeft)
  }

  const merged = new Map<string, EpayGridRowFragment>()
  for (let i = 0; i < positions.length; i++) {
    if (i > 0) await scrollEpayGridTo(page, positions[i]!)
    for (const frag of await scrapeRenderedEpayGridCells(page)) {
      const existing = merged.get(frag.rowKey)
      if (!existing) {
        merged.set(frag.rowKey, { ...frag })
        continue
      }
      if (!existing.taxYear) existing.taxYear = frag.taxYear
      if (!existing.amountRaw) existing.amountRaw = frag.amountRaw
      if (!existing.crn) existing.crn = frag.crn
      if (!existing.chlnCreDt) existing.chlnCreDt = frag.chlnCreDt
    }
  }
  await scrollEpayGridTo(page, "start")

  return Array.from(merged.values()).map((frag) => {
    const amount = parseInt(frag.amountRaw.replace(/[,₹\s]/g, ""), 10)
    return {
      rowKey: frag.rowKey,
      taxYear: frag.taxYear,
      amount: Number.isNaN(amount) ? 0 : amount,
      crn: frag.crn.replace(/\s+/g, ""),
      chlnCreDt: frag.chlnCreDt,
    }
  })
}

async function getEpayGridPageInfo(page: Page): Promise<{ current: number; total: number } | null> {
  return page.evaluate(() => {
    const match = (document.body.innerText || "").match(/(\d+)\s+of\s+(\d+)\s+pages?/i)
    return match ? { current: parseInt(match[1]!, 10), total: parseInt(match[2]!, 10) } : null
  })
}

async function clickPrevEpayGridPage(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const buttons = Array.from(
      document.querySelectorAll("button.buttonPag.mdc-icon-button.mat-mdc-icon-button")
    ) as HTMLElement[]
    const nextIdx = buttons.findIndex((btn) => btn.querySelector('img[alt="right arrow"]'))
    // Pager is [first, prev, next, last]; fall back to the button just before "next".
    const prev =
      buttons.find((btn) => btn.querySelector('img[alt="left arrow"]')) ??
      (nextIdx > 0 ? buttons[nextIdx - 1] : undefined)
    if (!prev || prev.hasAttribute("disabled")) return false
    prev.click()
    return true
  })
}

async function goToEpayGridPage(page: Page, targetPage: number, trackedPage: number): Promise<number> {
  let current = (await getEpayGridPageInfo(page))?.current ?? trackedPage
  for (let guard = 0; current !== targetPage && guard < 100; guard++) {
    const goBack = current > targetPage
    const moved = goBack
      ? await clickPrevEpayGridPage(page)
      : await clickNextPaymentHistoryPage(page)
    if (!moved) {
      console.log(
        `Could not move grid from page ${current} to page ${targetPage} (${
          goBack ? "previous" : "next"
        } button unavailable)`
      )
      break
    }
    await waitForSecs(3000)
    current = (await getEpayGridPageInfo(page))?.current ?? (goBack ? current - 1 : current + 1)
  }
  return current
}

async function locateEpayGridRowByCrn(
  page: Page,
  crn: string
): Promise<{ rowKey: string | null; gridCrns: string[] }> {
  await scrollEpayGridTo(page, "start")
  return page.evaluate((targetCrn) => {
    const rows = Array.from(document.querySelectorAll("ag-grid-angular .ag-row")) as HTMLElement[]
    const gridCrns: string[] = []
    let rowKey: string | null = null
    rows.forEach((row, i) => {
      const text = (row.querySelector('[col-id="crn"]')?.textContent || "").replace(/\s+/g, "")
      if (!text) return
      gridCrns.push(text)
      if (rowKey === null && text.includes(targetCrn)) {
        rowKey =
          row.getAttribute("row-index") ??
          row.getAttribute("aria-rowindex") ??
          row.getAttribute("row-id") ??
          `dom-${i}`
      }
    })
    return { rowKey, gridCrns }
  }, crn)
}

/** Rewind to the first grid page, then walk forward until the CRN shows up. */
async function findEpayGridPageWithCrn(page: Page, crn: string): Promise<number | null> {
  for (let guard = 0; guard < 100 && (await clickPrevEpayGridPage(page)); guard++) {
    await waitForSecs(3000)
  }
  for (let pageNum = 1; pageNum <= 100; pageNum++) {
    const { rowKey } = await locateEpayGridRowByCrn(page, crn)
    if (rowKey !== null) return (await getEpayGridPageInfo(page))?.current ?? pageNum
    if (!(await clickNextPaymentHistoryPage(page))) return null
    await waitForSecs(3000)
  }
  return null
}

async function closeOpenMatMenus(page: Page): Promise<void> {
  for (let i = 0; i < 3; i++) {
    const open = await page.evaluate(
      () => document.querySelectorAll(".cdk-overlay-container .mat-mdc-menu-panel").length
    )
    if (open === 0) return
    await page.keyboard.press("Escape")
    await waitForSecs(400)
  }
}

async function clickEpayRowActionButton(
  page: Page,
  rowKey: string
): Promise<{ clicked: boolean; renderedCols: string[] }> {
  return page.evaluate((key) => {
    const rows = (
      Array.from(document.querySelectorAll("ag-grid-angular .ag-row")) as HTMLElement[]
    ).filter(
      (row, i) =>
        (row.getAttribute("row-index") ??
          row.getAttribute("aria-rowindex") ??
          row.getAttribute("row-id") ??
          `dom-${i}`) === key
    )
    // A logical row can be split across pinned/center containers — check each part.
    for (const row of rows) {
      const button = row.querySelector(
        "app-e-pay-tax-actions .mat-mdc-icon-button"
      ) as HTMLElement | null
      if (button) {
        button.click()
        return { clicked: true, renderedCols: [] }
      }
    }
    const renderedCols = Array.from(
      new Set(
        rows.flatMap((row) =>
          Array.from(row.querySelectorAll("[col-id]")).map((c) => c.getAttribute("col-id") || "")
        )
      )
    )
    return { clicked: false, renderedCols }
  }, rowKey)
}

/** Click the first item of the actions menu that just opened (same item the legacy flow used). */
async function clickFirstOpenMenuItem(
  page: Page,
  timeoutMs = 5000
): Promise<{ clicked: string | null; labels: string[] }> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const result = await page.evaluate(() => {
      const panels = Array.from(
        document.querySelectorAll(".cdk-overlay-container .mat-mdc-menu-panel")
      ) as HTMLElement[]
      const panel = panels[panels.length - 1]
      if (!panel) return null
      const items = Array.from(panel.querySelectorAll(".mat-mdc-menu-item")) as HTMLElement[]
      if (items.length === 0) return null
      const labels = items.map((item) => (item.textContent || "").replace(/\s+/g, " ").trim())
      items[0]!.click()
      return { clicked: labels[0] ?? "", labels }
    })
    if (result) return result
    await waitForSecs(250)
  }
  return { clicked: null, labels: [] }
}

type EpayRowDownloadResult =
  | { ok: true; fileName: string }
  | { ok: false; reason: "row-not-found" | "download-failed"; detail: string }

/**
 * Download one Generated Challans row (by CRN) on the current grid page and confirm a PDF
 * actually landed in `downloadDir`. Retries the whole row → menu → file sequence.
 */
async function downloadEpayGridRowByCrn(
  page: Page,
  crn: string,
  downloadDir: string,
  maxAttempts = 3
): Promise<EpayRowDownloadResult> {
  let lastDetail = ""
  let rowSeen = false

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await waitForSecs(2000)
    const tag = `CRN ${crn} (attempt ${attempt}/${maxAttempts})`

    await closeOpenMatMenus(page)

    const { rowKey, gridCrns } = await locateEpayGridRowByCrn(page, crn)
    if (rowKey === null) {
      lastDetail = `not on current grid page; rendered CRNs: ${gridCrns.join(", ") || "none"}`
      console.log(`${tag}: ${lastDetail}`)
      continue
    }
    rowSeen = true

    const beforeMtimes = getPdfMtimes(downloadDir)

    let action = await clickEpayRowActionButton(page, rowKey)
    if (!action.clicked) {
      await scrollEpayGridTo(page, "end")
      action = await clickEpayRowActionButton(page, rowKey)
    }
    if (!action.clicked) {
      lastDetail = `row-index ${rowKey} found but Actions button not rendered (rendered columns: ${
        action.renderedCols.join(", ") || "none"
      })`
      console.log(`${tag}: ${lastDetail}`)
      continue
    }

    const menu = await clickFirstOpenMenuItem(page)
    if (!menu.clicked) {
      lastDetail = `row-index ${rowKey}: actions menu did not open`
      console.log(`${tag}: ${lastDetail}`)
      continue
    }
    console.log(
      `${tag}: row-index ${rowKey}, clicked "${menu.clicked}" (menu: ${menu.labels.join(" | ")})`
    )

    const fileName = await waitForNewPdfDownload(downloadDir, beforeMtimes, 30000)
    if (fileName) {
      if (!fileName.includes(crn)) {
        console.log(`${tag}: warning — saved file ${fileName} does not contain the CRN`)
      }
      return { ok: true, fileName }
    }
    lastDetail = `clicked "${menu.clicked}" but no new PDF appeared in ${downloadDir} within 30s`
    console.log(`${tag}: ${lastDetail}`)
  }

  return {
    ok: false,
    reason: rowSeen ? "download-failed" : "row-not-found",
    detail: lastDetail,
  }
}

export type EpayTargetedDownloadStats = PaymentHistoryDownloadStats & {
  matched: number
  notFound: number
  failed: number
}

/**
 * Download only e-Pay grid rows matching CSV targets (assessment year + amount).
 * Each target gets its own CRN; when several portal rows share a year+amount, the newest win.
 */
async function runEpayTargetedRowDownload(
  page: Page,
  targets: EpayRowDownloadTarget[],
  downloadDir: string
): Promise<EpayTargetedDownloadStats> {
  const stats: EpayTargetedDownloadStats = {
    totalSeen: 0,
    skipped: 0,
    downloaded: 0,
    pages: 0,
    matched: 0,
    notFound: 0,
    failed: 0,
  }

  if (targets.length === 0) return stats

  // Count rather than dedupe: two CSV sections with the same amount are two challans.
  type TargetGroup = { key: string; assessmentYear: string; amount: number; needed: number }
  const groups = new Map<string, TargetGroup>()
  for (const target of targets) {
    const assessmentYear = target.assessmentYear.trim()
    const key = `${assessmentYear}:${target.amount}`
    const group = groups.get(key) ?? { key, assessmentYear, amount: target.amount, needed: 0 }
    group.needed += 1
    groups.set(key, group)
  }

  // Skip portal AY filter modal (wastes time / often fails). Match year+amount on grid rows.
  console.log(
    `CSV-targeted download: no AY filter modal — matching ${targets.length} target(s) on grid: ${Array.from(
      groups.values()
    )
      .map((g) => `${g.assessmentYear} / ${g.amount}${g.needed > 1 ? ` ×${g.needed}` : ""}`)
      .join(", ")}`
  )

  type Candidate = EpayGridRow & { chlnCreDtMs: number; pageNum: number }
  const candidates = new Map<string, Candidate[]>()
  const seenCrns = new Set<string>()

  let pageNum = 0
  while (true) {
    pageNum++
    stats.pages = pageNum
    await waitForSecs(2000)

    const pageInfo = await getEpayGridPageInfo(page)
    const rows = await scrapeEpayGridRows(page)
    stats.totalSeen += rows.length
    console.log(
      `Grid page ${pageNum}${pageInfo ? ` (${pageInfo.current} of ${pageInfo.total})` : ""}: ${
        rows.length
      } row(s)${rows.length ? " — " : ""}${rows
        .map((r) => `${r.crn || "?"} ${r.taxYear || "?"} ₹${r.amount} [${r.chlnCreDt || "?"}]`)
        .join("; ")}`
    )

    for (const row of rows) {
      if (!row.crn || seenCrns.has(row.crn)) continue
      const key = `${row.taxYear}:${row.amount}`
      if (!groups.has(key)) continue
      seenCrns.add(row.crn)
      const list = candidates.get(key) ?? []
      list.push({ ...row, chlnCreDtMs: parseChlnCreDtMs(row.chlnCreDt), pageNum })
      candidates.set(key, list)
    }

    const allTargetsSeen = Array.from(groups.values()).every(
      (g) => (candidates.get(g.key)?.length ?? 0) >= g.needed
    )
    if (allTargetsSeen) break
    const hasNext = await clickNextPaymentHistoryPage(page)
    if (!hasNext) break
    await waitForSecs(3000)
  }

  type Assignment = { crn: string; assessmentYear: string; amount: number; pageNum: number }
  const assignments: Assignment[] = []
  for (const group of groups.values()) {
    const matches = (candidates.get(group.key) ?? []).sort((a, b) => b.chlnCreDtMs - a.chlnCreDtMs)
    if (matches.length > group.needed) {
      console.log(
        `${matches.length} portal rows match ${group.assessmentYear} / ${group.amount}; using newest ${
          group.needed
        }: ${matches
          .slice(0, group.needed)
          .map((m) => m.crn)
          .join(", ")}`
      )
    }
    for (const match of matches.slice(0, group.needed)) {
      assignments.push({
        crn: match.crn,
        assessmentYear: group.assessmentYear,
        amount: group.amount,
        pageNum: match.pageNum,
      })
    }
    const missing = group.needed - Math.min(matches.length, group.needed)
    if (missing > 0) {
      stats.notFound += missing
      console.log(
        `No portal row for CSV target: ${group.assessmentYear} / amount ${group.amount}${
          missing > 1 ? ` (${missing} missing)` : ""
        }`
      )
    }
  }

  // Scanning stopped on the last page — work backwards so each page is visited once.
  assignments.sort((a, b) => b.pageNum - a.pageNum)
  const failedCrns: string[] = []
  let currentPage = pageNum

  for (const assignment of assignments) {
    stats.matched += 1
    console.log(
      `Downloading CRN ${assignment.crn} for ${assignment.assessmentYear} / amount ${assignment.amount} (grid page ${assignment.pageNum})`
    )
    currentPage = await goToEpayGridPage(page, assignment.pageNum, currentPage)

    let result = await downloadEpayGridRowByCrn(page, assignment.crn, downloadDir)
    if (!result.ok && result.reason === "row-not-found") {
      console.log(`CRN ${assignment.crn} not on grid page ${currentPage} — searching all pages`)
      const foundPage = await findEpayGridPageWithCrn(page, assignment.crn)
      if (foundPage !== null) {
        currentPage = foundPage
        result = await downloadEpayGridRowByCrn(page, assignment.crn, downloadDir)
      } else {
        currentPage = (await getEpayGridPageInfo(page))?.current ?? currentPage
      }
    }

    if (result.ok) {
      stats.downloaded += 1
      console.log(`Downloaded CRN ${assignment.crn} → ${result.fileName}`)
    } else {
      stats.failed += 1
      failedCrns.push(assignment.crn)
      console.log(`Failed to download CRN ${assignment.crn} (${result.reason}): ${result.detail}`)
    }
  }

  console.log(
    `CSV-targeted download summary: ${targets.length} target(s), ${stats.matched} matched, ${stats.downloaded} downloaded, ${stats.failed} failed, ${stats.notFound} not found on portal`
  )
  if (failedCrns.length > 0) {
    console.log(`CSV-targeted download failed CRNs: ${failedCrns.join(", ")}`)
  }
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
  // Every page POSTs the same URL (page number is in the body), so responses are told apart
  // by arrival order, not URL — deduping on URL silently dropped page 2 onwards.
  let pending: { seq: number; json: unknown } | null = null
  let seq = 0
  let lastConsumedSeq = 0

  const onResponse = async (response: { url: () => string; json: () => Promise<unknown> }) => {
    const url = response.url()
    if (!isPaymentHistoryApiUrl(url)) return
    try {
      pending = { seq: ++seq, json: await response.json() }
    } catch {
      /* ignore parse errors */
    }
  }

  page.on("response", onResponse)

  const take = async (timeoutMs = 60000): Promise<PaymentHistoryPageCapture | null> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      if (pending && pending.seq > lastConsumedSeq) {
        lastConsumedSeq = pending.seq
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
    lastConsumedSeq = seq
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
      paymentHistoryStats = await runEpayTargetedRowDownload(page, csvTargets, downloadPath)
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
  /** Set when `csiAfter` was requested and the CSI tab download succeeded. */
  csi?: { downloadPath: string; files: string[]; startedAt: number }
  /** Set when `csiAfter` was requested and the CSI tab download failed (PDFs are unaffected). */
  csiError?: string
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
    /**
     * After the PDFs, switch to the CSI File tab in the same session and download the CSI
     * file for this range (saves a separate login). Uses the session's Act selection.
     */
    csiAfter?: { fromDate: string; toDate: string }
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
  let csiResult: MissingPaymentPdfDownloadResult["csi"]
  let csiError: string | undefined
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

    if (!skipDateFilter && dateRange) {
      // The filter triggers a fresh paymenthistory response; drop the tab's initial one.
      // Unfiltered runs must keep it — it is page 1, and nothing re-fetches it.
      capture.reset()
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

    if (options?.csiAfter) {
      const csiPath = csiDownloadDir(companyName)
      const startedAt = Date.now()
      try {
        console.log(`[downloadMissingPaymentHistoryPdfs] CSI File tab in same session → ${csiPath}`)
        await closeOpenMatMenus(page)
        fs.mkdirSync(csiPath, { recursive: true })
        await client.send("Page.setDownloadBehavior", { behavior: "allow", downloadPath: csiPath })
        try {
          await client.send("Browser.setDownloadBehavior", {
            behavior: "allow",
            downloadPath: csiPath,
            eventsEnabled: true,
          })
        } catch {
          /* Page-level behaviour above is enough; events only speed up completion detection. */
        }
        await page.evaluate(() => window.scrollTo(0, 0))
        const { fromDate, toDate } = options.csiAfter
        let files: string[]
        try {
          files = await downloadCsiFromEpayTabs(page, client, csiPath, fromDate, toDate)
        } catch (err: any) {
          // After a long Payment History pass the tab strip sometimes re-renders without
          // the CSI tab. Re-open e-Pay from the menu (same login) and try once more.
          if (page.url().includes("sessionExpire")) throw err
          console.log(
            `[downloadMissingPaymentHistoryPdfs] CSI tab missing (${err?.message || err}) — re-opening e-Pay in same session`
          )
          await navigateToEpayTaxViaMenu(page)
          // The portal may remember the Act choice and open straight on the tab strip.
          const landing = await Promise.any([
            page
              .waitForSelector('button.large-button-primary.iconsAfter.nextIcon[type="button"]', {
                visible: true,
                timeout: 120000,
              })
              .then(() => "choice" as const),
            page
              .waitForSelector(".mdc-tab__text-label", { visible: true, timeout: 120000 })
              .then(() => "tabs" as const),
          ])
          if (landing === "choice") {
            if (!skipNewActRadio) {
              await page.waitForSelector("#mat-radio-0", { visible: true, timeout: 30000 })
              await page.click("#mat-radio-0")
            }
            await clickContinueAfterEpayLanding(page)
          }
          await page.waitForSelector(".mdc-tab__text-label", { visible: true, timeout: 60000 })
          await waitForSecs(6000)
          files = await downloadCsiFromEpayTabs(page, client, csiPath, fromDate, toDate)
        }
        csiResult = { downloadPath: csiPath, files, startedAt }
      } catch (err: any) {
        csiError = err?.message || String(err)
        console.log(`[downloadMissingPaymentHistoryPdfs] CSI tab download failed: ${csiError}`)
      }
    }

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
    ...(csiResult ? { csi: csiResult } : {}),
    ...(csiError ? { csiError } : {}),
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

async function clickEpayTabByLabel(page: Page, tabLabel: string, timeoutMs = 45000) {
  // The tab strip can render before all tabs are populated (slow portal), so poll.
  const start = Date.now()
  let seen: string[] = []
  while (Date.now() - start < timeoutMs) {
    if (await clickEpayTabByLabelOnce(page, tabLabel)) return
    seen = await page
      .evaluate(() =>
        Array.from(document.querySelectorAll(".mdc-tab__text-label")).map((el) =>
          (el.textContent || "").replace(/\s+/g, " ").trim()
        )
      )
      .catch(() => [])
    await waitForSecs(2000)
  }
  throw new Error(
    `Could not find e-Pay tab: "${tabLabel}" (tabs on page: ${seen.join(" | ") || "none"}; url ${page.url()})`
  )
}

async function clickEpayTabByLabelOnce(page: Page, tabLabel: string): Promise<boolean> {
  return page.evaluate((want) => {
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

/** Folder the CSI flows save into: `public/pdf/challans/{company}/CSI`. */
export function csiDownloadDir(companyName: string): string {
  return path.resolve(`./public/pdf/challans/${companyName}/CSI`)
}

/**
 * On an already-open e-Pay page (Act chosen, tab strip visible): select the CSI File tab,
 * set the dates and download into `downloadPath`. Returns the downloaded file names.
 */
async function downloadCsiFromEpayTabs(
  page: Page,
  client: Awaited<ReturnType<Page["createCDPSession"]>>,
  downloadPath: string,
  fromDate: string,
  toDate: string
): Promise<string[]> {
  if (!fs.existsSync(downloadPath)) fs.mkdirSync(downloadPath, { recursive: true })
  await clickEpayTabByLabel(page, CSI_TAB_LABEL)
  await waitForSecs(3000)

  await setCsiFileDates(page, fromDate, toDate)

  const beforeMtimes = getDownloadFileMtimes(downloadPath)
  await clickDownloadCsiChallanFileButton(page)
  console.log("Clicked Download Challan File — waiting for file to finish downloading...")
  const files = await waitForCsiDownloadComplete(downloadPath, beforeMtimes, client)
  console.log(`CSI file downloaded: ${files.join(", ")}`)
  return files
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

  const downloadPath = csiDownloadDir(companyName)
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
    const files = await downloadCsiFromEpayTabs(page, client, downloadPath, fromDate, toDate)
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
