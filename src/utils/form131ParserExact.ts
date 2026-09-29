/**
 * Form 131 (New Act) caret-file parser.
 * Format differs from classic Form 16A (FORM131 FH/SP/FT field layout).
 *
 * FH^ver^FORM131^lastUpdated^name^addr1..^state^countryCode^phone^email^PAN^TAN^taxYear^Q^receiptNo^from^to
 * FT^ver^authName^father^designation^place^authPAN
 * SP^PAN^name^addr..^city^paymentCode^amount^date^taxDed^taxDep^rate^^^^^^cinTax^BSR^challan^depDate^status^certNo^
 */

export interface Form131Header {
  formCode: string // FORM130 | FORM131 | FORM133
  formType: string // 130 | 131 | 133
  lastUpdatedOn: string // dd/mmm/yyyy
  employerName: string
  addressLines: string[]
  state: string
  countryCode: string
  contactNumber: string
  email: string
  deductorPAN: string
  deductorTAN: string
  taxYear: string // 2026-27
  quarter: string // Q1
  receiptNumber: string
  periodFrom: string // dd/mmm/yyyy
  periodTo: string // dd/mmm/yyyy
}

export interface Form131Footer {
  authPersonName: string
  fatherName: string
  designation: string
  place: string
  authPersonPAN: string
  verificationDate: string // dd/mmm/yyyy (declaration date)
}

export interface Form131PaymentRow {
  natureOfPaymentCode: string
  amountPaidCredited: string
  paymentDate: string // dd/mmm/yyyy
}

export interface Form131TaxRow {
  quarter: string
  receiptNumber: string
  taxDeducted: string
  taxRate: string
  taxDeposited: string
}

export interface Form131CinRow {
  taxDeposited: string
  bsrCode: string
  depositDate: string
  challanSerialNumber: string
  matchingStatus: string // Final | Unmatched | Overbooked | ...
}

export interface Form131BinRow {
  taxDeposited: string
  receiptNumber: string
  ddoSerialNumber: string
  transferVoucherDate: string
  matchingStatus: string
}

export interface Form131DeducteeData {
  pan: string
  name: string
  addressLines: string[]
  certificateNumber: string
  totalAmtPaid: string
  totalAmtDeducted: string
  totalAmtDeposited: string
  wordsTotalAmtDeducted: string
  paymentSummary: Form131PaymentRow[]
  taxDeductedSummary: Form131TaxRow[]
  binDetails: Form131BinRow[]
  cinDetails: Form131CinRow[]
}

export interface Form131Data {
  header: Form131Header
  footer: Form131Footer
  deducteeData: Form131DeducteeData
}

const MONTHS = [
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

function isValidField(field: string | undefined): boolean {
  return field !== undefined && field !== null && field.trim() !== "" && field.trim() !== "-"
}

/** YYYYMMDD → dd/mmm/yyyy */
function formatYyyymmdd(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr || ""
  const year = dateStr.substring(0, 4)
  const month = parseInt(dateStr.substring(4, 6), 10)
  const day = dateStr.substring(6, 8)
  if (!month || month < 1 || month > 12) return dateStr
  return `${day}/${MONTHS[month - 1]}/${year}`
}

/** DD-MM-YYYY or DD/MM/YYYY → dd/mmm/yyyy */
function formatDmy(dateStr: string): string {
  if (!dateStr) return ""
  const cleaned = dateStr.trim().replace(/\//g, "-")
  const parts = cleaned.split("-")
  if (parts.length !== 3) return dateStr
  // Already dd-mmm-yyyy?
  if (/^[A-Za-z]{3}$/.test(parts[1] || "")) {
    const d = parts[0]!.padStart(2, "0")
    const mon = parts[1]![0]!.toUpperCase() + parts[1]!.slice(1).toLowerCase()
    return `${d}/${mon}/${parts[2]}`
  }
  if (parts[0]!.length === 4) {
    // YYYY-MM-DD
    return formatYyyymmdd(`${parts[0]}${parts[1]}${parts[2]}`)
  }
  const day = parts[0]!.padStart(2, "0")
  const month = parseInt(parts[1] || "0", 10)
  const year = parts[2] || ""
  if (!month || month < 1 || month > 12) return dateStr
  return `${day}/${MONTHS[month - 1]}/${year}`
}

function taxYearFromField(raw: string): string {
  const s = (raw || "").trim()
  if (/^\d{4}-\d{2}$/.test(s)) return s
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10)
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`
  }
  return s
}

function formTypeFromCode(formCode: string): string {
  const m = /FORM\s*(\d{3})/i.exec(formCode || "")
  return m?.[1] || formCode.replace(/^FORM/i, "") || ""
}

function mapTinStatus(code: string): string {
  const c = (code || "").trim().toUpperCase()
  if (c === "F" || c === "FINAL") return "Final"
  if (c === "U" || c === "UNMATCHED") return "Unmatched"
  if (c === "O" || c === "OVERBOOKED") return "Overbooked"
  if (c === "P" || c === "PROVISIONAL") return "Provisional"
  return code || ""
}

function numberToWords(num: number): string {
  if (num === 0) return "Zero only"

  const ones = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ]
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"]

  function convertLessThanThousand(n: number): string {
    if (n === 0) return ""
    if (n < 20) return ones[n] || ""
    if (n < 100)
      return (tens[Math.floor(n / 10)] || "") + (n % 10 !== 0 ? " " + (ones[n % 10] || "") : "")
    return (
      (ones[Math.floor(n / 100)] || "") +
      " Hundred" +
      (n % 100 !== 0 ? " " + convertLessThanThousand(n % 100) : "")
    )
  }

  const wholePart = Math.floor(num)
  const paisePart = Math.round((num - wholePart) * 100)
  let remaining = wholePart
  let result = ""

  if (remaining >= 10000000) {
    result += convertLessThanThousand(Math.floor(remaining / 10000000)) + " Crore "
    remaining %= 10000000
  }
  if (remaining >= 100000) {
    result += convertLessThanThousand(Math.floor(remaining / 100000)) + " Lakh "
    remaining %= 100000
  }
  if (remaining >= 1000) {
    result += convertLessThanThousand(Math.floor(remaining / 1000)) + " Thousand "
    remaining %= 1000
  }
  if (remaining > 0) result += convertLessThanThousand(remaining)

  result = result.trim()
  if (paisePart > 0) {
    result += " and " + convertLessThanThousand(paisePart) + " Paise"
  }
  return (result || "Zero") + " only"
}

function joinAddressParts(parts: string[]): string[] {
  const cleaned = parts.map((p) => p.trim()).filter((p) => p && p !== "-")
  if (cleaned.length === 0) return []
  // Collapse into ~2 display lines like the portal PDF
  if (cleaned.length <= 2) return cleaned
  const mid = Math.ceil(cleaned.length / 2)
  return [cleaned.slice(0, mid).join(", "), cleaned.slice(mid).join(", ")]
}

export function isForm131CaretContent(fileContent: string): boolean {
  const first = fileContent.split(/\r?\n/).find((l) => l.trim().length > 0) || ""
  const fields = first.split("^")
  return fields[0] === "FH" && /^FORM\s*13[013]$/i.test(fields[2] || "")
}

export function isNewActCertificateFormType(formType: string | undefined | null): boolean {
  const t = String(formType || "").trim()
  return t === "130" || t === "131" || t === "133"
}

export function parseForm131File(fileContent: string): Form131Data[] {
  const lines = fileContent.split(/\r?\n/).filter((line) => line.trim().length > 0)

  let header: Form131Header | null = null
  let footer: Form131Footer | null = null
  const deducteeMap = new Map<string, Form131DeducteeData>()

  for (const line of lines) {
    const fields = line.split("^")
    const rec = fields[0]

    if (rec === "FH") {
      const formCode = (fields[2] || "FORM131").toUpperCase().replace(/\s+/g, "")
      const addressParts = [fields[5], fields[6], fields[7], fields[8], fields[9]].filter(
        (f) => isValidField(f)
      ) as string[]
      header = {
        formCode,
        formType: formTypeFromCode(formCode),
        lastUpdatedOn: formatDmy(fields[3] || ""),
        employerName: fields[4] || "",
        addressLines: joinAddressParts(addressParts),
        state: fields[10] || "",
        countryCode: fields[11] || "",
        contactNumber: fields[12] || "",
        email: fields[13] || "",
        deductorPAN: fields[14] || "",
        deductorTAN: fields[15] || "",
        taxYear: taxYearFromField(fields[16] || ""),
        quarter: (fields[17] || "").toUpperCase().startsWith("Q")
          ? (fields[17] || "").toUpperCase()
          : `Q${fields[17] || ""}`,
        receiptNumber: fields[18] || "",
        periodFrom: formatYyyymmdd(fields[19] || ""),
        periodTo: formatYyyymmdd(fields[20] || ""),
      }
    } else if (rec === "FT") {
      footer = {
        authPersonName: fields[2] || "",
        fatherName: fields[3] || "",
        designation: fields[4] || "",
        place: fields[5] || "",
        authPersonPAN: fields[6] || "",
        verificationDate: header?.lastUpdatedOn || formatDmy(new Date().toLocaleDateString("en-GB")),
      }
      // Prefer today's date for declaration Date field when lastUpdated is statement date —
      // reference PDF uses a later signature date. Keep lastUpdated for Certificate header;
      // declaration date uses current date like classic Form 16A.
      const now = new Date()
      const day = String(now.getDate()).padStart(2, "0")
      footer.verificationDate = `${day}/${MONTHS[now.getMonth()]}/${now.getFullYear()}`
    } else if (rec === "SP" && header) {
      const pan = (fields[1] || "").trim()
      if (!pan) continue

      const addrParts = [fields[3], fields[4], fields[5], fields[6], fields[7]].filter((f) =>
        isValidField(f)
      ) as string[]

      const amount = parseFloat(fields[9] || "0") || 0
      const taxDed = parseFloat(fields[11] || "0") || 0
      const taxDepSummary = parseFloat(fields[12] || "0") || 0
      const rate = fields[13] || ""
      const cinTax = parseFloat(fields[19] || "0") || 0
      const bsr = fields[20] || ""
      const challanSerial = fields[21] || ""
      const depositDate = fields[22] || ""
      const status = mapTinStatus(fields[23] || "")
      const certNo = fields[24] || ""

      // BIN present when early BIN slots have values (fields 14-18)
      const hasBin =
        isValidField(fields[14]) ||
        isValidField(fields[15]) ||
        isValidField(fields[16]) ||
        isValidField(fields[17]) ||
        isValidField(fields[18])
      const hasCin = isValidField(bsr) || isValidField(challanSerial) || cinTax > 0

      let deductee = deducteeMap.get(pan)
      if (!deductee) {
        deductee = {
          pan,
          name: fields[2] || "",
          addressLines: joinAddressParts(addrParts),
          certificateNumber: certNo,
          totalAmtPaid: "0.00",
          totalAmtDeducted: "0.00",
          totalAmtDeposited: "0.00",
          wordsTotalAmtDeducted: "Zero only",
          paymentSummary: [],
          taxDeductedSummary: [],
          binDetails: [],
          cinDetails: [],
        }
        deducteeMap.set(pan, deductee)
      }

      if (certNo) deductee.certificateNumber = certNo

      deductee.paymentSummary.push({
        natureOfPaymentCode: fields[8] || "",
        amountPaidCredited: amount.toFixed(2),
        paymentDate: formatDmy(fields[10] || ""),
      })

      if (hasCin) {
        deductee.cinDetails.push({
          taxDeposited: cinTax.toFixed(2),
          bsrCode: bsr || "-",
          depositDate: depositDate ? formatDmy(depositDate) : "-",
          challanSerialNumber: challanSerial || "-",
          matchingStatus: status,
        })
      }

      if (hasBin) {
        deductee.binDetails.push({
          taxDeposited: (parseFloat(fields[14] || "0") || 0).toFixed(2),
          receiptNumber: fields[15] || "",
          ddoSerialNumber: fields[16] || "",
          transferVoucherDate: fields[17] ? formatDmy(fields[17]) : "",
          matchingStatus: mapTinStatus(fields[18] || ""),
        })
      }

      // Accumulate tax summary (one logical row per quarter — update running totals)
      const existingTax = deductee.taxDeductedSummary[0]
      if (!existingTax) {
        deductee.taxDeductedSummary.push({
          quarter: header.quarter,
          receiptNumber: header.receiptNumber,
          taxDeducted: taxDed.toFixed(2),
          taxRate: rate || "0.0000",
          taxDeposited: (taxDepSummary || cinTax || taxDed).toFixed(2),
        })
      } else {
        const newDed = parseFloat(existingTax.taxDeducted) + taxDed
        const newDep =
          parseFloat(existingTax.taxDeposited) + (taxDepSummary || cinTax || taxDed)
        const paidSoFar = parseFloat(deductee.totalAmtPaid) + amount
        const calcRate = paidSoFar > 0 ? ((newDed / paidSoFar) * 100).toFixed(4) : rate
        existingTax.taxDeducted = newDed.toFixed(2)
        existingTax.taxDeposited = newDep.toFixed(2)
        existingTax.taxRate = calcRate
      }

      deductee.totalAmtPaid = (parseFloat(deductee.totalAmtPaid) + amount).toFixed(2)
      deductee.totalAmtDeducted = (
        parseFloat(deductee.totalAmtDeducted) + taxDed
      ).toFixed(2)
      deductee.totalAmtDeposited = (
        parseFloat(deductee.totalAmtDeposited) + (taxDepSummary || cinTax || taxDed)
      ).toFixed(2)
      deductee.wordsTotalAmtDeducted = numberToWords(parseFloat(deductee.totalAmtDeducted))
    }
  }

  if (!header || !footer) {
    throw new Error("Invalid Form 131 file: Missing FH or FT record")
  }

  const result: Form131Data[] = []
  deducteeMap.forEach((deducteeData) => {
    deducteeData.paymentSummary.sort((a, b) =>
      a.paymentDate.localeCompare(b.paymentDate)
    )
    result.push({ header: header!, footer: footer!, deducteeData })
  })

  return result
}
