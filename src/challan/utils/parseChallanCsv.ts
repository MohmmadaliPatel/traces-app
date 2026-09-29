import {
  parseIncomeTaxActCsv,
  type IncomeTaxActKind,
} from "src/challan/utils/incomeTaxAct"
import {
  challanModeCsvColumnName,
  parseChallanModeCsv,
  type NewRegimeChallanMode,
} from "src/challan/utils/challanMode"

export type EpayRowDownloadTarget = {
  assessmentYear: string
  amount: number
}

export type EpayCsvDownloadBatchItem = {
  companyId: number
  companyName: string
  tan: string
  incomeTaxAct: IncomeTaxActKind
  rowDownloadTargets: EpayRowDownloadTarget[]
}

export type ParsedChallanCsvSection = {
  sectionCode: string
  amount: string
}

export type ParsedChallanCsvRow = {
  companyCode: string
  companyName: string
  username: string
  password: string
  assessmentYear: string
  act: IncomeTaxActKind
  newRegimeChallanMode: NewRegimeChallanMode
  sections: ParsedChallanCsvSection[]
}

export function challanCsvMetaColumns(): string[] {
  return [
    "Company Code",
    "Company Name",
    "Username",
    "Password",
    "Assessment Year",
    "Act",
    challanModeCsvColumnName(),
  ]
}

export function parseCsvFileText(text: string): Record<string, string>[] {
  const lines = text.split(/\r?\n/).filter((line) => line.trim())
  if (lines.length < 2) {
    throw new Error("CSV file is empty or invalid")
  }

  const headerLine = lines[0]
  if (!headerLine) {
    throw new Error("CSV file has no headers")
  }

  const headers = splitCsvLine(headerLine).map((h) => h.trim())
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line)
    const row: Record<string, string> = {}
    headers.forEach((header, index) => {
      row[header] = (values[index] || "").trim()
    })
    return row
  })
}

/** Split a CSV line respecting double-quoted fields (commas inside quotes). */
export function splitCsvLine(line: string): string[] {
  const result: string[] = []
  let current = ""
  let inQuotes = false

  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!
    if (ch === '"') {
      const next = line[i + 1]
      if (inQuotes && next === '"') {
        current += '"'
        i++
      } else {
        inQuotes = !inQuotes
      }
      continue
    }
    if (ch === "," && !inQuotes) {
      result.push(current)
      current = ""
      continue
    }
    current += ch
  }
  result.push(current)
  return result
}

export function parseChallanCsvRow(row: Record<string, string>): ParsedChallanCsvRow | null {
  const companyName = row["Company Name"]?.trim()
  if (!companyName) return null

  const rowAct = parseIncomeTaxActCsv(row["Act"])
  const newRegimeChallanMode = parseChallanModeCsv(row[challanModeCsvColumnName()])
  const metaColumns = new Set(challanCsvMetaColumns())
  const sections: ParsedChallanCsvSection[] = []

  for (const [header, amount] of Object.entries(row)) {
    if (metaColumns.has(header) || header.trim() === "" || !amount?.trim()) continue
    sections.push({
      sectionCode: header.trim(),
      amount: amount.trim(),
    })
  }

  if (sections.length === 0) return null

  return {
    companyCode: row["Company Code"]?.trim() ?? "",
    companyName,
    username: row["Username"]?.trim() ?? "",
    password: row["Password"]?.trim() ?? "",
    assessmentYear: row["Assessment Year"]?.trim() ?? "",
    act: rowAct,
    newRegimeChallanMode,
    sections,
  }
}

export function buildEpayDownloadTargetsFromRow(
  row: ParsedChallanCsvRow
): EpayRowDownloadTarget[] {
  const { assessmentYear, sections, act, newRegimeChallanMode } = row
  if (!assessmentYear) return []

  const amounts = sections
    .map((s) => parseInt(String(s.amount).replace(/[,₹]/g, ""), 10))
    .filter((n) => !Number.isNaN(n) && n > 0)

  if (amounts.length === 0) return []

  if (act === "new" && newRegimeChallanMode === "combined") {
    return [{ assessmentYear, amount: amounts.reduce((sum, n) => sum + n, 0) }]
  }

  return amounts.map((amount) => ({ assessmentYear, amount }))
}

function dedupeDownloadTargets(targets: EpayRowDownloadTarget[]): EpayRowDownloadTarget[] {
  const seen = new Set<string>()
  const out: EpayRowDownloadTarget[] = []
  for (const target of targets) {
    const key = `${target.assessmentYear}:${target.amount}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(target)
  }
  return out
}

export function buildEpayDownloadBatchItems(
  csvRows: Record<string, string>[],
  companies: Array<{ id: number; name: string; tan: string }>
): EpayCsvDownloadBatchItem[] {
  const map = new Map<string, EpayCsvDownloadBatchItem>()

  for (const raw of csvRows) {
    const row = parseChallanCsvRow(raw)
    if (!row || !row.username) continue

    const company = companies.find(
      (c) => c.tan.trim().toUpperCase() === row.username.trim().toUpperCase()
    )
    if (!company) continue

    const targets = buildEpayDownloadTargetsFromRow(row)
    if (targets.length === 0) continue

    const key = `${company.id}:${row.act}`
    const existing = map.get(key)
    if (existing) {
      existing.rowDownloadTargets.push(...targets)
      existing.rowDownloadTargets = dedupeDownloadTargets(existing.rowDownloadTargets)
    } else {
      map.set(key, {
        companyId: company.id,
        companyName: company.name,
        tan: company.tan,
        incomeTaxAct: row.act,
        rowDownloadTargets: dedupeDownloadTargets(targets),
      })
    }
  }

  return Array.from(map.values())
}
