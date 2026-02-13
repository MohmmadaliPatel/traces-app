/**
 * Form 16A PDF Generator - EXACT MATCH to Java JasperReports Output
 * Based on JRXML templates: Form-16A.jrxml, Payment_Summary.jrxml, Tax_Deducted.jrxml, CIN_Tax_Deducted.jrxml
 */

import puppeteer from "puppeteer"
import { Form16AData } from "./form16AParserExact"
import path from "path"
import fs from "fs"

interface PdfGenerationOptions {
  outputPath: string
  data: Form16AData
}

function imageToBase64(imagePath: string): string {
  try {
    const absolutePath = path.isAbsolute(imagePath)
      ? imagePath
      : path.join(process.cwd(), imagePath)
    if (!fs.existsSync(absolutePath)) {
      console.warn(`⚠ Image not found: ${absolutePath}`)
      return ""
    }
    const imageBuffer = fs.readFileSync(absolutePath)
    const base64 = imageBuffer.toString("base64")
    const ext = path.extname(absolutePath).toLowerCase()
    const mimeType =
      ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png"
    return `data:${mimeType};base64,${base64}`
  } catch (error) {
    console.warn(`⚠ Could not load image: ${imagePath}`, error)
    return ""
  }
}

/**
 * Generate HTML file for Form 16A (for browser preview and editing)
 */
export async function generateForm16AHtmlFile(options: PdfGenerationOptions): Promise<string> {
  const { outputPath, data } = options

  // Load images as base64
  const watermarkBase64 = imageToBase64("public/images/form16/watermark.png")
  const tdsLogoBase64 = imageToBase64("public/images/form16/tdslogo.png")
  const emblemBase64 = imageToBase64("public/images/form16/emblem-english.jpg")

  if (!watermarkBase64) console.warn("⚠ Watermark not loaded!")
  if (!tdsLogoBase64) console.warn("⚠ TDS logo not loaded!")
  if (!emblemBase64) console.warn("⚠ Emblem not loaded!")

  const htmlContent = generateForm16AHtml(data, watermarkBase64, tdsLogoBase64, emblemBase64)

  // Save HTML to file (replace .pdf with .html in output path, or use as-is if already .html)
  const htmlPath = outputPath.endsWith(".html")
    ? outputPath
    : outputPath.replace(/\.pdf$/i, ".html")
  fs.writeFileSync(htmlPath, htmlContent, "utf-8")

  console.log(`✓ Generated HTML: ${htmlPath}`)
  return htmlPath
}

export async function generateForm16APdf(options: PdfGenerationOptions): Promise<void> {
  const { outputPath, data } = options

  // Load images
  const watermarkPath = path.join(process.cwd(), "public", "images", "form16", "watermark.png")
  const tdsLogoPath = path.join(process.cwd(), "public", "images", "form16", "tdslogo.png")
  const emblemPath = path.join(process.cwd(), "public", "images", "form16", "emblem-english.jpg")

  const watermarkBase64 = imageToBase64(watermarkPath)
  const tdsLogoBase64 = imageToBase64(tdsLogoPath)
  const emblemBase64 = imageToBase64(emblemPath)

  if (!watermarkBase64) console.warn("⚠ Watermark image not loaded!")
  if (!tdsLogoBase64) console.warn("⚠ TDS logo not loaded!")
  if (!emblemBase64) console.warn("⚠ Emblem not loaded!")

  const htmlContent = generateForm16AHtml(data, watermarkBase64, tdsLogoBase64, emblemBase64)

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--allow-file-access-from-files"],
  })

  try {
    const page = await browser.newPage()

    // Set viewport
    await page.setViewport({ width: 794, height: 1123 }) // A4 at 96 DPI

    await page.setContent(htmlContent, {
      waitUntil: "networkidle0",
      timeout: 60000,
    })

    // Wait for images to load
    await page
      .waitForFunction(
        () => {
          const images = document.querySelectorAll("img")
          return Array.from(images).every((img) => img.complete)
        },
        { timeout: 10000 }
      )
      .catch(() => {
        console.warn("⚠ Some images may not have loaded")
      })

    // Additional wait
    await new Promise((resolve) => setTimeout(resolve, 500))

    // Note: We're using Puppeteer's header/footer system for proper page numbering
    // The HTML header/footer elements are kept for styling reference but won't be used
    // Puppeteer's header/footer will appear on all pages (we can't easily hide on first page)

    // Determine if we have multiple pages and set appropriate margins
    const hasMultiplePages = await page.evaluate(() => {
      const firstPageContent = document.querySelector(".first-page")
      if (firstPageContent) {
        const contentHeight = firstPageContent.scrollHeight
        const pageHeight = 1123 // A4 height at 96 DPI (794px width, 1123px height)
        return contentHeight > pageHeight
      }
      return false
    })

    // Build header and footer templates for Puppeteer
    // Header: Matching example PDF analysis - 6pt font, Times-Bold, single line with multiple spaces
    // From PDF: "Certificate Number: DIAQISA   TAN of Deductor: MUMC18011A   PAN of Deductee: AAACA4710A   Assessment Year: 2026-27"
    // All items on same line at y: 802.04, spaced with 3 spaces between items
    // Header should appear on all pages starting from page 2
    // Puppeteer's headerTemplate shows on all pages including page 1
    // We'll hide it on page 1 by making it have zero height/visibility when pageNumber is 1
    // Note: Puppeteer doesn't support JavaScript in headerTemplate, so we use a CSS workaround
    // const headerText = `<div style="font-size: 6pt; font-family: 'Times New Roman', Times, serif; font-weight: 700; display: flex; justify-content: space-around; align-items: center; width: 100%; padding: 10pt 0; height: 30pt; line-height: 15pt; box-sizing: border-box; white-space: nowrap; text-align: center;">
    //   <b>Certificate Number: ${data.deducteeData.certificateNumber}</b>
    //   <b>TAN of Deductor: ${data.header.deductorTAN}</b>
    //   <b>PAN of Deductee: ${data.deducteeData.pan}</b>
    //   <b>Assessment Year: ${data.header.assessmentYear}</b>
    // </div>`
    const headerText = ``

    // Footer: Matching example PDF analysis - 7pt font, Times-Roman (not bold), right-aligned, "Page X of Y"
    // From PDF: "Page 2 of 3" at x: 507.56, y: 26.14, right-aligned, 7pt font
    // Note: Puppeteer uses special classes for page numbers - pageNumber and totalPages (camelCase)
    // Increased z-index to ensure footer text is visible on top
    const footerText = `<div style="font-size: 7pt; font-family: 'Times New Roman', Times, serif; font-weight: 400; text-align: right; padding: 0 70px 0 0; height: 16pt; line-height: 14pt; box-sizing: border-box; width: 100%; z-index: 9999; position: relative;">
      <span style="display: inline;">Page </span><span class="pageNumber" style="display: inline;"></span><span style="display: inline;"> of </span><span class="totalPages" style="display: inline;"></span>
    </div>`

    // Use Puppeteer's header/footer for proper page numbering
    // They will appear on all pages, but we hide the HTML ones on first page
    await page.pdf({
      path: outputPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: false,
      // Increase top and bottom margins when we have header/footer (multiple pages)
      // JRXML: header height=30pt, footer height=16pt, page margins=20pt
      // Puppeteer renders header/footer in the margin area, so we need:
      // Top: 20pt (base) + 30pt (header) + 10pt (buffer) = 60pt total = 60/72 inch ≈ 0.833in
      // Bottom: At least 50px (0.52in) to ensure content doesn't get cut off
      // Converting: 50px at 96 DPI = 50/96 inch ≈ 0.52in
      // Side margins: 20pt = 20/72 inch ≈ 0.278in
      // Converting points to inches: 1pt = 1/72 inch
      // Increased top margin to prevent content overlap with header
      // Margins:
      // - First page: normal top margin (0.278in = 20px)
      // - Pages 2+: CSS @page:not(:first) rule handles 80px margin-top
      // Footer still uses footerTemplate, so we need bottom margin for it
      margin: hasMultiplePages
        ? { top: "0.65in", right: "0.278in", bottom: "0.75in", left: "0.278in" } // 0.65in top margin for pages 2+, increased bottom margin (0.75in) to ensure footer is visible
        : { top: "0.278in", right: "0.278in", bottom: "0.52in", left: "0.278in" }, // Normal margins for single page (no header needed)
      displayHeaderFooter: hasMultiplePages, // Show header/footer on multi-page documents
      // Use headerTemplate to show header on all pages starting from page 2
      // Note: Puppeteer will show header on all pages, but we can't easily hide on page 1
      // Solution: Show header on all pages, but first page content starts lower to account for header space
      headerTemplate: hasMultiplePages ? headerText : "<div></div>",
      footerTemplate: hasMultiplePages ? footerText : "<div></div>",
    })

    console.log(`✓ Generated PDF: ${outputPath}`)
  } finally {
    await browser.close()
  }
}

/**
 * Generate section code table based on assessment year
 * Matches the structure from SectionCodeAY*.jrxml files
 */
function generateSectionCodeTable(year: number): string {
  // Section codes for AY 2026 and later (from SectionCodeAY2026.jrxml)
  // Organized by y-coordinate order from JRXML: left column first, then right column
  // Left column (x=6 for code, x=51 for description) - ordered by y coordinate
  const leftColumnSections = [
    ["193", "Interest on Securities"],
    ["194", "Dividends"],
    ["194A", "Interest other than 'Interest on securities'"],
    ["194B", "Winnings from lottery or crossword puzzle, etc"],
    ["194BA", "Winnings from online games"],
    ["194BB", "Winning from horse race"],
    ["194C", "Payments to contractors and sub-contractors"],
    ["194D", "Insurance commission"],
    ["194E", "Payments to non-resident sportsmen or sports associations"],
    ["194EE", "Payments in respect of deposits under National Savings Scheme"],
    ["194F", "Payments on account of repurchase of units by Mutual Fund or Unit Trust of India"],
    ["194G", "Commission, price, etc. on sale of lottery tickets"],
    ["194H", "Commission or brokerage"],
    ["194I", "Rent"],
    [
      "194I(a)",
      "Payment of Rent for the use of land or building or land appurtenant or furniture or fittings",
    ],
    ["194I(b)", "Payment of Rent for the use of any machinery or plant or equipment"],
    ["194J(a)", "Fees for technical services"],
    ["194J(b)", "Fees for professional  services or royalty etc"],
    [
      "194K",
      "Income payable to a resident assessee in respect of units of a specified mutual fund or of the units of the Unit Trust of India",
    ],
    ["194LA", "Payment of compensation on acquisition of certain immovable property"],
    ["194LB", "Income by way of Interest from Infrastructure Debt fund"],
    ["194LC", "Income by way of interest from specified company payable to a non-resident"],
    ["194LC1", "Income under clause (i) and (ia) of sub-section (2) of section 194LC"],
    ["194LC2", "Income under clause (ib) of sub-section (2) of section 194LC"],
    ["194LC3", "Income under clause (ic) of sub-section (2) of section 194LC"],
    ["194LBA", "Certain income from units of a business trust"],
    ["194LBB", "Income in respect of units of investment fund"],
    ["194LBC", "Income in respect of investment in securitization trust"],
    [
      "194N",
      "Payments of certain amounts in cash other than cases covered by first proviso or third proviso",
    ],
    [
      "194NC",
      "Payment of certain amounts in cash to co-operative societies not covered by first proviso",
    ],
    [
      "194NF",
      "Payments of certain amounts in cash to non-filers except in case of co-operative societies",
    ],
    ["194NFT", "Payment of certain amount in cash to non-filers being co-operative societies"],
    ["194O", "Payment of certain sums by e-commerce operator to e-commerce participant"],
    ["194P", "Deduction of tax in case of specified senior citizen"],
    ["194Q", "Deduction of tax at source on payment of certain sum for purchase of goods"],
    ["194R", "Benefits or Perquisites in Business or Profession"],
    [
      "194S",
      "Payment of consideration for transfer of virtual digital asset by persons other than specified persons.",
    ],
    [
      "194T",
      "Payment of salary, remuneration, commission, bonus or interest to a partner of firm.",
    ],
    [
      "Proviso to section 194B",
      "Winnings from lottery or crossword puzzle, etc where consideration is made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such winnings are released",
    ],
    [
      "Sub-section (2) of section 194BA",
      "Net Winnings from online games where the net winnings are made in kind or cash is not sufficient to meet the tax liability and tax has been paid before such net winnings are released",
    ],
  ]

  // Right column (x=284 for code, x=329 for description) - ordered by y coordinate
  const rightColumnSections = [
    ["196A", "Income in respect of units of non-residents"],
    ["196B", "Income from units"],
    [
      "196C",
      "Income from foreign currency bonds or shares of Indian company payable to non-residents",
    ],
    ["196D", "Income of specified fund from securities"],
    ["196DA", "Income of foreign institutional investors from securities"],
    ["195", "Other sums payable to a non-resident"],
    ["206CA", "Collection at source from alcoholic liquor for human consumption"],
    [
      "206CB",
      "Collection at source from contractors or licensee or lease relating to parking lots",
    ],
    ["206CC", "Collection at source from timber obtained by any mode other than a forest lease"],
    [
      "206CE",
      "Collection at source from Timber or any other forest produce (not being tendu leaves) obtained under a forest lease",
    ],
    ["206CF", "Collection at source from contractors or licensee or lease relating to toll plaza"],
    [
      "206CG",
      "Collection at source from contractors or licensee or lease relating to mine or quarry",
    ],
    ["206CH", "Collection at source on sale of Motor vehicle"],
    ["206CI", "Collection at source from on sale of certain Minerals"],
    ["206CJ", "Collection at source from tendu Leaves"],
    ["206CK", "Collection at source on cash case of Bullion and Jewellery"],
    ["206CL", "Collection at source on sale of art piece such as antiques, painting, sculpture"],
    ["206CM", "Collection at source on sale in cash of any goods(other than bullion/jewelry)"],
    ["206CMA", "Collection at source on sale of wrist watch"],
    ["206CMB", "Collection at source on sale of art piece such as antiques, painting, sculpture"],
    ["206CMC", "Collection at source on sale of collectibles such as coin, stamp"],
    ["206CMD", "Collection at source on sale of yacht, rowing boat, canoe, helicopter"],
    ["206CME", "Collection at source on sale of pair of sunglasses"],
    ["206CMF", "Collection at source on sale of bag such as handbag, purse"],
    ["206CMG", "Collection at source on sale of pair of shoes"],
    [
      "206CMH",
      "Collection at source on sale of sportswear and equipment such as golf kit, ski-wear",
    ],
    ["206CMI", "Collection at source on sale of home theatre system"],
    [
      "206CMJ",
      "Collection at source on sale of horse for horse racing in race clubs and horse for polo",
    ],
    ["206CN", "Collection at source on providing of any services (other than Ch-XVII-B)"],
  ]

  // Use appropriate sections based on year
  const leftSections = year >= 2026 ? leftColumnSections : leftColumnSections
  const rightSections = year >= 2026 ? rightColumnSections : rightColumnSections

  // Create 4-column table rows (left pair, right pair)
  let tableRows = ""
  const maxRows = Math.max(leftSections.length, rightSections.length)

  for (let i = 0; i < maxRows; i++) {
    const leftSection = leftSections[i] || ["", ""]
    const rightSection = rightSections[i] || ["", ""]

    // Check if right section is empty
    const isRightEmpty = !rightSection[0] && !rightSection[1]
    const rightCodeClass = isRightEmpty ? "section-code-col empty-right" : "section-code-col"
    const rightDescClass = isRightEmpty ? "description-col empty-right" : "description-col"

    tableRows += `<tr>
      <td class="section-code-col">${leftSection[0] || "&nbsp;"}</td>
      <td class="description-col">${leftSection[1] || "&nbsp;"}</td>
      <td class="${rightCodeClass}">${rightSection[0] || ""}</td>
      <td class="${rightDescClass}">${rightSection[1] || ""}</td>
    </tr>`
  }

  return `<table class="section-code-table">
    <tr>
      <th>Section Code</th>
      <th>Description</th>
      <th>Section Code</th>
      <th>Description</th>
    </tr>
    ${tableRows}
  </table>`
}

function generateForm16AHtml(
  data: Form16AData,
  watermarkBase64: string,
  tdsLogoBase64: string,
  emblemBase64: string
): string {
  const { header, footer, deducteeData } = data

  // Extract assessment year to determine which section codes to show
  const assessmentYear = header.assessmentYear || ""
  const yearMatch = assessmentYear.match(/^(\d{4})/)
  const year = yearMatch && yearMatch[1] ? parseInt(yearMatch[1], 10) : 2026

  // Generate section code table based on assessment year (matching JRXML logic)
  const sectionCodeTable = generateSectionCodeTable(year)

  // Calculate payment summary total
  const totalPaid = deducteeData.paymentSummary
    .reduce((sum, p) => sum + parseFloat(p.amountPaidCredited || "0"), 0)
    .toFixed(2)

  // Payment Summary Table rows - filter out empty rows
  const paymentRows = deducteeData.paymentSummary
    .filter(
      (p) =>
        p.amountPaidCredited &&
        p.amountPaidCredited.trim() !== "" &&
        parseFloat(p.amountPaidCredited) > 0
    )
    .map(
      (p, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="r">${p.amountPaidCredited}</td>
        <td class="c">${p.natureOfPayment || ""}</td>
        <td class="c">${p.referenceNo || ""}</td>
        <td class="c">${p.paymentDate || ""}</td>
      </tr>`
    )
    .join("")

  // Tax Deducted Summary rows (Summary of tax deducted at source) - filter out empty rows
  const taxRows = deducteeData.taxDeductedSummary
    .filter((t) => t.taxDeducted && t.taxDeducted.trim() !== "" && parseFloat(t.taxDeducted) > 0)
    .map(
      (t) => `<tr>
        <td class="c">${t.quarter || ""}</td>
        <td class="c">${t.receiptNumber || ""}</td>
        <td class="r">${t.taxDeducted}</td>
        <td class="r">${t.taxDeposited || ""}</td>
      </tr>`
    )
    .join("")

  // BIN Table rows (Section I: Book Adjustment) - only show rows with data
  const binRows = deducteeData.binDetails
    .filter((b) => b.taxDeposited && b.taxDeposited.trim() !== "" && parseFloat(b.taxDeposited) > 0) // Filter out empty rows
    .map(
      (b, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="r">${b.taxDeposited}</td>
        <td class="c">${b.receiptNumber || ""}</td>
        <td class="c">${b.ddoSequenceNumber || ""}</td>
        <td class="c">${b.depositDate || ""}</td>
        <td class="c">${b.bookingStatus || ""}</td>
      </tr>`
    )
    .join("")

  // Calculate BIN total
  const binTotal = deducteeData.binDetails
    .reduce((sum, b) => sum + parseFloat(b.taxDeposited || "0"), 0)
    .toFixed(2)

  // CIN Table rows (Section II) - NO "Date of payment" column! - only show rows with data
  const cinRows = deducteeData.cinDetails
    .filter((c) => c.taxDeposited && c.taxDeposited.trim() !== "" && parseFloat(c.taxDeposited) > 0) // Filter out empty rows
    .map(
      (c, i) => `<tr>
        <td class="c">${i + 1}</td>
        <td class="r">${c.taxDeposited}</td>
        <td class="c">${c.bsrCode || ""}</td>
        <td class="c">${c.depositDate || ""}</td>
        <td class="c">${c.challanSerialNumber || ""}</td>
        <td class="c">${c.bookingStatus || ""}</td>
      </tr>`
    )
    .join("")

  // Calculate CIN total
  const cinTotal = deducteeData.cinDetails
    .reduce((sum, c) => sum + parseFloat(c.taxDeposited || "0"), 0)
    .toFixed(2)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<style>
/* Page-specific margins - works dynamically for any number of pages (2, 30, etc.) */
@page {
  size: A4;
  margin-left: 20px;
  margin-right: 20px;
  margin-bottom: 80px; /* Increased to 75px to ensure footer is visible */
}
/* First page - normal top margin */
@page:first {
  margin-top: 20px;
  margin-bottom: 75px; /* Increased to ensure footer visibility */
}
/* All pages from page 2 onwards - 80px top margin */
/* This automatically applies to page 2, 3, 4... up to any number of pages */
@page:not(:first) {
  margin-top: 80px !important; /* 80px margin-top from page 2 onwards - works for any number of pages */
}
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Times New Roman', Times, serif;
  font-size: 8pt;
  color: #000;
  line-height: 1.3;
  position: relative;
  background: #fff;
  margin: 0;
  padding: 0;
  min-height: 100vh;
  overflow: visible; /* Ensure all content is visible */
}

/* Add margin-top to body content on page 2+ to push content down */
/* This works by detecting when content is on page 2+ and adding margin */
@page:not(:first) {
  /* Add margin-top to body on pages 2+ */
}
@page:not(:first) body {
  margin-top: 80px !important;
}

/* Content wrapper to ensure it's above watermark */
.content-wrapper {
  position: relative;
  z-index: 1;
  background: transparent;
  padding-bottom: 50px; /* Extra padding to ensure last page content isn't cut off (at least 50px) */
}


/* Add padding-top on page 2+ to prevent content overlap with header */
.content-wrapper:not(.first-page) {
  padding-top: 40px; /* Space for header (30pt + some buffer) */
}

/* Page break handling - add spacing after first page */
.page-break {
  page-break-before: always;
  padding-top: 30px; /* Space for header on subsequent pages */
}

/* Watermark - Centered, behind content, on every page */
.watermark-bg {
  position: fixed;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 550px; /* Increased from 411px */
  height: 470px; /* Increased from 350px */
  z-index: -1;
  pointer-events: none;
  background: transparent;
  margin: 0;
  padding: 0;
  page-break-inside: avoid;
}
.watermark-bg img {
  width: 100%;
  height: 100%;
  opacity: 1; /* Increased from 0.60 */
  object-fit: contain;
  display: block;
  -webkit-print-color-adjust: exact;
  print-color-adjust: exact;
}

/* Header with logos - matching JRXML: 393pt x 50pt for TDS, 160pt x 50pt for Emblem */
.logo-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  height: 50pt;
  margin-bottom: 0;
}
.logo-header img.tds { width: 393pt; height: 50pt; object-fit: contain; }
.logo-header img.emblem { width: 160pt; height: 50pt; object-fit: contain; background: transparent; mix-blend-mode: multiply; }

/* Title section */
.title { border: 1px solid #000; text-align: center; font-size: 12pt; font-weight: 700; font-family: 'Times New Roman', Times, serif; padding: 4px; }
.subtitle { border: 1px solid #000; border-top: none; text-align: center; font-size: 8pt; font-weight: 400; font-family: 'Times New Roman', Times, serif; padding: 2px; }
.desc { border: 1px solid #000;border-bottom: none; border-top: none; text-align: center; font-size: 8pt; font-weight: 700; font-family: 'Times New Roman', Times, serif; padding: 4px; }

/* Box styles */
.box { border: 1px solid #000; }
.box-hdr { border: 1px solid #000; font-weight: 700; font-family: 'Times New Roman', Times, serif; text-align: center; padding: 4px; font-size: 8pt; }
.box-content { border: 1px solid #000; border-top: none; font-weight: 400; font-family: 'Times New Roman', Times, serif; padding: 6px 8px; min-height: 65px; font-size: 8pt; line-height: 1.4; }

/* Layout */
.row { display: flex; width: 100%; }
.col-50 { width: 50%; }
.col-25 { width: 25%; }

/* Tables */
table { width: 100%; border-collapse: collapse; font-size: 8pt; }
th, td { border: 1px solid #000; padding: 3px 4px; vertical-align: middle; }
th { font-weight: 700; font-family: 'Times New Roman', Times, serif; text-align: center; font-size: 8pt; }
td { font-weight: 400; font-family: 'Times New Roman', Times, serif; }
.c { text-align: center; }
.r { text-align: right; font-family: Helvetica, Arial, sans-serif; font-weight: 400; } /* Numerical entries use Helvetica */
.l { text-align: left; }
.b { font-weight: 700; font-family: 'Times New Roman', Times, serif; }

/* Section headers */
.section-hdr {
  border: 1px solid #000;
  padding: 4px;
  font-weight: 700;
  font-family: 'Times New Roman', Times, serif;
  text-align: center;
  font-size: 7pt;
  line-height: 1.3;
}
.section-sub {
  border: 1px solid #000;
  border-top: none;
  padding: 2px;
  font-size: 6pt;
  font-weight: 700;
  font-family: 'Times New Roman', Times, serif;
  text-align: center;
}

/* Amount box */
.amt-box { border: 1px solid #000; padding: 6px; margin-top: 6px; font-size: 8pt; }

/* Verification */
.verify-section {
  page-break-inside: avoid;
  break-inside: avoid;
  page-break-after: auto;
}
.verify-title {
  border: 1px solid #000;
  padding: 4px;
  font-weight: 700;
  font-family: 'Times New Roman', Times, serif;
  text-align: center;
  font-size: 8pt;
  line-height: 1.3;
}
.verify-box {
  border: 1px solid #000;
  border-top: none;
  font-weight: 400;
  font-family: 'Times New Roman', Times, serif;
  padding: 8px;
  font-size: 8pt;
  text-align: justify;
  line-height: 1.4;
}

/* Signature */
.sig-table td { border: 1px solid #000; font-weight: 400; font-family: 'Times New Roman', Times, serif; padding: 4px 6px; font-size: 8pt; }

/* Notes */
.notes {
  margin-top: 12px;
  font-size: 8pt;
  font-weight: 400;
  font-family: 'Times New Roman', Times, serif;
}
.notes p { margin-bottom: 2px; }
.notes ol { margin-left: 12px; }
.notes li { margin-bottom: 1px; }

/* Legend */
.legend-title { font-weight: 700; font-family: 'Times New Roman', Times, serif; margin-top: 6px; font-size: 8pt; }
.legend-sub { font-weight: 700; font-family: 'Times New Roman', Times, serif; margin: 5px 10px; font-size: 8pt; }
.legend-table {
  font-size: 7pt;
  margin-top: 3px;
  margin-left: 10px;
  margin-right: 10px;
  border-collapse: collapse;
  width: calc(100% - 20px); /* Account for left and right margins */
  max-width: 100%;
  table-layout: fixed; /* Use fixed layout to control column widths */
  word-wrap: break-word; /* Allow text to wrap within cells */
}
.legend-table th {
  background-color: #C5D9F1;
  font-weight: 700;
  font-family: 'Times New Roman', Times, serif;
  font-size: 7pt;
  padding: 2px;
  border: 1px solid #000;
  text-align: center;
  word-wrap: break-word;
  overflow-wrap: break-word;
}
.legend-table td {
  font-weight: 400;
  font-family: 'Times New Roman', Times, serif;
  font-size: 7pt;
  vertical-align: top;
  padding: 2px;
  padding-left: 2px;
  border: 1px solid #000;
  text-align: left;
  word-wrap: break-word;
  overflow-wrap: break-word;
  overflow: hidden; /* Prevent content from overflowing */
}

/* Section Code Table - 4 column layout */
.section-code-table {
  font-size: 7pt;
  margin-top: 3px;
  border-collapse: collapse;
  width: 100%;
}
.section-code-table th {
  background-color: #C5D9F1;
  font-weight: 500;
  font-size: 7pt;
  padding: 2px;
  border: 1px solid #000;
  text-align: center;
}
.section-code-table td {
  font-size: 7pt;
  vertical-align: top;
  padding: 2px;
  border: 1px solid #000;
  text-align: left;
  padding-left: 2px;
  min-height: 15px; /* Ensure minimum height so borders are visible even for empty cells */
  empty-cells: show; /* Show borders for empty cells */
}
.section-code-table td.empty-right {
  border: none !important; /* Remove borders for empty right column cells */
}
.section-code-table .section-code-col {
  width: 45px;
  text-align: left;
  font-weight: 700;
  font-family: 'Times New Roman', Times, serif;
}
.section-code-table .description-col {
  width: 225px;
  text-align: left;
}

/* Gray background for total row */
.gray-bg { background-color: #CCCCCC; }

/* Header and Footer - Fixed position, shown on all pages except first */
.pdf-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  width: 100%;
  font-size: 6pt; /* Matching JRXML: 6pt font */
  font-family: 'Times New Roman', Times, serif;
  font-weight: 700; /* Matching JRXML: Times-Bold */
  text-align: left; /* Matching JRXML: left-aligned, not centered */
  border-bottom: 0.01pt solid #000;
  padding: 10pt 0;
  background: #fff;
  z-index: 1000;
  height: 30pt; /* Matching JRXML: 30pt height */
  display: none; /* Hidden by default - will be shown via print media */
  line-height: 15pt;
  box-sizing: border-box;
}

.pdf-header .header-item {
  margin-right: 5pt; /* Spacing between items matching JRXML layout */
  display: inline-block;
  white-space: nowrap;
}

.pdf-header .header-item b {
  font-weight: 700;
}

.pdf-footer {
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  width: 100%;
  font-size: 7pt; /* Matching JRXML: 7pt font */
  font-family: 'Times New Roman', Times, serif;
  font-weight: 400; /* Matching JRXML: Times-Roman, not bold */
  text-align: right; /* Matching JRXML: right-aligned */
  background: #fff;
  z-index: 1000;
  padding: 0;
  height: 16pt; /* Matching JRXML: 16pt height */
  line-height: 14pt;
  display: none; /* Hidden by default - will be shown via print media */
  box-sizing: border-box;
}

/* Removed .footer-line - JRXML footer has NO horizontal line above it */

/* Page 2+ Header - Regular element (not fixed), appears only on page 2+ */
.pdf-page-header {
  font-size: 6pt;
  font-family: 'Times New Roman', Times, serif;
  font-weight: 700;
  text-align: left;
  padding: 10pt 0;
  height: 30pt;
  line-height: 15pt;
  border-bottom: 0.01pt solid #000;
  background: #fff;
  box-sizing: border-box;
  white-space: nowrap;
  width: 100%;
  margin: 0;
  display: block;
  visibility: visible;
  opacity: 1;
  z-index: 100;
}

/* Show header/footer on pages after the first */
@media print {
  /* Hide header on first page using @page:first */
  @page:first {
    /* First page has no header */
  }

  /* Show header starting from page 2 */
  /* The header is positioned after first page content, so it only appears on page 2+ */
  .pdf-page-header {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  /* Page break marker for spacing */
  .page-break {
    page-break-before: always;
    padding-top: 0;
    margin-top: 0;
  }

  /* Ensure header is visible on page 2+ */
  .pdf-page-header {
    display: block !important;
    visibility: visible !important;
    opacity: 1 !important;
  }

  /* Ensure content doesn't overlap footer on pages with footer */
  body.has-multiple-pages {
    padding-bottom: 30px; /* Space for footer */
  }
}
</style>
</head>
<body>

<!-- Watermark Background - Fixed, centered, behind all content, appears on every page -->
${
  watermarkBase64
    ? `
<div class="watermark-bg">
  <img src="${watermarkBase64}" alt="watermark">
</div>
`
    : ""
}

<!-- PDF Header/Footer - Using Puppeteer's header/footer system instead -->
<!-- HTML elements kept for reference but hidden -->
<div class="pdf-header" style="display: none;">
  <span class="header-item"><b>Certificate Number:</b> ${deducteeData.certificateNumber}</span>
  <span class="header-item"><b>TAN of Deductor:</b> ${header.deductorTAN}</span>
  <span class="header-item"><b>PAN of Deductee:</b> ${deducteeData.pan}</span>
  <span class="header-item"><b>Assessment Year:</b> ${header.assessmentYear}</span>
</div>

<div class="pdf-footer" style="margin:50px;">
  <span style="margin:50px;">Page <span class="page-number"></span> of <span class="total-pages"></span></span>
</div>

<div class="content-wrapper first-page">
<!-- Header Logos -->
<div class="logo-header">
  ${
    tdsLogoBase64
      ? `<img src="${tdsLogoBase64}" class="tds" alt="">`
      : '<div style="width:393pt;height:50pt;"></div>'
  }
  ${
    emblemBase64
      ? `<img src="${emblemBase64}" class="emblem" style="background: transparent; mix-blend-mode: multiply;" alt="">`
      : '<div style="width:160pt;height:50pt;"></div>'
  }
</div>

<!-- Title -->
<div class="title">FORM NO. 16A</div>
<div class="subtitle">[See rule 31(1)(b)]</div>
<div class="desc">Certificate under section 203 of the Income-tax Act, 1961 for tax deducted at source</div>

<!-- Certificate Number / Last Updated Row -->
<div class="row">
  <div class="col-50">
    <div class="box" style="padding: 4px; border-bottom: none;"><b>Certificate No. :</b> ${
      deducteeData.certificateNumber
    }</div>
  </div>
  <div class="col-50">
    <div class="box" style="padding: 4px; border-left: none; border-bottom: none; text-align: right;"><b>Last updated on </b><span style="margin-left: 10px;margin-right: 10px;"> </span> ${
      footer.verificationDate
    }</div>
  </div>
</div>

<!-- Deductor / Deductee Addresses -->
<div class="row">
  <div class="col-50" style="display: flex; flex-direction: column;">
    <div class="box-hdr">Name and address of the Deductor</div>
    <div class="box-content" style="flex: 1;">
      ${header.employerName}<br>
      ${header.addressPart1}${header.addressPart2 ? "<br>" + header.addressPart2 : ""}
      <br>${header.state}<br>${header.telNumber}<br>${header.email}
    </div>
  </div>
  <div class="col-50" style="display: flex; flex-direction: column;">
    <div class="box-hdr" style="border-left: none;">Name and address of the Deductee</div>
    <div class="box-content" style="border-left: none; flex: 1;">
      ${deducteeData.name}<br>
      ${deducteeData.addressLine1}${
    deducteeData.addressLine2 ? "<br>" + deducteeData.addressLine2 : ""
  }
    </div>
  </div>
</div>

<!-- PAN / TAN Row -->
<table style="margin-top: 0;">
  <tr>
    <th style="width: 33.33%;">PAN of the Deductor</th>
    <th style="width: 33.33%;">TAN of the Deductor</th>
    <th style="width: 33.33%;">PAN of the Deductee</th>
  </tr>
  <tr>
    <td class="c">${header.deductorPAN}</td>
    <td class="c">${header.deductorTAN}</td>
    <td class="c">${deducteeData.pan}</td>
  </tr>
</table>

<!-- CIT / Assessment Year / Period -->
<div class="row" style="margin-top: 0;">
  <div class="col-50" style="display: flex; flex-direction: column; height: 90px;">
    <div class="box-hdr" style="flex: 0 0 auto;">CIT (TDS)</div>
    <div class="box-content" style="flex: 1 1 0; text-align: center; display: flex; align-items: center; justify-content: center;">
      ${header.citName}<br>${header.citAddress1}${
    header.citAddress2 ? "<br>" + header.citAddress2 : ""
  }
    </div>
  </div>
  <div class="col-25" style="display: flex; flex-direction: column; height: 90px;">
    <div class="box-hdr" style="border-left: none; flex: 0 0 auto;">Assessment Year</div>
    <div class="box-content" style="border-left: none; flex: 1 1 0; text-align: center; display: flex; align-items: center; justify-content: center;">
      ${header.assessmentYear}
    </div>
  </div>
  <div class="col-25" style="display: flex; flex-direction: column; height: 90px;">
    <div class="box-hdr" style="border-left: none; flex: 0 0 auto;">Period</div>
    <div class="box-content" style="border-left: none; flex: 1 1 0; padding: 0; display: flex; align-items: center; justify-content: center;">
      <table style="border: none; height: 100%; width: 100%; border-collapse: collapse;">
        <tr>
          <th style="border: none; border-right: 0.01pt solid #000; font-size: 6pt; width: 50%; height: 50%;">From</th>
          <th style="border: none; font-size: 6pt; width: 50%; height: 50%;">To</th>
        </tr>
        <tr>
          <td class="c" style="border: none; border-right: 0.01pt solid #000; height: 50%;">${
            header.periodFrom
          }</td>
          <td class="c" style="border: none; height: 50%;">${header.periodTo}</td>
        </tr>
      </table>
    </div>
  </div>
</div>

<!-- Summary of Payment -->
<div class="section-hdr" style="margin-top: 0;">Summary of payment</div>
<table>
  <thead>
    <tr>
      <th style="width: 40px;">Sl. No.</th>
      <th style="width: 90px;">Amount paid/<br>credited</th>
      <th style="width: 90px;">Nature of<br>Payment**</th>
      <th style="width: 130px;">Deductee Reference No.<br>provided by Deductor<br>(if available)</th>
      <th style="width: 90px;">Date of Payment/<br>credit (dd-mm-yyyy)</th>
    </tr>
  </thead>
  <tbody>
    ${paymentRows}
    <tr>
      <td class="c b">Total (Rs.)</td>
      <td class="r b">${totalPaid}</td>
      <td colspan="3"></td>
    </tr>
  </tbody>
</table>

<!-- Summary of tax deducted at source in respect of Deductee -->
<div class="section-hdr">Summary of tax deducted at source in respect of Deductee</div>
<table>
  <thead>
    <tr>
      <th style="width: 100px;">Quarter</th>
      <th style="width: 150px;">Receipt Numbers of Original<br>Quarterly Statements of TDS<br>Under sub-section (3) of Section 200</th>
      <th style="width: 110px;">Amount of Tax<br>Deducted in respect<br>of Deductee</th>
      <th style="width: 110px;">Amount of Tax<br>Deposited / Remitted<br>in respect of Deductee</th>
    </tr>
  </thead>
  <tbody>
    ${taxRows}
    <tr>
      <td colspan="2" class="c b">Total (Rs.)</td>
      <td class="r b">${deducteeData.totalAmtDeducted}</td>
      <td class="r b">${deducteeData.totalAmtDeposited}</td>
    </tr>
  </tbody>
</table>

<!-- Section I: BIN Details (Book Adjustment) - Only show if there are BIN details -->
${
  true
    ? `
<div class="section-hdr">I. DETAILS OF TAX DEDUCTED AND DEPOSITED IN THE CENTRAL GOVERNMENT ACCOUNT THROUGH BOOK ADJUSTMENT<br>(The deductor to provide payment-wise details of tax deducted and deposited with respect to the deductee)</div>
<table>
  <thead>
    <tr>
      <th rowspan="2" style="width: 50px;">Sl.<br>No.</th>
      <th rowspan="2" style="width: 120px;">Tax deposited in<br>respect of<br>deductee (Rs.)</th>
      <th colspan="4" style="width: 384px;">Book Identification Number (BIN)</th>
    </tr>
    <tr>
      <th style="width: 94px;">Receipt Numbers<br>of Form No. 24G</th>
      <th style="width: 126px;">DDO serial number<br>in Form No. 24G</th>
      <th style="width: 89px;">Date of Transfer<br>voucher<br>(dd/mm/yyyy)</th>
      <th style="width: 75px;">Status of Matching<br>with Form No. 24G</th>
    </tr>
  </thead>
  <tbody>
    ${binRows}
    <tr>
      <td class="c b">Total<br>(Rs.)</td>
      <td class="r b">${binTotal}</td>
      <td colspan="4" class="gray-bg"></td>
    </tr>
  </tbody>
</table>
`
    : ""
}

<!-- Section II: CIN Details - Only show if there are CIN details -->
${
  cinRows && cinRows.trim() !== ""
    ? `
<div class="section-hdr">II. DETAILS OF TAX DEDUCTED AND DEPOSITED IN THE CENTRAL GOVERNMENT ACCOUNT THROUGH CHALLAN</div>
<div class="section-sub">(The deductor to provide payment-wise details of tax deducted and deposited with respect to the deductee)</div>
<table>
  <thead>
    <tr>
      <th rowspan="2" style="width: 40px;">Sl.<br>No.</th>
      <th rowspan="2" style="width: 100px;">Tax deposited in<br>respect of the<br>deductee (Rs.)</th>
      <th colspan="4" style="width: 250px;">Challan Identification Number (CIN)</th>
      </tr>
      <tr>
      <th style="width: 80px;">BSR Code of<br>the Bank Branch</th>
      <th style="width: 85px;">Date on which<br>tax deposited<br>(dd/mm/yyyy)</th>
      <th style="width: 85px;">Challan Serial<br>Number</th>
      <th style="width: 70px;">Status of<br>matching<br>with OLTAS*</th>
    </tr>
  </thead>
  <tbody>
    ${cinRows}
    <tr>
      <td class="c b">Total<br>(Rs.)</td>
      <td class="r b">${cinTotal}</td>
      <td colspan="4" class="gray-bg"></td>
    </tr>
  </tbody>
</table>
`
    : ""
}

<!-- Verification -->
<div class="verify-section">
  <div class="verify-title">Verification</div>
  <div class="verify-box">
I, <b>${footer.authPersonName}</b>, son/daughter of <b>${
    footer.fatherName
  }</b> working in the capacity of <b>${
    footer.designation
  }</b> do hereby certify that a sum of Rs. <b>${deducteeData.totalAmtDeducted}</b> [Rupees <b>${
    deducteeData.wordsTotalAmtDeducted
  }</b>] has been deducted and a sum of Rs. <b>${deducteeData.totalAmtDeposited}</b> [Rupees <b>${
    deducteeData.wordsTotalAmtDeposited
  }</b>] has been deposited to the credit of the Central Government. I further certify that the information given above is true, complete and correct and is based on the books of account, documents, TDS statements, TDS deposited and other available records.
  </div>

  <!-- Signature Section -->
  <table class="sig-table">
    <tr>
      <td style="width: 45%;"><b>Place :</b> ${footer.place}</td>
      <td rowspan="2" style="width: 55%; text-align: center; vertical-align: bottom; padding-bottom: 8px;"><b>(Signature of person responsible for deduction of tax)</b></td>
    </tr>
    <tr>
      <td><b>Date :</b> ${footer.verificationDate}</td>
    </tr>
    <tr>
      <td><b>Designation :</b> ${footer.designation}</td>
      <td><b>Full Name :</b> ${footer.authPersonName}</td>
    </tr>
  </table>
</div>

<!-- Notes -->
<div class="notes">
  <p><b>Notes:</b></p>
  <ol>
    <li>Form 16A contains the latest transaction reported by the deductor in the <b>TDS/TCS Statement</b>. For further details please view your 26AS for same AY on the website <u>https://www.tdscpc.gov.in</u></li>
    <li>To update the PAN details in Income Tax Department database, apply for 'PAN change request' through NSDL or UTITSL</li>
    <li>In items <b>I</b> and <b>II</b>, in column for tax deposited in respect of deductee, furnish total amount of TDS, surcharge (if applicable) and education cess (if applicable).</li>
  </ol>
</div>

<!-- Legend -->
<div class="legend-title">Legend used in Form 16A</div>
<div class="legend-sub">* Status of matching with OLTAS</div>

<table class="legend-table">
  <tr>
    <th style="width: 10%;">Legend</th>
    <th style="width: 15%;">Description</th>
    <th style="width: 75%;">Definition</th>
  </tr>
  <tr>
    <td style="text-align: center;" class="c b">U</td>
    <td>Unmatched</td>
    <td>Deductors have not deposited taxes or have furnished incorrect particulars of tax payment in the TDS/TCS statement.</td>
  </tr>
  <tr>
    <td style="text-align: center;" class="c b">P</td>
    <td>Provisional</td>
    <td>Provisional tax credit is effected only for TDS / TCS Statements filed by Government deductors."P" status will be changed to Final (F) on verification of payment details submitted by Pay and Accounts Officer (PAO)</td>
  </tr>
  <tr>
    <td style="text-align: center;" class="c b">F</td>
    <td>Final</td>
    <td>In case of non-government deductors, payment details of TDS / TCS deposited in bank by deductor have matched with the payment details mentioned in the TDS / TCS statement filed by the deductors. In case of government deductors, details of TDS / TCS booked in Government account have been verified by Pay & Accounts Officer (PAO)</td>
  </tr>
  <tr>
    <td style="text-align: center;" class="c b">O</td>
    <td>Overbooked</td>
    <td>Payment details of TDS / TCS deposited in bank by deductor have matched with details mentioned in the TDS / TCS statement but the amount is over claimed in the statement. Final (F) credit will be reflected only when deductor reduces claimed amount in the statement or makes new payment for excess amount claimed in the statement</td>
  </tr>
</table>

<div class="legend-title" style="margin: 5px 10px;">** Nature of Payment</div>


</div>

<!-- Header is now handled by Puppeteer's headerTemplate, so it appears on all pages starting from page 2 -->

<!-- Section Code and Description Table - Last Page -->
<div style="page-break-before: always;"></div>
<div class="content-wrapper" style="padding-top: 0;">
${sectionCodeTable}
</div>

</body>
</html>`
}
