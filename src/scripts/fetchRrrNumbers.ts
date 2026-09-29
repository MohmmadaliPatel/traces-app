import fs from "fs"
import path from "path"
import type { AxiosInstance } from "axios"
import {
  createIncomeTaxAxiosClient,
  loginIncomeTaxPortal,
  saveIncomeTaxUserProfile,
  viewFiledFormsRequestHeaders,
} from "src/shared/portals/incomeTax"
import { runWithConcurrency } from "src/challan/utils/runWithConcurrency"
import { waitForSecs } from "src/utils/promises"

const SAVE_ENTITY_URL = "https://eportal.incometax.gov.in/iec/servicesapi/auth/saveEntity"
const REQUEST_TIMEOUT_MS = 45000

/** Aggregate extract outputs (updated on every run). */
export const RRR_EXTRACT_DIR = path.join(process.cwd(), "public", "pdf", "return", "rrr-extract")
export const RRR_EXTRACT_JSON = path.join(RRR_EXTRACT_DIR, "rrr_extract.json")
export const RRR_EXTRACT_CSV = path.join(RRR_EXTRACT_DIR, "rrr_extract.csv")

const CSV_HEADERS = [
  "Company Name",
  "Financial year",
  "Quarter",
  "Filing Type",
  "returnType",
  "Date of Tds return",
  "RRR number",
  "Acknowledgement number",
] as const

export type RrrExtractRow = {
  "Company Name": string
  "Financial year": string | number
  Quarter: string
  "Filing Type": string
  returnType: string
  "Date of Tds return": string
  "RRR number": string
  "Acknowledgement number": string
}

export type FetchRrrNumbersInput = {
  company: {
    name: string
    tan: string
    it_password: string
  }
  formTypes: string[]
  financialYears: string[]
  quarters: string[]
}

export type FetchRrrBatchCompany = {
  id: number
  name: string
  tan: string
  it_password: string
}

export type FetchRrrBatchResult = {
  companyId: number
  companyName: string
  success: boolean
  rows: RrrExtractRow[]
  error?: string
}

function log(company: string, msg: string, extra?: unknown) {
  const prefix = `[RRR][${company}]`
  if (extra !== undefined) {
    console.log(prefix, msg, extra)
  } else {
    console.log(prefix, msg)
  }
}

function normalizeFormType(formType: string): string {
  const upper = formType.toUpperCase().trim()
  return upper.startsWith("F") ? upper : `F${upper}`
}

function fyQuarterKey(fy: string | number, quarter: string): string {
  return `${String(fy)}|${String(quarter).toUpperCase()}`
}

function rowKey(row: RrrExtractRow): string {
  return [
    row["Company Name"],
    row.returnType,
    String(row["Financial year"]),
    String(row.Quarter).toUpperCase(),
    row["Acknowledgement number"] || row["RRR number"],
  ].join("|")
}

function createClient(): AxiosInstance {
  const client = createIncomeTaxAxiosClient()
  client.defaults.timeout = REQUEST_TIMEOUT_MS
  return client
}

async function postViewFiledForms(
  client: AxiosInstance,
  companyName: string,
  payload: Record<string, unknown>
): Promise<any> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        log(companyName, `viewFiledForms retry ${attempt}`, payload)
        await waitForSecs(2000)
      }
      const res = await client.post(SAVE_ENTITY_URL, payload, {
        headers: viewFiledFormsRequestHeaders(),
        timeout: REQUEST_TIMEOUT_MS,
      })
      return res.data
    } catch (error: any) {
      lastError = error
      const status = error?.response?.status
      const code = error?.code || error?.cause?.code
      log(companyName, `viewFiledForms error attempt=${attempt}`, {
        status,
        code,
        message: error?.message,
        data:
          typeof error?.response?.data === "string"
            ? error.response.data.slice(0, 200)
            : error?.response?.data,
      })
      const isTransient =
        code === "ECONNRESET" ||
        code === "ECONNABORTED" ||
        code === "ETIMEDOUT" ||
        /socket hang up|timeout/i.test(error?.message || "")
      if (!isTransient || attempt === 2) throw error
    }
  }
  throw lastError || new Error("viewFiledForms failed")
}

/**
 * Fetch pages until every requested FY+quarter is found, then stop.
 * Uses responseCount for total pages so we never request empty pages.
 */
async function fetchTargetedFiledForms(
  client: AxiosInstance,
  companyName: string,
  tan: string,
  formType: string,
  yearSet: Set<string>,
  quarterSet: Set<string>
): Promise<any[]> {
  const matched: any[] = []
  const needed = new Set<string>()
  for (const fy of yearSet) {
    for (const q of quarterSet) {
      needed.add(fyQuarterKey(fy, q))
    }
  }
  const found = new Set<string>()

  const pageSize = 5
  const pan = tan.toUpperCase()
  let totalPages = 1

  for (let currentPage = 0; currentPage < totalPages; currentPage++) {
    const payload = {
      serviceName: "viewFiledForms",
      entityNum: pan,
      formTypeCd: formType,
      currentPage: currentPage.toString(),
      pageSize: pageSize.toString(),
      filterParameterDetails: [],
    }

    log(companyName, `viewFiledForms ${formType} page ${currentPage + 1}`, payload)
    const data = await postViewFiledForms(client, companyName, payload)
    const list: any[] = data?.forms || []
    const responseCount = Number(data?.responseCount)
    log(companyName, `viewFiledForms ${formType} page ${currentPage} ok`, {
      formsOnPage: list.length,
      responseCount,
    })

    for (const returnRecord of list) {
      const refYear = String(returnRecord.refYear ?? "")
      const quarter = String(returnRecord.financialQrtr ?? "").toUpperCase()
      if (!yearSet.has(refYear) || !quarterSet.has(quarter)) continue
      matched.push(returnRecord)
      found.add(fyQuarterKey(refYear, quarter))
    }

    if (Number.isFinite(responseCount) && responseCount >= 0) {
      if (currentPage === 0) {
        totalPages = responseCount === 0 ? 1 : Math.ceil(responseCount / pageSize)
        log(companyName, `${formType} totalPages=${totalPages} from responseCount=${responseCount}`)
      }
    } else if (list.length < pageSize) {
      totalPages = currentPage + 1
    } else {
      totalPages = currentPage + 2
    }

    if (needed.size > 0 && [...needed].every((k) => found.has(k))) {
      log(companyName, `early stop ${formType}: found all targets`, [...found])
      break
    }
  }

  return matched
}

function escapeCsv(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`
  }
  return value
}

function rowsToCsv(rows: RrrExtractRow[]): string {
  return [
    CSV_HEADERS.join(","),
    ...rows.map((row) => CSV_HEADERS.map((h) => escapeCsv(String(row[h] ?? ""))).join(",")),
  ].join("\n")
}

function readExistingExtractRows(): RrrExtractRow[] {
  try {
    if (!fs.existsSync(RRR_EXTRACT_JSON)) return []
    const parsed = JSON.parse(fs.readFileSync(RRR_EXTRACT_JSON, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

let extractFileWriteChain: Promise<void> = Promise.resolve()

function withExtractFileLock<T>(fn: () => T | Promise<T>): Promise<T> {
  const run = extractFileWriteChain.then(fn, fn)
  extractFileWriteChain = run.then(
    () => undefined,
    () => undefined
  )
  return run
}

export async function persistRrrExtractRows(newRows: RrrExtractRow[]): Promise<{
  jsonPath: string
  csvPath: string
  totalRows: number
}> {
  return withExtractFileLock(() => {
    if (!fs.existsSync(RRR_EXTRACT_DIR)) {
      fs.mkdirSync(RRR_EXTRACT_DIR, { recursive: true })
    }

    const byKey = new Map<string, RrrExtractRow>()
    for (const row of readExistingExtractRows()) {
      byKey.set(rowKey(row), row)
    }
    for (const row of newRows) {
      byKey.set(rowKey(row), row)
    }

    const merged = [...byKey.values()].sort((a, b) => {
      const nameCmp = String(a["Company Name"]).localeCompare(String(b["Company Name"]))
      if (nameCmp !== 0) return nameCmp
      const fyCmp = Number(b["Financial year"]) - Number(a["Financial year"])
      if (fyCmp !== 0) return fyCmp
      return String(b.Quarter).localeCompare(String(a.Quarter))
    })

    fs.writeFileSync(RRR_EXTRACT_JSON, JSON.stringify(merged, null, 2), "utf-8")
    fs.writeFileSync(RRR_EXTRACT_CSV, rowsToCsv(merged), "utf-8")
    console.log(`[RRR] persisted ${merged.length} rows -> ${RRR_EXTRACT_JSON}`)

    return {
      jsonPath: RRR_EXTRACT_JSON,
      csvPath: RRR_EXTRACT_CSV,
      totalRows: merged.length,
    }
  })
}

function toExtractRows(
  companyName: string,
  formType: string,
  records: any[]
): RrrExtractRow[] {
  return records.map((returnRecord) => ({
    "Company Name": companyName,
    "Financial year": returnRecord.refYear || "",
    Quarter: returnRecord.financialQrtr || "",
    "Filing Type": returnRecord.filingTypeCd || "",
    returnType: formType,
    "Date of Tds return": returnRecord.ackDt || "",
    "RRR number": returnRecord.tempAckNo || "",
    "Acknowledgement number": returnRecord.ackNum || "",
  }))
}

export async function fetchRrrNumbers(input: FetchRrrNumbersInput): Promise<RrrExtractRow[]> {
  const { company, formTypes, financialYears, quarters } = input
  const label = company.name

  if (!company.it_password?.trim()) {
    throw new Error(`Company "${label}" is missing IT portal password`)
  }
  if (!company.tan?.trim()) {
    throw new Error(`Company "${label}" is missing TAN`)
  }
  if (!formTypes.length) throw new Error("At least one form type is required")
  if (!financialYears.length) throw new Error("At least one financial year is required")
  if (!quarters.length) throw new Error("At least one quarter is required")

  const normalizedFormTypes = formTypes.map(normalizeFormType)
  const yearSet = new Set(financialYears.map(String))
  const quarterSet = new Set(quarters.map((q) => q.toUpperCase()))

  const allNeeded = new Set<string>()
  for (const formType of normalizedFormTypes) {
    for (const fy of yearSet) {
      for (const q of quarterSet) {
        allNeeded.add(`${formType}|${fyQuarterKey(fy, q)}`)
      }
    }
  }
  const allFound = new Set<string>()

  log(label, `start tan=${company.tan} forms=${normalizedFormTypes.join(",")} fy=${[...yearSet]} q=${[...quarterSet]}`)

  const client = createClient()
  log(label, "logging in to IT e-portal...")
  await loginIncomeTaxPortal(client, company.tan, company.it_password)
  log(label, "login ok")

  log(label, "fetching user profile...")
  await saveIncomeTaxUserProfile(client, company.tan)
  log(label, "profile ok")

  const rows: RrrExtractRow[] = []

  for (const formType of normalizedFormTypes) {
    const formNeeded = [...yearSet].flatMap((fy) =>
      [...quarterSet].map((q) => `${formType}|${fyQuarterKey(fy, q)}`)
    )
    if (formNeeded.every((k) => allFound.has(k))) {
      log(label, `skip ${formType} (targets already found)`)
      continue
    }

    log(label, `fetching ${formType}...`)
    const matched = await fetchTargetedFiledForms(
      client,
      label,
      company.tan,
      formType,
      yearSet,
      quarterSet
    )
    const formRows = toExtractRows(company.name, formType, matched)
    rows.push(...formRows)
    log(label, `${formType} matched ${formRows.length} row(s)`, formRows.map((r) => r["RRR number"]))

    for (const row of formRows) {
      allFound.add(`${formType}|${fyQuarterKey(row["Financial year"], row.Quarter)}`)
    }

    if ([...allNeeded].every((k) => allFound.has(k))) {
      log(label, "all targets found — skipping remaining form types")
      break
    }
  }

  await persistRrrExtractRows(rows)
  log(label, `done rows=${rows.length}`)
  return rows
}

export async function fetchRrrNumbersBatch(input: {
  companies: FetchRrrBatchCompany[]
  formTypes: string[]
  financialYears: string[]
  quarters: string[]
  concurrency?: number
}): Promise<{
  results: FetchRrrBatchResult[]
  rows: RrrExtractRow[]
  jsonPath: string
  csvPath: string
  totalRows: number
}> {
  // Cap concurrency: IT portal rate-limits / hangs under heavy parallel logins
  const concurrency = Math.min(Math.max(1, input.concurrency ?? 2), 4)
  console.log(
    `[RRR] batch start companies=${input.companies.length} concurrency=${concurrency} forms=${input.formTypes} fy=${input.financialYears} q=${input.quarters}`
  )

  const results = await runWithConcurrency(
    input.companies,
    concurrency,
    async (company, index) => {
      // Stagger starts so 4 logins don't hit the portal at the exact same instant
      if (index > 0) {
        await waitForSecs(Math.min(index, concurrency) * 800)
      }

      console.log(`[RRR] >>> company ${index + 1}/${input.companies.length}: ${company.name}`)
      try {
        if (!company.it_password?.trim()) {
          console.log(`[RRR] <<< ${company.name} FAIL missing it_password`)
          return {
            companyId: company.id,
            companyName: company.name,
            success: false,
            rows: [],
            error: "Missing IT portal password",
          } satisfies FetchRrrBatchResult
        }

        const rows = await fetchRrrNumbers({
          company: {
            name: company.name,
            tan: company.tan,
            it_password: company.it_password,
          },
          formTypes: input.formTypes,
          financialYears: input.financialYears,
          quarters: input.quarters,
        })

        console.log(`[RRR] <<< ${company.name} OK rows=${rows.length}`)
        return {
          companyId: company.id,
          companyName: company.name,
          success: true,
          rows,
        } satisfies FetchRrrBatchResult
      } catch (error: any) {
        const errMsg = error?.message || "Failed to extract RRR"
        console.error(`[RRR] <<< ${company.name} FAIL`, errMsg)
        if (error?.stack) console.error(error.stack)
        return {
          companyId: company.id,
          companyName: company.name,
          success: false,
          rows: [],
          error: errMsg,
        } satisfies FetchRrrBatchResult
      }
    }
  )

  const rows = results.flatMap((r) => r.rows)
  const persisted = await persistRrrExtractRows(rows)
  const successCount = results.filter((r) => r.success).length
  console.log(
    `[RRR] batch done success=${successCount}/${results.length} rowsThisRun=${rows.length} totalSaved=${persisted.totalRows}`
  )

  return {
    results,
    rows,
    jsonPath: persisted.jsonPath,
    csvPath: persisted.csvPath,
    totalRows: persisted.totalRows,
  }
}
