import fs from "fs"
import path from "path"

const CHALLANS_BASE = path.join(process.cwd(), "public", "pdf", "challans")

export function normalizeCompanyName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/private limited/gi, "pvt ltd")
    .replace(/pvt\./gi, "pvt")
    .replace(/ltd\./gi, "ltd")
    .replace(/\s+/g, " ")
    .trim()
}

export function findMatchingCompanyFolder(companyName: string, baseFolder: string): string | null {
  try {
    if (!fs.existsSync(baseFolder)) {
      return null
    }

    const folders = fs
      .readdirSync(baseFolder, { withFileTypes: true })
      .filter((dirent) => dirent.isDirectory())
      .map((dirent) => dirent.name)

    const normalizedTarget = normalizeCompanyName(companyName)

    // An exactly-named folder always wins; otherwise "swiggy" would land in
    // "Swiggy Instamart" and one entity's receipts would be filed under another's TAN.
    const exact = folders.find((folder) => normalizeCompanyName(folder) === normalizedTarget)
    if (exact) {
      return path.join(baseFolder, exact)
    }

    // Fuzzy (substring) match only when it is unambiguous; with several candidates the
    // caller falls back to a folder named exactly after the company.
    const fuzzy = folders.filter((folder) => {
      const normalizedFolder = normalizeCompanyName(folder)
      return (
        normalizedFolder.includes(normalizedTarget) || normalizedTarget.includes(normalizedFolder)
      )
    })
    if (fuzzy.length === 1) {
      return path.join(baseFolder, fuzzy[0]!)
    }
  } catch {
    /* base folder missing or unreadable */
  }

  return null
}

/** Resolved company folder under public/pdf/challans (falls back to exact companyName). */
export function resolveCompanyChallanFolder(companyName: string): string {
  const matched = findMatchingCompanyFolder(companyName, CHALLANS_BASE)
  return matched ?? path.join(CHALLANS_BASE, companyName)
}

export function paymentHistoryDir(companyName: string): string {
  return path.join(resolveCompanyChallanFolder(companyName), "PaymentHistory")
}

export function paymentHistoryPdfPath(companyName: string, cin: string): string {
  return path.join(paymentHistoryDir(companyName), `${cin}_ChallanReceipt.pdf`)
}

export function paymentHistoryPdfExists(companyName: string, cin: string): boolean {
  return fs.existsSync(paymentHistoryPdfPath(companyName, cin))
}

export function paymentHistoryContentJsonPath(companyName: string): string {
  return path.join(resolveCompanyChallanFolder(companyName), "payment_history_content.json")
}

export function paymentHistoryGapsJsonPath(companyName: string): string {
  return path.join(resolveCompanyChallanFolder(companyName), "payment_history_gaps.json")
}

export type PaymentHistoryRowInput = {
  cin: string
  brnNum?: string
  assessmentYear?: string
  paymentType?: string
  minorDesc?: string
  minorHead?: string
  amount?: number
  paymentTime?: string
  crn?: string
  tileId?: string
  actType?: string
}

export type PaymentHistoryRowWithPdf = PaymentHistoryRowInput & {
  pdfExists: boolean
  expectedPdfPath: string
}

export type PaymentHistoryGapsResult = {
  summary: {
    totalPayments: number
    pdfsPresent: number
    pdfsMissing: number
    companyName: string
    paymentHistoryDir: string
  }
  present: PaymentHistoryRowWithPdf[]
  missing: PaymentHistoryRowWithPdf[]
  all: PaymentHistoryRowWithPdf[]
}

const MONTH_INDEX: Record<string, number> = {
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

/** Indian FY label for a calendar date (Apr–Mar), e.g. 2025-26. */
export function dateToIndianFinancialYear(date: Date): string {
  const year = date.getFullYear()
  const month = date.getMonth() // 0-based
  if (month >= 3) {
    const yy = String((year + 1) % 100).padStart(2, "0")
    return `${year}-${yy}`
  }
  const yy = String(year % 100).padStart(2, "0")
  return `${year - 1}-${yy}`
}

/** Last N Indian FYs newest-first, e.g. ["2026-27","2025-26"]. */
export function getLastNIndianFinancialYears(n = 2, asOf: Date = new Date()): string[] {
  const years: string[] = []
  let cursor = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  for (let i = 0; i < n; i++) {
    const fy = dateToIndianFinancialYear(cursor)
    years.push(fy)
    // Step into previous FY (March of the FY start calendar year)
    const startYear = parseInt(fy.slice(0, 4), 10)
    cursor = new Date(startYear, 2, 31) // 31 Mar of start year → prior FY
  }
  return years
}

/**
 * Map portal `paymentTime` (e.g. "07-Jun-2025 16:48:27") to Indian FY.
 * Returns null if unparseable.
 */
export function paymentTimeToFinancialYear(paymentTime: string): string | null {
  const datePart = paymentTime.trim().split(/\s+/)[0] ?? ""
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(datePart)
  if (!match) return null
  const day = parseInt(match[1]!, 10)
  const month = MONTH_INDEX[match[2]!.toLowerCase()]
  const year = parseInt(match[3]!, 10)
  if (month === undefined || Number.isNaN(day) || Number.isNaN(year)) return null
  return dateToIndianFinancialYear(new Date(year, month, day))
}

/** New Act from FY 2026-27 onward; earlier FYs use Old Act. */
export function actTypeForFinancialYear(fy: string): "O" | "N" {
  return fy >= "2026-27" ? "N" : "O"
}

export function incomeTaxActForFinancialYear(fy: string): "old" | "new" {
  return actTypeForFinancialYear(fy) === "N" ? "new" : "old"
}

/**
 * Cutoff for portal Old vs New Act when downloading payment PDFs from Excel deposit dates.
 * On or before 30-Apr-2026 → Old Act; after 30-Apr-2026 → New Act.
 */
export const NEW_ACT_DEPOSIT_CUTOFF = new Date(2026, 3, 30) // 30 Apr 2026 (local)

/** Resolve Old/New Act from a deposit date string (e.g. "05-Apr-2025" or "05-Apr-2025 12:00:00"). */
export function incomeTaxActForDepositDate(depositDate: string): "old" | "new" {
  const dayKey = String(depositDate || "")
    .trim()
    .split(/\s+/)[0]
  const d = dayKey ? parsePortalDayKey(dayKey) : null
  if (!d) return "old"
  return d.getTime() > NEW_ACT_DEPOSIT_CUTOFF.getTime() ? "new" : "old"
}

export function filterPaymentsByFinancialYears<T extends PaymentHistoryRowInput>(
  payments: T[],
  financialYears: string[]
): T[] {
  const allowed = new Set(financialYears)
  return payments.filter((p) => {
    if (!p.paymentTime?.trim()) return false
    const fy = paymentTimeToFinancialYear(p.paymentTime)
    return fy !== null && allowed.has(fy)
  })
}

/** Portal filter dates from API `paymentTime` e.g. "07-Jun-2025 16:48:27". */
export function parsePaymentTimeToPortalRange(paymentTime: string): {
  dayKey: string
  fromDate: string
  toDate: string
} {
  const datePart = paymentTime.trim().split(/\s+/)[0] ?? ""
  if (!datePart) {
    throw new Error(`Invalid paymentTime: ${paymentTime}`)
  }
  return {
    dayKey: datePart,
    fromDate: `${datePart} 00:00:00`,
    toDate: `${datePart} 23:59:59`,
  }
}

const PORTAL_MONTHS = [
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
] as const

/** Parse portal day key `07-Jun-2025` → Date (local). */
export function parsePortalDayKey(dayKey: string): Date | null {
  const match = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(dayKey.trim())
  if (!match) return null
  const day = parseInt(match[1]!, 10)
  const month = MONTH_INDEX[match[2]!.toLowerCase()]
  const year = parseInt(match[3]!, 10)
  if (month === undefined || Number.isNaN(day) || Number.isNaN(year)) return null
  return new Date(year, month, day)
}

export function formatPortalDayKey(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0")
  const month = PORTAL_MONTHS[date.getMonth()]!
  const year = date.getFullYear()
  return `${day}-${month}-${year}`
}

/**
 * From deposit dates (DD-MMM-YYYY), build portal From/To with ±1 day buffer:
 * from = min(dates) − 1 day 00:00:00, to = max(dates) + 1 day 23:59:59.
 */
export function buildDepositDatesFilterRange(
  depositDates: string[]
): { fromDate: string; toDate: string; fromDayKey: string; toDayKey: string } | null {
  let minMs = Infinity
  let maxMs = -Infinity
  let minDay = ""
  let maxDay = ""

  for (const raw of depositDates) {
    const dayKey = String(raw || "")
      .trim()
      .split(/\s+/)[0]
    if (!dayKey) continue
    const d = parsePortalDayKey(dayKey)
    if (!d) continue
    const ms = d.getTime()
    if (ms < minMs) {
      minMs = ms
      minDay = dayKey
    }
    if (ms > maxMs) {
      maxMs = ms
      maxDay = dayKey
    }
  }

  if (!minDay || !maxDay) return null

  const fromDateObj = parsePortalDayKey(minDay)!
  fromDateObj.setDate(fromDateObj.getDate() - 1)
  const toDateObj = parsePortalDayKey(maxDay)!
  toDateObj.setDate(toDateObj.getDate() + 1)

  const fromDayKey = formatPortalDayKey(fromDateObj)
  const toDayKey = formatPortalDayKey(toDateObj)

  return {
    fromDayKey,
    toDayKey,
    fromDate: `${fromDayKey} 00:00:00`,
    toDate: `${toDayKey} 23:59:59`,
  }
}

export type MissingPaymentsDateRange = {
  fromDate: string
  toDate: string
  fromDayKey: string
  toDayKey: string
  cins: string[]
  count: number
}

/**
 * Build one portal From/To range covering all missing payments (earliest → latest day),
 * with a ±1 day buffer (from = min−1, to = max+1) so the portal filter is inclusive.
 */
export function buildMissingPaymentsDateRange(
  missing: PaymentHistoryRowInput[]
): MissingPaymentsDateRange | null {
  const withDates = missing.filter((m) => m.paymentTime?.trim() && m.cin)
  if (withDates.length === 0) return null

  let minMs = Infinity
  let maxMs = -Infinity
  let minDay = ""
  let maxDay = ""

  for (const item of withDates) {
    const { dayKey } = parsePaymentTimeToPortalRange(item.paymentTime!)
    const d = parsePortalDayKey(dayKey)
    if (!d) continue
    const ms = d.getTime()
    if (ms < minMs) {
      minMs = ms
      minDay = dayKey
    }
    if (ms > maxMs) {
      maxMs = ms
      maxDay = dayKey
    }
  }

  if (!minDay || !maxDay) return null

  const fromDateObj = parsePortalDayKey(minDay)!
  fromDateObj.setDate(fromDateObj.getDate() - 1)
  const toDateObj = parsePortalDayKey(maxDay)!
  toDateObj.setDate(toDateObj.getDate() + 1)

  const fromDayKey = formatPortalDayKey(fromDateObj)
  const toDayKey = formatPortalDayKey(toDateObj)

  return {
    fromDayKey,
    toDayKey,
    fromDate: `${fromDayKey} 00:00:00`,
    toDate: `${toDayKey} 23:59:59`,
    cins: withDates.map((m) => m.cin),
    count: withDates.length,
  }
}

export type MissingPaymentDayGroup = {
  dayKey: string
  fromDate: string
  toDate: string
  items: PaymentHistoryRowWithPdf[]
  cins: string[]
  assessmentYear?: string
  paymentType?: string
}

/** Group missing payments by calendar day (payment date filter on portal). */
export function groupMissingByPaymentDay(
  companyName: string,
  missing: PaymentHistoryRowInput[]
): MissingPaymentDayGroup[] {
  const byDay = new Map<string, PaymentHistoryRowInput[]>()

  for (const item of missing) {
    if (!item.paymentTime?.trim()) {
      console.warn(`[groupMissingByPaymentDay] Skipping ${item.cin} — no paymentTime`)
      continue
    }
    const { dayKey } = parsePaymentTimeToPortalRange(item.paymentTime)
    const list = byDay.get(dayKey) ?? []
    list.push(item)
    byDay.set(dayKey, list)
  }

  return Array.from(byDay.entries())
    .sort(([a], [b]) => {
      const ta = new Date(a.replace(/-/g, " ")).getTime()
      const tb = new Date(b.replace(/-/g, " ")).getTime()
      return (Number.isNaN(ta) ? 0 : ta) - (Number.isNaN(tb) ? 0 : tb)
    })
    .map(([dayKey, items]) => {
      const { fromDate, toDate } = parsePaymentTimeToPortalRange(items[0]!.paymentTime!)
      const itemsWithPdf: PaymentHistoryRowWithPdf[] = items.map((p) => ({
        ...p,
        pdfExists: paymentHistoryPdfExists(companyName, p.cin),
        expectedPdfPath: paymentHistoryPdfPath(companyName, p.cin),
      }))
      return {
        dayKey,
        fromDate,
        toDate,
        items: itemsWithPdf,
        cins: items.map((i) => i.cin),
        assessmentYear: items[0]?.assessmentYear,
        paymentType: items[0]?.paymentType,
      }
    })
}

export function loadMissingFromGapsJson(companyName: string): PaymentHistoryRowWithPdf[] {
  const gapsPath = paymentHistoryGapsJsonPath(companyName)
  if (!fs.existsSync(gapsPath)) {
    return []
  }
  const data = JSON.parse(fs.readFileSync(gapsPath, "utf8")) as {
    missing?: PaymentHistoryRowWithPdf[]
  }
  return data.missing ?? []
}

export function analyzePaymentHistoryGaps(
  companyName: string,
  payments: PaymentHistoryRowInput[]
): PaymentHistoryGapsResult {
  const dir = paymentHistoryDir(companyName)
  const all: PaymentHistoryRowWithPdf[] = payments.map((p) => {
    const expectedPdfPath = paymentHistoryPdfPath(companyName, p.cin)
    return {
      ...p,
      pdfExists: fs.existsSync(expectedPdfPath),
      expectedPdfPath,
    }
  })

  const present = all.filter((r) => r.pdfExists)
  const missing = all.filter((r) => !r.pdfExists)

  return {
    summary: {
      totalPayments: all.length,
      pdfsPresent: present.length,
      pdfsMissing: missing.length,
      companyName,
      paymentHistoryDir: dir,
    },
    present,
    missing,
    all,
  }
}
