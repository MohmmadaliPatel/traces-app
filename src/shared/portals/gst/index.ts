/**
 * GST portal public "Search Taxpayer" (https://services.gst.gov.in/services/searchtp).
 *
 * Each lookup needs a captcha read by a person: captcha() sets the session's CaptchaCookie,
 * and the next search() must send that image's text. A wrong captcha comes back as HTTP 200
 * with errorCode SWEB_9000.
 */
import axios, { AxiosInstance } from "axios"
import { wrapper } from "axios-cookiejar-support"
import { CookieJar } from "tough-cookie"

const BASE = "https://services.gst.gov.in/services"
const SEARCH_PAGE = `${BASE}/searchtp`
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"

export const WRONG_CAPTCHA_CODE = "SWEB_9000"

export type TaxpayerDetails = {
  gstin: string
  lgnm: string // legal name
  tradeNam: string
  dty: string // taxpayer type: Regular, Composition, ...
  sts: string // Active, Cancelled, ...
  rgdt: string // registration date, dd/mm/yyyy
  cxdt: string // cancellation date, "" when not cancelled
  ctb: string // constitution of business
  [key: string]: unknown
}

export type TaxpayerSearchResult =
  | { ok: true; data: TaxpayerDetails }
  | { ok: false; wrongCaptcha: boolean; errorCode: string; message: string }

export class GstSearchSession {
  private client: AxiosInstance

  private constructor() {
    this.client = wrapper(
      axios.create({
        jar: new CookieJar(),
        timeout: 30000,
        validateStatus: () => true,
        headers: { "User-Agent": USER_AGENT, "Accept-Language": "en-US,en;q=0.9" },
      })
    )
  }

  /** Loads the search page so the portal sets its session cookies. */
  static async open(): Promise<GstSearchSession> {
    const session = new GstSearchSession()
    const res = await session.client.get(SEARCH_PAGE)
    if (res.status !== 200) throw new Error(`GST search page returned HTTP ${res.status}`)
    return session
  }

  /** Fetches a fresh captcha PNG; it replaces any earlier captcha for this session. */
  async captcha(): Promise<Buffer> {
    const res = await this.client.get(`${BASE}/captcha?rnd=${Math.random()}`, {
      responseType: "arraybuffer",
      headers: { Accept: "image/*", Referer: SEARCH_PAGE },
    })
    const type = String(res.headers["content-type"] || "")
    if (res.status !== 200 || !type.startsWith("image/")) {
      throw new Error(`GST captcha returned HTTP ${res.status} (${type || "no content-type"})`)
    }
    return Buffer.from(res.data)
  }

  async search(gstin: string, captcha: string): Promise<TaxpayerSearchResult> {
    const res = await this.client.post(
      `${BASE}/api/search/taxpayerDetails`,
      { gstin, captcha },
      {
        headers: {
          Accept: "application/json, text/plain, */*",
          "Content-Type": "application/json;charset=UTF-8",
          Origin: "https://services.gst.gov.in",
          Referer: SEARCH_PAGE,
        },
      }
    )
    const body = res.data
    if (res.status !== 200 || !body || typeof body !== "object") {
      throw new Error(
        `GST taxpayerDetails returned HTTP ${res.status}: ${String(
          typeof body === "object" ? JSON.stringify(body) : body
        ).slice(0, 200)}`
      )
    }
    if (body.gstin) return { ok: true, data: body as TaxpayerDetails }
    const errorCode = String(body.errorCode || "UNKNOWN")
    return {
      ok: false,
      wrongCaptcha: errorCode === WRONG_CAPTCHA_CODE,
      errorCode,
      message: String(body.message || ""),
    }
  }
}

const GSTIN_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ"
const STATE_CODES = new Set([
  ...Array.from({ length: 38 }, (_, i) => String(i + 1).padStart(2, "0")),
  "96",
  "97",
  "99",
])
const REGULAR_GSTIN = /^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/

/** Mod-36 check character over the first 14 characters of a GSTIN/UIN. */
export function gstinCheckDigit(gstin: string): string {
  let sum = 0
  for (let i = 0; i < 14; i++) {
    const product = GSTIN_CHARS.indexOf(gstin[i]!) * (i % 2 ? 2 : 1)
    sum += Math.floor(product / 36) + (product % 36)
  }
  return GSTIN_CHARS[(36 - (sum % 36)) % 36]!
}

/**
 * Why a GSTIN can't be real, or null if it passes the offline checks. Only the length,
 * state code and check digit are tested, so TDS/UIN/OIDAR registrations aren't rejected.
 */
export function gstinFormatProblem(gstin: string): string | null {
  if (!/^[0-9A-Z]{15}$/.test(gstin)) return "Not 15 letters/digits"
  if (!STATE_CODES.has(gstin.slice(0, 2))) return `Unknown state code ${gstin.slice(0, 2)}`
  if (gstinCheckDigit(gstin) !== gstin[14]) {
    const fixes = likelyTypoFixes(gstin)
    return (
      "Check digit mismatch" +
      (fixes.length ? ` — possible O/0 or I/1 typo of ${fixes.join(" or ")} (unverified)` : "")
    )
  }
  return null
}

/** Single O<->0 / I<->1 swaps that turn the GSTIN into a well-formed, check-digit-valid one. */
function likelyTypoFixes(gstin: string): string[] {
  const swaps: Record<string, string> = { O: "0", "0": "O", I: "1", "1": "I" }
  const fixes: string[] = []
  for (let i = 0; i < gstin.length; i++) {
    const swap = swaps[gstin[i]!]
    if (!swap) continue
    const candidate = gstin.slice(0, i) + swap + gstin.slice(i + 1)
    if (REGULAR_GSTIN.test(candidate) && gstinCheckDigit(candidate) === candidate[14]) {
      fixes.push(candidate)
    }
  }
  return fixes
}
