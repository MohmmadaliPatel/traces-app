/**
 * New Act TLDC flow (TRACES REST):
 * 1. Login → Bearer token
 * 2. POST searchDeductor (paginate) — list child certificates for TAN
 * 3. GET download/requests — download ALL ready PDFs (statusCode === 3)
 * 4. Initiate:
 *    - default: initiate only when there are NO download requests
 *    - forceInitiate: initiate all search certs regardless of existing requests
 * 5. Re-fetch requests + download whatever became ready
 * 6. Parse PDFs (cert + PAN + panName) → child-certificate detail → DB rows
 */
import fs from "fs"
import path from "path"
import pdfParse from "pdf-parse"
import type { AxiosInstance } from "axios"
import {
  createAuthenticatedTracesClient,
  createTracesHttp,
  generateCaptcha,
  loginTraces,
  resolveCaptchaFromImageBase64,
} from "../jobs/traces"

const MAX_LOGIN_ATTEMPTS = 5
const CAPTCHA_RETRY_ERROR_CODES = new Set(["CPT403", "CPT401", "CPT400"])
const STATUS_CODE_READY = 3
const REQUESTS_SIZE = 50
const INITIATE_CHUNK = 10
const POST_INITIATE_WAIT_MS = 5000

export type NewActCredentials = {
  userId: string
  password: string
  tan: string
}

export type SearchDeductorCertificate = {
  childCertNum: string
  taxYear: string
  sectionCode: string
  deducteePan: string
  childCertificateAmount: number
  validFrom: string
  validTo: string
  remarks?: string
}

export type ChildCertificateApiResponse = {
  id?: number
  parentCertNum?: string
  childCertNum: string
  appPan?: string
  tan?: string
  taxYear?: number | string
  sectionCode?: string
  issueDate?: string
  certificateAmount?: number
  amountConsumed?: number
  balanceAvailable?: number
  validityStartDate?: string
  validityEndDate?: string
  activeFlag?: string
  natureOfPayment?: string
  certificateRate?: number
  insertTimestamp?: string
  updateTimestamp?: string
}

export type ParsedPdfCert = {
  pdfPath: string
  reqId?: string
  certNumber: string | null
  pan: string | null
  panName: string | null
}

export type NewActTldcRow = {
  certNumber: string
  din: string
  fy: string
  pan: string
  panName: string
  section: string
  NatureOfPayment: string
  tdsAmountLimit: string
  tdsAmountConsumed: string
  tdsRate: string
  validFrom: Date
  validTo: Date
  cancelDate: Date | null
  isActive: boolean
  detailJsonPath?: string
  source: "searchDeductor" | "childCertificate"
}

export type FetchTldcNewActResult = {
  certificatesFromSearch: SearchDeductorCertificate[]
  downloadedPdfs: { reqId: number; path: string; bytes: number }[]
  parsedPdfs: ParsedPdfCert[]
  missingCertNumbers: string[]
  initiated: { childCertNum: string; requestId?: string; status?: string; error?: string }[]
  rows: NewActTldcRow[]
  pdfDir: string
}

function log(msg: string, extra?: unknown) {
  if (extra !== undefined) console.log(`[TLDC:NewAct] ${msg}`, extra)
  else console.log(`[TLDC:NewAct] ${msg}`)
}

function safeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "unknown"
}

function isRetryableLoginFailure(loginRes: { errorCode?: string; message?: string }): boolean {
  const code = (loginRes.errorCode ?? "").toUpperCase()
  if (CAPTCHA_RETRY_ERROR_CODES.has(code)) return true
  const msg = (loginRes.message ?? "").toLowerCase()
  return (
    msg.includes("captcha") ||
    msg.includes("verification code") ||
    msg.includes("image data")
  )
}

export async function loginForAccessToken(credentials: NewActCredentials): Promise<string> {
  const http = createTracesHttp()
  for (let attempt = 1; attempt <= MAX_LOGIN_ATTEMPTS; attempt++) {
    const captchaMeta = await generateCaptcha(http)
    const captchaText = await resolveCaptchaFromImageBase64(captchaMeta.image)
    const loginRes = await loginTraces(http, {
      tan: credentials.tan,
      userId: credentials.userId,
      password: credentials.password,
      captcha: captchaText,
      captchaId: captchaMeta.id,
    })
    const accessToken = loginRes.authTokenDto?.accessToken
    if (accessToken?.trim()) return accessToken

    const errorCode = loginRes.errorCode ?? "UNKNOWN"
    const errorMessage = loginRes.message ?? "no accessToken"
    if (attempt >= MAX_LOGIN_ATTEMPTS) {
      throw new Error(
        `TRACES login failed after ${MAX_LOGIN_ATTEMPTS} attempts: ${errorCode} — ${errorMessage}`
      )
    }
    if (!isRetryableLoginFailure(loginRes)) {
      throw new Error(`TRACES login failed (non-retryable): ${errorCode} — ${errorMessage}`)
    }
    await new Promise((r) => setTimeout(r, 800))
  }
  throw new Error("TRACES login did not return accessToken")
}

function authClient(accessToken: string): AxiosInstance {
  return createAuthenticatedTracesClient(accessToken)
}

/** Normalize UI FY ("2026-27") for matching searchDeductor taxYear. */
export function normalizeTaxYear(fy: string): string {
  const s = (fy || "").trim()
  if (/^\d{4}-\d{2}$/.test(s)) return s
  if (/^\d{4}$/.test(s)) {
    const y = parseInt(s, 10)
    return `${y}-${String((y + 1) % 100).padStart(2, "0")}`
  }
  // "2026-2027" → "2026-27"
  const m = /^(\d{4})-(\d{4})$/.exec(s)
  if (m) return `${m[1]}-${m[2]!.slice(-2)}`
  return s
}

export async function searchDeductorAllPages(
  accessToken: string,
  tan: string,
  pageSize = 10
): Promise<SearchDeductorCertificate[]> {
  const client = authClient(accessToken)
  const all: SearchDeductorCertificate[] = []
  let pageNumber = 1
  let hasNext = true

  while (hasNext) {
    const res = await client.post(
      "/childcertgenservice/api/view/searchDeductor",
      { tan, pageNumber, pageSize },
      { validateStatus: () => true }
    )
    if (res.status >= 400) {
      throw new Error(
        `searchDeductor HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 400)}`
      )
    }
    const certs = Array.isArray(res.data?.certificates) ? res.data.certificates : []
    all.push(...certs)
    hasNext = Boolean(res.data?.hasNext)
    log(`searchDeductor page ${pageNumber}: ${certs.length} cert(s), hasNext=${hasNext}`)
    pageNumber++
    if (pageNumber > 100) break
  }

  return all
}

type DownloadRequestItem = {
  reqId: number
  statusCode?: number
  numberOfCertificates?: number
  statusLabel?: string | null
}

async function fetchDownloadRequestItems(
  accessToken: string,
  tan: string
): Promise<DownloadRequestItem[]> {
  const client = authClient(accessToken)
  const all: DownloadRequestItem[] = []
  for (let page = 0; page < 20; page++) {
    const res = await client.get("/childcertgenservice/api/download/requests", {
      params: { userId: tan, page, size: REQUESTS_SIZE },
      validateStatus: () => true,
    })
    const items = res.data?.data?.items
    const pageItems: DownloadRequestItem[] = Array.isArray(items) ? items : []
    all.push(...pageItems)
    const hasNext =
      Boolean(res.data?.data?.hasNext) ||
      Boolean(res.data?.hasNext) ||
      pageItems.length >= REQUESTS_SIZE
    if (pageItems.length === 0 || !hasNext) break
    if (pageItems.length < REQUESTS_SIZE) break
  }
  return all
}

async function downloadReadyRequestPdfs(opts: {
  accessToken: string
  tan: string
  pdfDir: string
  requestItems: DownloadRequestItem[]
  skipExistingPdfs: boolean
  downloadedPdfs: FetchTldcNewActResult["downloadedPdfs"]
}): Promise<void> {
  const { accessToken, tan, pdfDir, requestItems, skipExistingPdfs, downloadedPdfs } = opts
  const ready = requestItems.filter(
    (i) =>
      i.statusCode === STATUS_CODE_READY &&
      i.reqId != null &&
      (i.numberOfCertificates == null || i.numberOfCertificates > 0)
  )
  log(`ready PDFs to download: ${ready.length} of ${requestItems.length} request(s)`)

  const already = new Set(downloadedPdfs.map((d) => d.reqId))
  for (const item of ready) {
    if (already.has(item.reqId)) continue
    const pdfPath = path.join(pdfDir, `${item.reqId}.pdf`)
    if (skipExistingPdfs && fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 100) {
      downloadedPdfs.push({
        reqId: item.reqId,
        path: pdfPath,
        bytes: fs.statSync(pdfPath).size,
      })
      log(`skip existing PDF reqId=${item.reqId}`)
      continue
    }
    try {
      const buf = await downloadChildCertificatePdf(accessToken, tan, item.reqId)
      fs.writeFileSync(pdfPath, buf)
      downloadedPdfs.push({ reqId: item.reqId, path: pdfPath, bytes: buf.length })
      log(`saved PDF reqId=${item.reqId} (${buf.length} bytes)`)
    } catch (err: any) {
      log(`FAIL download reqId=${item.reqId}: ${err?.message || err}`)
    }
  }
}

async function initiateCertDownloads(
  accessToken: string,
  tan: string,
  certNumbers: string[]
): Promise<FetchTldcNewActResult["initiated"]> {
  const initiated: FetchTldcNewActResult["initiated"] = []
  if (certNumbers.length === 0) return initiated

  log(`initiating download for ${certNumbers.length} cert(s)`)
  for (let i = 0; i < certNumbers.length; i += INITIATE_CHUNK) {
    const chunk = certNumbers.slice(i, i + INITIATE_CHUNK)
    try {
      const initRes = await initiateChildCertDownload(accessToken, tan, chunk)
      for (const childCertNum of chunk) {
        initiated.push({
          childCertNum,
          requestId: initRes.requestId,
          status: initRes.status,
          error: initRes.errorMessage || undefined,
        })
      }
      log(`initiate OK requestId=${initRes.requestId} status=${initRes.status}`, chunk)
    } catch (err: any) {
      for (const childCertNum of chunk) {
        initiated.push({ childCertNum, error: err?.message || String(err) })
      }
      log(`initiate FAIL: ${err?.message || err}`)
    }
  }
  return initiated
}

function decodeBase64Pdf(base64: string): Buffer {
  const cleaned = base64.replace(/^data:application\/pdf;base64,/i, "").replace(/\s/g, "")
  return Buffer.from(cleaned, "base64")
}

async function downloadChildCertificatePdf(
  accessToken: string,
  tan: string,
  requestId: number
): Promise<Buffer> {
  const client = authClient(accessToken)
  const res = await client.post(
    "/childcertgenservice/api/download/downloadChildCertificates",
    { requestId, userId: tan },
    { validateStatus: () => true }
  )
  if (res.status >= 400) {
    throw new Error(`download HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 300)}`)
  }
  const base64 =
    (res.data && typeof res.data === "object" && (res.data as { base64?: string }).base64) || null
  if (!base64 || typeof base64 !== "string" || !base64.trim()) {
    throw new Error("download response missing base64")
  }
  const buf = decodeBase64Pdf(base64)
  if (buf.length < 100 || buf.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error("decoded content is not a valid PDF")
  }
  return buf
}

/**
 * Extract child certificate number + deductee PAN + name from New Act PDF text.
 */
export function parseChildCertificatePdfText(text: string): {
  certNumber: string | null
  pan: string | null
  panName: string | null
} {
  const certFromNote =
    text.match(/The\s+Certificate\s+Number:\s*([A-Z0-9]{10,})/i)?.[1] ||
    text.match(/Certificate\s+Number:\s*([A-Z0-9]{10,})/i)?.[1] ||
    null

  // Compact header line: 4AC0526TDP4A0582026-2719-Jun-2026
  const certFromHeader =
    text.match(/\b([0-9][A-Z0-9]{11,18})(?=\d{4}-\d{2})/)?.[1] ||
    text.match(/\b([0-9][A-Z0-9]{10,20})\b/)?.[1] ||
    null

  const certNumber = (certFromNote || certFromHeader || null)?.toUpperCase() ?? null

  // Payee block: Name / PAN / Address headers then values (e.g. LINK LEGAL + AABFL6757A)
  const payeeNamed = text.match(
    /2\.\s*Details of Payee:\s*Name\s*PAN\s*Address\s*([^\n\r]+?)\s*([A-Z]{5}[0-9]{4}[A-Z])/i
  )
  const footerNamed = text.match(
    /NamePANAddress\s*([A-Z0-9 .,&\-\/'()]+?)([A-Z]{5}[0-9]{4}[A-Z])/i
  )

  let panName = (payeeNamed?.[1] || footerNamed?.[1] || "").trim() || null
  let pan = (payeeNamed?.[2] || footerNamed?.[2] || "").toUpperCase() || null

  if (!pan) {
    const payeeBlock = text.split(/2\.\s*Details of Payee:/i)[1] || text
    const panMatches = [...payeeBlock.matchAll(/\b([A-Z]{5}[0-9]{4}[A-Z])\b/g)].map((m) => m[1]!)
    pan = panMatches[0] || null
  }

  if (panName) {
    // Strip accidental PAN glued to name in some extractions
    panName = panName.replace(new RegExp(`${pan}$`, "i"), "").trim() || panName
  }

  return { certNumber, pan, panName }
}

export async function parseChildCertificatePdfFile(pdfPath: string): Promise<ParsedPdfCert> {
  const buf = fs.readFileSync(pdfPath)
  const data = await pdfParse(buf)
  const parsed = parseChildCertificatePdfText(data.text || "")
  const reqId = path.basename(pdfPath, ".pdf")
  return {
    pdfPath,
    reqId: /^\d+$/.test(reqId) ? reqId : undefined,
    certNumber: parsed.certNumber,
    pan: parsed.pan,
    panName: parsed.panName,
  }
}

export async function initiateChildCertDownload(
  accessToken: string,
  tan: string,
  childCertNums: string[]
): Promise<{ requestId?: string; status?: string; errorMessage?: string; raw: unknown }> {
  const client = authClient(accessToken)
  const res = await client.post(
    "/childcertgenservice/api/download/initiate",
    { userLoginId: tan, childCertNum: childCertNums },
    { validateStatus: () => true }
  )
  if (res.status >= 400) {
    throw new Error(`initiate HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 400)}`)
  }
  return {
    requestId: res.data?.requestId != null ? String(res.data.requestId) : undefined,
    status: res.data?.status,
    errorMessage: res.data?.errorMessage,
    raw: res.data,
  }
}

export async function fetchChildCertificateDetail(
  accessToken: string,
  tan: string,
  childCertNum: string,
  pan = ""
): Promise<ChildCertificateApiResponse> {
  const client = authClient(accessToken)
  const res = await client.get("/certificateservice/api/child-certificate", {
    params: { childCertNum, tan, pan: pan || "" },
    validateStatus: () => true,
  })
  if (res.status >= 400) {
    throw new Error(
      `child-certificate HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 400)}`
    )
  }
  if (!res.data || typeof res.data !== "object") {
    throw new Error("child-certificate returned empty body")
  }
  return res.data as ChildCertificateApiResponse
}

const DETAIL_MAX_ATTEMPTS = 3

async function fetchChildCertificateDetailWithRetry(
  accessToken: string,
  tan: string,
  childCertNum: string,
  pan = ""
): Promise<ChildCertificateApiResponse> {
  let lastError: unknown
  for (let attempt = 1; attempt <= DETAIL_MAX_ATTEMPTS; attempt++) {
    try {
      return await fetchChildCertificateDetail(accessToken, tan, childCertNum, pan)
    } catch (err) {
      lastError = err
      log(
        `detail retry ${attempt}/${DETAIL_MAX_ATTEMPTS} ${childCertNum}: ${
          err instanceof Error ? err.message : err
        }`
      )
      if (attempt < DETAIL_MAX_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 1000 * attempt))
      }
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(`child-certificate failed for ${childCertNum}`)
}

function parsePortalDate(value?: string | null): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

function taxYearToFy(taxYear: number | string | undefined, fallbackFy: string): string {
  if (taxYear == null || taxYear === "") return fallbackFy
  if (typeof taxYear === "number") {
    return `${taxYear}-${String((taxYear + 1) % 100).padStart(2, "0")}`
  }
  return normalizeTaxYear(String(taxYear))
}

export function mapChildCertificateToRow(
  detail: ChildCertificateApiResponse,
  fallback: Partial<SearchDeductorCertificate> & { fy: string; panName?: string },
  detailJsonPath?: string
): NewActTldcRow {
  const fy = taxYearToFy(detail.taxYear, fallback.fy)
  const validFrom =
    parsePortalDate(detail.validityStartDate) ||
    parsePortalDate(fallback.validFrom) ||
    new Date()
  const validTo =
    parsePortalDate(detail.validityEndDate) ||
    parsePortalDate(fallback.validTo) ||
    new Date(new Date().setFullYear(new Date().getFullYear() + 1))

  return {
    certNumber: detail.childCertNum || fallback.childCertNum || "",
    din: detail.parentCertNum || (detail.id != null ? String(detail.id) : ""),
    fy,
    pan: detail.appPan || fallback.deducteePan || "",
    panName: fallback.panName || "",
    section: detail.sectionCode || fallback.sectionCode || "",
    NatureOfPayment: detail.natureOfPayment || "",
    tdsAmountLimit: String(
      detail.certificateAmount ?? fallback.childCertificateAmount ?? "0"
    ),
    tdsAmountConsumed: String(detail.amountConsumed ?? "0"),
    tdsRate: String(detail.certificateRate ?? "0"),
    validFrom,
    validTo,
    cancelDate: null,
    isActive: (detail.activeFlag ?? "A").toUpperCase() !== "N",
    detailJsonPath,
    source: "childCertificate",
  }
}

function lookupPanName(
  parsedPdfs: ParsedPdfCert[],
  certNumber?: string | null,
  pan?: string | null
): string {
  const cert = (certNumber || "").toUpperCase()
  const panU = (pan || "").toUpperCase()
  if (cert) {
    const byCert = parsedPdfs.find(
      (p) => p.certNumber?.toUpperCase() === cert && p.panName?.trim()
    )
    if (byCert?.panName) return byCert.panName.trim()
  }
  if (panU) {
    const byPan = parsedPdfs.find((p) => p.pan?.toUpperCase() === panU && p.panName?.trim())
    if (byPan?.panName) return byPan.panName.trim()
  }
  return ""
}

export async function fetchTldcDataNewAct({
  companyName,
  tan,
  fy,
  credentials,
  /** Default true: initiate only when there are zero download requests */
  initiateIfNoRequest = true,
  /** When true: initiate ALL search certs even if requests already exist */
  forceInitiate = false,
  skipExistingPdfs = true,
  /** @deprecated use initiateIfNoRequest / forceInitiate */
  initiateMissing,
}: {
  companyName: string
  tan: string
  fy: string
  credentials: NewActCredentials
  initiateIfNoRequest?: boolean
  forceInitiate?: boolean
  skipExistingPdfs?: boolean
  initiateMissing?: boolean
}): Promise<FetchTldcNewActResult> {
  // Back-compat: old `initiateMissing=true` behaves like forceInitiate
  if (initiateMissing === true && forceInitiate !== true) {
    forceInitiate = true
  }
  if (initiateMissing === false && initiateIfNoRequest === true && forceInitiate !== true) {
    // explicit old false → do not auto-initiate
    initiateIfNoRequest = false
  }

  const targetFy = normalizeTaxYear(fy)
  const pdfDir = path.join(
    process.cwd(),
    "public",
    "pdf",
    "child-certificates",
    safeFolderName(companyName)
  )
  const detailDir = path.join(pdfDir, "details")
  fs.mkdirSync(pdfDir, { recursive: true })
  fs.mkdirSync(detailDir, { recursive: true })

  log(
    `login tan=${tan} fy=${targetFy} initiateIfNoRequest=${initiateIfNoRequest} forceInitiate=${forceInitiate}`
  )
  const accessToken = await loginForAccessToken({
    tan: credentials.tan || tan,
    userId: credentials.userId,
    password: credentials.password,
  })

  // 1) Search deductor
  const allSearch = await searchDeductorAllPages(accessToken, tan)
  const certificatesFromSearch = allSearch.filter(
    (c) => normalizeTaxYear(c.taxYear || "") === targetFy || !targetFy
  )
  log(
    `searchDeductor total=${allSearch.length}, for FY ${targetFy}=${certificatesFromSearch.length}`
  )

  // 2) Download all currently ready request PDFs
  let requestItems = await fetchDownloadRequestItems(accessToken, tan)
  log(`download requests found: ${requestItems.length}`)
  const downloadedPdfs: FetchTldcNewActResult["downloadedPdfs"] = []
  await downloadReadyRequestPdfs({
    accessToken,
    tan,
    pdfDir,
    requestItems,
    skipExistingPdfs,
    downloadedPdfs,
  })

  const parseLocalPdfs = async (): Promise<ParsedPdfCert[]> => {
    const pdfFiles = fs
      .readdirSync(pdfDir)
      .filter((f) => f.endsWith(".pdf"))
      .map((f) => path.join(pdfDir, f))
    const parsed: ParsedPdfCert[] = []
    for (const pdfPath of pdfFiles) {
      try {
        parsed.push(await parseChildCertificatePdfFile(pdfPath))
      } catch (err: any) {
        log(`FAIL parse ${pdfPath}: ${err?.message || err}`)
        parsed.push({ pdfPath, certNumber: null, pan: null, panName: null })
      }
    }
    return parsed
  }

  let parsedPdfs = await parseLocalPdfs()
  let pdfCertSet = new Set(
    parsedPdfs
      .map((p) => p.certNumber?.toUpperCase())
      .filter((c): c is string => Boolean(c))
  )
  log(`parsed PDFs=${parsedPdfs.length}, unique certs in PDFs=${pdfCertSet.size}`)

  const allSearchCertNums = certificatesFromSearch
    .map((c) => (c.childCertNum || "").toUpperCase())
    .filter(Boolean)
  const missingCertNumbers = allSearchCertNums.filter((num) => !pdfCertSet.has(num))

  // 3) Initiate
  //    - forceInitiate: all search certs (no matter what)
  //    - default: only if there are NO download requests
  //    - if requests already exist → do not initiate (unless force)
  const initiated: FetchTldcNewActResult["initiated"] = []
  let certsToInitiate: string[] = []

  if (forceInitiate) {
    certsToInitiate = allSearchCertNums
    log(`forceInitiate: will initiate ${certsToInitiate.length} cert(s)`)
  } else if (initiateIfNoRequest) {
    if (requestItems.length === 0) {
      certsToInitiate = missingCertNumbers.length > 0 ? missingCertNumbers : allSearchCertNums
      log(
        `no download requests — initiating ${certsToInitiate.length} cert(s) (default)`
      )
    } else {
      log(
        `download requests already exist (${requestItems.length}) — skip initiate (default). missingInPdfs=${missingCertNumbers.length}`
      )
    }
  } else if (missingCertNumbers.length > 0) {
    log(
      `initiate disabled; missing ${missingCertNumbers.length} cert(s) in PDFs: ${missingCertNumbers
        .slice(0, 10)
        .join(", ")}${missingCertNumbers.length > 10 ? "…" : ""}`
    )
  }

  if (certsToInitiate.length > 0) {
    initiated.push(...(await initiateCertDownloads(accessToken, tan, certsToInitiate)))
    log(`waiting ${POST_INITIATE_WAIT_MS}ms for portal to prepare downloads...`)
    await new Promise((r) => setTimeout(r, POST_INITIATE_WAIT_MS))

    // 4) Re-fetch requests + download whatever is available now
    requestItems = await fetchDownloadRequestItems(accessToken, tan)
    log(`post-initiate download requests: ${requestItems.length}`)
    await downloadReadyRequestPdfs({
      accessToken,
      tan,
      pdfDir,
      requestItems,
      skipExistingPdfs,
      downloadedPdfs,
    })
    parsedPdfs = await parseLocalPdfs()
    pdfCertSet = new Set(
      parsedPdfs
        .map((p) => p.certNumber?.toUpperCase())
        .filter((c): c is string => Boolean(c))
    )
    log(
      `after initiate: parsed PDFs=${parsedPdfs.length}, unique certs=${pdfCertSet.size}`
    )
  }

  // Refresh missing list after optional initiate/download
  const missingAfter = allSearchCertNums.filter((num) => !pdfCertSet.has(num))
  if (missingAfter.length > 0) {
    log(
      `still missing in PDFs: ${missingAfter.slice(0, 10).join(", ")}${
        missingAfter.length > 10 ? "…" : ""
      }`
    )
  }

  // 5) child-certificate detail for each search result (+ save JSON)
  const rows: NewActTldcRow[] = []
  for (const cert of certificatesFromSearch) {
    const panNameFromPdf = lookupPanName(
      parsedPdfs,
      cert.childCertNum,
      cert.deducteePan
    )
    try {
      const detail = await fetchChildCertificateDetailWithRetry(
        accessToken,
        tan,
        cert.childCertNum,
        cert.deducteePan || ""
      )
      const detailJsonPath = path.join(detailDir, `${cert.childCertNum}.json`)
      fs.writeFileSync(detailJsonPath, JSON.stringify(detail, null, 2), "utf8")
      const panName =
        panNameFromPdf ||
        lookupPanName(parsedPdfs, detail.childCertNum, detail.appPan)
      rows.push(
        mapChildCertificateToRow(
          detail,
          { ...cert, fy: targetFy, panName },
          detailJsonPath
        )
      )
      log(`detail OK ${cert.childCertNum}${panName ? ` panName=${panName}` : ""}`)
    } catch (err: any) {
      log(`detail FAIL ${cert.childCertNum}: ${err?.message || err}`)
      // Fallback row from searchDeductor only
      rows.push({
        certNumber: cert.childCertNum,
        din: "",
        fy: normalizeTaxYear(cert.taxYear || targetFy),
        pan: cert.deducteePan || "",
        panName: panNameFromPdf,
        section: cert.sectionCode || "",
        NatureOfPayment: "",
        tdsAmountLimit: String(cert.childCertificateAmount ?? "0"),
        tdsAmountConsumed: "0",
        tdsRate: "0",
        validFrom: parsePortalDate(cert.validFrom) || new Date(),
        validTo: parsePortalDate(cert.validTo) || new Date(),
        cancelDate: null,
        isActive: true,
        source: "searchDeductor",
      })
    }
  }

  return {
    certificatesFromSearch,
    downloadedPdfs,
    parsedPdfs,
    missingCertNumbers: missingAfter,
    initiated,
    rows,
    pdfDir,
  }
}

/**
 * Refresh existing New Act rows via child-certificate API.
 * Also re-reads local PDFs (if present) to fill panName.
 */
export async function updateTldcDataNewAct({
  tan,
  credentials,
  records,
  companyName,
}: {
  tan: string
  credentials: NewActCredentials
  records: Array<{ id: number; certNumber: string; pan: string; fy: string }>
  companyName?: string
}): Promise<NewActTldcRow[]> {
  const accessToken = await loginForAccessToken({
    tan: credentials.tan || tan,
    userId: credentials.userId,
    password: credentials.password,
  })

  let parsedPdfs: ParsedPdfCert[] = []
  if (companyName) {
    const pdfDir = path.join(
      process.cwd(),
      "public",
      "pdf",
      "child-certificates",
      safeFolderName(companyName)
    )
    if (fs.existsSync(pdfDir)) {
      const pdfFiles = fs
        .readdirSync(pdfDir)
        .filter((f) => f.endsWith(".pdf"))
        .map((f) => path.join(pdfDir, f))
      for (const pdfPath of pdfFiles) {
        try {
          parsedPdfs.push(await parseChildCertificatePdfFile(pdfPath))
        } catch {
          // ignore parse errors on update
        }
      }
    }
  }

  const rows: NewActTldcRow[] = []
  for (const rec of records) {
    try {
      const detail = await fetchChildCertificateDetailWithRetry(
        accessToken,
        tan,
        rec.certNumber,
        rec.pan || ""
      )
      const panName = lookupPanName(parsedPdfs, rec.certNumber, detail.appPan || rec.pan)
      rows.push(
        mapChildCertificateToRow(detail, {
          childCertNum: rec.certNumber,
          deducteePan: rec.pan,
          fy: normalizeTaxYear(rec.fy),
          panName,
        })
      )
    } catch (err: any) {
      log(`update FAIL ${rec.certNumber}: ${err?.message || err}`)
    }
  }
  return rows
}

// CLI: yarn tldc:new-act -- --tan=... --fy=2026-27 --companyName=... [--initiate]
if (require.main === module) {
  ;(async () => {
    const dotenv = await import("dotenv")
    dotenv.config()
    const db = (await import("db")).default

    const args = process.argv.slice(2)
    const get = (k: string) => {
      const m = args.find((a) => a.startsWith(`--${k}=`))
      return m ? m.slice(k.length + 3) : undefined
    }
    const tan = (get("tan") || process.env.COMPANY_TAN || "").toUpperCase()
    const fy = get("fy") || "2026-27"
    const companyNameArg = get("companyName")
    const forceInitiate = args.includes("--initiate") || args.includes("--force-initiate")

    if (!tan) {
      console.error(
        "Usage: yarn tldc:new-act -- --tan=MUMC18011A --fy=2026-27 [--force-initiate]"
      )
      process.exit(1)
    }

    const company = await db.company.findFirst({
      where: { tan, isTemporary: false },
      select: { id: true, name: true, tan: true, user_id: true, password: true },
    })
    if (!company) {
      console.error(`Company not found for TAN ${tan}`)
      process.exit(1)
    }

    const result = await fetchTldcDataNewAct({
      companyName: companyNameArg || company.name,
      tan: company.tan,
      fy,
      credentials: {
        userId: company.user_id,
        password: company.password,
        tan: company.tan,
      },
      initiateIfNoRequest: true,
      forceInitiate,
    })

    console.log(
      JSON.stringify(
        {
          search: result.certificatesFromSearch.length,
          downloaded: result.downloadedPdfs.length,
          parsed: result.parsedPdfs,
          missing: result.missingCertNumbers,
          initiated: result.initiated,
          rows: result.rows.length,
        },
        null,
        2
      )
    )
    await db.$disconnect()
  })().catch(async (err) => {
    console.error(err)
    process.exit(1)
  })
}
