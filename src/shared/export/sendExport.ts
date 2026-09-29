import type { NextApiResponse } from "next"
import type { ExportFormat, ExportTable } from "./types"
import { toCsv } from "./toCsv"
import { toXlsx } from "./toXlsx"
import { toPdf } from "./toPdf"

const CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  pdf: "application/pdf",
}

export async function buildExportBuffer(
  table: ExportTable,
  format: ExportFormat
): Promise<Buffer> {
  if (format === "csv") return toCsv(table)
  if (format === "xlsx") return toXlsx(table)
  return toPdf(table)
}

export async function sendExport(
  res: NextApiResponse,
  table: ExportTable,
  format: ExportFormat
): Promise<void> {
  const buffer = await buildExportBuffer(table, format)
  const filename = `${table.filename}.${format}`
  res.setHeader("Content-Type", CONTENT_TYPES[format])
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`)
  res.setHeader("Content-Length", buffer.length)
  res.status(200).send(buffer)
}
