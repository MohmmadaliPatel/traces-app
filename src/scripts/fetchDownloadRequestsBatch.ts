/**
 * Login to TRACES (API captcha + Bearer) and GET childcert download requests
 * for each company. Records companies whose response `data` is non-empty.
 *
 * API:
 *   GET /childcertgenservice/api/download/requests?userId={TAN}&page=0&size=10
 *
 * Output:
 *   public/pdf/download_requests_batch_report.json
 *
 * CLI:
 *   --trial              Process only the first company
 *   --limit=N            Process at most N companies
 *   --companyId=N        Process only this company id
 *   --tan=XXXXX          Process only this TAN
 *   --concurrency=N      Parallel companies (default 1, max 4)
 *   --retry-errors       Re-run only companies that failed in the existing report
 *                        (merges results back into the same JSON)
 *
 * Examples:
 *   yarn traces:download-requests-trial --tan=MUMC32912F
 *   yarn traces:download-requests
 *   yarn traces:download-requests -- --retry-errors
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
import { runWithConcurrency } from "../challan/utils/runWithConcurrency"

dotenv.config()

const DEFAULT_CONCURRENCY = 1
const MAX_CONCURRENCY = 4
const MAX_LOGIN_ATTEMPTS = 5
const CAPTCHA_RETRY_ERROR_CODES = new Set(["CPT403", "CPT401", "CPT400"])

const PAGE = 0
const SIZE = 10

const REPORT_PATH = path.join(process.cwd(), "public", "pdf", "download_requests_batch_report.json")

type CompanyRow = {
  id: number
  name: string
  tan: string
  user_id: string
  password: string
}

type CliOptions = {
  trial: boolean
  limit?: number
  companyId?: number
  tan?: string
  concurrency: number
  retryErrors: boolean
}

type CompanyResult = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  hasData: boolean
  httpStatus?: number
  apiStatus?: number | string
  message?: string
  data?: unknown
  error?: string
}

type BatchReport = {
  generatedAt: string
  endpoint: string
  page: number
  size: number
  concurrency: number
  summary: {
    companiesProcessed: number
    companiesSucceeded: number
    companiesFailed: number
    withData: number
    empty: number
  }
  companiesWithData: CompanyResult[]
  companies: CompanyResult[]
  errors: string[]
}

function loadExistingReport(): BatchReport | null {
  if (!fs.existsSync(REPORT_PATH)) return null
  try {
    return JSON.parse(fs.readFileSync(REPORT_PATH, "utf8")) as BatchReport
  } catch {
    return null
  }
}

function parseCliArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { trial: false, concurrency: DEFAULT_CONCURRENCY, retryErrors: false }
  for (const arg of argv) {
    if (arg === "--trial" || arg === "-t") {
      opts.trial = true
      continue
    }
    if (arg === "--retry-errors" || arg === "--retry") {
      opts.retryErrors = true
      continue
    }
    const limitMatch = /^--limit=(\d+)$/.exec(arg)
    if (limitMatch) {
      opts.limit = parseInt(limitMatch[1]!, 10)
      continue
    }
    const idMatch = /^--companyId=(\d+)$/.exec(arg)
    if (idMatch) {
      opts.companyId = parseInt(idMatch[1]!, 10)
      continue
    }
    const tanMatch = /^--tan=(.+)$/i.exec(arg)
    if (tanMatch) {
      opts.tan = tanMatch[1]!.trim().toUpperCase()
      continue
    }
    const concMatch = /^--concurrency=(\d+)$/.exec(arg)
    if (concMatch) {
      opts.concurrency = parseInt(concMatch[1]!, 10)
    }
  }

  if (!opts.companyId && process.env.COMPANY_ID) {
    const n = parseInt(process.env.COMPANY_ID, 10)
    if (!Number.isNaN(n)) opts.companyId = n
  }
  if (!opts.tan && process.env.COMPANY_TAN) {
    opts.tan = process.env.COMPANY_TAN.trim().toUpperCase()
  }
  if (process.env.TRIAL === "1" || process.env.TRIAL === "true") {
    opts.trial = true
  }
  if (process.env.CONCURRENCY) {
    const n = parseInt(process.env.CONCURRENCY, 10)
    if (!Number.isNaN(n)) opts.concurrency = n
  }

  if (opts.trial && opts.limit == null) {
    opts.limit = 1
  }

  opts.concurrency = Math.min(
    MAX_CONCURRENCY,
    Math.max(1, opts.concurrency || DEFAULT_CONCURRENCY)
  )
  return opts
}

function selectCompanies(all: CompanyRow[], opts: CliOptions): CompanyRow[] {
  let selected = all
  if (opts.companyId != null) {
    selected = selected.filter((c) => c.id === opts.companyId)
  }
  if (opts.tan) {
    selected = selected.filter((c) => c.tan.toUpperCase() === opts.tan)
  }
  if (opts.limit != null && opts.limit > 0) {
    selected = selected.slice(0, opts.limit)
  }
  return selected
}

function log(msg: string) {
  console.log(msg)
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

/** Captcha + login until Bearer accessToken is returned (no browser / preauth). */
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
    if (accessToken?.trim()) {
      return accessToken
    }

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

function hasNonEmptyData(data: unknown): boolean {
  if (data == null) return false
  if (Array.isArray(data)) return data.length > 0
  if (typeof data === "string") return data.trim().length > 0
  if (typeof data === "object") return Object.keys(data as object).length > 0
  return true
}

async function fetchDownloadRequests(accessToken: string, tan: string): Promise<{
  httpStatus: number
  body: { data?: unknown; status?: number | string; message?: string }
}> {
  const client = createAuthenticatedTracesClient(accessToken)
  const res = await client.get("/childcertgenservice/api/download/requests", {
    params: { userId: tan, page: PAGE, size: SIZE },
    validateStatus: () => true,
  })
  const body =
    res.data && typeof res.data === "object"
      ? (res.data as { data?: unknown; status?: number | string; message?: string })
      : { data: null, message: typeof res.data === "string" ? res.data : undefined }
  return { httpStatus: res.status, body }
}

async function processCompany(
  company: CompanyRow,
  index: number,
  total: number
): Promise<CompanyResult> {
  const prefix = `[${index + 1}/${total}] ${company.name} (${company.tan})`
  const base: CompanyResult = {
    companyId: company.id,
    companyName: company.name,
    tan: company.tan,
    success: false,
    hasData: false,
  }

  if (!company.tan?.trim() || !company.password?.trim()) {
    const error = "Missing TRACES credentials (tan / password)"
    log(`${prefix} — SKIP: ${error}`)
    return { ...base, error }
  }

  try {
    log(`${prefix} — logging in…`)
    const accessToken = await loginForAccessToken({
      tan: company.tan.trim(),
      userId: company.user_id?.trim() || company.tan.trim(),
      password: company.password,
    })

    log(`${prefix} — GET download/requests…`)
    const { httpStatus, body } = await fetchDownloadRequests(accessToken, company.tan.trim())
    const hasData = hasNonEmptyData(body.data)

    if (hasData) {
      log(`${prefix} — HAS DATA (http=${httpStatus} apiStatus=${body.status ?? "n/a"})`)
    } else {
      log(
        `${prefix} — empty (${body.message ?? "no data"}; http=${httpStatus} apiStatus=${
          body.status ?? "n/a"
        })`
      )
    }

    return {
      ...base,
      success: true,
      hasData,
      httpStatus,
      apiStatus: body.status,
      message: body.message,
      ...(hasData ? { data: body.data } : {}),
    }
  } catch (err: any) {
    const error = err?.message || String(err)
    log(`${prefix} — ERROR: ${error}`)
    return { ...base, error }
  }
}

function buildReport(
  companies: CompanyResult[],
  concurrency: number
): BatchReport {
  const companiesWithData = companies.filter((r) => r.hasData)
  const errors = companies.filter((r) => !r.success).map((r) => `${r.companyName}: ${r.error}`)
  return {
    generatedAt: new Date().toISOString(),
    endpoint: `${TRACES_APP_API_ORIGIN}/childcertgenservice/api/download/requests`,
    page: PAGE,
    size: SIZE,
    concurrency,
    summary: {
      companiesProcessed: companies.length,
      companiesSucceeded: companies.filter((r) => r.success).length,
      companiesFailed: companies.filter((r) => !r.success).length,
      withData: companiesWithData.length,
      empty: companies.filter((r) => r.success && !r.hasData).length,
    },
    companiesWithData,
    companies,
    errors,
  }
}

function mergeRetryResults(
  previous: BatchReport,
  retryResults: CompanyResult[]
): CompanyResult[] {
  const byId = new Map(retryResults.map((r) => [r.companyId, r]))
  return previous.companies.map((c) => byId.get(c.companyId) ?? c)
}

async function main() {
  const cli = parseCliArgs(process.argv.slice(2))
  const existingReport = cli.retryErrors ? loadExistingReport() : null

  log("========================================")
  log(" TRACES Download Requests Batch")
  log("========================================")
  log(`API origin: ${TRACES_APP_API_ORIGIN}`)
  log(`Endpoint:   /childcertgenservice/api/download/requests?userId={TAN}&page=${PAGE}&size=${SIZE}`)
  log(`Concurrency: ${cli.concurrency}`)
  if (cli.retryErrors) log("Mode: retry-errors (from existing report)")
  if (cli.trial) log("Mode: trial (limit=1 unless --limit set)")
  if (cli.companyId != null) log(`Filter: companyId=${cli.companyId}`)
  if (cli.tan) log(`Filter: tan=${cli.tan}`)
  if (cli.limit != null) log(`Limit: ${cli.limit}`)

  if (cli.retryErrors && !existingReport) {
    console.error(`ERROR: --retry-errors requires an existing report at ${REPORT_PATH}`)
    process.exit(1)
  }

  log("\nLoading companies from database...")
  const allCompanies = await db.company.findMany({
    where: { isTemporary: false },
    select: {
      id: true,
      name: true,
      tan: true,
      user_id: true,
      password: true,
    },
    orderBy: { name: "asc" },
  })

  let companies = selectCompanies(allCompanies, cli)

  if (cli.retryErrors && existingReport) {
    const failedIds = new Set(
      existingReport.companies.filter((c) => !c.success).map((c) => c.companyId)
    )
    companies = companies.filter((c) => failedIds.has(c.id))
    log(`Retrying ${companies.length} failed companies from report`)
  }

  if (companies.length === 0) {
    console.error(
      `ERROR: No companies matched (total in DB: ${allCompanies.length}). Check --companyId / --tan / --retry-errors.`
    )
    process.exit(1)
  }

  log(`Companies to process: ${companies.length} (of ${allCompanies.length})`)

  // Space out logins when retrying 403s (rate limit); concurrency stays 1 by default.
  const interCompanyDelayMs = cli.retryErrors ? 2000 : 0

  const results = await runWithConcurrency(companies, cli.concurrency, async (company, index) => {
    if (interCompanyDelayMs > 0 && index > 0) {
      await new Promise((r) => setTimeout(r, interCompanyDelayMs))
    }
    return processCompany(company, index, companies.length)
  })

  const mergedCompanies =
    cli.retryErrors && existingReport
      ? mergeRetryResults(existingReport, results)
      : results

  const report = buildReport(mergedCompanies, cli.concurrency)
  const thisRunErrors = results.filter((r) => !r.success).map((r) => `${r.companyName}: ${r.error}`)
  const companiesWithDataThisRun = results.filter((r) => r.hasData)

  const reportDir = path.dirname(REPORT_PATH)
  if (!fs.existsSync(reportDir)) {
    fs.mkdirSync(reportDir, { recursive: true })
  }
  fs.writeFileSync(REPORT_PATH, JSON.stringify(report, null, 2), "utf8")

  log("\n========================================")
  log(" SUMMARY")
  log("========================================")
  if (cli.retryErrors) {
    log(`This run:    ${results.length} retried`)
    log(`  Succeeded: ${results.filter((r) => r.success).length}`)
    log(`  Failed:    ${results.filter((r) => !r.success).length}`)
    log(`  With data: ${companiesWithDataThisRun.length}`)
    log("--- Merged report ---")
  }
  log(`Processed:  ${report.summary.companiesProcessed}`)
  log(`Succeeded:  ${report.summary.companiesSucceeded}`)
  log(`Failed:     ${report.summary.companiesFailed}`)
  log(`With data:  ${report.summary.withData}`)
  log(`Empty:      ${report.summary.empty}`)
  log(`Report:     ${REPORT_PATH}`)
  if (report.companiesWithData.length > 0) {
    log("Companies with data:")
    for (const c of report.companiesWithData) {
      log(`  - ${c.companyName} (${c.tan})`)
    }
  }
  if (thisRunErrors.length > 0) {
    log(`Errors this run (${thisRunErrors.length}):`)
    for (const e of thisRunErrors.slice(0, 30)) log(`  - ${e}`)
    if (thisRunErrors.length > 30) log(`  ... +${thisRunErrors.length - 30} more`)
  }
  log("========================================")

  await db.$disconnect()
  process.exit(thisRunErrors.length > 0 ? 1 : 0)
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
