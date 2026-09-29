/** How new-regime section lines on one CSV row are turned into portal challans. */
export type NewRegimeChallanMode = "combined" | "separate"

const CSV_COLUMN = "Challan Mode"

/** CSV column name for optional per-row combine vs separate challan creation. */
export function challanModeCsvColumnName(): string {
  return CSV_COLUMN
}

/** CSV / UI: empty or `combined` → one challan; `separate` → one challan per section. */
export function parseChallanModeCsv(value: string | undefined): NewRegimeChallanMode {
  const v = (value ?? "").trim().toLowerCase()
  if (v === "separate" || v === "s") return "separate"
  return "combined"
}
