import type { ExportTable } from "./types"

function escapeCsv(value: string | number): string {
  if (value === null || value === undefined) return ""
  const stringValue = String(value)
  if (
    stringValue.includes(",") ||
    stringValue.includes('"') ||
    stringValue.includes("\n") ||
    stringValue.includes("\r")
  ) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  return stringValue
}

export function toCsv(table: ExportTable): Buffer {
  const lines = [
    table.headers.map(escapeCsv).join(","),
    ...table.rows.map((row) => row.map(escapeCsv).join(",")),
  ]
  // BOM helps Excel open UTF-8 correctly
  return Buffer.from(`\uFEFF${lines.join("\n")}`, "utf-8")
}
