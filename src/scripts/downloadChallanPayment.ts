import puppeteer from "puppeteer-extra"
import fs from "fs"
// add stealth plugin and use defaults (all evasion techniques)
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import { Page } from "puppeteer"
import { waitForSecs } from "src/utils/promises"
import path from "path"
import pdfParse from "pdf-parse"
import * as XLSX from "xlsx"
puppeteer.use(StealthPlugin())

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

export async function downloadChallanPayments(
  Username: string,
  Password: string,
  companyName: string,
  fromDate?: string,
  toDate?: string,
  assessmentYear?: string,
  paymentType?: string
) {
  console.log("Downloading challan payments for company:", companyName)
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
  const downloadPath = path.resolve(`./public/pdf/challans/${companyName}/PaymentHistory`)
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

  await page.evaluate(() => {
    setTimeout(() => {
      location.href = "#/dashboard/e-pay-tax/e-pay-tax-dashboard"
      setTimeout(() => {
        window["$"]("#securityReasonPopup").modal("hide")
      }, 1000)
    }, 5000)
  })
  await page.waitForSelector(".mdc-tab__text-label")
  const elements = await page.$$(".mdc-tab__text-label")

  await waitForSecs(6000)
  for (let element of elements) {
    // Get the text content of each element
    const text = await page.evaluate((el) => el.textContent?.trim(), element)

    // Check if the text content is "Generated Challans"
    if (text === "Payment History") {
      // Click the element if it matches
      await element.click()
    }
  }

  await waitForSecs(5000)

  // Apply filters using the portal's filter modal
  if (assessmentYear || paymentType || (fromDate && toDate)) {
    console.log("Applying filters using the portal's filter modal...")

    // Click the Filter button to open modal
    await page.waitForSelector("button.defaultButton.filterButton")
    await page.click("button.defaultButton.filterButton")
    await waitForSecs(2000)

    // Fill in Assessment Year if provided
    if (assessmentYear) {
      console.log("Selecting assessment year:", assessmentYear)
      // Click on the assessment year select by clicking on its value display
      await page.evaluate(() => {
        const selectValue = document.getElementById("mat-select-value-17")
        if (selectValue) {
          const parentSelect = selectValue.closest("mat-select")
          if (parentSelect) {
            ;(parentSelect as HTMLElement).click()
          }
        }
      })
      await waitForSecs(1000)

      // Find and click the option with matching text
      await page.evaluate((year) => {
        const options = Array.from(document.querySelectorAll("mat-option"))
        const targetOption = options.find((opt) => opt.textContent?.trim() === year)
        if (targetOption) {
          ;(targetOption as HTMLElement).click()
        }
      }, assessmentYear)
      await waitForSecs(1000)
    }

    // Fill in Type of Payment if provided
    if (paymentType) {
      console.log("Selecting payment type:", paymentType)
      // Click on the payment type select by clicking on its value display
      await page.evaluate(() => {
        const selectValue = document.getElementById("mat-select-value-19")
        if (selectValue) {
          const parentSelect = selectValue.closest("mat-select")
          if (parentSelect) {
            ;(parentSelect as HTMLElement).click()
          }
        }
      })
      await waitForSecs(1000)

      // Find and click the option with matching text
      await page.evaluate((type) => {
        const options = Array.from(document.querySelectorAll("mat-option"))
        const targetOption = options.find((opt) => opt.textContent?.trim() === type)
        if (targetOption) {
          ;(targetOption as HTMLElement).click()
        }
      }, paymentType)
      await waitForSecs(1000)
    }

    // Fill in Payment Date Range if provided
    if (fromDate && toDate) {
      console.log("Selecting date range:", fromDate, "to", toDate)

      // Click the calendar toggle button for "From" date
      await page.evaluate(() => {
        const fromInput = document.getElementById("frompayment")
        if (fromInput) {
          // Find the calendar toggle button (mat-datepicker-toggle)
          const parent = fromInput.closest("mat-form-field")
          const calendarButton = parent?.querySelector(
            'mat-datepicker-toggle button[aria-label="Open calendar"]'
          )
          if (calendarButton) {
            ;(calendarButton as HTMLElement).click()
          }
        }
      })
      await waitForSecs(1000)

      // Select the from date from the calendar
      await page.evaluate((dateStr) => {
        // Parse the date string (format: DD-MMM-YYYY HH:mm:ss or DD-MMM-YYYY)
        const datePart = dateStr.split(" ")[0]
        if (!datePart) return

        const parts = datePart.split("-")
        const day = parts[0]
        const month = parts[1]
        const year = parts[2]

        if (!day || !month || !year) return

        // Convert month abbreviation to full name for aria-label matching
        const monthMap = {
          Jan: "January",
          Feb: "February",
          Mar: "March",
          Apr: "April",
          May: "May",
          Jun: "June",
          Jul: "July",
          Aug: "August",
          Sep: "September",
          Oct: "October",
          Nov: "November",
          Dec: "December",
        }
        const fullMonth = monthMap[month]

        // Find and click the date button in the calendar
        // Format: "December 23, 2025"
        const dateButtons = Array.from(
          document.querySelectorAll("button.mat-calendar-body-cell[aria-label]")
        )
        for (const btn of dateButtons) {
          const ariaLabel = btn.getAttribute("aria-label")
          if (ariaLabel && ariaLabel === `${fullMonth} ${parseInt(day)}, ${year}`) {
            ;(btn as HTMLElement).click()
            break
          }
        }
      }, fromDate)
      await waitForSecs(1000)

      // Click the calendar toggle button for "To" date
      await page.evaluate(() => {
        const toInput = document.getElementById("topayment")
        if (toInput) {
          // Find the calendar toggle button (mat-datepicker-toggle)
          const parent = toInput.closest("mat-form-field")
          const calendarButton = parent?.querySelector(
            'mat-datepicker-toggle button[aria-label="Open calendar"]'
          )
          if (calendarButton) {
            ;(calendarButton as HTMLElement).click()
          }
        }
      })
      await waitForSecs(1000)

      // Select the to date from the calendar
      await page.evaluate((dateStr) => {
        // Parse the date string (format: DD-MMM-YYYY HH:mm:ss or DD-MMM-YYYY)
        const datePart = dateStr.split(" ")[0]
        if (!datePart) return

        const parts = datePart.split("-")
        const day = parts[0]
        const month = parts[1]
        const year = parts[2]

        if (!day || !month || !year) return

        // Convert month abbreviation to full name for aria-label matching
        const monthMap = {
          Jan: "January",
          Feb: "February",
          Mar: "March",
          Apr: "April",
          May: "May",
          Jun: "June",
          Jul: "July",
          Aug: "August",
          Sep: "September",
          Oct: "October",
          Nov: "November",
          Dec: "December",
        }
        const fullMonth = monthMap[month]

        // Find and click the date button in the calendar
        // Format: "December 23, 2025"
        const dateButtons = Array.from(
          document.querySelectorAll("button.mat-calendar-body-cell[aria-label]")
        )
        for (const btn of dateButtons) {
          const ariaLabel = btn.getAttribute("aria-label")
          console.log(ariaLabel,  `${fullMonth} ${parseInt(day)}, ${year}`)
          if (ariaLabel && ariaLabel === `${fullMonth} ${parseInt(day)}, ${year}`) {
            (btn as HTMLElement).click()
            break
          }
        }
      }, toDate)
      await waitForSecs(1000)
    }

    // Click the Filter button in the modal to apply filters
    console.log("Clicking filter button to apply filters...")
    // Wait for the filter button to be visible
    await waitForSecs(1000)

    // Search for filter button within the filter-section element
    const filterClicked = await page.evaluate(() => {
      // Find the filter-section container using three-class combination to avoid dummy sections
      // Select the filter section that is NOT hidden (ignores any with the "hidden" attribute)
      const filterSection = Array.from(document.querySelectorAll(".filter-section.mt-3.mr-3"))
        .find((el) => !el.hasAttribute("hidden") && ((el as HTMLElement).offsetParent !== null));
      if (!filterSection) {
        console.log("Could not find .filter-section.mt-3.mr-3 element")
        return false
      }

      // Approach 1: Find button with text "Filter" in modal footer within filter-section
      const modalFooter = filterSection.querySelector(".modal-footer")
      if (modalFooter) {
        const buttons = Array.from(modalFooter.querySelectorAll("button"))
        const filterButton = buttons.find((btn) => btn.textContent?.trim() === "Filter")
        if (filterButton) {
          console.log("Found filter button in modal footer")
          ;(filterButton as HTMLElement).click()
          return true
        }
      }

      // Approach 2: Find by class combination within filter-section
      const filterButtons = Array.from(
        filterSection.querySelectorAll("button.defaultButton.primaryButton")
      )
      const filterButton = filterButtons.find((btn) => btn.textContent?.trim() === "Filter")
      if (filterButton) {
        console.log("Found filter button by class combination")
        ;(filterButton as HTMLElement).click()
        return true
      }

      console.log("Could not find filter button in filter-section")
      return false
    })

    if (filterClicked) {
      console.log("Filter button clicked successfully")
    } else {
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

  // Download all filtered payments across all pages
  await page.evaluate(async () => {
    function waitForSecs(timeout = 5000) {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(true)
        }, timeout)
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

      // Download all records on this page
      for (const btn of actionButtons) {
        ;(btn as any).click()
        await waitForSecs(500)
        ;(document.querySelector(".mat-mdc-menu-item.mat-focus-indicator") as any)?.click()
        await waitForSecs(5000)
      }

      // Check if next page button is enabled
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
}
