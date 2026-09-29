export type ExportFormat = "xlsx" | "csv" | "pdf"

export type ExportTable = {
  headers: string[]
  rows: (string | number)[][]
  title: string
  filename: string
}

export const EXPORT_FEATURES = [
  "tldc",
  "ldc-utilisation",
  "outstanding-demand",
  "return-status",
  "rrr",
  "form140",
  "deductee-masters",
] as const

export type ExportFeature = (typeof EXPORT_FEATURES)[number]

export function isExportFeature(value: string): value is ExportFeature {
  return (EXPORT_FEATURES as readonly string[]).includes(value)
}

export function isExportFormat(value: unknown): value is ExportFormat {
  return value === "xlsx" || value === "csv" || value === "pdf"
}

export function todayStamp(): string {
  return new Date().toISOString().split("T")[0]!
}
