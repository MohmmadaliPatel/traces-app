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

    for (const folder of folders) {
      const normalizedFolder = normalizeCompanyName(folder)
      if (
        normalizedFolder.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedFolder)
      ) {
        return path.join(baseFolder, folder)
      }
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
