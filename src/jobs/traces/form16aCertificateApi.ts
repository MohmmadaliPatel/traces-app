/**
 * TRACES new-portal Form 16A certificate APIs (tdscertificatesservice).
 * Pure REST + Bearer — same auth pattern as Justification Report.
 *
 *   GET  /tdscertificatesservice/getActiveRequests?userId=&fetchAll=false&page=&size=
 *   POST /tdscertificatesservice/initiate
 *   GET  /tdscertificatesservice/downloadFile?requestId=
 */
import fs from "fs"
import path from "path"
import type { AxiosInstance } from "axios"
import { createAuthenticatedTracesClient } from "./http"
import {
  loginJustificationAccessToken,
  type JustificationRequestItem,
} from "./justificationApi"

export type Form16aRequestItem = JustificationRequestItem

export type InitiateForm16aPayload = {
  userId: string
  tan: string
  financialYear: string
  quarter: string
  formType: string
  /** Form 16A bulk certificate download type on new portal */
  downloadType: number
}

export type Form16aDownloadResult = {
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

/** Fixed downloadType for Form 16A (130/131/133) on tdscertificatesservice */
export const FORM16A_DOWNLOAD_TYPE = 14

const LIST_PAGE_SIZE = 10

export { loginJustificationAccessToken as loginForm16aAccessToken }

function authClient(accessToken: string): AxiosInstance {
  return createAuthenticatedTracesClient(accessToken)
}

function normalizeRequestItem(raw: any): Form16aRequestItem | null {
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

export function buildForm16aInitiatePayload(opts: {
  tan: string
  formType: string
  financialYear: string
  quarter: string
}): InitiateForm16aPayload {
  const tan = opts.tan.trim().toUpperCase()
  const quarter = (opts.quarter || "").trim().toUpperCase()
  const qLabel = quarter.startsWith("Q") ? quarter : `Q${quarter}`
  return {
    userId: tan,
    tan,
    financialYear: String(opts.financialYear).trim(),
    quarter: qLabel,
    formType: String(opts.formType).trim(),
    downloadType: FORM16A_DOWNLOAD_TYPE,
  }
}

/** Paginate GET getActiveRequests (Spring `content` page). */
export async function fetchForm16aActiveRequests(
  accessToken: string,
  tan: string,
  log: (msg: string) => void = console.log
): Promise<Form16aRequestItem[]> {
  const client = authClient(accessToken)
  const all: Form16aRequestItem[] = []
  let page = 0
  let totalPages = 1

  while (page < totalPages && page < 100) {
    const res = await client.get("/tdscertificatesservice/getActiveRequests", {
      params: {
        userId: tan.trim().toUpperCase(),
        fetchAll: false,
        page,
        size: LIST_PAGE_SIZE,
      },
      validateStatus: () => true,
    })
    if (res.status >= 400) {
      throw new Error(
        `getActiveRequests HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 400)}`
      )
    }
    const body = res.data || {}
    const itemsRaw = Array.isArray(body.content)
      ? body.content
      : Array.isArray(body.items)
      ? body.items
      : Array.isArray(body?.data?.content)
      ? body.data.content
      : []
    for (const raw of itemsRaw) {
      const item = normalizeRequestItem(raw)
      if (item) all.push(item)
    }
    totalPages = Number(body.totalPages ?? body?.data?.totalPages ?? 1) || 1
    const last = Boolean(body.last ?? body?.data?.last)
    log(
      `getActiveRequests page=${page + 1}/${totalPages}: got ${itemsRaw.length} (total so far ${all.length})`
    )
    if (last || itemsRaw.length === 0) break
    page++
  }

  return all
}

export async function initiateForm16aDownload(
  accessToken: string,
  payload: InitiateForm16aPayload,
  log: (msg: string) => void = console.log
): Promise<{ httpStatus: number; data: unknown }> {
  const client = authClient(accessToken)
  log(`initiate Form16A: ${JSON.stringify(payload)}`)
  const res = await client.post("/tdscertificatesservice/initiate", payload, {
    validateStatus: () => true,
  })
  if (res.status >= 400) {
    throw new Error(
      `initiate HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 500)}`
    )
  }
  return { httpStatus: res.status, data: res.data }
}

function bufferFromDownloadResponse(data: unknown, contentType: string | undefined): Buffer {
  if (Buffer.isBuffer(data)) return data
  if (typeof data === "string") {
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

export async function downloadForm16aFile(
  accessToken: string,
  requestId: string,
  destDir: string,
  fileBaseName: string,
  log: (msg: string) => void = console.log
): Promise<{ filePath: string; bytes: number }> {
  const client = authClient(accessToken)
  fs.mkdirSync(destDir, { recursive: true })

  const res = await client.get("/tdscertificatesservice/downloadFile", {
    params: { requestId },
    responseType: "arraybuffer",
    validateStatus: () => true,
  })

  if (res.status >= 400) {
    const jsonClient = authClient(accessToken)
    const jsonRes = await jsonClient.get("/tdscertificatesservice/downloadFile", {
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
    log(`Saved Form 16A file ${filePath} (${buf.length} bytes)`)
    return { filePath, bytes: buf.length }
  }

  const raw = Buffer.from(res.data)
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
  log(`Saved Form 16A file ${filePath} (${buf.length} bytes)`)
  return { filePath, bytes: buf.length }
}

export async function downloadGeneratedForm16aItems(opts: {
  accessToken: string
  tan: string
  companyName: string
  items: Form16aRequestItem[]
  log?: (msg: string) => void
}): Promise<Form16aDownloadResult[]> {
  const log = opts.log || console.log
  const results: Form16aDownloadResult[] = []
  const tan = opts.tan.trim().toUpperCase()

  for (const item of opts.items) {
    const finYr = (item.financialYear || "UNKNOWN").replace(/[/\\?%*:|"<>]/g, "_")
    const qrtr = (item.quarter || "UNKNOWN").replace(/[/\\?%*:|"<>]/g, "_")
    const formType = (item.formType || "UNKNOWN").replace(/[/\\?%*:|"<>]/g, "_")
    const destDir = path.join(
      process.cwd(),
      "public",
      "pdf",
      "form16a-download",
      opts.companyName,
      finYr,
      qrtr,
      formType
    )
    const base = `F16A_${item.requestId}`
    try {
      const { filePath } = await downloadForm16aFile(
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
