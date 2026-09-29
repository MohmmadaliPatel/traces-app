import axios, { AxiosInstance } from "axios"
import type { GenerateCaptchaResponse, TracesLoginResponse } from "./types"
import {
  TRACES_PATH_GENERATE_CAPTCHA,
  TRACES_PATH_LOGIN,
  getTracesApiBaseUrl,
} from "./constants"
import { extractSetCookieLinesFromAxiosResponse } from "./preauth"

const FILE = "src/jobs/traces/auth.ts"
function log(fn: string, message: string, detail?: string) {
  const extra = detail ? ` ${detail}` : ""
  console.log(`[TRACES] ${FILE} · ${fn} — ${message}${extra}`)
}

export const TRACES_MAX_LOGIN_ATTEMPTS = 5

/** Tag an error with the HTTP status that produced it, for {@link isTransientTracesFailure}. */
function withHttpStatus(err: Error, status: number): Error {
  ;(err as Error & { status?: number }).status = status
  return err
}
const CAPTCHA_RETRY_ERROR_CODES = new Set(["CPT403", "CPT401", "CPT400"])

export function isRetryableTracesLoginFailure(loginRes: {
  errorCode?: string
  message?: string
}): boolean {
  const code = (loginRes.errorCode ?? "").toUpperCase()
  if (CAPTCHA_RETRY_ERROR_CODES.has(code)) return true
  const msg = (loginRes.message ?? "").toLowerCase()
  return (
    msg.includes("captcha") ||
    msg.includes("verification code") ||
    msg.includes("image data")
  )
}

/** HTTP statuses below 500 that still mean "try again" rather than "credentials rejected". */
const TRANSIENT_HTTP_STATUSES = new Set([408, 425, 429])

/** Socket / DNS level failures that are worth another attempt. */
const TRANSIENT_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNABORTED",
  "ECONNREFUSED",
  "ETIMEDOUT",
  "EAI_AGAIN",
  "ENETUNREACH",
  "ENETRESET",
  "EHOSTUNREACH",
  "EPIPE",
  "ERR_NETWORK",
  "ERR_BAD_RESPONSE",
])

/**
 * True when a thrown captcha / login error is a transport or gateway hiccup rather than a
 * rejection of the request itself. TRACES routinely answers with 504 / 502 under load, and
 * those must not kill the job: the caller retries them with a fresh captcha.
 */
export function isTransientTracesFailure(err: unknown): boolean {
  if (err == null) return false

  const anyErr = err as {
    code?: string
    status?: number
    response?: { status?: number }
    message?: string
  }

  const status = anyErr.status ?? anyErr.response?.status
  if (typeof status === "number" && (status >= 500 || TRANSIENT_HTTP_STATUSES.has(status))) {
    return true
  }

  if (TRANSIENT_ERROR_CODES.has((anyErr.code ?? "").toUpperCase())) {
    return true
  }

  // Status is not always attached (e.g. an HTML gateway page wrapped in a plain Error).
  const msg = String(anyErr.message ?? err).toLowerCase()
  return (
    /\bhttp (?:408|425|429|5\d\d)\b/.test(msg) ||
    /gateway time-?out/.test(msg) ||
    msg.includes("bad gateway") ||
    msg.includes("service unavailable") ||
    msg.includes("socket hang up") ||
    msg.includes("network error") ||
    /timeout of \d+ms exceeded/.test(msg)
  )
}

/** Backoff before the next TRACES attempt: ~2s, 4s, 8s, 16s, capped at 20s, plus jitter. */
export function tracesRetryDelayMs(attempt: number): number {
  const base = Math.min(2000 * 2 ** Math.max(0, attempt - 1), 20000)
  return base + Math.floor(Math.random() * 500)
}

/** Pull CPT403 / captcha-mismatch details out of a thrown Axios or wrapped login error. */
export function tracesLoginFailureFromUnknown(err: unknown): {
  errorCode?: string
  message?: string
} | null {
  if (err == null) return null
  const anyErr = err as {
    message?: string
    response?: { data?: { errorCode?: string; message?: string } }
  }
  const data = anyErr.response?.data
  if (data && typeof data === "object") {
    const failure = {
      errorCode: typeof data.errorCode === "string" ? data.errorCode : undefined,
      message: typeof data.message === "string" ? data.message : undefined,
    }
    if (isRetryableTracesLoginFailure(failure)) return failure
  }
  const msg = String(anyErr.message ?? err)
  if (isRetryableTracesLoginFailure({ message: msg }) || /CPT40[013]/i.test(msg)) {
    return {
      errorCode: data && typeof data.errorCode === "string" ? data.errorCode : "CPT403",
      message: data && typeof data.message === "string" ? data.message : msg,
    }
  }
  return null
}

function normalizeCaptchaResponse(data: unknown): GenerateCaptchaResponse {
  const d = data as Record<string, unknown>
  if (!d || typeof d !== "object") {
    throw new Error("Invalid captcha response body")
  }
  const id = String(d.id ?? d.captchaId ?? d.captcha_id ?? "")
  let image: unknown = d.image ?? d.imageBase64 ?? d.captchaImage ?? d.data
  if (image && typeof image === "object" && "data" in (image as object)) {
    image = (image as { data?: string }).data
  }
  if (typeof image !== "string") {
    throw new Error("Captcha response missing image string")
  }
  const cleaned = image.replace(/^data:image\/\w+;base64,/, "")
  if (!id) {
    throw new Error("Captcha response missing id")
  }
  return { id, image: cleaned }
}

function normalizeLoginResponse(data: unknown): TracesLoginResponse {
  const d = data as Record<string, unknown>
  if (!d || typeof d !== "object") {
    return {}
  }
  const nested = d.authTokenDto as Record<string, unknown> | undefined
  const accessToken =
    (nested?.accessToken as string | undefined) ||
    (d.accessToken as string | undefined) ||
    (d.access_token as string | undefined) ||
    (d.token as string | undefined)
  const refreshToken =
    (nested?.refreshToken as string | undefined) ||
    (nested?.refresh_token as string | undefined) ||
    (d.refreshToken as string | undefined) ||
    (d.refresh_token as string | undefined)
  const errorCode = typeof d.errorCode === "string" ? d.errorCode : undefined
  const message = typeof d.message === "string" ? d.message : undefined
  const isAuthenticated =
    typeof d.isAuthenticated === "boolean" ? d.isAuthenticated : undefined

  if (accessToken) {
    return {
      authTokenDto: {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
      },
      errorCode,
      message,
      isAuthenticated,
    }
  }
  return {
    errorCode,
    message,
    isAuthenticated,
    ...(d as TracesLoginResponse),
  }
}

export type LoginTracesBody = {
  /** Password for the deductor account */
  password: string
  captcha: string
  captchaId: string
  /**
   * TAN from DB — sent as `userId` in the login API payload (required by TRACES).
   * Falls back to `userId` when `tan` is not set.
   */
  tan?: string
  /** Legacy / probe: only used if `tan` is empty */
  userId?: string
  userType?: string
  subUserPanId?: string
}

/**
 * GET captcha — relative to `TRACES_APP_API_ORIGIN`, or set `TRACES_GENERATE_CAPTCHA_URL` (full URL).
 * @param collectSetCookieLines optional sink for raw `Set-Cookie` lines (TRACES JSON API host).
 */
export async function generateCaptcha(
  http: AxiosInstance,
  collectSetCookieLines?: string[]
): Promise<GenerateCaptchaResponse> {
  const fullUrl = process.env.TRACES_GENERATE_CAPTCHA_URL
  const path = TRACES_PATH_GENERATE_CAPTCHA
  const method = (process.env.TRACES_GENERATE_CAPTCHA_METHOD ?? "get").toLowerCase()
  log(
    "generateCaptcha",
    "request captcha image",
    fullUrl ? `custom URL ${method.toUpperCase()}` : `${method.toUpperCase()} ${getTracesApiBaseUrl()}${path}`
  )

  const res = fullUrl
    ? method === "post"
      ? await axios.post(fullUrl, {}, { timeout: 120000 })
      : await axios.get(fullUrl, { timeout: 120000 })
    : method === "post"
      ? await http.post(path, {})
      : await http.get(path)

  if (res.status >= 400) {
    throw withHttpStatus(
      new Error(`generateCaptcha failed HTTP ${res.status}: ${JSON.stringify(res.data)}`),
      res.status
    )
  }
  const cookieLines = extractSetCookieLinesFromAxiosResponse(res)
  if (collectSetCookieLines && cookieLines.length > 0) {
    collectSetCookieLines.push(...cookieLines)
    log("generateCaptcha", "saved Set-Cookie line(s) for Puppeteer", String(cookieLines.length))
  }
  const out = normalizeCaptchaResponse(res.data)
  log("generateCaptcha", "OK", `captchaId=${out.id} image base64 len=${out.image.length}`)
  return out
}

/**
 * POST `.../loginservice/api/auth/login`
 * API expects `userId` = **TAN** (deductor), plus `userType` / `subUserPanId` per portal contract.
 */
export async function loginTraces(
  http: AxiosInstance,
  body: LoginTracesBody,
  collectSetCookieLines?: string[]
): Promise<TracesLoginResponse> {
  const apiUserId = (body.tan ?? body.userId ?? "").trim()
  if (!apiUserId) {
    throw new Error("TRACES login requires `tan` (preferred) or `userId` for the API userId field")
  }

  const fullUrl = process.env.TRACES_LOGIN_URL
  const path = TRACES_PATH_LOGIN
  log(
    "loginTraces",
    "POST login",
    fullUrl || `${getTracesApiBaseUrl()}${path} userId(len)=${apiUserId.length}`
  )
  const payload = {
    userId: apiUserId,
    userType: body.userType ?? "Deductor",
    subUserPanId: body.subUserPanId ?? "",
    password: body.password,
    captcha: body.captcha,
    captchaId: body.captchaId,
  }

  const requestConfig = { timeout: 120000, validateStatus: () => true }
  let res
  try {
    res = fullUrl
      ? await axios.post(fullUrl, payload, requestConfig)
      : await http.post(path, payload, { validateStatus: () => true })
  } catch (err) {
    const failure = tracesLoginFailureFromUnknown(err)
    if (failure) {
      log(
        "loginTraces",
        "login rejected (retryable captcha, thrown)",
        `errorCode=${failure.errorCode ?? "unknown"} message=${failure.message ?? "no message"}`
      )
      return failure
    }
    throw err
  }

  if (res.status >= 400) {
    const rejected = normalizeLoginResponse(res.data)
    if (isRetryableTracesLoginFailure(rejected)) {
      log(
        "loginTraces",
        "login rejected (retryable captcha)",
        `HTTP ${res.status} errorCode=${rejected.errorCode ?? "unknown"} message=${rejected.message ?? "no message"}`
      )
      return rejected
    }
    throw withHttpStatus(
      new Error(`loginTraces failed HTTP ${res.status}: ${JSON.stringify(res.data)}`),
      res.status
    )
  }
  const cookieLines = extractSetCookieLinesFromAxiosResponse(res)
  if (collectSetCookieLines && cookieLines.length > 0) {
    collectSetCookieLines.push(...cookieLines)
    log("loginTraces", "saved Set-Cookie line(s) for Puppeteer", String(cookieLines.length))
  }
  const out = normalizeLoginResponse(res.data)
  const hasAccess = Boolean(out.authTokenDto?.accessToken)
  const hasRefresh = Boolean(out.authTokenDto?.refreshToken)
  if (hasAccess) {
    log(
      "loginTraces",
      "OK",
      `authTokenDto.accessToken present refreshToken=${hasRefresh ? "present" : "missing"}`
    )
  } else {
    log(
      "loginTraces",
      "login rejected",
      `errorCode=${out.errorCode ?? "unknown"} message=${out.message ?? "no message"}`
    )
  }
  return out
}
