/**
 * TRACES "Statement Filed Status" extractor.
 *
 * The legacy page at /app/ded/stmtstatus.xhtml renders a jqGrid fed by
 *
 *   POST /app/ded/srv/DedStmtStatusServlet?financialYear=<startYear>&quarter=<3..6>&formType=<24Q|26Q|27Q|27EQ>&reqType=1
 *   body: _search=false&nd=<ts>&rows=<n>&page=<n>&sidx=&sord=asc
 *
 * which answers
 *
 *   { totalpages, page, rowCount, rows: [{ finyear, quarter, formtype, tokenno, dtoffiling,
 *                                          status, dtofprcng, stmnttype, remarks?, reason? }] }
 *
 * `stmnttype` is "Regular" for the original statement and "Correction" for each correction, so
 * this is the authoritative source for clause 34(b) column (d) — the conso file header only ever
 * carries the *latest* correction's date.
 *
 * Token numbers come back masked as first-4 + "X"*n + last-4 (e.g. 7700XXXXXXX8491). They are
 * still matchable against a full token; see `tokenMatches`.
 *
 * We load the page once per company and then call the servlet directly with `credentials:
 * "same-origin"`, rather than driving the three selects and clicking Go for all 16 combinations.
 */
import fs from "fs"
import path from "path"
import db from "db"
import {
  attachTraces61RedirectGuard,
  loginWithTracesApiAndPreauth,
  traces61DedUrl,
} from "src/jobs/traces"

export const STMT_QUARTER_CODES: Record<string, string> = { Q1: "3", Q2: "4", Q3: "5", Q4: "6" }
export const STMT_FORM_TYPES = ["24Q", "26Q", "27Q", "27EQ"] as const

export type StatementStatusRow = {
  finyear: string
  quarter: string
  formtype: string
  tokenno: string
  dtoffiling: string
  status: string
  dtofprcng: string
  stmnttype: string
  remarks?: string | null
  reason?: string | null
}

export type CompanyStatementResult = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  rows: StatementStatusRow[]
  /** Combinations that genuinely returned nothing, vs ones that errored — kept apart on purpose. */
  emptyCombinations: string[]
  failedCombinations: { combination: string; error: string }[]
  error?: string
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

export function statementStatusRawDir(): string {
  return path.join(process.cwd(), "public", "pdf", "clause34", "statement-status")
}

/**
 * TRACES masks tokens as first-4 + X… + last-4. Compare a (possibly masked) portal token
 * against a full one without ever treating "X" as a digit.
 */
export function tokenMatches(portalToken: string, fullToken: string): boolean {
  const a = (portalToken || "").trim()
  const b = (fullToken || "").trim()
  if (!a || !b) return false
  if (a === b) return true
  if (!a.includes("X")) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "X") continue
    if (a[i] !== b[i]) return false
  }
  return true
}

function log(tan: string, msg: string, extra?: unknown) {
  if (extra !== undefined) console.log(`[stmt][${tan}] ${msg}`, extra)
  else console.log(`[stmt][${tan}] ${msg}`)
}

async function launchBrowser() {
  const puppeteer = require("puppeteer")
  return puppeteer.launch({
    headless: process.env.STMT_HEADLESS === "1",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : undefined,
  })
}

/** Call the grid servlet from inside the page so the JSF session cookies ride along. */
async function fetchCombination(
  page: any,
  financialYear: string,
  quarterCode: string,
  formType: string
): Promise<{ rows: StatementStatusRow[]; rowCount: number; totalpages: number }> {
  const script = `(async () => {
    const out = { rows: [], rowCount: 0, totalpages: 1 };
    let pageNo = 1;
    for (;;) {
      const url = "/app/ded/srv/DedStmtStatusServlet?financialYear=" + ${JSON.stringify(
        financialYear
      )} +
        "&quarter=" + ${JSON.stringify(quarterCode)} +
        "&formType=" + ${JSON.stringify(formType)} + "&reqType=1";
      const res = await fetch(url, {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
          "X-Requested-With": "XMLHttpRequest",
          Accept: "application/json, text/javascript, */*; q=0.01",
        },
        body: "_search=false&nd=" + Date.now() + "&rows=100&page=" + pageNo + "&sidx=&sord=asc",
      });
      if (!res.ok) throw new Error("HTTP " + res.status + " from DedStmtStatusServlet");
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); }
      catch (e) { throw new Error("Non-JSON reply (" + text.slice(0, 160) + ")"); }
      if (Array.isArray(data.rows)) out.rows.push.apply(out.rows, data.rows);
      out.rowCount = Number(data.rowCount) || out.rows.length;
      out.totalpages = Number(data.totalpages) || 1;
      if (pageNo >= out.totalpages) break;
      pageNo++;
    }
    return out;
  })()`
  return page.evaluate(script)
}

/**
 * A page plus the means to rebuild it. TRACES expires the JSF session part-way through a
 * 16-combination sweep and then answers 410 Gone, so the extractor has to be able to re-login.
 */
export type StatementSession = {
  page: any
  relogin: () => Promise<any>
}

export async function fetchStatementStatusForCompany(
  session: StatementSession,
  company: { id: number; name: string; tan: string },
  financialYear: string,
  quarters: string[],
  formTypes: readonly string[]
): Promise<CompanyStatementResult> {
  const result: CompanyStatementResult = {
    companyId: company.id,
    companyName: company.name,
    tan: company.tan,
    success: true,
    rows: [],
    emptyCombinations: [],
    failedCombinations: [],
  }

  let page = session.page

  const openStatusPage = async () => {
    await page.goto(traces61DedUrl("stmtstatus.xhtml"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    await delay(2500)
  }

  await openStatusPage()

  // Warm-up: the first servlet call after a preauth cookie bridge often answers 410 until the
  // JSF page has completed one request cycle. Spend a throwaway call here rather than paying
  // for a captcha-backed re-login in the middle of the sweep.
  try {
    await fetchCombination(page, financialYear, "3", "26Q")
  } catch {
    await delay(3000)
    await openStatusPage()
    try {
      await fetchCombination(page, financialYear, "3", "26Q")
    } catch {
      log(
        company.tan,
        "  warm-up still failing — continuing, per-combination recovery will handle it"
      )
    }
  }

  /**
   * Run one combination, recovering from an expired session.
   * Escalates: reload the page, then a full re-login. Only after both fail is it an error.
   */
  const fetchWithRecovery = async (quarterCode: string, formType: string) => {
    try {
      return await fetchCombination(page, financialYear, quarterCode, formType)
    } catch (firstError: any) {
      log(company.tan, `  retrying after: ${String(firstError?.message || firstError)}`)
      try {
        await openStatusPage()
        return await fetchCombination(page, financialYear, quarterCode, formType)
      } catch {
        log(company.tan, "  session gone — re-logging in")
        page = await session.relogin()
        await openStatusPage()
        return await fetchCombination(page, financialYear, quarterCode, formType)
      }
    }
  }

  for (const quarter of quarters) {
    const code = STMT_QUARTER_CODES[quarter]
    if (!code) throw new Error(`Unknown quarter ${quarter}`)
    for (const formType of formTypes) {
      const combination = `${formType} ${quarter}`
      try {
        const res = await fetchWithRecovery(code, formType)
        if (res.rows.length === 0) {
          result.emptyCombinations.push(combination)
          log(company.tan, `${combination}: no statement filed`)
        } else {
          result.rows.push(...res.rows)
          const regular = res.rows.filter((r) => /regular/i.test(r.stmnttype || ""))
          log(
            company.tan,
            `${combination}: ${res.rows.length} statement(s) — original ${
              regular[0]?.dtoffiling ?? "(none)"
            }`
          )
        }
      } catch (error: any) {
        // Never silently drop a combination: "no data" and "the call failed" mean very
        // different things when the output is a tax-audit disclosure.
        const message = String(error?.message || error)
        result.failedCombinations.push({ combination, error: message })
        result.success = false
        log(company.tan, `${combination}: FAILED — ${message}`)
      }
      await delay(700)
    }
  }

  return result
}

/** Persist to the existing ReturnStatus table, keyed on (company, FY, quarter, form, token). */
export async function persistStatementRows(
  companyId: number,
  rows: StatementStatusRow[]
): Promise<{ saved: number; updated: number }> {
  let saved = 0
  let updated = 0
  for (const row of rows) {
    const key = {
      companyId_finyear_quarter_formtype_tokenno: {
        companyId,
        finyear: row.finyear,
        quarter: row.quarter,
        formtype: row.formtype,
        tokenno: row.tokenno,
      },
    }
    const data = {
      dtoffiling: row.dtoffiling ?? "",
      status: row.status ?? "",
      dtofprcng: row.dtofprcng ?? "",
      stmnttype: row.stmnttype ?? "",
      remarks: row.remarks ?? null,
      reason: row.reason ?? null,
    }
    const existing = await db.returnStatus.findUnique({ where: key })
    if (existing) {
      await db.returnStatus.update({ where: key, data })
      updated++
    } else {
      await db.returnStatus.create({
        data: {
          companyId,
          finyear: row.finyear,
          quarter: row.quarter,
          formtype: row.formtype,
          tokenno: row.tokenno,
          ...data,
        },
      })
      saved++
    }
  }
  return { saved, updated }
}

export async function fetchStatementStatusBatch(input: {
  tans: string[]
  financialYear: string
  quarters?: string[]
  formTypes?: readonly string[]
}): Promise<CompanyStatementResult[]> {
  const quarters = input.quarters ?? ["Q1", "Q2", "Q3", "Q4"]
  const formTypes = input.formTypes ?? STMT_FORM_TYPES
  const outDir = statementStatusRawDir()
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

  const companies = await db.company.findMany({
    where: { tan: { in: input.tans.map((t) => t.toUpperCase()) } },
  })
  const byTan = new Map(companies.map((c) => [c.tan, c]))

  const browser = await launchBrowser()
  const results: CompanyStatementResult[] = []

  try {
    for (const [index, tan] of input.tans.map((t) => t.toUpperCase()).entries()) {
      const company = byTan.get(tan)
      if (!company) {
        results.push({
          companyId: -1,
          companyName: tan,
          tan,
          success: false,
          rows: [],
          emptyCombinations: [],
          failedCombinations: [],
          error: "Company not found in database",
        })
        continue
      }

      console.log(`\n[stmt] ===== ${index + 1}/${input.tans.length} ${company.name} (${tan}) =====`)
      const result = await runCompany(browser, company, input, quarters, formTypes)
      if (result.rows.length) {
        fs.writeFileSync(
          path.join(outDir, `${tan}_${input.financialYear}.json`),
          JSON.stringify(result, null, 2),
          "utf-8"
        )
      }
      results.push(result)

      // Space the logins out — the captcha solver starts missing under rapid repeat use.
      if (index < input.tans.length - 1) await delay(6000)
    }
  } finally {
    await browser.close().catch(() => undefined)
  }

  return results
}

/**
 * One company, with a single retry. A navigation timeout or a dead session is transient;
 * giving up after one attempt would report a real statement as "not filed".
 */
async function runCompany(
  browser: any,
  company: { id: number; name: string; tan: string; user_id: string; password: string },
  input: { financialYear: string },
  quarters: string[],
  formTypes: readonly string[]
): Promise<CompanyStatementResult> {
  const tan = company.tan
  const MAX_ATTEMPTS = 2
  let lastError = ""

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    if (attempt > 1) {
      log(tan, `retrying company (attempt ${attempt}/${MAX_ATTEMPTS}) after: ${lastError}`)
      await delay(15000)
    }
    let page: any = null
    try {
      const openSession = async () => {
        const fresh = await browser.newPage()
        await fresh.setViewport({ width: 1920, height: 1080 })
        await loginWithTracesApiAndPreauth(
          fresh,
          { userId: company.user_id, password: company.password, tan: company.tan },
          { redirectGuard: true }
        )
        await attachTraces61RedirectGuard(fresh)
        await delay(5000)
        return fresh
      }

      page = await openSession()
      const session: StatementSession = {
        page,
        relogin: async () => {
          await page?.close().catch(() => undefined)
          await delay(8000)
          page = await openSession()
          return page
        },
      }

      const result = await fetchStatementStatusForCompany(
        session,
        company,
        input.financialYear,
        quarters,
        formTypes
      )
      const { saved, updated } = await persistStatementRows(company.id, result.rows)
      log(tan, `persisted ${saved} new / ${updated} updated ReturnStatus row(s)`)
      return result
    } catch (error: any) {
      lastError = String(error?.message || error)
      log(tan, `attempt ${attempt} failed — ${lastError}`)
    } finally {
      await page?.close().catch(() => undefined)
    }
  }

  log(tan, `FAILED after ${MAX_ATTEMPTS} attempt(s) — ${lastError}`)
  return {
    companyId: company.id,
    companyName: company.name,
    tan,
    success: false,
    rows: [],
    emptyCombinations: [],
    failedCombinations: [],
    error: lastError,
  }
}
