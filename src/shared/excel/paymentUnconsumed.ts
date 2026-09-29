/**
 * Payment / unconsumed Excel rows: TAN + Date of Deposit (+ optional amount/name).
 * Used by Challan Management "download PDFs from uploaded Excels" and related APIs.
 */

export type PaymentUnconsumedRow = {
  tan: string
  dateOfDeposit: string
  challanAmount?: string | number
  companyName?: string
  sourceFile?: string
}

function pickField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = row[key]
    if (val != null && String(val).trim() !== "") return String(val).trim()
  }
  const lowerMap = new Map(
    Object.keys(row).map((k) => [k.toLowerCase().trim(), row[k]] as const)
  )
  for (const key of keys) {
    const val = lowerMap.get(key.toLowerCase())
    if (val != null && String(val).trim() !== "") return String(val).trim()
  }
  return ""
}

/** Parse a single SheetJS row into a payment/unconsumed identity row (or null if incomplete). */
export function parsePaymentUnconsumedRow(
  row: Record<string, unknown>,
  sourceFile?: string
): PaymentUnconsumedRow | null {
  const tan = pickField(row, ["TAN", "Tan", "tan", "Username", "User ID", "username"]).toUpperCase()
  const dateOfDeposit = pickField(row, [
    "Date of Deposit",
    "Date Of Deposit",
    "Deposit Date",
    "date of deposit",
  ])
  if (!tan || !dateOfDeposit) return null

  const amountRaw = pickField(row, ["Challan Amount", "Amount", "challan amount"])
  const companyName = pickField(row, ["Company Name", "company name", "Name"]) || undefined

  return {
    tan,
    dateOfDeposit,
    challanAmount: amountRaw || undefined,
    companyName,
    sourceFile,
  }
}

/** Parse many sheet rows; skips incomplete rows. */
export function parsePaymentUnconsumedRows(
  rows: Record<string, unknown>[],
  sourceFile?: string
): PaymentUnconsumedRow[] {
  const out: PaymentUnconsumedRow[] = []
  for (const row of rows) {
    const parsed = parsePaymentUnconsumedRow(row, sourceFile)
    if (parsed) out.push(parsed)
  }
  return out
}
