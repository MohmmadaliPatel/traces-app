import * as XLSX from "xlsx"
import type { ExportTable } from "./types"

export function toXlsx(table: ExportTable): Buffer {
  const sheetName = (table.title || "Export").slice(0, 31)
  const aoa: (string | number)[][] = [table.headers, ...table.rows]
  const worksheet = XLSX.utils.aoa_to_sheet(aoa)
  const workbook = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(workbook, worksheet, sheetName)
  const out = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer
  return Buffer.isBuffer(out) ? out : Buffer.from(out)
}
