/**
 * TRACES date helpers for TLDC rows.
 *
 * TRACES is an IST system. Dates arrive as "17-Sep-2026" (old Act 197 verification
 * table), "17/09/2026", or "2026-09-17T00:00:00.000+05:30" (new Act REST). We store
 * them as the instant of IST midnight and always format back in Asia/Kolkata, so the
 * calendar date never shifts by a day regardless of the server timezone.
 */

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000

const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
}

function istMidnight(year: number, monthIndex: number, day: number): Date | null {
  if (monthIndex < 0 || monthIndex > 11 || day < 1 || day > 31) return null
  const d = new Date(Date.UTC(year, monthIndex, day) - IST_OFFSET_MS)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Parse a TRACES date string into the instant of IST midnight on that calendar date. */
export function parseTracesDate(value?: string | null): Date | null {
  const s = (value || "").trim()
  if (!s || s === "-" || /^n\.?a\.?$/i.test(s)) return null

  // 17-Sep-2026 / 17 Sep 2026
  let m = /^(\d{1,2})[-\s/]([A-Za-z]{3})[A-Za-z]*[-\s/](\d{4})$/.exec(s)
  if (m) {
    const month = MONTHS[m[2]!.toLowerCase()]
    return month == null ? null : istMidnight(+m[3]!, month, +m[1]!)
  }

  // 17/09/2026 or 17-09-2026 (TRACES is always day-first)
  m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
  if (m) return istMidnight(+m[3]!, +m[2]! - 1, +m[1]!)

  // 2026-09-17, optionally with a time/offset: keep the calendar date as written
  m = /^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/.exec(s)
  if (m) return istMidnight(+m[1]!, +m[2]! - 1, +m[3]!)

  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Format a stored instant as DD-MM-YYYY in IST. Returns null for null/invalid input. */
export function formatIstDate(value?: Date | string | null): string | null {
  if (!value) return null
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return null
  const ist = new Date(d.getTime() + IST_OFFSET_MS)
  const dd = String(ist.getUTCDate()).padStart(2, "0")
  const mm = String(ist.getUTCMonth() + 1).padStart(2, "0")
  return `${dd}-${mm}-${ist.getUTCFullYear()}`
}
