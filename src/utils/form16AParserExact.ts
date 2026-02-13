/**
 * Form 16A Parser - EXACT MATCH to Java Implementation
 * Based on TRACES-PDF-CONVERTERV2.1L.jar/in/gov/tds/parser/Form16AParser.java
 */

// ============= INTERFACES =============

export interface Form16AHeader {
  employerName: string
  addressPart1: string
  addressPart2: string
  state: string
  pincode: string
  telNumber: string // Format: +(91)XXXXX
  email: string
  deductorPAN: string
  deductorTAN: string
  assessmentYear: string // Format: YYYY-YY (e.g., 2026-27)
  periodicity: string // Q1, Q2, Q3, Q4
  certificateNumber: string
  citName: string
  citAddress1: string
  citAddress2: string
  periodFrom: string // Format: DD-MMM-YYYY
  periodTo: string // Format: DD-MMM-YYYY
  processingDate: string
}

export interface Form16AFooter {
  authPersonName: string
  fatherName: string
  designation: string
  place: string
  verificationDate: string // Format: DD-MMM-YYYY (current date)
}

export interface PaymentSummaryRow {
  amountPaidCredited: string // Decimal with 2 places
  natureOfPayment: string
  paymentDate: string // Format: DD-MM-YYYY
  bookingStatus: string
  referenceNo: string
}

export interface TaxDeductedRow {
  quarter: string
  receiptNumber: string
  taxDeducted: string
  taxDeposited: string
}

export interface CINRow {
  taxDeposited: string
  bsrCode: string
  depositDate: string // Format: DD-MM-YYYY or "-"
  challanSerialNumber: string
  bookingStatus: string
}

export interface BINRow {
  taxDeposited: string
  receiptNumber: string // Receipt Numbers of Form No. 24G
  ddoSequenceNumber: string // DDO serial number in Form No. 24G
  depositDate: string // Date of Transfer voucher (dd/mm/yyyy)
  bookingStatus: string // Status of Matching with Form No. 24G
}

export interface Form16ADeducteeData {
  pan: string
  name: string
  addressLine1: string
  addressLine2: string
  totalAmtDeposited: string
  totalAmtDeducted: string
  wordsTotalAmtDeposited: string
  wordsTotalAmtDeducted: string
  certificateNumber: string
  paymentSummary: PaymentSummaryRow[]
  taxDeductedSummary: TaxDeductedRow[]
  binDetails: BINRow[]
  cinDetails: CINRow[]
}

export interface Form16AData {
  header: Form16AHeader
  footer: Form16AFooter
  deducteeData: Form16ADeducteeData
}

// ============= HELPER FUNCTIONS =============

function isValidField(field: string | undefined): boolean {
  return field !== undefined && field !== null && field.trim() !== "" && field.trim() !== "-"
}

function trimComma(field: string): string {
  if (field.endsWith(",")) {
    return field.substring(0, field.length - 1)
  }
  return field
}

/**
 * Convert YYYYMMDD to DD-MMM-YYYY
 */
function formatPeriodDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return ""
  const year = dateStr.substring(0, 4)
  const month = parseInt(dateStr.substring(4, 6), 10)
  const day = dateStr.substring(6, 8)
  const months = [
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
  return `${day}-${months[month - 1]}-${year}`
}

/**
 * Convert YYYY-MM-DD to DD-MM-YYYY (Java's getPatternDate)
 */
function formatPaymentDate(dateStr: string): string {
  if (!dateStr || !dateStr.includes("-")) return ""
  const parts = dateStr.split("-")
  if (parts.length !== 3) return dateStr
  return `${parts[2]}-${parts[1]}-${parts[0]}`
}

/**
 * Get current date in DD-MMM-YYYY format
 */
function getCurrentDateFormatted(): string {
  const now = new Date()
  const day = String(now.getDate()).padStart(2, "0")
  const months = [
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
  const month = months[now.getMonth()]
  const year = now.getFullYear()
  return `${day}-${month}-${year}`
}

/**
 * Convert number to words (Indian currency format)
 */
function numberToWords(num: number): string {
  if (num === 0) return "Zero Only"

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
  const tens = [
    "",
    "",
    "Twenty",
    "Thirty",
    "Forty",
    "Fifty",
    "Sixty",
    "Seventy",
    "Eighty",
    "Ninety",
  ]

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

  if (wholePart === 0) {
    return paisePart > 0 ? convertLessThanThousand(paisePart) + " Paise Only" : "Zero Only"
  }

  let result = ""
  let remaining = wholePart

  // Crores (10,000,000)
  if (remaining >= 10000000) {
    result += convertLessThanThousand(Math.floor(remaining / 10000000)) + " Crore "
    remaining %= 10000000
  }

  // Lakhs (100,000)
  if (remaining >= 100000) {
    result += convertLessThanThousand(Math.floor(remaining / 100000)) + " Lakh "
    remaining %= 100000
  }

  // Thousands
  if (remaining >= 1000) {
    result += convertLessThanThousand(Math.floor(remaining / 1000)) + " Thousand "
    remaining %= 1000
  }

  // Hundreds, Tens, Ones
  if (remaining > 0) {
    result += convertLessThanThousand(remaining)
  }

  result = result.trim()

  // Add paise
  if (paisePart > 0) {
    result += " and " + convertLessThanThousand(paisePart) + " Paise"
  }

  return result + " Only"
}

// ============= MAIN PARSER =============

export function parseForm16AFile(fileContent: string): Form16AData[] {
  const lines = fileContent.split(/\r?\n/).filter((line) => line.trim().length > 0)

  let header: Form16AHeader | null = null
  let footer: Form16AFooter | null = null
  const deducteeMap = new Map<string, Form16ADeducteeData>()

  // Track if we've processed tax deducted summary for each PAN
  const taxSummaryProcessed = new Map<string, boolean>()

  console.log(`📄 Processing Form 16A file: ${lines.length} lines`)
  for (const line of lines) {
    // console.log(line);
    
    const fields = line.split("^")
    // console.log(fields);
    
    if (fields[0] === "FH") {
      header = parseFHRecord(fields)
      console.log(`✓ Parsed FH record: ${header.employerName}`)
    } else if (fields[0] === "FT") {
      // Pass processingDate from header to footer for verificationDate
      const processingDate = header?.processingDate || ""
      footer = parseFTRecord(fields, processingDate)
      console.log(`✓ Parsed FT record: ${footer.authPersonName}`)
    } else if (fields[0] === "SP" && header) {
      const pan = fields[1] || ""

      // Get payment date formatted
      const paymentDate = isValidField(fields[10]) ? formatPaymentDate(fields[10] || "") : ""
      // Get reference number from field 31 (or 30)
      const referenceNo = fields.length >= 32 && isValidField(fields[31]) ? fields[31] : ""

      
      // Payment Summary row
      const paymentRow: PaymentSummaryRow = {
        amountPaidCredited: parseFloat(fields[8] || "0").toFixed(2),
        natureOfPayment: fields[9] || "",
        paymentDate: paymentDate,
        bookingStatus: fields[11] || "",
        referenceNo: referenceNo || "",
      }
      console.log(paymentRow)
      // CIN row (when field[27] = 'N')
      let cinRow: CINRow | null = null
      
      if (fields[27] === "N") {
        const taxDeposited = parseFloat(fields[22] || "0").toFixed(2)
        const bsrCode = fields[23] || "-"
        const challanSerial = fields[24] || "-"
        const depositDate = isValidField(fields[25]) ? formatPaymentDate(fields[25] || "") : "-"
        const status = fields[26] || ""

        // If tax deposited is 0, show dashes
        if (parseFloat(taxDeposited) === 0) {
          cinRow = {
            taxDeposited: "0.00",
            bsrCode: "-",
            depositDate: "-",
            challanSerialNumber: "-",
            bookingStatus: status,
          }
        } else {
          cinRow = {
            taxDeposited: taxDeposited,
            bsrCode: bsrCode,
            depositDate: depositDate,
            challanSerialNumber: challanSerial,
            bookingStatus: status,
          }
        }
      }

      // BIN row (when field[27] = 'Y')
      let binRow: BINRow | null = null
      if (fields[27] === "Y") {
        const taxDeposited = parseFloat(fields[17] || "0").toFixed(2)
        const receiptNumber = fields[18] || ""
        const ddoSequenceNumber = fields[19] || ""
        const depositDate = isValidField(fields[20]) ? formatPaymentDate(fields[20] || "") : ""
        const bookingStatus = fields[21] || ""

        binRow = {
          taxDeposited: taxDeposited,
          receiptNumber: receiptNumber,
          ddoSequenceNumber: ddoSequenceNumber,
          depositDate: depositDate,
          bookingStatus: bookingStatus,
        }
      }

      // Check if this PAN already exists
      let deductee = deducteeMap.get(pan)

      if (!deductee) {
        // Build deductee address
        let dedAdd1 = ""
        let dedAdd2 = ""
        let isDedComma = false
        let isDedComma2 = false

        if (isValidField(fields[3])) {
          dedAdd1 += fields[3]
          isDedComma = true
        }
        if (isValidField(fields[4])) {
          if (isDedComma) dedAdd1 += ", "
          dedAdd1 += fields[4]
          isDedComma = true
        }
        if (isValidField(fields[5])) {
          if (isDedComma) dedAdd1 += ", "
          dedAdd1 += fields[5]
          isDedComma = true
        }
        if (isValidField(fields[6])) {
          if (isDedComma) dedAdd1 += ", "
          dedAdd2 += fields[6]
          isDedComma2 = true
        }
        if (isValidField(fields[7])) {
          if (isDedComma2) {
            dedAdd2 += ", "
          } else if (isDedComma) {
            dedAdd1 += ", "
          }
          dedAdd2 += fields[7]
        }

        // Get totals from fields 28 and 29
        const totalDeposited = parseFloat(fields[28] || "0").toFixed(2)
        const totalDeducted = parseFloat(fields[29] || "0").toFixed(2)

        deductee = {
          pan: pan,
          name: fields[2] || "",
          addressLine1: dedAdd1,
          addressLine2: dedAdd2,
          totalAmtDeposited: totalDeposited,
          totalAmtDeducted: totalDeducted,
          wordsTotalAmtDeposited: numberToWords(parseFloat(totalDeposited)),
          wordsTotalAmtDeducted: numberToWords(parseFloat(totalDeducted)),
          certificateNumber: fields[30] || "",
          paymentSummary: [],
          taxDeductedSummary: [],
          binDetails: [],
          cinDetails: [],
        }

        // Add Tax Deducted Summary row (ONE per PAN) - uses fields 12, 13, 15
        const taxRow: TaxDeductedRow = {
          quarter: header.periodicity,
          receiptNumber: fields[15] || "",
          taxDeducted: parseFloat(fields[12] || "0").toFixed(2),
          taxDeposited: parseFloat(fields[13] || "0").toFixed(2),
        }
        deductee.taxDeductedSummary.push(taxRow)
        taxSummaryProcessed.set(pan, true)

        deducteeMap.set(pan, deductee)
      }

      // Add payment summary row
      deductee.paymentSummary.push(paymentRow)

      // Add CIN row if exists
      if (cinRow) {
        deductee.cinDetails.push(cinRow)
      }

      // Add BIN row if exists
      if (binRow) {
        deductee.binDetails.push(binRow)
      }
    }
  }

  console.log(`✓ Found ${deducteeMap.size} unique deductees (PANs)`)

  if (!header || !footer) {
    throw new Error("Invalid Form 16A file: Missing FH or FT record")
  }

  // Convert map to array and sort payment summary by date
  const result: Form16AData[] = []
  deducteeMap.forEach((deducteeData) => {
    // Sort payment summary by date
    deducteeData.paymentSummary.sort((a, b) => {
      const dateA = a.paymentDate.split("-").reverse().join("-")
      const dateB = b.paymentDate.split("-").reverse().join("-")
      return dateA.localeCompare(dateB)
    })

    // Sort CIN details by deposit date
    deducteeData.cinDetails.sort((a, b) => {
      if (a.depositDate === "-" || b.depositDate === "-") return 0
      const dateA = a.depositDate.split("-").reverse().join("-")
      const dateB = b.depositDate.split("-").reverse().join("-")
      return dateA.localeCompare(dateB)
    })

    console.log(
      `  PAN: ${deducteeData.pan} - ${deducteeData.paymentSummary.length} payments, Total: ₹${deducteeData.totalAmtDeducted}`
    )

    result.push({
      header: header!,
      footer: footer!,
      deducteeData,
    })
  })

  return result
}

function parseFHRecord(fields: string[]): Form16AHeader {
  // Build employer address parts (fields 4-8)
  let addressPart1 = ""
  let addressPart2 = ""
  let iscommaReq = false
  let iscommaReqAdd2 = false

  if (isValidField(fields[4])) {
    addressPart1 += trimComma(fields[4] || "")
    iscommaReq = true
  }
  if (isValidField(fields[5])) {
    if (iscommaReq) addressPart1 += ", "
    addressPart1 += trimComma(fields[5] || "")
    iscommaReq = true
  }
  if (isValidField(fields[6])) {
    if (iscommaReq) addressPart1 += ", "
    addressPart1 += trimComma(fields[6] || "")
    iscommaReq = true
  }

  // Fields 7 and 8 handling
  if (!isValidField(fields[7]) && !isValidField(fields[8])) {
    if (isValidField(fields[10])) {
      addressPart1 += " - " + fields[10]
    }
  } else {
    if (isValidField(fields[7])) {
      if (iscommaReq) addressPart1 += ", "
      addressPart2 += trimComma(fields[7] || "")
      iscommaReqAdd2 = true
    }
    if (isValidField(fields[8])) {
      if (iscommaReqAdd2) {
        addressPart2 += ", "
      } else if (iscommaReq) {
        addressPart1 += ", "
      }
      addressPart2 += trimComma(fields[8] || "")
      iscommaReqAdd2 = true
    }
    if (isValidField(fields[10])) {
      addressPart2 += " - " + fields[10]
    }
  }

  // Build CIT address
  let citAddress1 = ""
  let citAddress2 = ""
  iscommaReq = false
  iscommaReqAdd2 = false

  if (isValidField(fields[19])) {
    citAddress1 += trimComma(fields[19] || "")
    iscommaReq = true
  }
  if (isValidField(fields[20])) {
    if (iscommaReq) citAddress1 += ", "
    citAddress1 += trimComma(fields[20] || "")
    iscommaReq = true
  }
  if (isValidField(fields[21])) {
    if (iscommaReq) citAddress1 += ", "
    citAddress1 += trimComma(fields[21] || "")
    iscommaReq = true
  }
  if (isValidField(fields[22])) {
    if (iscommaReq) citAddress1 += ", "
    citAddress1 += trimComma(fields[22] || "")
    iscommaReqAdd2 = true
  }
  if (isValidField(fields[23])) {
    if (iscommaReqAdd2) {
      citAddress2 += ", "
    } else if (iscommaReq) {
      citAddress1 += ", "
    }
    citAddress2 += trimComma(fields[23] || "")
    iscommaReqAdd2 = true
  }
  if (isValidField(fields[24])) {
    if (iscommaReqAdd2) citAddress2 += ", "
    citAddress2 += trimComma(fields[24] || "")
    iscommaReqAdd2 = true
  }
  if (isValidField(fields[25])) {
    if (iscommaReqAdd2) citAddress2 += " - "
    citAddress2 += trimComma(fields[25] || "")
  }

  // Format tel number with +(91) prefix
  let telNumber = ""
  if (isValidField(fields[11])) {
    telNumber = "+(91)" + fields[11]
  }

  // Format assessment year (YYYY to YYYY-YY)
  const year = fields[15] || ""
  let assessmentYear = ""
  if (year) {
    const nextYear = (parseInt(year, 10) + 1).toString()
    assessmentYear = `${year}-${nextYear.substring(2)}`
  }

  // Map periodicity
  let periodicity = ""
  switch (fields[16]) {
    case "3":
      periodicity = "Q1"
      break
    case "4":
      periodicity = "Q2"
      break
    case "5":
      periodicity = "Q3"
      break
    case "6":
      periodicity = "Q4"
      break
  }

  return {
    employerName: fields[3] || "",
    addressPart1,
    addressPart2,
    state: fields[9] || "",
    pincode: fields[10] || "",
    telNumber,
    email: fields[12] || "",
    deductorPAN: fields[13] || "",
    deductorTAN: fields[14] || "",
    assessmentYear,
    periodicity,
    certificateNumber: fields[17] || "",
    citName: fields[18] || "",
    citAddress1,
    citAddress2,
    periodFrom: formatPeriodDate(fields[26] || ""),
    periodTo: formatPeriodDate(fields[27] || ""),
    processingDate: fields[28] || "",
  }
}

function parseFTRecord(fields: string[], processingDate?: string): Form16AFooter {
  // Use processingDate from FH record if available, otherwise use current date
  const verificationDate =
    processingDate && processingDate.trim() !== "" ? processingDate : getCurrentDateFormatted()

  return {
    authPersonName: fields[2] || "",
    fatherName: fields[3] || "",
    designation: fields[4] || "",
    place: fields[5] || "",
    verificationDate: verificationDate,
  }
}
