/**
 * Fill the TRACES unconsumed challan list with real amounts.
 *
 * TRACES hides both the challan amount and the unconsumed amount ("View Amount") until the
 * exact challan amount is entered. Receipt PDFs only cover recent quarters, so this takes
 * every payment the e-filing portal still lists (all years, API only) and, per unconsumed
 * row, tries the amounts paid on that deposit date (then ±1 day) until TRACES accepts one.
 * A wrong amount is just answered with success=5.
 *
 * Writes, per company, public/pdf/<label>/<Company>/<Company>_unconsumed_list.xlsx and a
 * consolidated workbook public/pdf/<label>/<label>_unconsumed_with_amounts.xlsx.
 * Progress is kept in public/pdf/<label>/unconsumed_amounts.json (rerun resumes).
 *
 *   node scripts/run-ts.js src/scripts/fillUnconsumedAmounts.ts [--label=q2-fy2026-27]
 *     [--concurrency=4] [--tan=XXXX] [--skip-tans=A,B] [--redo] [--retry-unmatched]
 *     [--companies-xlsx=PATH]   companies from a sheet instead of the DB (e.g. Continuum)
 */
import fs from "fs"
import path from "path"
import dotenv from "dotenv"
import * as XLSX from "xlsx"
import db from "db"
import { openTraces61ApiSession, postLegacyServletJson, htmlToText } from "../jobs/traces"
import { fetchPaymentHistory, type PaymentHistoryItem } from "./fetchPaymentHistory"
import { financialYearFromDepositDate } from "../challan/utils/challanStatusExcel"
import { runWithConcurrency } from "../challan/utils/runWithConcurrency"
import { loadCompaniesXlsx } from "../challan/utils/companiesXlsx"

dotenv.config()

const PDF_BASE = path.join(process.cwd(), "public", "pdf")
const MAX_TRIES_PER_ROW = 15
const TRACES_ERROR = "TRACES returned an error (retry later)"

type Company = { id: number; name: string; tan: string; it_password: string | null; user_id: string | null; password: string | null }

type OutRow = {
  "Company Name": string
  TAN: string
  BSR: string
  "Challan Serial No": string
  "Challan Amount": number | ""
  "Receipt Number": string
  "Date of Deposit": string
  "Financial Year": string
  "Unconsumed Amount": number | string
  "Amount Source": string
}

type CompanyResult = {
  status: "Done" | "Failed"
  error?: string
  rows?: number
  revealed?: number
  unresolved?: number
  totalUnconsumed?: number
  finishedAt: string
}

function arg(name: string): string | undefined {
  const hit = process.argv.slice(2).find((a) => a === name || a.startsWith(`${name}=`))
  if (!hit) return undefined
  return hit.includes("=") ? hit.slice(hit.indexOf("=") + 1) : "true"
}

function safeName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, "_").trim()
}

function log(msg: string) {
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${msg}`)
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

/** "07-Aug-2024" (or "07-Aug-2024 08:22:55") → epoch day, or null. */
function dayNumber(text: string): number | null {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})/.exec(text.trim())
  if (!m) return null
  const month = MONTHS.findIndex((x) => x.toLowerCase() === m[2]!.toLowerCase())
  if (month < 0) return null
  return Math.round(Date.UTC(Number(m[3]), month, Number(m[1])) / 86400000)
}

function toNumber(value: unknown): number | null {
  const n = parseFloat(String(value ?? "").replace(/[₹,\s]/g, ""))
  return Number.isFinite(n) ? n : null
}

/** Exact BSR/CSN amounts parsed earlier from receipt PDFs (challan_status_pdf_coverage.json). */
function pdfAmountsByCsn(companyName: string): Map<string, number> {
  const map = new Map<string, number>()
  const file = path.join(PDF_BASE, "challans", companyName, "challan_status_pdf_coverage.json")
  if (!fs.existsSync(file)) return map
  try {
    const items = JSON.parse(fs.readFileSync(file, "utf8"))?.items ?? []
    for (const it of items) {
      const day = dayNumber(String(it.date ?? ""))
      const amount = toNumber(it.challanAmount)
      if (day != null && amount != null) map.set(`${String(it.csn).replace(/^0+/, "")}|${day}`, amount)
    }
  } catch {
    /* coverage file is a cache; ignore if unreadable */
  }
  return map
}

/** Candidate challan amounts for a deposit day, most likely first, de-duplicated. */
function candidatesFor(day: number, payments: Array<{ day: number; amount: number; tds: boolean }>): number[] {
  const ordered = [
    ...payments.filter((p) => p.day === day && p.tds),
    ...payments.filter((p) => p.day === day && !p.tds),
    ...payments.filter((p) => Math.abs(p.day - day) === 1 && p.tds),
  ]
  return [...new Set(ordered.map((p) => p.amount))].slice(0, MAX_TRIES_PER_ROW)
}

async function processCompany(company: Company, label: string): Promise<CompanyResult> {
  if (!company.user_id?.trim() || !company.password?.trim()) throw new Error("No TRACES credentials")

  const session = await openTraces61ApiSession({ userId: company.user_id, password: company.password, tan: company.tan })
  const portalRows: any[] = []
  for (let page = 1; ; page++) {
    const data = await postLegacyServletJson(session, "app/ded/srv/GetUnconChlnDetailServlet?reqtype=0", {
      body: `_search=false&nd=${Date.now()}&rows=100&page=${page}&sidx=&sord=asc`,
    })
    const rows = Array.isArray(data?.rows) ? data.rows : []
    portalRows.push(...rows)
    if (rows.length === 0 || page >= (Number(data?.totalpages) || 1)) break
  }

  const text = (v: unknown) => htmlToText(String(v ?? "")).trim()
  const needsReveal = (v: string) => !v || /view/i.test(v)
  const hidden = portalRows.filter((r) => needsReveal(text(r.unconschlnamt)))

  // Only log in to e-filing when something is hidden; it is the slow part.
  let payments: Array<{ day: number; amount: number; tds: boolean }> = []
  if (hidden.length > 0 && company.it_password?.trim()) {
    const fetched = await fetchPaymentHistory({
      tan: company.tan,
      itPassword: company.it_password,
      companyName: company.name,
      acts: ["O", "N"],
      financialYears: [],
    })
    payments = fetched.payments
      .map((p: PaymentHistoryItem) => ({
        day: dayNumber(String(p.paymentTime ?? "")) ?? -1,
        amount: toNumber(p.amount) ?? -1,
        tds: /TDS|TCS/i.test(String(p.paymentType ?? "")),
      }))
      .filter((p) => p.day >= 0 && p.amount > 0)
  }
  const earliestPayment = payments.length ? Math.min(...payments.map((p) => p.day)) : null
  const pdfAmounts = pdfAmountsByCsn(company.name)

  const out: OutRow[] = []
  let revealed = 0
  for (const r of portalRows) {
    const date = text(r.dateofdep)
    const csn = text(r.chlnsrno)
    const day = dayNumber(date)
    let unconsumed: number | string = text(r.unconschlnamt)
    let challanAmount: number | "" = toNumber(text(r.chlnamt)) ?? ""
    let source = "Shown by TRACES"

    if (needsReveal(String(unconsumed))) {
      unconsumed = "View Amount"
      source =
        day != null && earliestPayment != null && day >= earliestPayment - 1
          ? "No matching payment amount"
          : "Deposited before e-filing payment history (amount not available)"
      const exact = day != null ? pdfAmounts.get(`${csn.replace(/^0+/, "")}|${day}`) : undefined
      const tries = [...new Set([...(exact != null ? [exact] : []), ...(day != null ? candidatesFor(day, payments) : [])])]
      let erroredOut = false
      for (const amount of tries) {
        const body = new URLSearchParams({
          recptNum: String(r.recptNo ?? ""),
          chlnSNo: csn,
          enteredAmt: amount.toFixed(2),
          dateOfDep: date,
          bsrCode: text(r.chlnbsrcode),
        })
        // TRACES intermittently answers HTTP 410 "Error while processing" even for the right
        // amount (verified: the same request succeeds a few seconds later). Retry the same
        // amount with backoff; only a clean success=2/5 answer settles it.
        let first: any = null
        for (let attempt = 1; attempt <= 3 && first == null; attempt++) {
          await new Promise((resolve) => setTimeout(resolve, attempt === 1 ? 300 : 4000 * attempt))
          try {
            const data = await postLegacyServletJson(session, "app/ded/srv/GetUnconChlnDetailServlet?reqtype=1", { body })
            first = (Array.isArray(data) ? data[0] : data) ?? {}
          } catch (err: any) {
            log(`  ${company.name}: CSN ${csn} ${date} amount ${amount.toFixed(2)} attempt ${attempt} → ${String(err?.message || err).slice(-90)}`)
          }
        }
        if (first == null) {
          erroredOut = true
          break
        }
        if (first.success === 2 && first.unConsChlnAmt != null) {
          unconsumed = toNumber(first.unConsChlnAmt) ?? String(first.unConsChlnAmt)
          challanAmount = amount
          source = exact === amount ? "Receipt PDF" : "e-filing payment history"
          revealed++
          break
        }
      }
      if (erroredOut && unconsumed === "View Amount") source = TRACES_ERROR
    } else {
      unconsumed = toNumber(unconsumed) ?? unconsumed
    }

    out.push({
      "Company Name": company.name,
      TAN: company.tan,
      BSR: text(r.chlnbsrcode),
      "Challan Serial No": csn,
      "Challan Amount": challanAmount,
      "Receipt Number": String(r.recptNo ?? ""),
      "Date of Deposit": date,
      "Financial Year": financialYearFromDepositDate(date) || "",
      "Unconsumed Amount": unconsumed,
      "Amount Source": source,
    })
  }

  const dir = path.join(PDF_BASE, label, safeName(company.name))
  fs.mkdirSync(dir, { recursive: true })
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(out), "Unconsumed")
  XLSX.writeFile(wb, path.join(dir, `${safeName(company.name)}_unconsumed_list.xlsx`))
  fs.writeFileSync(path.join(dir, "unconsumed_rows.json"), JSON.stringify(out))

  const unresolved = out.filter((o) => typeof o["Unconsumed Amount"] !== "number").length
  return {
    status: "Done",
    rows: out.length,
    revealed,
    unresolved,
    totalUnconsumed: out.reduce((s, o) => s + (typeof o["Unconsumed Amount"] === "number" ? o["Unconsumed Amount"] : 0), 0),
    finishedAt: new Date().toISOString(),
  }
}

function writeConsolidated(label: string, companies: Company[], state: Record<string, CompanyResult>) {
  const all: OutRow[] = []
  const summary: Record<string, unknown>[] = []
  for (const c of companies) {
    const res = state[c.tan]
    const rowsFile = path.join(PDF_BASE, label, safeName(c.name), "unconsumed_rows.json")
    const rows: OutRow[] = res?.status === "Done" && fs.existsSync(rowsFile) ? JSON.parse(fs.readFileSync(rowsFile, "utf8")) : []
    all.push(...rows)
    summary.push({
      "Company Name": c.name,
      TAN: c.tan,
      Status: res ? (res.status === "Done" ? "Done" : `Failed: ${res.error ?? ""}`.slice(0, 250)) : "Not run",
      "Unconsumed challans": res?.rows ?? "",
      "With amount": res?.status === "Done" ? (res.rows ?? 0) - (res.unresolved ?? 0) : "",
      "Amount not available": res?.unresolved ?? "",
      "Total unconsumed amount": res?.totalUnconsumed ?? "",
    })
  }
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), "Summary")
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(all), "All challans")
  const file = path.join(PDF_BASE, label, `${label}_unconsumed_with_amounts.xlsx`)
  XLSX.writeFile(wb, file)
  return file
}

async function main() {
  const label = arg("--label") ?? "q2-fy2026-27"
  const concurrency = Math.min(6, Math.max(1, parseInt(arg("--concurrency") ?? "4", 10) || 4))
  const onlyTan = arg("--tan")?.toUpperCase()
  const skip = new Set((arg("--skip-tans") ?? "").split(",").map((t) => t.trim().toUpperCase()).filter(Boolean))
  const redo = arg("--redo") === "true"
  // Earlier runs could leave a 410'd row as "No matching payment amount"; this redoes those too.
  const retryUnmatched = arg("--retry-unmatched") === "true"

  const companiesXlsx = arg("--companies-xlsx")
  let companies = companiesXlsx
    ? loadCompaniesXlsx(path.resolve(companiesXlsx))
    : ((await db.company.findMany({
        where: { isTemporary: false },
        orderBy: { name: "asc" },
        select: { id: true, name: true, tan: true, it_password: true, user_id: true, password: true },
      })) as Company[])
  if (onlyTan) companies = companies.filter((c) => c.tan.toUpperCase() === onlyTan)

  const stateFile = path.join(PDF_BASE, label, "unconsumed_amounts.json")
  fs.mkdirSync(path.dirname(stateFile), { recursive: true })
  const state: Record<string, CompanyResult> = fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, "utf8")) : {}
  const hasErrorRows = (c: Company) => {
    const f = path.join(PDF_BASE, label, safeName(c.name), "unconsumed_rows.json")
    return (
      fs.existsSync(f) &&
      (JSON.parse(fs.readFileSync(f, "utf8")) as OutRow[]).some(
        (r) => r["Amount Source"] === TRACES_ERROR || (retryUnmatched && r["Amount Source"] === "No matching payment amount")
      )
    )
  }
  const todo = companies.filter(
    (c) => !skip.has(c.tan.toUpperCase()) && (redo || state[c.tan]?.status !== "Done" || hasErrorRows(c))
  )
  log(`${todo.length} of ${companies.length} compan(ies) to process · concurrency ${concurrency}`)

  await runWithConcurrency(todo, concurrency, async (company, i) => {
    log(`[${i + 1}/${todo.length}] → ${company.name} (${company.tan})`)
    try {
      state[company.tan] = await processCompany(company, label)
      const r = state[company.tan]!
      log(`[${i + 1}/${todo.length}] Done ← ${company.name}: ${r.rows} row(s), revealed ${r.revealed}, not available ${r.unresolved}`)
    } catch (err: any) {
      state[company.tan] = { status: "Failed", error: String(err?.message || err).slice(0, 300), finishedAt: new Date().toISOString() }
      log(`[${i + 1}/${todo.length}] FAILED ← ${company.name}: ${state[company.tan]!.error}`)
    }
    fs.writeFileSync(stateFile, JSON.stringify(state, null, 2))
  })

  const file = writeConsolidated(label, companies.filter((c) => !skip.has(c.tan.toUpperCase())), state)
  log(`Consolidated: ${path.relative(process.cwd(), file)}`)
}

main()
  .then(() => db.$disconnect())
  .catch(async (err) => {
    console.error(err)
    await db.$disconnect()
    process.exit(1)
  })
