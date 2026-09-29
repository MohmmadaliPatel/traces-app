/**
 * Form 131 PDF generator — layout matched to official New Act certificate
 * (reference: public/131_AAECC1568J_Q1_2026-27.pdf).
 */

import type { Browser, Page } from "puppeteer"
import {
  DSC_SIGBOX_CSS,
  dscSigBoxAnchorHtml,
  extractAndStripSigBoxAnchor,
  storeSignatureBox,
} from "src/form16/utils/dscSignatureBox"
import { PDFDocument, StandardFonts, rgb } from "pdf-lib"
import path from "path"
import fs from "fs"
import { secCodes } from "src/challan/utils/newSecCodes"
import {
  getForm16ABrowser,
  closeForm16ABrowser,
  isExistingForm16APdf,
  defaultForm16AConcurrency,
  type Form16ABatchOptions,
  type Form16ABatchResult,
} from "./form16APdfGeneratorExact"
import type { Form131Data } from "./form131ParserExact"
import { form131NatureLegend } from "./form131NatureLegend"

export { closeForm16ABrowser as closeForm131Browser }

interface PdfGenerationOptions {
  outputPath: string
  data: Form131Data
}

function imageToBase64(imagePath: string): string {
  try {
    const absolutePath = path.isAbsolute(imagePath)
      ? imagePath
      : path.join(process.cwd(), imagePath)
    if (!fs.existsSync(absolutePath)) return ""
    const imageBuffer = fs.readFileSync(absolutePath)
    const base64 = imageBuffer.toString("base64")
    const ext = path.extname(absolutePath).toLowerCase()
    const mimeType =
      ext === ".png" ? "image/png" : ext === ".jpg" || ext === ".jpeg" ? "image/jpeg" : "image/png"
    return `data:${mimeType};base64,${base64}`
  } catch {
    return ""
  }
}

let cachedImages: { watermark: string; tdsLogo: string; emblem: string } | null = null
let cachedTimesFonts: { regular: string; bold: string } | null = null

function getImages() {
  if (cachedImages) return cachedImages
  cachedImages = {
    watermark: imageToBase64(path.join(process.cwd(), "public", "images", "form16", "watermark.png")),
    tdsLogo: imageToBase64(path.join(process.cwd(), "public", "images", "form16", "tdslogo.png")),
    emblem: imageToBase64(
      path.join(process.cwd(), "public", "images", "form16", "emblem-english.jpg")
    ),
  }
  return cachedImages
}

function getTimesFontFaces(): string {
  if (!cachedTimesFonts) {
    const candidates = [
      "/System/Library/Fonts/Supplemental/Times New Roman.ttf",
      "/Library/Fonts/Times New Roman.ttf",
    ]
    const boldCandidates = [
      "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
      "/Library/Fonts/Times New Roman Bold.ttf",
    ]
    const regularPath = candidates.find((p) => fs.existsSync(p))
    const boldPath = boldCandidates.find((p) => fs.existsSync(p))
    cachedTimesFonts = {
      regular: regularPath ? fs.readFileSync(regularPath).toString("base64") : "",
      bold: boldPath ? fs.readFileSync(boldPath).toString("base64") : "",
    }
  }
  const faces: string[] = []
  if (cachedTimesFonts.regular) {
    faces.push(`@font-face{font-family:'Times New Roman';src:url(data:font/ttf;base64,${cachedTimesFonts.regular}) format('truetype');font-weight:400;font-style:normal;}`)
  }
  if (cachedTimesFonts.bold) {
    faces.push(`@font-face{font-family:'Times New Roman';src:url(data:font/ttf;base64,${cachedTimesFonts.bold}) format('truetype');font-weight:700;font-style:normal;}`)
  }
  return faces.join("\n")
}

function formatInr(amount: string | number, withSymbol = true): string {
  const n = typeof amount === "number" ? amount : parseFloat(String(amount).replace(/,/g, "")) || 0
  const indian = n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return withSymbol ? `₹${indian}` : indian
}

function escapeHtml(s: string): string {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
}

function natureDesc(code: string): string {
  const hit = secCodes.find((c) => c.sec_cd === code)
  if (!hit) return code
  return hit.natr_pymnt_desc.replace(/\s*-\s*\d{3}.*$/i, "").trim()
}

function formTitleBlock(formType: string): { title: string; rule: string; desc: string } {
  if (formType === "130") {
    return {
      title: "FORM NO. 130",
      rule: "[See rule 215(1)(Table: Sl. No. 1)]",
      desc: "Certificate under section 395(4) of the Income-tax Act for tax deducted at source on salary paid to an employee under section 392",
    }
  }
  if (formType === "133") {
    return {
      title: "FORM NO. 133",
      rule: "[See rule 215(1)(Table: Sl. No. 4)]",
      desc: "Certificate under section 395(4) of the Income-tax Act for tax collected at source",
    }
  }
  return {
    title: "FORM NO. 131",
    rule: "[See rule 215(1)(Table: Sl. No. 2)]",
    desc: "Certificate under section 395(4) of the Income-tax act deducted at source other than on salary paid to an employee under section 392 or pension or interest income of specified senior citizen under section 393(1)[Table: Sl. No. 8(iii)]",
  }
}

function buildHeaderTemplate(data: Form131Data): string {
  const { header, deducteeData } = data
  const item = (label: string, value: string) =>
    `<span style="white-space:nowrap;"><b>${label}</b> ${escapeHtml(value)}</span>`
  return `<div style="font-size:6.5pt;font-family:'Times New Roman',Times,serif;font-weight:400;width:100%;display:flex;justify-content:space-between;align-items:center;padding:7pt 7.01mm 0 7.01mm;height:22pt;line-height:11pt;box-sizing:border-box;background:#fff;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    ${item("Certificate Number:", deducteeData.certificateNumber)}
    ${item("TAN of Deductor:", header.deductorTAN)}
    ${item("PAN of Deductee:", deducteeData.pan)}
    ${item("Tax Year:", header.taxYear)}
  </div>`
}

function buildFooterTemplate(): string {
  return `<div style="font-size:7pt;font-family:'Times New Roman',Times,serif;font-weight:400;text-align:right;padding:2pt 7.01mm 11pt 0;height:27pt;line-height:12pt;box-sizing:border-box;width:100%;-webkit-print-color-adjust:exact;print-color-adjust:exact;">
    <span>Page </span><span class="pageNumber"></span><span> of </span><span class="totalPages"></span>
  </div>`
}

function legendRowsHtml(fromCode?: string, toCode?: string): string {
  // Exact code order from official Form 131 reference PDF (pages 2–3)
  const preferred = [
    "1004",
    "1005",
    "1006",
    "1008",
    "1009",
    "1011",
    "1012",
    "1013",
    "1014",
    "1015",
    "1016",
    "1017",
    "1018",
    "1019",
    "1020",
    "1021",
    "1022",
    "1023",
    "1024",
    "1026",
    "1027",
    "1028",
    "1029",
    "1030",
    "1031",
    "1033",
    "1034",
    "1035",
    "1037",
    "1038",
    "1058",
    "1059",
    "1060",
    "1061",
    "1062",
    "1063",
    "1064",
    "1065",
    "1066",
    "1067",
    "1039",
    "1040",
    "1041",
    "1042",
    "1043",
    "1044",
    "1045",
    "1046",
    "1047",
    "1048",
    "1049",
    "1050",
    "1051",
    "1052",
    "1053",
    "1054",
    "1055",
    "1056",
    "1057",
  ]
  const byCode = new Map(secCodes.map((c) => [c.sec_cd, c]))
  let codes = preferred
  if (fromCode || toCode) {
    const start = fromCode ? preferred.indexOf(fromCode) : 0
    const end = toCode ? preferred.indexOf(toCode) : preferred.length - 1
    codes = preferred.slice(start < 0 ? 0 : start, end < 0 ? preferred.length : end + 1)
  }
  const rows: string[] = []
  for (const code of codes) {
    const fromPortal = form131NatureLegend[code]
    const hit = byCode.get(code)
    const raw =
      fromPortal ||
      (hit
        ? hit.natr_pymnt_desc.replace(/\s*-\s*[\d(].*$/i, "").trim()
        : natureDesc(code))
    const desc = String(raw).trim()
    rows.push(`<tr><td class="code">${code}</td><td>${escapeHtml(desc || code)}</td></tr>`)
  }
  return rows.join("\n")
}

function natureLegendTableHtml(fromCode: string, toCode: string): string {
  return `<table class="legend legend-nature">
    <thead>
      <tr><th style="width:36pt;">Section Code</th><th>Nature of Payment</th></tr>
    </thead>
    <tbody>
      ${legendRowsHtml(fromCode, toCode)}
    </tbody>
  </table>`
}

export function generateForm131Html(
  data: Form131Data,
  watermarkBase64: string,
  tdsLogoBase64: string,
  emblemBase64: string
): string {
  const { header, footer, deducteeData } = data
  const formType = header.formType || "131"
  const titles = formTitleBlock(formType)

  const deductorAddr = header.addressLines.map(escapeHtml).join("<br>")
  const deducteeAddr = deducteeData.addressLines.map(escapeHtml).join("<br>")

  const paymentRows = deducteeData.paymentSummary
    .map(
      (row, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="c">${escapeHtml(row.natureOfPaymentCode)}</td>
      <td class="r">${formatInr(row.amountPaidCredited)}</td>
      <td class="c">${escapeHtml(row.paymentDate)}</td>
    </tr>`
    )
    .join("\n")

  const taxRows = deducteeData.taxDeductedSummary
    .map(
      (row) => `<tr>
      <td class="c">${escapeHtml(row.quarter)}</td>
      <td class="c">${escapeHtml(row.receiptNumber)}</td>
      <td class="r">${formatInr(row.taxDeducted)}</td>
      <td class="c">${escapeHtml(row.taxRate)}</td>
      <td class="r">${formatInr(row.taxDeposited)}</td>
    </tr>`
    )
    .join("\n")

  const binRows =
    deducteeData.binDetails.length > 0
      ? deducteeData.binDetails
          .map(
            (row, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="r">${formatInr(row.taxDeposited)}</td>
      <td class="c">${escapeHtml(row.receiptNumber)}</td>
      <td class="c">${escapeHtml(row.ddoSerialNumber)}</td>
      <td class="c">${escapeHtml(row.transferVoucherDate)}</td>
      <td class="c">${escapeHtml(row.matchingStatus)}</td>
    </tr>`
          )
          .join("\n")
      : `<tr>
      <td class="c" style="padding:1.5pt 3pt;">-</td>
      <td class="c" style="padding:1.5pt 3pt;">-</td>
      <td class="c" style="padding:1.5pt 3pt;">-</td>
      <td class="c" style="padding:1.5pt 3pt;">-</td>
      <td class="c" style="padding:1.5pt 3pt;">-</td>
      <td class="c" style="padding:1.5pt 3pt;">-</td>
    </tr>`

  const binTotal =
    deducteeData.binDetails.length > 0
      ? formatInr(
          deducteeData.binDetails.reduce((s, r) => s + (parseFloat(r.taxDeposited) || 0), 0)
        )
      : formatInr(0)

  const cinRows =
    deducteeData.cinDetails.length > 0
      ? deducteeData.cinDetails
          .map(
            (row, i) => `<tr>
      <td class="c">${i + 1}</td>
      <td class="r">${formatInr(row.taxDeposited, false)}</td>
      <td class="c">${escapeHtml(row.bsrCode)}</td>
      <td class="c">${escapeHtml(row.depositDate)}</td>
      <td class="c">${escapeHtml(row.challanSerialNumber)}</td>
      <td class="c">${escapeHtml(row.matchingStatus)}</td>
    </tr>`
          )
          .join("\n")
      : ""

  const cinTotal = formatInr(
    deducteeData.cinDetails.reduce((s, r) => s + (parseFloat(r.taxDeposited) || 0), 0)
  )

  const wordsCapitalized =
    deducteeData.wordsTotalAmtDeducted.charAt(0).toUpperCase() +
    deducteeData.wordsTotalAmtDeducted.slice(1)

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8"/>
<style>
${getTimesFontFaces()}
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: 'Times New Roman', Times, serif;
    font-size: 8pt;
    color: #000;
    margin: 0;
    padding: 0;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .watermark-bg {
    position: fixed;
    /* Intrinsic watermark.png = 411×350; REF colored width ≈ 84.73mm */
    top: 50%;
    left: 50%;
    transform: translate(-50%, -50%);
    /* Match REF visible watermark through table cells */
    width: 100mm;
    height: 85.2mm; /* 100 × 350/411 */
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
    opacity: 1;
    object-fit: contain;
    display: block;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  .content-wrapper {
    position: relative;
    z-index: 1;
    background: transparent;
  }
  .content-wrapper.continued { padding-top: 0; }
  .logo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    height: 49.5pt;
    margin-bottom: 3.4pt;
  }
  .logo-header img.tds {
    height: 49.5pt;
    width: auto;
    max-height: 49.5pt;
    flex-shrink: 0;
  }
  .logo-header img.emblem {
    height: 49.5pt;
    width: auto;
    max-height: 49.5pt;
    background: transparent;
    mix-blend-mode: multiply;
    flex-shrink: 0;
  }
  /* REF hairlines rasterize ~1px @ gray≈89. Chrome min border is 1 CSS px
     (~2 device px black). Use mid-gray 1px single-edge lines to match weight. */
  :root { --hair: #000; }
  .title {
    border: 1px solid var(--hair);
    text-align: center;
    font-size: 11pt;
    font-weight: 700;
    padding: 3pt 4pt;
    text-decoration: underline;
    line-height: 1.15;
  }
  .subtitle {
    border: 1px solid var(--hair);
    border-top: none;
    text-align: center;
    font-size: 8pt;
    font-weight: 400;
    padding: 2.5pt 4pt;
    line-height: 1.15;
  }
  .desc {
    border: 1px solid var(--hair);
    border-top: none;
    text-align: center;
    font-size: 7.5pt;
    font-weight: 400;
    padding: 3.5pt 5pt;
    line-height: 1.25;
  }
  table.meta {
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
    font-family: 'Times New Roman', Times, serif;
    border-left: 1px solid var(--hair);
  }
  table.meta td {
    border: none;
    border-right: 1px solid var(--hair);
    border-bottom: 1px solid var(--hair);
    padding: 4pt 8pt;
    font-size: 8pt;
    font-weight: 400;
    vertical-align: middle;
  }
  table.meta td.right { text-align: left; width: 42%; }
  table.part, table.data, table.legend, table.sig {
    width: 100%;
    border-collapse: collapse;
    border-spacing: 0;
    table-layout: fixed;
    font-family: 'Times New Roman', Times, serif;
    border-top: 1px solid var(--hair);
    border-left: 1px solid var(--hair);
  }
  table.part th, table.part td,
  table.data th, table.data td,
  table.legend th, table.legend td,
  table.sig th, table.sig td {
    border: none;
    border-right: 1px solid var(--hair);
    border-bottom: 1px solid var(--hair);
    padding: 2.5pt 4pt;
    vertical-align: top;
    font-size: 8pt;
    line-height: 1.2;
    font-weight: 400;
    background-color: transparent;
  }
  /* REF: header/simple ≈ 18pt; address ≈ 26–30pt; contact ≈ 35pt */
  table.part th, table.part td {
    padding: 5.75pt 5pt;
    background-color: transparent;
    line-height: 1.15;
  }
  table.part th {
    font-weight: 400;
    background-color: transparent;
  }
  table.part .lbl {
    width: 30%;
    font-weight: 400;
    vertical-align: middle;
    padding-top: 5.75pt;
  }
  table.part td.multiline {
    padding-top: 3.75pt;
    padding-bottom: 3.75pt;
    line-height: 1.22;
    vertical-align: middle;
  }
  table.part th.part-hdr {
    text-align: center;
    font-weight: 400;
    font-size: 8pt;
    background-color: transparent;
    vertical-align: middle;
    padding: 5.75pt 4pt;
  }
  table.part th.row-hdr {
    width: 40pt;
    text-align: center;
    font-weight: 400;
    font-size: 7.5pt;
    background-color: transparent;
    vertical-align: middle;
    padding: 5.75pt 2pt;
  }
  table.part .num {
    width: 40pt;
    text-align: center;
    font-weight: 400;
    vertical-align: middle;
  }
  table.part .note {
    font-size: 6pt;
    font-style: italic;
    font-weight: 400;
    color: #000;
  }
  table.part .sub-lbl {
    font-weight: 700;
    font-size: 7pt;
    font-family: 'Times New Roman', Times, serif;
  }
  table.part td.has-sub {
    padding: 0;
    vertical-align: middle;
    text-align: center;
  }
  table.part table.sub-pair {
    width: 100%;
    height: 100%;
    border-collapse: collapse;
    border: none;
    table-layout: fixed;
  }
  table.part table.sub-pair td {
    border: none !important;
    box-shadow: none !important;
    text-align: center;
    vertical-align: middle;
    padding: 2pt 3pt;
    font-family: 'Times New Roman', Times, serif;
    background: transparent;
  }
  table.part table.sub-pair td.sub-lbl {
    font-weight: 700;
    font-size: 7pt;
    padding-bottom: 0;
    height: 45%;
  }
  table.part table.sub-pair td.sub-val {
    font-weight: 400;
    font-size: 8pt;
    padding-top: 1pt;
    height: 55%;
  }
  table.part tr.pa-hdr th {
    height: 18pt;
    padding-top: 4pt;
    padding-bottom: 4pt;
  }
  table.part tr.pa-simple td {
    height: 18pt;
    padding-top: 4pt;
    padding-bottom: 4pt;
  }
  table.part tr.pa-addr td {
    height: 26pt;
    padding-top: 3.5pt;
    padding-bottom: 3.5pt;
  }
  table.part tr.pa-addr td.multiline {
    padding-top: 3.5pt;
    padding-bottom: 3.5pt;
    line-height: 1.2;
  }
  table.part tr.pa-contact td {
    height: 35pt;
    padding-top: 3pt;
    padding-bottom: 3pt;
  }
  table.part tr.pa-quarter td {
    height: 26pt;
    padding-top: 3pt;
    padding-bottom: 3pt;
  }
  .section-hdr {
    border: 1px solid var(--hair);
    border-bottom: none;
    background-color: transparent;
    font-weight: 700;
    font-size: 8pt;
    text-align: center;
    padding: 2.5pt 4pt;
    line-height: 1.2;
    margin-top: 0;
  }
  .section-hdr.left { text-align: left; }
  .section-hdr.mt { margin-top: 0; }
  .section-sub {
    border: 1px solid var(--hair);
    border-top: none;
    border-bottom: none;
    text-align: center;
    font-size: 7pt;
    font-style: italic;
    font-weight: 400;
    padding: 2pt 5pt;
    line-height: 1.25;
  }
  table.data th, table.data td {
    padding: 2pt 3pt;
  }
  table.data td {
    padding: 1.75pt 3pt;
    height: auto;
    line-height: 1.15;
  }
  table.data th {
    background: transparent;
    font-weight: 700;
    text-align: center;
    font-size: 7pt;
    line-height: 1.15;
    vertical-align: middle;
  }
  table.data td { font-size: 7.5pt; vertical-align: middle; }
  table.data tr.total td {
    background: transparent;
    font-weight: 700;
  }
  .c { text-align: center; }
  .r { text-align: right; }
  .b { font-weight: 700; }
  .l { text-align: left; }
  .decl {
    border: 1px solid var(--hair);
    margin-top: 5pt;
    padding: 0;
  }
  .decl-title {
    font-weight: 700;
    text-align: center;
    text-decoration: underline;
    padding: 3pt 4pt;
    font-size: 9pt;
    border-bottom: 1px solid var(--hair);
  }
  .decl-body {
    padding: 4pt 6pt 5pt;
    font-size: 8pt;
    line-height: 1.35;
    text-align: justify;
  }
  table.sig { margin-top: 5pt; width: 100%; }
  table.sig td {
    vertical-align: middle;
    font-size: 8pt;
    padding: 3.5pt 5pt;
    height: auto;
    min-height: 16pt;
    font-weight: 400;
  }
  table.sig td.sig-span {
    text-align: center;
    vertical-align: top;
    padding-top: 3pt;
  }
  table.sig .sig-label { font-weight: 700; }
${DSC_SIGBOX_CSS}
  .notes {
    margin-top: 4pt;
    font-size: 6.25pt;
    line-height: 1.25;
    font-family: 'Times New Roman', Times, serif;
  }
  .notes ol { margin: 1.5pt 0 0 13pt; padding: 0; }
  .notes li { margin-bottom: 1pt; }
  .legend-title {
    font-weight: 700;
    font-size: 8pt;
    margin-top: 4pt;
    margin-bottom: 1.5pt;
    text-decoration: underline;
  }
  .legend-sub {
    font-weight: 700;
    font-size: 7.5pt;
    margin: 2pt 0 1pt;
  }
  /* REF: page margin 7.01mm; nature table 10.46mm → +3.45mm each side.
     Status-matching table is left-inset only (L=10.46mm, R≈7.01mm). */
  table.legend {
    font-size: 6.5pt;
  }
  table.legend.legend-status {
    width: calc(100% - 3.45mm);
    margin-left: 3.45mm;
    margin-right: 0;
  }
  table.legend.legend-nature {
    width: calc(100% - 6.9mm);
    margin-left: 3.45mm;
    margin-right: 3.45mm;
  }
  table.legend th {
    background-color: #c5d9f1 !important;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
    font-weight: 700;
    text-align: center;
    font-size: 7pt;
    padding: 2pt 3pt !important;
    line-height: 1.15;
  }
  table.legend td.code {
    width: 36pt;
    text-align: center;
    font-weight: 700;
    white-space: nowrap;
    vertical-align: top;
    padding: 2.85pt 2pt !important;
  }
  table.legend td {
    padding: 2.85pt 3pt !important;
    line-height: 1.22;
    vertical-align: top;
    font-size: 6.5pt;
    font-weight: 400;
    background: transparent;
  }
  .page-break { page-break-before: always; }
</style>
</head>
<body>
${
  watermarkBase64
    ? `<div class="watermark-bg"><img src="${watermarkBase64}" alt=""/></div>`
    : ""
}
<div class="content-wrapper first-page">
  <div class="logo-header">
    ${tdsLogoBase64 ? `<img class="tds" src="${tdsLogoBase64}" alt=""/>` : "<div></div>"}
    ${emblemBase64 ? `<img class="emblem" src="${emblemBase64}" alt=""/>` : "<div></div>"}
  </div>

  <div class="title">${escapeHtml(titles.title)}</div>
  <div class="subtitle">${escapeHtml(titles.rule)}</div>
  <div class="desc">${escapeHtml(titles.desc)}</div>

  <table class="meta">
    <tr>
      <td>Certificate No.: ${escapeHtml(deducteeData.certificateNumber)}</td>
      <td class="right">Last updated on: ${escapeHtml(header.lastUpdatedOn)}</td>
    </tr>
  </table>

  <table class="part">
    <tr class="pa-hdr">
      <th class="row-hdr">Row No.</th>
      <th class="part-hdr" colspan="4">PART A: Details of the deductor</th>
    </tr>
    <tr class="pa-simple">
      <td class="num">1.</td>
      <td class="lbl">Name<br/><span class="note">(refer Note 1)</span></td>
      <td colspan="3">${escapeHtml(header.employerName)}</td>
    </tr>
    <tr class="pa-addr">
      <td class="num">2.</td>
      <td class="lbl">Address<br/><span class="note">(refer Note 2)</span></td>
      <td class="multiline" colspan="3">${deductorAddr}</td>
    </tr>
    <tr class="pa-simple">
      <td class="num">3.</td>
      <td class="lbl">Permanent Account Number</td>
      <td colspan="3">${escapeHtml(header.deductorPAN)}</td>
    </tr>
    <tr class="pa-simple">
      <td class="num">4.</td>
      <td class="lbl">Tax Deduction and Collection Account Number</td>
      <td colspan="3">${escapeHtml(header.deductorTAN)}</td>
    </tr>
    <tr class="pa-simple">
      <td class="num">5.</td>
      <td class="lbl">Email id</td>
      <td colspan="3">${escapeHtml(header.email)}</td>
    </tr>
    <tr class="pa-contact">
      <td class="num">6.</td>
      <td class="lbl">Contact number</td>
      <td class="has-sub" style="width:22%;">
        <table class="sub-pair"><tr><td class="sub-lbl">Country Code</td></tr><tr><td class="sub-val">${escapeHtml(header.countryCode)}</td></tr></table>
      </td>
      <td class="has-sub" colspan="2">
        <table class="sub-pair"><tr><td class="sub-lbl">Number</td></tr><tr><td class="sub-val">${escapeHtml(header.contactNumber)}</td></tr></table>
      </td>
    </tr>
    <tr class="pa-simple">
      <td class="num">7.</td>
      <td class="lbl">Tax year</td>
      <td colspan="3">${escapeHtml(header.taxYear)}</td>
    </tr>
    <tr class="pa-quarter">
      <td class="num">8.</td>
      <td class="lbl">Quarter of tax year</td>
      <td class="has-sub" style="width:22%;">
        <table class="sub-pair"><tr><td class="sub-lbl">From</td></tr><tr><td class="sub-val">${escapeHtml(header.periodFrom)}</td></tr></table>
      </td>
      <td class="has-sub" colspan="2">
        <table class="sub-pair"><tr><td class="sub-lbl">To</td></tr><tr><td class="sub-val">${escapeHtml(header.periodTo)}</td></tr></table>
      </td>
    </tr>
    <tr class="pa-hdr">
      <th class="part-hdr" colspan="5">Details of the deductee</th>
    </tr>
    <tr class="pa-simple">
      <td class="num">9.</td>
      <td class="lbl">Name<br/><span class="note">(refer Note 1)</span></td>
      <td colspan="3">${escapeHtml(deducteeData.name)}</td>
    </tr>
    <tr class="pa-addr">
      <td class="num">10.</td>
      <td class="lbl">Address<br/><span class="note">(refer Note 2)</span></td>
      <td class="multiline" colspan="3">${deducteeAddr}</td>
    </tr>
    <tr class="pa-simple">
      <td class="num">11.</td>
      <td class="lbl">Permanent Account Number</td>
      <td colspan="3">${escapeHtml(deducteeData.pan)}</td>
    </tr>
  </table>

  <div class="section-hdr left">PART B</div>
  <div class="section-hdr" style="border-top:none;">Summary of payment</div>
  <table class="data">
    <thead>
      <tr>
        <th style="width:36pt;">Sl. No.</th>
        <th style="width:72pt;">Nature of<br/>payment**</th>
        <th>Amount paid/<br/>credited</th>
        <th>Date of payment/<br/>credit<br/>(dd/mmm/yyyy)</th>
      </tr>
    </thead>
    <tbody>
      ${paymentRows}
      <tr class="total">
        <td colspan="2" class="c">Total</td>
        <td class="r">${formatInr(deducteeData.totalAmtPaid)}</td>
        <td></td>
      </tr>
    </tbody>
  </table>

  <div class="section-hdr">Summary of tax deducted at source in respect of deductee</div>
  <table class="data">
    <thead>
      <tr>
        <th style="width:48pt;">Quarter</th>
        <th>Receipt Numbers of Original<br/>Quarterly Statements of TDS<br/>Under section 397(3)(b)</th>
        <th style="width:78pt;">Amount of Tax<br/>Deducted</th>
        <th style="width:78pt;">Rate at which tax is<br/>deducted at source</th>
        <th style="width:90pt;">Amount of Tax Deposited /<br/>adjusted</th>
      </tr>
    </thead>
    <tbody>
      ${taxRows}
      <tr class="total">
        <td colspan="2" class="c">Total</td>
        <td class="r">${formatInr(deducteeData.totalAmtDeducted)}</td>
        <td></td>
        <td class="r">${formatInr(deducteeData.totalAmtDeposited)}</td>
      </tr>
    </tbody>
  </table>

  <div class="section-hdr">I. DETAILS OF TAX DEDUCTED AND DEPOSITED IN THE CENTRAL GOVERNMENT ACCOUNT THROUGH BOOK ADJUSTMENT</div>
  <div class="section-sub">(The deductor to provide payment-wise details of tax deducted and deposited with respect to the deductee)</div>
  <table class="data">
    <thead>
      <tr>
        <th rowspan="2" style="width:32pt;">Sl. No.</th>
        <th rowspan="2" style="width:70pt;">Tax deposited<br/>(refer Note 5)</th>
        <th colspan="4">Book Identification Number (BIN)</th>
      </tr>
      <tr>
        <th>Receipt Numbers of Form No.<br/>137</th>
        <th>DDO serial number in Form<br/>No. 137</th>
        <th>Date of Transfer voucher<br/>(dd/mmm/yyyy)</th>
        <th>Status of Matching with Form<br/>No. 137</th>
      </tr>
    </thead>
    <tbody>
      ${binRows}
      <tr class="total">
        <td class="c">Total</td>
        <td class="r">${binTotal}</td>
        <td colspan="4"></td>
      </tr>
    </tbody>
  </table>
</div>

<div class="page-break"></div>
<div class="content-wrapper continued">
  <div class="section-hdr">II. DETAILS OF TAX DEDUCTED AND DEPOSITED IN THE CENTRAL GOVERNMENT ACCOUNT THROUGH CHALLAN</div>
  <div class="section-sub">(The deductor to provide payment-wise details of tax deducted and deposited with respect to the deductee)</div>
  <table class="data">
    <thead>
      <tr>
        <th rowspan="2" style="width:32pt;">Sl. No.</th>
        <th rowspan="2" style="width:70pt;">Tax deposited<br/>(refer Note 5)</th>
        <th colspan="4">Challan Identification Number (CIN)</th>
      </tr>
      <tr>
        <th>BSR Code of the Bank<br/>Branch</th>
        <th>Date on which tax deposited<br/>(dd/mmm/yyyy)</th>
        <th>Challan Serial Number</th>
        <th>Status of matching with<br/>TIN 2.0</th>
      </tr>
    </thead>
    <tbody>
      ${
        cinRows ||
        `<tr><td class="c">_</td><td class="c">_</td><td class="c">_</td><td class="c">_</td><td class="c">_</td><td class="c">_</td></tr>`
      }
      <tr class="total">
        <td class="c">Total</td>
        <td class="r">${cinTotal}</td>
        <td colspan="4"></td>
      </tr>
    </tbody>
  </table>

  <div class="decl">
    <div class="decl-title">DECLARATION</div>
    <div class="decl-body">
      <p style="margin:0 0 4pt;">
        I, <b>${escapeHtml(footer.authPersonName.toUpperCase())}</b>, (name of person responsible for deduction of tax) having Permanent Account Number <b>${escapeHtml(
          footer.authPersonPAN
        )}</b> working in the capacity as <b>${escapeHtml(
          footer.designation.toUpperCase()
        )}</b> (designation) of <b>${escapeHtml(
          header.employerName.toUpperCase()
        )}</b> (name of the deductor) do hereby certify that a sum of <b>${formatInr(
          deducteeData.totalAmtDeducted
        )}</b> [₹ <b>${escapeHtml(wordsCapitalized)}</b> (in words)] has been deducted and deposited to the credit of the Central Government.
      </p>
      <p style="margin:0 0 3pt;">
        I further certify that the information given above is true, complete and correct and is based on books of account, documents, TDS statements, TDS deposited and other available records.
      </p>
      <table class="sig">
        <tr>
          <td class="sig-label" style="width:18%;">Place</td>
          <td style="width:32%;">${escapeHtml((footer.place || "").toUpperCase())}</td>
          <td class="sig-span sig-label" rowspan="2" colspan="2" style="width:50%;">Signature of person responsible for deduction of tax${dscSigBoxAnchorHtml(26)}</td>
        </tr>
        <tr>
          <td class="sig-label">Date</td>
          <td>${escapeHtml(footer.verificationDate)}</td>
        </tr>
        <tr>
          <td class="sig-label">Designation:</td>
          <td>${escapeHtml(footer.designation.toUpperCase())}</td>
          <td class="sig-label" style="width:12%;">Name:</td>
          <td>${escapeHtml(footer.authPersonName.toUpperCase())}</td>
        </tr>
      </table>
    </div>
  </div>

  <div class="notes">
    <b>Notes:</b>
    <ol>
      <li>In case of individual, the first, middle and last name shall be provided in full without any abbreviations. In any other case also, the name shall be provided in full</li>
      <li>The address shall contain i. Country/Region, ii. Flat/Door/Block number iii. Road/Street/Block/Sector, iv. PIN/ZIP Code, v. Post Office, vi. Area/locality, vii. District, viii. State</li>
      <li>Government deductors to fill information in Part B, item I if tax is paid without production of an income-tax challan and in item II if tax is paid accompanied by an income-tax challan.</li>
      <li>Non-Government deductors to fill information in Part B, item II.</li>
      <li>In Part B, items I and II, in column for tax deposited, sum of tax deducted, surcharge and health &amp; education cess shall be provided.</li>
      <li>Some of the information in the Form would be pre-filled to the extent possible.</li>
      <li>Amounts to be filled in ₹ unless otherwise provided.</li>
    </ol>
  </div>

  <div class="legend-title">Legend used in Form No. ${escapeHtml(formType)}</div>
  <div class="legend-sub">* Status of matching with TIN 2.0</div>
  <table class="legend legend-status" style="margin-bottom:6pt;">
    <thead>
      <tr><th style="width:18%;">Description</th><th>Definition</th></tr>
    </thead>
    <tbody>
      <tr><td><b>Unmatched</b></td><td>Deductors have not deposited taxes or have furnished incorrect particulars of tax payment in the TDS/TCS statement.</td></tr>
      <tr><td><b>Final</b></td><td>In case of non-government deductors, payment details of TDS / TCS deposited in bank by deductor have matched with the payment details mentioned in the TDS / TCS statement filed by the deductors.</td></tr>
      <tr><td><b>Overbooked</b></td><td>Payment details of TDS / TCS deposited in bank by deductor have matched with details mentioned in the TDS / TCS statement but the amount is over claimed.</td></tr>
    </tbody>
  </table>

  <div class="legend-sub">** Nature of Payment</div>
  ${natureLegendTableHtml("1004", "1028")}
</div>
<div class="page-break"></div>
<div class="content-wrapper continued">
  ${natureLegendTableHtml("1029", "1057")}
</div>
</body>
</html>`
}

async function createRenderPage(browser: Browser): Promise<Page> {
  const page = await browser.newPage()
  await page.setViewport({ width: 794, height: 1123 })
  return page
}

async function renderForm131PdfOnPage(page: Page, options: PdfGenerationOptions): Promise<void> {
  const { outputPath, data } = options
  const { watermark, tdsLogo, emblem } = getImages()
  const htmlContent = generateForm131Html(data, watermark, tdsLogo, emblem)

  const dir = path.dirname(outputPath)
  fs.mkdirSync(dir, { recursive: true })

  // Split at the first forced page-break so page-1 never reflows under the
  // repeating header margin (0.55in). Merging "all pages then replace page 1"
  // breaks when page-1 content overflows that taller margin (extra blank/partial page).
  const breakMarker = '<div class="page-break"></div>'
  const breakIdx = htmlContent.indexOf(breakMarker)
  if (breakIdx < 0) {
    throw new Error("Form 131 HTML missing page-break marker between page 1 and continuation")
  }

  const headClose = htmlContent.indexOf("</head>")
  if (headClose < 0) throw new Error("Form 131 HTML missing </head>")
  const head = htmlContent.slice(0, headClose + "</head>".length)

  const bodyStart = htmlContent.indexOf("<body>")
  const bodyInnerStart = bodyStart + "<body>".length
  const beforeBreak = htmlContent.slice(bodyInnerStart, breakIdx)
  const afterBreak = htmlContent.slice(breakIdx + breakMarker.length).replace(/<\/body>\s*<\/html>\s*$/i, "")

  const wmMatch = beforeBreak.match(/<div class="watermark-bg">[\s\S]*?<\/div>/)
  const wmHtml = wmMatch ? wmMatch[0] : ""

  const page1Html = `${head}<body>${beforeBreak}</body></html>`
  const restHtml = `${head}<body>${wmHtml}${afterBreak}</body></html>`

  const tmpRest = outputPath.replace(/\.pdf$/i, `.tmp-rest-${process.pid}.pdf`)
  const tmpP1 = outputPath.replace(/\.pdf$/i, `.tmp-p1-${process.pid}.pdf`)

  // Reserve footer space only; correct "Page N of M" is stamped after merge
  const spacerFooter = `<div style="height:27pt;width:100%;"></div>`
  const pageMargin = { top: "0.30in", bottom: "0.58in", left: "7.01mm", right: "7.01mm" }
  const restMargin = { top: "0.55in", bottom: "0.58in", left: "7.01mm", right: "7.01mm" }

  try {
    await page.setContent(page1Html, { waitUntil: "load", timeout: 30000 })
    await page.pdf({
      path: tmpP1,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: `<div style="height:0;width:100%;overflow:hidden;font-size:0;"></div>`,
      footerTemplate: spacerFooter,
      margin: pageMargin,
      preferCSSPageSize: false,
    })

    await page.setContent(restHtml, { waitUntil: "load", timeout: 30000 })
    await page.pdf({
      path: tmpRest,
      format: "A4",
      printBackground: true,
      displayHeaderFooter: true,
      headerTemplate: buildHeaderTemplate(data),
      footerTemplate: spacerFooter,
      margin: restMargin,
      preferCSSPageSize: false,
    })

    const p1Doc = await PDFDocument.load(fs.readFileSync(tmpP1))
    const restDoc = await PDFDocument.load(fs.readFileSync(tmpRest))
    const merged = await PDFDocument.create()

    const p1Pages = await merged.copyPages(
      p1Doc,
      Array.from({ length: p1Doc.getPageCount() }, (_, i) => i)
    )
    p1Pages.forEach((p) => merged.addPage(p))

    const restPages = await merged.copyPages(
      restDoc,
      Array.from({ length: restDoc.getPageCount() }, (_, i) => i)
    )
    restPages.forEach((p) => merged.addPage(p))

    if (p1Doc.getPageCount() !== 1) {
      console.warn(
        `Form 131 page-1 PDF has ${p1Doc.getPageCount()} pages (expected 1); content may be overflowing`
      )
    }

    const font = await merged.embedFont(StandardFonts.TimesRoman)
    const total = merged.getPageCount()
    const rightMarginPt = (7.01 / 25.4) * 72
    const footerY = 22
    const fontSize = 7
    for (let i = 0; i < total; i++) {
      const pg = merged.getPage(i)
      const { width } = pg.getSize()
      const label = `Page ${i + 1} of ${total}`
      const textWidth = font.widthOfTextAtSize(label, fontSize)
      pg.drawText(label, {
        x: width - rightMarginPt - textWidth,
        y: footerY,
        size: fontSize,
        font,
        color: rgb(0, 0, 0),
      })
    }

    // Record where the DSC stamp belongs, and drop the anchor that marked it.
    const sigBox = extractAndStripSigBoxAnchor(merged)
    if (sigBox) {
      storeSignatureBox(merged, sigBox)
    } else {
      console.warn(`Form 131: signature-box anchor not found in ${path.basename(outputPath)}; the DSC stamp will fall back to its default position`)
    }

    fs.writeFileSync(outputPath, await merged.save())
  } finally {
    for (const p of [tmpRest, tmpP1]) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        /* ignore */
      }
    }
  }
}

export async function generateForm131Pdf(
  options: PdfGenerationOptions,
  opts?: { skipExisting?: boolean }
): Promise<"generated" | "skipped"> {
  const skipExisting = opts?.skipExisting !== false
  if (skipExisting && isExistingForm16APdf(options.outputPath)) return "skipped"

  const browser = await getForm16ABrowser()
  const page = await createRenderPage(browser)
  try {
    await renderForm131PdfOnPage(page, options)
    return "generated"
  } finally {
    await page.close().catch(() => {})
  }
}

export async function generateForm131PdfBatch(
  items: PdfGenerationOptions[],
  options: Form16ABatchOptions = {}
): Promise<Form16ABatchResult> {
  const result: Form16ABatchResult = {
    total: items.length,
    success: 0,
    skipped: 0,
    failed: 0,
    errors: [],
  }
  if (items.length === 0) return result

  const skipExisting = options.skipExisting !== false
  const concurrency = Math.max(1, options.concurrency ?? defaultForm16AConcurrency())
  const recycleEvery = Math.max(1, options.recycleEvery ?? 250)

  const pending: PdfGenerationOptions[] = []
  let done = 0
  for (const item of items) {
    if (skipExisting && isExistingForm16APdf(item.outputPath)) {
      result.skipped++
      done++
      options.onProgress?.(done, items.length, {
        outputPath: item.outputPath,
        ok: true,
        skipped: true,
      })
    } else {
      pending.push(item)
    }
  }
  if (pending.length === 0) return result

  const browser = await getForm16ABrowser()
  let nextIndex = 0

  const worker = async (): Promise<void> => {
    let page = await createRenderPage(browser)
    let rendered = 0
    try {
      while (true) {
        const idx = nextIndex++
        if (idx >= pending.length) break
        const item = pending[idx]!
        try {
          if (rendered > 0 && rendered % recycleEvery === 0) {
            await page.close().catch(() => {})
            page = await createRenderPage(browser)
          }
          await renderForm131PdfOnPage(page, item)
          result.success++
          rendered++
          done++
          options.onProgress?.(done, items.length, {
            outputPath: item.outputPath,
            ok: true,
          })
        } catch (err: any) {
          result.failed++
          result.errors.push({
            outputPath: item.outputPath,
            error: err?.message || String(err),
          })
          done++
          options.onProgress?.(done, items.length, {
            outputPath: item.outputPath,
            ok: false,
          })
        }
      }
    } finally {
      await page.close().catch(() => {})
    }
  }

  const workers = Array.from({ length: Math.min(concurrency, pending.length) }, () => worker())
  await Promise.all(workers)

  if (!options.keepBrowserOpen) {
    await closeForm16ABrowser()
  }
  return result
}

/** CPU default — re-export for call sites that only import Form 131. */
export { defaultForm16AConcurrency as defaultForm131Concurrency }
