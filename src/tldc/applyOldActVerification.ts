import db from "db"
import { parseTracesDate } from "./dates"
import type { TldcWarning } from "./errors"

/** One row scraped from the TRACES 197 certificate verification table (see updateTldcData). */
type VerificationRow = {
  certNumber?: string
  pan?: string
  panName?: string
  section?: string
  NatureOfPayment?: string
  tdsAmountLimit?: string
  tdsAmountConsumed?: string
  tdsRate?: string
  validFrom?: string
  validTo?: string
  cancelDate?: string
  issueDate?: string
  error?: string
}

/**
 * Write old-Act 197 verification rows back to TldcData. A certificate with a
 * cancellation date on TRACES is marked inactive. Rows TRACES could not return
 * become LDC_CERT_NOT_FOUND warnings.
 */
export async function applyOldActVerificationRows(
  companyId: number,
  rows: VerificationRow[]
): Promise<TldcWarning[]> {
  const warnings: TldcWarning[] = []

  for (const data of rows) {
    if (data.error) {
      warnings.push({
        certNumber: data.certNumber || "",
        errorCode: "LDC_CERT_NOT_FOUND",
        message: data.error,
      })
      continue
    }
    if (!data.certNumber || !data.pan) continue

    const cancelDate = parseTracesDate(data.cancelDate)
    try {
      await db.tldcData.updateMany({
        where: { companyId, certNumber: data.certNumber, pan: data.pan },
        data: {
          panName: data.panName || undefined,
          section: data.section || undefined,
          NatureOfPayment: data.NatureOfPayment || undefined,
          tdsAmountLimit: data.tdsAmountLimit || undefined,
          tdsAmountConsumed: data.tdsAmountConsumed || undefined,
          tdsRate: data.tdsRate || undefined,
          validFrom: parseTracesDate(data.validFrom) ?? undefined,
          validTo: parseTracesDate(data.validTo) ?? undefined,
          issueDate: parseTracesDate(data.issueDate) ?? undefined,
          cancelDate: cancelDate ?? undefined,
          isActive: !cancelDate,
          updatedAt: new Date(),
        },
      })
      console.log(`✅ Updated TLDC data for certificate: ${data.certNumber}, PAN: ${data.pan}`)
    } catch (updateError) {
      console.error(
        `❌ Error updating TLDC data for certificate: ${data.certNumber}, PAN: ${data.pan}:`,
        updateError
      )
    }
  }

  return warnings
}
