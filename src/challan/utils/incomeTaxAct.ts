/** `old` → Income-tax Act (pre–2025 regime) portal codes; `new` → Income-tax Act, 2025 codes. */
export type IncomeTaxActKind = "old" | "new"

/** CSV / UI: `old`, `o`, or empty → old regime; `new` or `n` → Income-tax Act, 2025. */
export function parseIncomeTaxActCsv(value: string | undefined): IncomeTaxActKind {
  const v = (value ?? "").trim().toLowerCase()
  if (v === "new" || v === "n") return "new"
  return "old"
}
