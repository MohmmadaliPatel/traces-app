/**
 * Style tokens and cell helpers for the clause 34 working paper.
 *
 * Every value here was read out of `xl/styles.xml` of the workbook supplied by the client, so a
 * regenerated file is visually indistinguishable from the one the reviewer already knows.
 * SheetJS (used elsewhere in this repo) cannot write cell styles at all, which is why this
 * feature uses ExcelJS.
 */
import type ExcelJS from "exceljs"

export const FONT = "Arial"

/** Values read off a portal or a conso file. */
export const BLUE = "FF0000FF"
/** Due dates looked up from the Due Dates sheet. */
export const GREEN = "FF008000"
/** Legend and explanatory notes. */
export const GREY = "FF595959"
export const WHITE = "FFFFFFFF"
export const HEADER_BG = "FF1F3864"
/** No statement / no value found on the portal. */
export const YELLOW = "FFFFFF00"
/** Needs a human look. */
export const AMBER = "FFFCE4D6"
export const LIGHT_BLUE = "FFD9E1F2"

export const DATE_FMT = "dd-mm-yyyy"
/** Accounting format used throughout 34(c): negatives bracketed, nil shown as a dash. */
export const AMOUNT_FMT = "#,##0;(#,##0);-"
export const PERCENT_FMT = "0.0%"

const THIN = { style: "thin" as const }
export const BORDER = { top: THIN, left: THIN, bottom: THIN, right: THIN }

export type CellOpts = {
  bold?: boolean
  italic?: boolean
  size?: number
  color?: string
  fill?: string
  numFmt?: string
  align?: "center" | "left" | "right"
  wrap?: boolean
  border?: boolean
}

export function style(cell: ExcelJS.Cell, opts: CellOpts = {}): ExcelJS.Cell {
  cell.font = {
    name: FONT,
    size: opts.size ?? 10,
    bold: opts.bold ?? false,
    italic: opts.italic ?? false,
    ...(opts.color ? { color: { argb: opts.color } } : {}),
  }
  if (opts.fill) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: opts.fill } }
  }
  if (opts.numFmt) cell.numFmt = opts.numFmt
  cell.alignment = {
    horizontal: opts.align ?? "center",
    vertical: "top",
    wrapText: opts.wrap ?? true,
  }
  if (opts.border !== false) cell.border = BORDER
  return cell
}

/** Excel serial (1900 system), computed from UTC so it never shifts with the host timezone. */
export function excelSerial(date: Date): number {
  return date.getTime() / 86400000 + 25569
}

/** Date cell value, or null when the date is unknown. */
export function dateValue(date: Date | null | undefined): number | null {
  return date ? excelSerial(date) : null
}

/** wrapText does not auto-fit in ExcelJS, so approximate the height the text needs. */
export function estimateRowHeight(values: string[], widths: number[]): number {
  let lines = 1
  for (let i = 0; i < values.length; i++) {
    const width = widths[i] ?? 10
    const text = values[i] ?? ""
    if (!text) continue
    lines = Math.max(lines, Math.ceil(text.length / Math.max(width - 1, 4)))
  }
  return Math.min(Math.max(lines * 12.5, 15), 130)
}

/** Header cell: bold white on the dark navy band. */
export function header(cell: ExcelJS.Cell, text: string): ExcelJS.Cell {
  return Object.assign(style(cell, { bold: true, color: WHITE, fill: HEADER_BG }), { value: text })
}
