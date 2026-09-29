/**
 * TRACES new-portal Justification Report APIs (tanjustreportservice).
 * Pure REST + Bearer — same auth pattern as New Act TLDC / child-cert downloads.
 *
 *   GET  /tanjustreportservice/api/justification/new-requests
 *   GET  /tanjustreportservice/api/justification/downloadFile?requestId=
 *   POST /tanjustreportservice/api/justification/initiateDownload
 */
import fs from "fs"
import path from "path"
import type { AxiosInstance } from "axios"
import { createAuthenticatedTracesClient, createTracesHttp } from "./http"
import {
  generateCaptcha,
  loginTraces,
  isRetryableTracesLoginFailure,
  isTransientTracesFailure,
  tracesLoginFailureFromUnknown,
  tracesRetryDelayMs,
  TRACES_MAX_LOGIN_ATTEMPTS,
} from "./auth"
import { resolveCaptchaFromImageBase64 } from "./captchaDecode"

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

const LIST_PAGE_SIZE_HINT = 50

export type JustificationRequestItem = {
  requestId: string
  financialYear: string
  formType: string
  quarter: string
  requestDate?: string
  status: string
  expiryDate?: string
  remarks?: string
}

export type InitiateJustificationPayload = {
  userId: string
  acknowledgementNumber: string
  formType: string
  assessmentYear: string
  deductorTan: string
  quarter: string
}

export type JustificationDownloadResult = {
  success: boolean
  requestId: string
  financialYear: string
  quarter: string
  formType: string
  filePath?: string
  tanReqNo?: string
  reqDate?: string
  error?: string
}

/** TRACES dropdown mapping used across Form16 / Conso / Justification: Q1→3 … Q4→6 */
export function justificationQuarterApiValue(quarter: string): string {
  const q = (quarter || "").trim().toUpperCase()
  if (q === "Q1" || q === "1") return "3"
  if (q === "Q2" || q === "2") return "4"
  if (q === "Q3" || q === "3") return "5"
  if (q === "Q4" || q === "4") return "6"
  return q
}

/** FY "2026-27" → assessment year "2026" */
export function assessmentYearFromFinancialYear(fy: string): string {
  const s = (fy || "").trim()
  const m = /^(\d{4})/.exec(s)
  return m?.[1] || s
}

export function buildAcknowledgementNumber(
  tan: string,
  formType: string,
  quarter: string
): string {
  const q = (quarter || "").trim().toUpperCase()
  const qLabel = q.startsWith("Q") ? q : `Q${q}`
  return `${tan.trim().toUpperCase()}${String(formType).trim()}${qLabel}`
}

export function buildInitiatePayload(opts: {
  tan: string
  formType: string
  financialYear: string
  quarter: string
}): InitiateJustificationPayload {
  const tan = opts.tan.trim().toUpperCase()
  return {
    userId: tan,
    acknowledgementNumber: buildAcknowledgementNumber(tan, opts.formType, opts.quarter),
    formType: String(opts.formType).trim(),
    assessmentYear: assessmentYearFromFinancialYear(opts.financialYear),
    deductorTan: tan,
    quarter: justificationQuarterApiValue(opts.quarter),
  }
}

export async function loginJustificationAccessToken(
  credentials: {
    tan: string
    userId?: string
    password: string
  },
  log: (msg: string) => void = console.log
): Promise<string> {
  const http = createTracesHttp()
  for (let attempt = 1; attempt <= TRACES_MAX_LOGIN_ATTEMPTS; attempt++) {
    try {
      log(`TRACES login attempt ${attempt}/${TRACES_MAX_LOGIN_ATTEMPTS}…`)
      const captchaMeta = await generateCaptcha(http)
      const captchaText = await resolveCaptchaFromImageBase64(captchaMeta.image)
      const loginRes = await loginTraces(http, {
        tan: credentials.tan,
        userId: credentials.userId || credentials.tan,
        password: credentials.password,
        captcha: captchaText,
        captchaId: captchaMeta.id,
      })
      const accessToken = loginRes.authTokenDto?.accessToken
      if (accessToken?.trim()) {
        if (attempt > 1) log(`TRACES login OK on attempt ${attempt}`)
        return accessToken
      }

      const errorCode = loginRes.errorCode ?? "UNKNOWN"
      const errorMessage = loginRes.message ?? "no accessToken"
      if (attempt >= TRACES_MAX_LOGIN_ATTEMPTS) {
        throw new Error(
          `TRACES login failed after ${TRACES_MAX_LOGIN_ATTEMPTS} attempts: ${errorCode} — ${errorMessage}`
        )
      }
      if (!isRetryableTracesLoginFailure(loginRes)) {
        throw new Error(`TRACES login failed (non-retryable): ${errorCode} — ${errorMessage}`)
      }
      log(
        `TRACES login captcha mismatch (${errorCode}): ${errorMessage} — retrying (${attempt}/${TRACES_MAX_LOGIN_ATTEMPTS})…`
      )
      await delay(800)
    } catch (err) {
      if (attempt >= TRACES_MAX_LOGIN_ATTEMPTS) {
        throw err
      }
      // Gateway / socket hiccups (TRACES 502s and 504s) get a backed-off retry.
      if (isTransientTracesFailure(err)) {
        const waitMs = tracesRetryDelayMs(attempt)
        log(
          `TRACES login transient error (${(err as Error).message}) — retrying in ${Math.round(
            waitMs / 1000
          )}s (${attempt}/${TRACES_MAX_LOGIN_ATTEMPTS})…`
        )
        await delay(waitMs)
        continue
      }
      const failure = tracesLoginFailureFromUnknown(err)
      if (!failure) throw err
      log(
        `TRACES login captcha mismatch (${failure.errorCode ?? "CPT403"}): ${failure.message} — retrying (${attempt}/${TRACES_MAX_LOGIN_ATTEMPTS})…`
      )
      await delay(800)
    }
  }
  throw new Error("TRACES login did not return accessToken")
}

function authClient(accessToken: string): AxiosInstance {
  return createAuthenticatedTracesClient(accessToken)
}

function normalizeRequestItem(raw: any): JustificationRequestItem | null {
  if (!raw || typeof raw !== "object") return null
  const requestId = String(raw.requestId ?? raw.reqId ?? raw.requestNo ?? "").trim()
  if (!requestId) return null
  return {
    requestId,
    financialYear: String(raw.financialYear ?? raw.finYr ?? "").trim(),
    formType: String(raw.formType ?? raw.frmType ?? "").trim(),
    quarter: String(raw.quarter ?? raw.qrtr ?? "").trim(),
    requestDate: raw.requestDate != null ? String(raw.requestDate) : undefined,
    status: String(raw.status ?? "").trim(),
    expiryDate: raw.expiryDate != null ? String(raw.expiryDate) : undefined,
    remarks: raw.remarks != null ? String(raw.remarks) : undefined,
  }
}

export function isGeneratedStatus(item: JustificationRequestItem): boolean {
  const status = (item.status || "").toLowerCase()
  const remarks = (item.remarks || "").toLowerCase()
  return (
    status === "generated" ||
    status === "available" ||
    remarks.includes("ready for download")
  )
}

export function matchesPeriod(
  item: JustificationRequestItem,
  financialYear?: string,
  quarter?: string,
  formType?: string
): boolean {
  if (financialYear && item.financialYear && item.financialYear !== financialYear) return false
  if (quarter) {
    const want = quarter.trim().toUpperCase()
    const got = (item.quarter || "").trim().toUpperCase()
    if (got && got !== want && got !== want.replace(/^Q/, "") && `Q${got}` !== want) return false
  }
  if (formType) {
    const want = formType.trim().toUpperCase()
    const got = (item.formType || "").trim().toUpperCase()
    if (got && got !== want) return false
  }
  return true
}

/** Paginate GET new-requests until last page. */
export async function fetchJustificationNewRequests(
  accessToken: string,
  tan: string,
  log: (msg: string) => void = console.log
): Promise<JustificationRequestItem[]> {
  const client = authClient(accessToken)
  const all: JustificationRequestItem[] = []
  let page = 0
  let totalPages = 1

  while (page < totalPages && page < 100) {
    const res = await client.get("/tanjustreportservice/api/justification/new-requests", {
      params: { userId: tan.trim().toUpperCase(), fetchAll: false, page },
      validateStatus: () => true,
    })
    if (res.status >= 400) {
      throw new Error(
        `new-requests HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 400)}`
      )
    }
    const body = res.data || {}
    const itemsRaw = Array.isArray(body.items)
      ? body.items
      : Array.isArray(body?.data?.items)
      ? body.data.items
      : []
    for (const raw of itemsRaw) {
      const item = normalizeRequestItem(raw)
      if (item) all.push(item)
    }
    totalPages = Number(body.totalPages ?? body?.data?.totalPages ?? 1) || 1
    const last = Boolean(body.last ?? body?.data?.last)
    log(
      `new-requests page=${page + 1}/${totalPages}: got ${itemsRaw.length} (total so far ${all.length})`
    )
    if (last || itemsRaw.length === 0) break
    page++
    if (itemsRaw.length < LIST_PAGE_SIZE_HINT && page >= totalPages) break
  }

  return all
}

export async function initiateJustificationDownload(
  accessToken: string,
  payloads: InitiateJustificationPayload[],
  log: (msg: string) => void = console.log
): Promise<{ httpStatus: number; data: unknown }> {
  const client = authClient(accessToken)
  log(`initiateDownload: ${JSON.stringify(payloads)}`)
  const res = await client.post(
    "/tanjustreportservice/api/justification/initiateDownload",
    payloads,
    { validateStatus: () => true }
  )
  if (res.status >= 400) {
    throw new Error(
      `initiateDownload HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 500)}`
    )
  }
  return { httpStatus: res.status, data: res.data }
}

function bufferFromDownloadResponse(data: unknown, contentType: string | undefined): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (typeof data === "string") {
    // raw base64 or data-URL
    if (/^data:.*base64,/i.test(data) || (/^[A-Za-z0-9+/=\s]+$/.test(data) && data.length > 200)) {
      const cleaned = data.replace(/^data:[^;]+;base64,/i, "").replace(/\s/g, "")
      return Buffer.from(cleaned, "base64")
    }
    return Buffer.from(data, "binary")
  }
  if (data && typeof data === "object") {
    const obj = data as Record<string, unknown>
    const b64 =
      (typeof obj.base64 === "string" && obj.base64) ||
      (typeof obj.fileContent === "string" && obj.fileContent) ||
      (typeof obj.data === "string" && obj.data) ||
      null
    if (b64) {
      const cleaned = b64.replace(/^data:[^;]+;base64,/i, "").replace(/\s/g, "")
      return Buffer.from(cleaned, "base64")
    }
    // Sometimes nested
    if (obj.file && typeof obj.file === "object") {
      return bufferFromDownloadResponse(obj.file, contentType)
    }
  }
  throw new Error(
    `Unexpected downloadFile response (content-type=${contentType || "n/a"}, type=${typeof data})`
  )
}

function guessExtension(buf: Buffer, contentType?: string, contentDisposition?: string): string {
  const cd = contentDisposition || ""
  const nameMatch = /filename\*?=(?:UTF-8''|")?([^";]+)/i.exec(cd)
  if (nameMatch?.[1]) {
    const ext = path.extname(decodeURIComponent(nameMatch[1].replace(/"/g, ""))).toLowerCase()
    if (ext) return ext
  }
  if (contentType?.includes("zip")) return ".zip"
  if (contentType?.includes("pdf")) return ".pdf"
  if (buf.length >= 4) {
    const magic = buf.subarray(0, 4).toString("latin1")
    if (magic.startsWith("PK")) return ".zip"
    if (magic.startsWith("%PDF")) return ".pdf"
  }
  if (buf.subarray(0, 2).toString("latin1") === "7z") return ".7z"
  return ".zip"
}

export async function downloadJustificationFile(
  accessToken: string,
  requestId: string,
  destDir: string,
  fileBaseName: string,
  log: (msg: string) => void = console.log
): Promise<{ filePath: string; bytes: number }> {
  const client = authClient(accessToken)
  fs.mkdirSync(destDir, { recursive: true })

  const res = await client.get("/tanjustreportservice/api/justification/downloadFile", {
    params: { requestId },
    responseType: "arraybuffer",
    validateStatus: () => true,
  })

  if (res.status >= 400) {
    // Retry as JSON (some gateways return JSON error / base64 with application/json)
    const jsonClient = authClient(accessToken)
    const jsonRes = await jsonClient.get("/tanjustreportservice/api/justification/downloadFile", {
      params: { requestId },
      validateStatus: () => true,
    })
    if (jsonRes.status >= 400) {
      throw new Error(
        `downloadFile HTTP ${res.status}/${jsonRes.status}: ${JSON.stringify(jsonRes.data)?.slice(
          0,
          400
        )}`
      )
    }
    const buf = bufferFromDownloadResponse(
      jsonRes.data,
      String(jsonRes.headers["content-type"] || "")
    )
    const ext = guessExtension(
      buf,
      String(jsonRes.headers["content-type"] || ""),
      String(jsonRes.headers["content-disposition"] || "")
    )
    const filePath = path.join(destDir, `${fileBaseName}${ext}`)
    fs.writeFileSync(filePath, buf)
    log(`Saved justification file ${filePath} (${buf.length} bytes)`)
    return { filePath, bytes: buf.length }
  }

  const raw = Buffer.from(res.data)
  // If gateway returned JSON as arraybuffer
  const asText = raw.subarray(0, Math.min(raw.length, 200)).toString("utf8").trim()
  let buf: Buffer
  if (asText.startsWith("{") || asText.startsWith('"')) {
    try {
      const parsed = JSON.parse(raw.toString("utf8"))
      buf = bufferFromDownloadResponse(parsed, String(res.headers["content-type"] || ""))
    } catch {
      buf = raw
    }
  } else {
    buf = raw
  }

  if (buf.length < 50) {
    throw new Error(`downloadFile too small (${buf.length} bytes) for requestId=${requestId}`)
  }

  const ext = guessExtension(
    buf,
    String(res.headers["content-type"] || ""),
    String(res.headers["content-disposition"] || "")
  )
  const filePath = path.join(destDir, `${fileBaseName}${ext}`)
  fs.writeFileSync(filePath, buf)
  log(`Saved justification file ${filePath} (${buf.length} bytes)`)
  return { filePath, bytes: buf.length }
}

export async function downloadGeneratedJustificationItems(opts: {
  accessToken: string
  tan: string
  companyName: string
  items: JustificationRequestItem[]
  log?: (msg: string) => void
}): Promise<JustificationDownloadResult[]> {
  const log = opts.log || console.log
  const results: JustificationDownloadResult[] = []
  const tan = opts.tan.trim().toUpperCase()

  for (const item of opts.items) {
    const finYr = (item.financialYear || "UNKNOWN").replace(/[/\\?%*:|"<>]/g, "_")
    const qrtr = (item.quarter || "UNKNOWN").replace(/[/\\?%*:|"<>]/g, "_")
    const formType = (item.formType || "UNKNOWN").replace(/[/\\?%*:|"<>]/g, "_")
    const destDir = path.join(
      process.cwd(),
      "public",
      "pdf",
      "traces",
      opts.companyName,
      finYr,
      qrtr,
      formType
    )
    const base = `JR_${item.requestId}`
    try {
      const { filePath } = await downloadJustificationFile(
        opts.accessToken,
        item.requestId,
        destDir,
        base,
        log
      )
      results.push({
        success: true,
        requestId: item.requestId,
        financialYear: item.financialYear,
        quarter: item.quarter,
        formType: item.formType,
        filePath,
        tanReqNo: `${tan}_${item.requestId}`,
        reqDate: item.requestDate,
      })
    } catch (err: any) {
      const error = err?.message || String(err)
      log(`download failed requestId=${item.requestId}: ${error}`)
      results.push({
        success: false,
        requestId: item.requestId,
        financialYear: item.financialYear,
        quarter: item.quarter,
        formType: item.formType,
        error,
      })
    }
  }
  return results
}
