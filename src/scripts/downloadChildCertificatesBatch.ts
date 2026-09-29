/**
 * For companies that have download-request data: login → list requests →
 * POST downloadChildCertificates for each item with statusCode === 3 → save PDF.
 *
 * Source companies (default): companiesWithData from
 *   public/pdf/download_requests_batch_report.json
 *
 * Download API:
 *   POST /childcertgenservice/api/download/downloadChildCertificates
 *   body: { requestId, userId: TAN }
 *   response: { base64, type }
 *
 * PDFs:
 *   public/pdf/child-certificates/{CompanyName}/{reqId}.pdf
 *
 * CLI:
 *   --from-report         Use companiesWithData from report (default)
 *   --tan=XXXXX           Only this TAN
 *   --companyId=N         Only this company id
 *   --skip-existing       Skip reqId if PDF already on disk (default true)
 *   --no-skip-existing    Re-download even if PDF exists
 *
 * Examples:
 *   yarn traces:download-child-certs
 *   yarn traces:download-child-certs -- --tan=MUMC29885C
 */
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import db from "db"
import {
  createAuthenticatedTracesClient,
  createTracesHttp,
  generateCaptcha,
  loginTraces,
  resolveCaptchaFromImageBase64,
  TRACES_APP_API_ORIGIN,
} from "../jobs/traces"

dotenv.config()

const MAX_LOGIN_ATTEMPTS = 5
const CAPTCHA_RETRY_ERROR_CODES = new Set(["CPT403", "CPT401", "CPT400"])
const STATUS_CODE_READY = 3
const PAGE = 0
const SIZE = 10

const REPORT_PATH = path.join(process.cwd(), "public", "pdf", "download_requests_batch_report.json")
const OUT_ROOT = path.join(process.cwd(), "public", "pdf", "child-certificates")
const BATCH_REPORT_PATH = path.join(OUT_ROOT, "download_child_certs_report.json")

type CompanyRow = {
  id: number
  name: string
  tan: string
  user_id: string
  password: string
}

type DownloadRequestItem = {
  reqId: number
  userId?: string
  dateTime?: string
  numberOfCertificates?: number
  statusCode?: number
  statusLabel?: string | null
  initiateDownloadFlag?: string
}

type CliOptions = {
  fromReport: boolean
  tan?: string
  companyId?: number
  skipExisting: boolean
}

type DownloadAttempt = {
  reqId: number
  statusCode?: number
  success: boolean
  skipped?: boolean
  path?: string
  bytes?: number
  error?: string
}

type CompanyResult = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  requestsFound: number
  statusCode3: number
  downloaded: number
  skipped: number
  failed: number
  downloads: DownloadAttempt[]
  error?: string
}

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { fromReport: true, skipExisting: true }
  for (const arg of argv) {
    if (arg === "--from-report") {
      opts.fromReport = true
      continue
    }
    if (arg === "--skip-existing") {
      opts.skipExisting = true
      continue
    }
    if (arg === "--no-skip-existing") {
      opts.skipExisting = false
      continue
    }
    const tanMatch = /^--tan=(.+)$/i.exec(arg)
    if (tanMatch) {
      opts.tan = tanMatch[1]!.trim().toUpperCase()
      continue
    }
    const idMatch = /^--companyId=(\d+)$/.exec(arg)
    if (idMatch) {
      opts.companyId = parseInt(idMatch[1]!, 10)
    }
  }
  if (!opts.companyId && process.env.COMPANY_ID) {
    const n = parseInt(process.env.COMPANY_ID, 10)
    if (!Number.isNaN(n)) opts.companyId = n
  }
  if (!opts.tan && process.env.COMPANY_TAN) {
    opts.tan = process.env.COMPANY_TAN.trim().toUpperCase()
  }
  return opts
}

function log(msg: string) {
  console.log(msg)
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

async function loginForAccessToken(credentials: {
  tan: string
  userId: string
  password: string
}): Promise<string> {
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

async function fetchDownloadRequests(
  accessToken: string,
  tan: string
): Promise<DownloadRequestItem[]> {
  const client = createAuthenticatedTracesClient(accessToken)
  const res = await client.get("/childcertgenservice/api/download/requests", {
    params: { userId: tan, page: PAGE, size: SIZE },
    validateStatus: () => true,
  })
  const data = res.data?.data
  const items = data?.items
  if (!Array.isArray(items)) return []
  return items as DownloadRequestItem[]
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
  const client = createAuthenticatedTracesClient(accessToken)
  const res = await client.post(
    "/childcertgenservice/api/download/downloadChildCertificates",
    { requestId, userId: tan },
    { validateStatus: () => true }
  )

  if (res.status >= 400) {
    throw new Error(`download HTTP ${res.status}: ${JSON.stringify(res.data)?.slice(0, 300)}`)
  }

  const base64 =
    (res.data && typeof res.data === "object" && (res.data as { base64?: string }).base64) ||
    (typeof res.data === "string" ? res.data : null)

  if (!base64 || typeof base64 !== "string" || !base64.trim()) {
    throw new Error(
      `download response missing base64 (keys=${
        res.data && typeof res.data === "object" ? Object.keys(res.data).join(",") : typeof res.data
      })`
    )
  }

  const buf = decodeBase64Pdf(base64)
  if (buf.length < 100) {
    throw new Error(`decoded PDF too small (${buf.length} bytes)`)
  }
  // PDF magic
  if (buf.subarray(0, 4).toString("latin1") !== "%PDF") {
    throw new Error(`decoded content is not a PDF (starts with ${buf.subarray(0, 8).toString("hex")})`)
  }
  return buf
}

function companyIdsFromReport(): number[] {
  if (!fs.existsSync(REPORT_PATH)) {
    throw new Error(`Report not found: ${REPORT_PATH}`)
  }
  const report = JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")) as {
    companiesWithData?: Array<{ companyId: number }>
  }
  const ids = (report.companiesWithData ?? []).map((c) => c.companyId)
  if (ids.length === 0) {
    throw new Error("Report has no companiesWithData")
  }
  return ids
}

async function processCompany(
  company: CompanyRow,
  index: number,
  total: number,
  skipExisting: boolean
): Promise<CompanyResult> {
  const prefix = `[${index + 1}/${total}] ${company.name} (${company.tan})`
  const result: CompanyResult = {
    companyId: company.id,
    companyName: company.name,
    tan: company.tan,
    success: false,
    requestsFound: 0,
    statusCode3: 0,
    downloaded: 0,
    skipped: 0,
    failed: 0,
    downloads: [],
  }

  if (!company.tan?.trim() || !company.password?.trim()) {
    result.error = "Missing TRACES credentials (tan / password)"
    log(`${prefix} — SKIP: ${result.error}`)
    return result
  }

  const outDir = path.join(OUT_ROOT, safeFolderName(company.name))
  fs.mkdirSync(outDir, { recursive: true })

  try {
    log(`${prefix} — logging in…`)
    const accessToken = await loginForAccessToken({
      tan: company.tan.trim(),
      userId: company.user_id?.trim() || company.tan.trim(),
      password: company.password,
    })

    log(`${prefix} — fetching download requests…`)
    const items = await fetchDownloadRequests(accessToken, company.tan.trim())
    result.requestsFound = items.length

    const ready = items.filter(
      (i) =>
        i.statusCode === STATUS_CODE_READY &&
        i.reqId != null &&
        (i.numberOfCertificates == null || i.numberOfCertificates > 0)
    )
    const skippedZeroCerts = items.filter(
      (i) => i.statusCode === STATUS_CODE_READY && (i.numberOfCertificates ?? 0) === 0
    )
    result.statusCode3 = ready.length
    log(
      `${prefix} — ${items.length} request(s), ${ready.length} with statusCode=${STATUS_CODE_READY}` +
        (skippedZeroCerts.length
          ? ` (skipped ${skippedZeroCerts.length} with 0 certificates)`
          : "")
    )

    for (const item of ready) {
      const reqId = item.reqId
      const pdfPath = path.join(outDir, `${reqId}.pdf`)

      if (skipExisting && fs.existsSync(pdfPath) && fs.statSync(pdfPath).size > 100) {
        log(`${prefix} — skip existing reqId=${reqId}`)
        result.skipped++
        result.downloads.push({
          reqId,
          statusCode: item.statusCode,
          success: true,
          skipped: true,
          path: pdfPath,
          bytes: fs.statSync(pdfPath).size,
        })
        continue
      }

      try {
        log(`${prefix} — downloading reqId=${reqId}…`)
        const buf = await downloadChildCertificatePdf(accessToken, company.tan.trim(), reqId)
        fs.writeFileSync(pdfPath, buf)
        result.downloaded++
        result.downloads.push({
          reqId,
          statusCode: item.statusCode,
          success: true,
          path: pdfPath,
          bytes: buf.length,
        })
        log(`${prefix} — saved ${pdfPath} (${buf.length} bytes)`)
      } catch (err: any) {
        const error = err?.message || String(err)
        result.failed++
        result.downloads.push({
          reqId,
          statusCode: item.statusCode,
          success: false,
          error,
        })
        log(`${prefix} — FAIL reqId=${reqId}: ${error}`)
      }
    }

    result.success = result.failed === 0
    return result
  } catch (err: any) {
    result.error = err?.message || String(err)
    log(`${prefix} — ERROR: ${result.error}`)
    return result
  }
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2))

  log("========================================")
  log(" TRACES Child Certificate Downloads")
  log("========================================")
  log(`API origin: ${TRACES_APP_API_ORIGIN}`)
  log(`Download:   POST /childcertgenservice/api/download/downloadChildCertificates`)
  log(`Output:     ${OUT_ROOT}/{Company}/{reqId}.pdf`)
  log(`Skip existing: ${cli.skipExisting}`)
  if (cli.tan) log(`Filter: tan=${cli.tan}`)
  if (cli.companyId != null) log(`Filter: companyId=${cli.companyId}`)

  let targetIds: number[] | null = null
  if (cli.fromReport && !cli.tan && cli.companyId == null) {
    targetIds = companyIdsFromReport()
    log(`From report companiesWithData: ${targetIds.length} company id(s)`)
  }

  const allCompanies = await db.company.findMany({
    where: {
      isTemporary: false,
      ...(targetIds ? { id: { in: targetIds } } : {}),
      ...(cli.companyId != null ? { id: cli.companyId } : {}),
      ...(cli.tan ? { tan: cli.tan } : {}),
    },
    select: {
      id: true,
      name: true,
      tan: true,
      user_id: true,
      password: true,
    },
    orderBy: { name: "asc" },
  })

  // Preserve report order when using from-report
  let companies = allCompanies
  if (targetIds) {
    const byId = new Map(allCompanies.map((c) => [c.id, c]))
    companies = targetIds.map((id) => byId.get(id)).filter(Boolean) as CompanyRow[]
  }

  if (companies.length === 0) {
    console.error("ERROR: No companies matched.")
    process.exit(1)
  }

  log(`Companies to process: ${companies.length}`)

  const results: CompanyResult[] = []
  for (let i = 0; i < companies.length; i++) {
    if (i > 0) await new Promise((r) => setTimeout(r, 1500))
    results.push(await processCompany(companies[i]!, i, companies.length, cli.skipExisting))
  }

  const report = {
    generatedAt: new Date().toISOString(),
    outRoot: OUT_ROOT,
    summary: {
      companiesProcessed: results.length,
      companiesSucceeded: results.filter((r) => r.success).length,
      companiesFailed: results.filter((r) => !r.success).length,
      statusCode3: results.reduce((s, r) => s + r.statusCode3, 0),
      downloaded: results.reduce((s, r) => s + r.downloaded, 0),
      skipped: results.reduce((s, r) => s + r.skipped, 0),
      failedDownloads: results.reduce((s, r) => s + r.failed, 0),
    },
    companies: results,
  }

  fs.mkdirSync(OUT_ROOT, { recursive: true })
  fs.writeFileSync(BATCH_REPORT_PATH, JSON.stringify(report, null, 2), "utf8")

  log("\n========================================")
  log(" SUMMARY")
  log("========================================")
  log(`Companies:   ${report.summary.companiesProcessed}`)
  log(`statusCode3: ${report.summary.statusCode3}`)
  log(`Downloaded:  ${report.summary.downloaded}`)
  log(`Skipped:     ${report.summary.skipped}`)
  log(`Failed DL:   ${report.summary.failedDownloads}`)
  log(`Report:      ${BATCH_REPORT_PATH}`)
  for (const c of results) {
    log(
      `  ${c.companyName}: ready=${c.statusCode3} downloaded=${c.downloaded} skipped=${c.skipped} failed=${c.failed}${
        c.error ? ` ERROR=${c.error}` : ""
      }`
    )
  }
  log("========================================")

  await db.$disconnect()
  const hardFail = results.some((r) => !r.success || r.failed > 0)
  process.exit(hardFail ? 1 : 0)
}

main().catch(async (err) => {
  console.error("Fatal:", err)
  try {
    await db.$disconnect()
  } catch {
    /* ignore */
  }
  process.exit(1)
})
