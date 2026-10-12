import type { TldcData } from "db"
import { secCodes as oldActSecCodes } from "src/challan/utils/secCodes"
import { secCodes as newActSecCodes } from "src/challan/utils/newSecCodes"
import { formatIstDate } from "./dates"
import { tldcPdfUrl } from "./pdfPath"

/** Income-tax Act 2025 applies from tax year 2026-27; earlier FYs are Income-tax Act 1961. */
export function tldcActForFy(fy: string): "old" | "new" {
  const start = parseInt((fy || "").slice(0, 4), 10)
  return Number.isFinite(start) && start >= 2026 ? "new" : "old"
}

/** Statutory section for a TRACES section code: "1027" → "393(1) [Table: Sl. No. 6(iii)]", "94J" → "194J". */
export function tldcSectionDesc(section: string): string | null {
  const code = (section || "").trim().toUpperCase()
  if (!code) return null
  const all = [...newActSecCodes, ...oldActSecCodes]
  const hit =
    all.find((c) => c.sec_cd.toUpperCase() === code) ||
    all.find((c) => c.sec_desc.toUpperCase() === code)
  return hit ? hit.sec_desc : null
}

function toNumber(value: string | null | undefined): number {
  const n = Number(String(value ?? "").replace(/[,\s₹]/g, ""))
  return Number.isFinite(n) ? n : 0
}

/**
 * Client-facing shape of a stored TLDC certificate. Dates are DD-MM-YYYY (IST),
 * amounts and rate are numbers. This is the contract documented for API consumers;
 * the UI keeps using the raw rows from the getTldcData RPC.
 */
export function serializeTldcRow(row: TldcData) {
  const limit = toNumber(row.tdsAmountLimit)
  const consumed = toNumber(row.tdsAmountConsumed)
  return {
    id: row.id,
    companyId: row.companyId,
    act: tldcActForFy(row.fy),
    fy: row.fy,
    certNumber: row.certNumber,
    din: row.din,
    pan: row.pan,
    panName: row.panName,
    section: row.section,
    sectionDesc: tldcSectionDesc(row.section),
    natureOfPayment: row.NatureOfPayment,
    tdsRate: toNumber(row.tdsRate),
    tdsAmountLimit: limit,
    tdsAmountConsumed: consumed,
    tdsAmountBalance: Math.max(limit - consumed, 0),
    issueDate: formatIstDate(row.issueDate),
    validFrom: formatIstDate(row.validFrom),
    validTo: formatIstDate(row.validTo),
    cancelDate: formatIstDate(row.cancelDate),
    isActive: row.isActive,
    pdfUrl: tldcPdfUrl(row.pdfPath),
    lastSyncedAt: row.updatedAt.toISOString(),
  }
}

export type SerializedTldcRow = ReturnType<typeof serializeTldcRow>
