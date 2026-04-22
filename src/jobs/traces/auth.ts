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
  if (accessToken) {
    return {
      authTokenDto: {
        accessToken,
        ...(refreshToken ? { refreshToken } : {}),
      },
    }
  }
  return d as TracesLoginResponse
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
    throw new Error(`generateCaptcha failed HTTP ${res.status}: ${JSON.stringify(res.data)}`)
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

  const res = fullUrl
    ? await axios.post(fullUrl, payload, { timeout: 120000 })
    : await http.post(path, payload)

  if (res.status >= 400) {
    throw new Error(`loginTraces failed HTTP ${res.status}: ${JSON.stringify(res.data)}`)
  }
  const cookieLines = extractSetCookieLinesFromAxiosResponse(res)
  if (collectSetCookieLines && cookieLines.length > 0) {
    collectSetCookieLines.push(...cookieLines)
    log("loginTraces", "saved Set-Cookie line(s) for Puppeteer", String(cookieLines.length))
  }
  const out = normalizeLoginResponse(res.data)
  const hasAccess = Boolean(out.authTokenDto?.accessToken)
  const hasRefresh = Boolean(out.authTokenDto?.refreshToken)
  log(
    "loginTraces",
    "OK",
    hasAccess
      ? `authTokenDto.accessToken present refreshToken=${hasRefresh ? "present" : "missing"}`
      : "no accessToken in response"
  )
  return out
}
