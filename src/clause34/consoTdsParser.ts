/**
 * Parser for TRACES consolidated statement (`.tds`) files — challan (`CD`) records.
 *
 * Format: one record per line, fields separated by a single `^`. Empty fields are real and
 * positional.
 *
 * ## Two corrections against the parser used elsewhere in this repo
 *
 * `NoticeDownloader-conso.ts` (and its three copies) collapse `^^+` into a single `^` before
 * splitting. That destroys empty fields, and because different records carry different numbers
 * of empties, it shifts columns by a *different* amount per record — so some challans parse as
 * garbage (a BSR code lands in the challan-number column). This parser never collapses.
 *
 * It also maps `Interest` to field 12 of the collapsed record, which is not interest at all.
 * The real offsets, verified against 13 challans whose values are independently known:
 *
 * ```
 * [1]  "CD"                     [21] tax (TDS)
 * [3]  challan serial in return [22] surcharge
 * [11] challan number (CSN)     [23] cess
 * [15] BSR code                 [24] interest charged on the challan
 * [17] challan date DDMMYYYY    [25] fee u/s 234E
 *                               [26] total deposited  (= 21+22+23+24+25)
 *                               [33] interest allocated in the TDS return
 * ```
 *
 * The distinction at [24] vs [33] is the one clause 34(c) turns on: [24] is what the challan
 * carries, [33] is what the return actually claimed against it. They differ when a deductor
 * pays interest but does not claim it (or claims interest out of an older challan's balance).
 */
import fs from "fs"

export const CD = {
  RECORD_TYPE: 1,
  SERIAL: 3,
  CHALLAN_NO: 11,
  BSR: 15,
  DATE: 17,
  TAX: 21,
  SURCHARGE: 22,
  CESS: 23,
  INTEREST_ON_CHALLAN: 24,
  FEE: 25,
  TOTAL_DEPOSITED: 26,
  INTEREST_IN_RETURN: 33,
} as const

/**
 * Deductee (`DD`) record offsets on the raw record, verified field-by-field against the
 * prepared working paper. Note `[24]` (date of tax deposit) is present in the file but is
 * mapped by no other parser in this repo.
 */
export const DD = {
  RECORD_TYPE: 1,
  PAN: 9,
  NAME: 12,
  TDS: 13,
  AMOUNT_PAID: 21,
  DATE_PAID: 22,
  DATE_DEDUCTED: 23,
  DATE_DEPOSITED: 24,
  SECTION: 33,
} as const

export type ConsoDeductee = {
  /** Serial of the challan this entry sits under. */
  challanSerial: string
  pan: string
  name: string
  sectionCode: string
  amountPaid: number
  tds: number
  datePaid: Date | null
  dateDeducted: Date | null
  dateDeposited: Date | null
}

export type ConsoChallan = {
  /** Serial number of the challan within the statement. */
  serial: string
  challanNo: string
  bsrCode: string
  challanDate: Date | null
  tax: number
  surcharge: number
  cess: number
  /** Interest charged on the challan itself. */
  interestOnChallan: number
  fee: number
  totalDeposited: number
  /** Interest allocated against this challan in the TDS return — what clause 34(c) reports. */
  interestInReturn: number
}

/** Conso amounts are zero-padded fixed-width decimals, e.g. `000000000234.00`. */
function amount(field: string | undefined): number {
  const raw = String(field ?? "").trim()
  if (!raw) return 0
  const n = Number(raw)
  return Number.isFinite(n) ? n : 0
}

/** Conso dates are `DDMMYYYY`. */
export function parseConsoDate(field: string | undefined): Date | null {
  const raw = String(field ?? "").trim()
  if (!/^\d{8}$/.test(raw)) return null
  const day = Number(raw.slice(0, 2))
  const month = Number(raw.slice(2, 4))
  const year = Number(raw.slice(4, 8))
  if (!day || !month) return null
  return new Date(Date.UTC(year, month - 1, day))
}

/** Every challan record in a conso file, in statement order. */
export function parseConsoChallans(filePath: string): ConsoChallan[] {
  // latin1, not utf8: deductee names carry legacy single-byte characters.
  const text = fs.readFileSync(filePath, "latin1")
  const out: ConsoChallan[] = []

  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const f = line.split("^")
    if (f[CD.RECORD_TYPE] !== "CD") continue

    out.push({
      serial: String(f[CD.SERIAL] ?? "").trim(),
      challanNo: String(f[CD.CHALLAN_NO] ?? "").trim(),
      bsrCode: String(f[CD.BSR] ?? "").trim(),
      challanDate: parseConsoDate(f[CD.DATE]),
      tax: amount(f[CD.TAX]),
      surcharge: amount(f[CD.SURCHARGE]),
      cess: amount(f[CD.CESS]),
      interestOnChallan: amount(f[CD.INTEREST_ON_CHALLAN]),
      fee: amount(f[CD.FEE]),
      totalDeposited: amount(f[CD.TOTAL_DEPOSITED]),
      interestInReturn: amount(f[CD.INTEREST_IN_RETURN]),
    })
  }

  return out
}

/** Every deductee entry in a conso file, each tagged with its parent challan's serial. */
export function parseConsoDeductees(filePath: string): ConsoDeductee[] {
  const text = fs.readFileSync(filePath, "latin1")
  const out: ConsoDeductee[] = []
  let challanSerial = ""

  for (const line of text.split(/\r?\n/)) {
    if (!line) continue
    const f = line.split("^")
    if (f[CD.RECORD_TYPE] === "CD") {
      challanSerial = String(f[CD.SERIAL] ?? "").trim()
      continue
    }
    if (f[DD.RECORD_TYPE] !== "DD") continue

    out.push({
      challanSerial,
      pan: String(f[DD.PAN] ?? "").trim(),
      name: String(f[DD.NAME] ?? "").trim(),
      sectionCode: String(f[DD.SECTION] ?? "").trim(),
      amountPaid: amount(f[DD.AMOUNT_PAID]),
      tds: amount(f[DD.TDS]),
      datePaid: parseConsoDate(f[DD.DATE_PAID]),
      dateDeducted: parseConsoDate(f[DD.DATE_DEDUCTED]),
      dateDeposited: parseConsoDate(f[DD.DATE_DEPOSITED]),
    })
  }

  return out
}

/**
 * Sanity check on a parsed challan: the components must add up to the stated total.
 * A failure means the field offsets are wrong for this file, not that the data is bad.
 */
export function challanTotalsAgree(challan: ConsoChallan): boolean {
  const sum =
    challan.tax + challan.surcharge + challan.cess + challan.interestOnChallan + challan.fee
  return Math.abs(sum - challan.totalDeposited) < 0.01
}

/** Index a directory tree of `.tds` files by bare filename. */
export function indexConsoFiles(root: string): Map<string, string> {
  const found = new Map<string, string>()
  if (!fs.existsSync(root)) return found

  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = `${dir}/${entry.name}`
      if (entry.isDirectory()) walk(full)
      else if (/\.tds$/i.test(entry.name)) found.set(entry.name, full)
    }
  }
  walk(root)
  return found
}
