/**
 * Old Act / New Act (Income-tax Act 1961 vs 2025) resolution helpers.
 * Canonical home for portal act mapping used by Challan, TLDC, and payment flows.
 */
export type { IncomeTaxActKind } from "src/challan/utils/incomeTaxAct"
export { parseIncomeTaxActCsv } from "src/challan/utils/incomeTaxAct"

export {
  actTypeForFinancialYear,
  incomeTaxActForFinancialYear,
  incomeTaxActForDepositDate,
} from "src/challan/utils/paymentHistoryFiles"

/** Map app act kind to IT e-portal actType code. */
export function actKindToPortalCode(act: "old" | "new" | undefined): "O" | "N" {
  return act === "new" ? "N" : "O"
}

/** Map IT e-portal actType code to app act kind. */
export function portalCodeToActKind(code: "O" | "N" | string | undefined): "old" | "new" {
  return code === "N" || code === "new" ? "new" : "old"
}
