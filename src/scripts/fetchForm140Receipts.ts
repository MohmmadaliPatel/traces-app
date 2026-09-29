import fs from "fs"
import path from "path"
import type { AxiosInstance } from "axios"
import * as XLSX from "xlsx"
import {
  createIncomeTaxAxiosClient,
  loginIncomeTaxPortal,
  saveIncomeTaxUserProfile,
  viewFiledFormsRequestHeaders,
} from "src/shared/portals/incomeTax"
import { runWithConcurrency } from "src/challan/utils/runWithConcurrency"
import { waitForSecs } from "src/utils/promises"

const SAVE_ENTITY_URL = "https://eportal.incometax.gov.in/iec/servicesapi/auth/saveEntity"
const INVOKE_URL = "https://eportal.incometax.gov.in/iec/itfweb/auth/invoke"
const PDF_URL = "https://eportal.incometax.gov.in/iec/pdfweb/pdf"
const REQUEST_TIMEOUT_MS = 60000

export type AckFormTypeCd = "T140" | "F26Q"

export const ACKNOWLEDGEMENT_ROOT_DIR = path.join(
  process.cwd(),
  "public",
  "pdf",
  "Acknowledgement"
)

export const FORM140_EXTRACT_DIR = path.join(ACKNOWLEDGEMENT_ROOT_DIR, "form140")
export const FORM140_EXTRACT_JSON = path.join(FORM140_EXTRACT_DIR, "form140_extract.json")
export const FORM140_EXTRACT_XLSX = path.join(FORM140_EXTRACT_DIR, "form140_extract.xlsx")

export const FORM26Q_EXTRACT_DIR = path.join(ACKNOWLEDGEMENT_ROOT_DIR, "form26q")
export const FORM26Q_EXTRACT_JSON = path.join(FORM26Q_EXTRACT_DIR, "form26q_extract.json")
export const FORM26Q_EXTRACT_XLSX = path.join(FORM26Q_EXTRACT_DIR, "form26q_extract.xlsx")

const EXCEL_HEADERS = [
  "Company Name",
  "TAN",
  "Form Type",
  "Status",
  "Acknowledgement No",
  "RRR Number",
  "PDF",
  "Financial Year",
  "Quarter",
  "Filing Date",
] as const

const DEFAULT_FORM_DESCRIPTIONS: Record<AckFormTypeCd, string> = {
  T140:
    "Quarterly statement of deduction of tax under section 397(3)(b) in respect of payments made other than salary ",
  F26Q:
    "Quarterly statement of deduction of tax under sub-section (3) of section 200 of the Income-tax Act, 1961 in respect of payments other than salary for the quarter ended June/September/December/March.(Financial year) ",
}

export type Form140ExtractRow = {
  "Company Name": string
  TAN: string
  "Form Type": string
  Status: string
  "Acknowledgement No": string
  "RRR Number": string
  PDF: string
  "Financial Year": string | number
  Quarter: string
  "Filing Date": string
}

export type FetchForm140Input = {
  company: {
    name: string
    tan: string
    it_password: string
  }
  formTypeCd?: AckFormTypeCd
  financialYears?: string[]
  quarters?: string[]
  skipExistingPdfs?: boolean
}

export type FetchForm140BatchCompany = {
  id: number
  name: string
  tan: string
  it_password: string
}

export type FetchForm140BatchResult = {
  companyId: number
  companyName: string
  success: boolean
  rows: Form140ExtractRow[]
  error?: string
}

type FormCatalogMeta = {
  formName: string
  formDesc: string
  formCd: string
}

function normalizeFormTypeCd(value: unknown): AckFormTypeCd {
  const upper = String(value || "T140")
    .trim()
    .toUpperCase()
  return upper === "F26Q" ? "F26Q" : "T140"
}

export function getAckExtractPaths(formTypeCd: AckFormTypeCd): {
  dir: string
  json: string
  xlsx: string
  /** Public URL segment under /pdf/Acknowledgement/ */
  publicDir: string
  sheetName: string
  logTag: string
} {
  if (formTypeCd === "F26Q") {
    return {
      dir: FORM26Q_EXTRACT_DIR,
      json: FORM26Q_EXTRACT_JSON,
      xlsx: FORM26Q_EXTRACT_XLSX,
      publicDir: "form26q",
      sheetName: "Form26Q",
      logTag: "Form26Q",
    }
  }
  return {
    dir: FORM140_EXTRACT_DIR,
    json: FORM140_EXTRACT_JSON,
    xlsx: FORM140_EXTRACT_XLSX,
    publicDir: "form140",
    sheetName: "Form140",
    logTag: "Form140",
  }
}

function fyFolderFromRefYear(refYear: number | string | null | undefined): string {
  const label = financialYearLabelFromRefYear(refYear)
  return safeFolderName(label === "-" ? "unknown" : label)
}

function quarterFolder(quarter: string | null | undefined): string {
  const q = String(quarter || "")
    .trim()
    .toUpperCase()
  if (/^Q[1-4]$/.test(q)) return q
  return safeFolderName(q || "unknown")
}

function log(tag: string, company: string, msg: string, extra?: unknown) {
  const prefix = `[${tag}][${company}]`
  if (extra !== undefined) {
    console.log(prefix, msg, extra)
  } else {
    console.log(prefix, msg)
  }
}

function safeFolderName(name: string): string {
  return name.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim() || "company"
}

function rowKey(row: Form140ExtractRow): string {
  return [row.TAN, row["Form Type"], row["Acknowledgement No"] || row["RRR Number"]].join("|")
}

function createClient(): AxiosInstance {
  const client = createIncomeTaxAxiosClient()
  client.defaults.timeout = REQUEST_TIMEOUT_MS
  return client
}

function assessmentYearFromTaxYear(taxYear: number | string | null | undefined): string {
  const y = Number(taxYear)
  if (!Number.isFinite(y) || y <= 0) return "-"
  return `${y}-${String(y + 1).slice(-2)}`
}

function financialYearLabelFromRefYear(refYear: number | string | null | undefined): string {
  const y = Number(refYear)
  if (!Number.isFinite(y) || y <= 0) return "-"
  return `${y}-${String(y + 1).slice(-2)}`
}

function buildAddress(data: Record<string, any>): string {
  return [
    data.entityAddrLine1Txt || "",
    data.entityAddrLine2Txt || "",
    "",
    data.entityLocalityDesc || "",
    data.entityPostofficeDesc || "",
    data.entityDistrictDesc || "",
    data.entityStateDesc || "",
    data.entityCountryName || "",
    data.entityPinCd != null ? String(data.entityPinCd) : "",
  ].join(",")
}

function signatoryName(detail: Record<string, any>): string {
  return [detail.pcFirstName, detail.pcMidName, detail.pcLastName]
    .map((p) => String(p || "").trim())
    .filter(Boolean)
    .join(" ")
}

async function postViewFiledForms(
  client: AxiosInstance,
  logTag: string,
  companyName: string,
  payload: Record<string, unknown>
): Promise<any> {
  let lastError: unknown
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      if (attempt > 0) {
        log(logTag, companyName, `viewFiledForms retry ${attempt}`, payload)
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
      log(logTag, companyName, `viewFiledForms error attempt=${attempt}`, {
        status,
        code,
        message: error?.message,
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

async function fetchFormCatalogMeta(
  client: AxiosInstance,
  logTag: string,
  companyName: string,
  tan: string,
  formTypeCd: AckFormTypeCd
): Promise<FormCatalogMeta> {
  const pan = tan.toUpperCase()
  const payload = {
    serviceName: "viewFiledForms",
    entityNum: pan,
  }
  log(logTag, companyName, "viewFiledForms catalog", payload)
  try {
    const data = await postViewFiledForms(client, logTag, companyName, payload)
    const list: any[] =
      formTypeCd === "T140"
        ? Array.isArray(data?.tyForms)
          ? data.tyForms
          : []
        : Array.isArray(data?.forms)
          ? data.forms
          : []
    const match = list.find(
      (f) => String(f?.formCd || "").toUpperCase() === formTypeCd
    )
    if (match) {
      return {
        formName: String(match.formName || DEFAULT_FORM_DESCRIPTIONS[formTypeCd]),
        formDesc: String(
          match.formDesc || (formTypeCd === "T140" ? "Form 140" : "Form 26Q")
        ),
        formCd: formTypeCd,
      }
    }
  } catch (error: any) {
    log(logTag, companyName, `catalog fetch failed (using defaults): ${error?.message || error}`)
  }

  return {
    formName: DEFAULT_FORM_DESCRIPTIONS[formTypeCd],
    formDesc: formTypeCd === "T140" ? "Form 140" : "Form 26Q",
    formCd: formTypeCd,
  }
}

async function fetchAllFiledForms(
  client: AxiosInstance,
  logTag: string,
  companyName: string,
  tan: string,
  formTypeCd: AckFormTypeCd,
  yearSet?: Set<string>,
  quarterSet?: Set<string>
): Promise<any[]> {
  const pan = tan.toUpperCase()
  const pageSize = 5
  let totalPages = 1
  const matched: any[] = []

  for (let currentPage = 0; currentPage < totalPages; currentPage++) {
    const payload = {
      serviceName: "viewFiledForms",
      entityNum: pan,
      formTypeCd,
      currentPage: currentPage.toString(),
      pageSize: pageSize.toString(),
      filterParameterDetails: [],
    }

    log(logTag, companyName, `viewFiledForms ${formTypeCd} page ${currentPage + 1}`, payload)
    const data = await postViewFiledForms(client, logTag, companyName, payload)
    const list: any[] = data?.forms || []
    const responseCount = Number(data?.responseCount)
    log(logTag, companyName, `viewFiledForms ${formTypeCd} page ${currentPage} ok`, {
      formsOnPage: list.length,
      responseCount,
    })

    for (const returnRecord of list) {
      const refYear = String(returnRecord.refYear ?? "")
      const quarter = String(returnRecord.financialQrtr ?? "").toUpperCase()
      if (yearSet && yearSet.size > 0 && !yearSet.has(refYear)) continue
      if (quarterSet && quarterSet.size > 0 && !quarterSet.has(quarter)) continue
      matched.push(returnRecord)
    }

    if (Number.isFinite(responseCount) && responseCount >= 0) {
      if (currentPage === 0) {
        totalPages = responseCount === 0 ? 1 : Math.ceil(responseCount / pageSize)
      }
    } else if (list.length < pageSize) {
      totalPages = currentPage + 1
    } else {
      totalPages = currentPage + 2
    }
  }

  return matched
}

async function invokeFiledForm(
  client: AxiosInstance,
  logTag: string,
  companyName: string,
  tan: string,
  formTypeCd: AckFormTypeCd,
  ackNum: string
): Promise<any> {
  const payload = {
    metadata: {
      sn: "viewFiledFormService",
      formName: formTypeCd,
      submitedBy: "",
      loggedInUserId: tan.toUpperCase(),
    },
    data: {
      ackNum,
    },
  }

  log(logTag, companyName, `invoke viewFiledFormService formName=${formTypeCd} ack=${ackNum}`)
  const res = await client.post(INVOKE_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    timeout: REQUEST_TIMEOUT_MS,
  })

  if (!res.data?.allOk) {
    throw new Error(`viewFiledFormService failed for ack ${ackNum}`)
  }
  return res.data.data
}

function buildPdfPayload(
  formTypeCd: AckFormTypeCd,
  form: any,
  detail: any,
  catalog: FormCatalogMeta
) {
  const attachmentAry = Array.isArray(detail.attachmentDocument)
    ? detail.attachmentDocument
    : []
  const everify = detail.everify || {}
  const formNo = formTypeCd === "T140" ? "Form 140" : "Form 26Q"

  const common = {
    formStatus: "",
    formName: "arn",
    attachmentAry,
    data: {
      dateOfEfiling: form.ackDt || "",
      arn: form.ackNum || "",
      name: detail.entityFirstName || detail.userFirstName || "",
      nameSignatory: "",
      entityNum: form.entityNum || detail.tan || detail.entityNumber || "",
      address: buildAddress(detail),
      formNo,
      formdescription: catalog.formName || DEFAULT_FORM_DESCRIPTIONS[formTypeCd],
      assessmentYear: "-",
      financialYear: "-",
      financialQtr: form.financialQrtr || detail.financialQrtr || "",
      filingType: form.filingTypeCd || "Regular",
      entityType: formTypeCd === "T140" ? "-" : "",
      verifiedBy: "",
      rrrNumber: form.tempAckNo || "",
      f3caDocName1: "",
      f3caDocName2: "",
      f3caDocName3: "",
      f3caDocName4: "",
      f3caDocName5: "",
      f3caDocName6: "",
      f3caDocName7: "",
      f3caDocName8: "",
      f3caDocName9: "",
      f3caDocName10: "",
      f3caDocHash1: "",
      f3caDocHash2: "",
      f3caDocHash3: "",
      f3caDocHash4: "",
      f3caDocHash5: "",
      f3caDocHash6: "",
      f3caDocHash7: "",
      f3caDocHash8: "",
      f3caDocHash9: "",
      f3caDocHash10: "",
      f3caDocSize1: "",
      f3caDocSize2: "",
      f3caDocSize3: "",
      f3caDocSize4: "",
      f3caDocSize5: "",
      f3caDocSize6: "",
      f3caDocSize7: "",
      f3caDocSize8: "",
      f3caDocSize9: "",
      f3caDocSize10: "",
      uploadStatus: "",
      statusDate: "",
      financialMonth: "",
      refYearType: "",
    },
  }

  if (formTypeCd === "T140") {
    common.data.nameSignatory = everify.fullName || ""
    common.data.assessmentYear = assessmentYearFromTaxYear(detail.taxYear || form.refYear)
    common.data.financialYear = "-"
    common.data.verifiedBy = everify.verPan || detail.userPan || ""
    common.data.refYearType = "T.Y."
  } else {
    common.data.nameSignatory = signatoryName(detail) || everify.fullName || ""
    common.data.assessmentYear = "-"
    common.data.financialYear = financialYearLabelFromRefYear(
      detail.financialYear || form.refYear
    )
    common.data.verifiedBy = detail.userPan || detail.pcPan || everify.verPan || ""
    common.data.refYearType = ""
  }

  return common
}

async function downloadReceiptPdf(
  client: AxiosInstance,
  logTag: string,
  companyName: string,
  formTypeCd: AckFormTypeCd,
  form: any,
  detail: any,
  catalog: FormCatalogMeta
): Promise<Buffer> {
  const payload = buildPdfPayload(formTypeCd, form, detail, catalog)
  log(logTag, companyName, `download PDF ack=${form.ackNum}`)
  const res = await client.post(PDF_URL, payload, {
    headers: {
      "Content-Type": "application/json",
      Accept: "application/pdf,application/json,text/plain,*/*",
    },
    responseType: "arraybuffer",
    timeout: REQUEST_TIMEOUT_MS,
  })

  const buf = Buffer.from(res.data)
  if (buf.length < 100) {
    throw new Error(`PDF too small for ack ${form.ackNum} (${buf.length} bytes)`)
  }

  // Portal sometimes returns JSON error with 200
  const head = buf.slice(0, 20).toString("utf8").trim()
  if (head.startsWith("{") || head.startsWith("<")) {
    throw new Error(`Unexpected PDF response for ack ${form.ackNum}: ${head.slice(0, 120)}`)
  }

  return buf
}

function readExistingRows(jsonPath: string): Form140ExtractRow[] {
  try {
    if (!fs.existsSync(jsonPath)) return []
    const parsed = JSON.parse(fs.readFileSync(jsonPath, "utf-8"))
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

export async function persistForm140ExtractRows(
  newRows: Form140ExtractRow[],
  formTypeCd: AckFormTypeCd = "T140"
): Promise<{
  jsonPath: string
  xlsxPath: string
  totalRows: number
}> {
  const paths = getAckExtractPaths(formTypeCd)

  return withExtractFileLock(() => {
    if (!fs.existsSync(paths.dir)) {
      fs.mkdirSync(paths.dir, { recursive: true })
    }

    const byKey = new Map<string, Form140ExtractRow>()
    for (const row of readExistingRows(paths.json)) {
      byKey.set(rowKey(row), row)
    }
    for (const row of newRows) {
      byKey.set(rowKey(row), row)
    }

    const merged = [...byKey.values()].sort((a, b) => {
      const nameCmp = String(a["Company Name"]).localeCompare(String(b["Company Name"]))
      if (nameCmp !== 0) return nameCmp
      const fyCmp = Number(b["Financial Year"]) - Number(a["Financial Year"])
      if (fyCmp !== 0) return fyCmp
      return String(b.Quarter).localeCompare(String(a.Quarter))
    })

    fs.writeFileSync(paths.json, JSON.stringify(merged, null, 2), "utf-8")

    const sheetRows = merged.map((row) => {
      const out: Record<string, string | number> = {}
      for (const h of EXCEL_HEADERS) {
        out[h] = row[h] ?? ""
      }
      return out
    })
    const wb = XLSX.utils.book_new()
    const ws = XLSX.utils.json_to_sheet(sheetRows, { header: [...EXCEL_HEADERS] })
    XLSX.utils.book_append_sheet(wb, ws, paths.sheetName)
    XLSX.writeFile(wb, paths.xlsx)

    console.log(`[${paths.logTag}] persisted ${merged.length} rows -> ${paths.xlsx}`)

    return {
      jsonPath: paths.json,
      xlsxPath: paths.xlsx,
      totalRows: merged.length,
    }
  })
}

export async function fetchForm140Receipts(input: FetchForm140Input): Promise<Form140ExtractRow[]> {
  const formTypeCd = normalizeFormTypeCd(input.formTypeCd)
  const paths = getAckExtractPaths(formTypeCd)
  const { company, financialYears, quarters, skipExistingPdfs = true } = input
  const label = company.name

  if (!company.it_password?.trim()) {
    throw new Error(`Company "${label}" is missing IT portal password`)
  }
  if (!company.tan?.trim()) {
    throw new Error(`Company "${label}" is missing TAN`)
  }

  const yearSet =
    financialYears && financialYears.length > 0
      ? new Set(financialYears.map(String))
      : undefined
  const quarterSet =
    quarters && quarters.length > 0
      ? new Set(quarters.map((q) => q.toUpperCase()))
      : undefined

  log(
    paths.logTag,
    label,
    `start tan=${company.tan} form=${formTypeCd} fy=${yearSet ? [...yearSet] : "all"} q=${
      quarterSet ? [...quarterSet] : "all"
    }`
  )

  const client = createClient()
  log(paths.logTag, label, "logging in to IT e-portal...")
  await loginIncomeTaxPortal(client, company.tan, company.it_password)
  log(paths.logTag, label, "login ok")

  log(paths.logTag, label, "fetching user profile...")
  await saveIncomeTaxUserProfile(client, company.tan)
  log(paths.logTag, label, "profile ok")

  const catalog = await fetchFormCatalogMeta(
    client,
    paths.logTag,
    label,
    company.tan,
    formTypeCd
  )

  const forms = await fetchAllFiledForms(
    client,
    paths.logTag,
    label,
    company.tan,
    formTypeCd,
    yearSet,
    quarterSet
  )
  log(paths.logTag, label, `matched ${forms.length} ${formTypeCd} filing(s)`)

  const companyFolder = safeFolderName(company.name)
  const rows: Form140ExtractRow[] = []

  for (const form of forms) {
    const ackNum = String(form.ackNum || "")
    const rrr = String(form.tempAckNo || "")
    if (!ackNum) {
      log(paths.logTag, label, "skip form without ackNum", form)
      continue
    }

    const fyFolder = fyFolderFromRefYear(form.refYear)
    const qFolder = quarterFolder(form.financialQrtr)
    const pdfDir = path.join(paths.dir, companyFolder, fyFolder, qFolder)
    fs.mkdirSync(pdfDir, { recursive: true })

    const pdfFileName = `${ackNum}_receipt.pdf`
    const pdfAbsPath = path.join(pdfDir, pdfFileName)
    const pdfRelPath = `/pdf/Acknowledgement/${paths.publicDir}/${companyFolder}/${fyFolder}/${qFolder}/${pdfFileName}`

    try {
      if (
        skipExistingPdfs &&
        fs.existsSync(pdfAbsPath) &&
        fs.statSync(pdfAbsPath).size > 100
      ) {
        log(paths.logTag, label, `skip existing PDF ack=${ackNum}`)
      } else {
        const detail = await invokeFiledForm(
          client,
          paths.logTag,
          label,
          company.tan,
          formTypeCd,
          ackNum
        )
        const pdfBuf = await downloadReceiptPdf(
          client,
          paths.logTag,
          label,
          formTypeCd,
          form,
          detail,
          catalog
        )
        fs.writeFileSync(pdfAbsPath, pdfBuf)
        log(paths.logTag, label, `saved PDF ack=${ackNum} (${pdfBuf.length} bytes)`)
      }

      rows.push({
        "Company Name": company.name,
        TAN: company.tan.toUpperCase(),
        "Form Type": formTypeCd,
        Status: form.verStatus || "",
        "Acknowledgement No": ackNum,
        "RRR Number": rrr,
        PDF: pdfRelPath,
        "Financial Year": form.refYear || "",
        Quarter: form.financialQrtr || "",
        "Filing Date": form.ackDt || "",
      })
    } catch (error: any) {
      log(paths.logTag, label, `FAIL ack=${ackNum}: ${error?.message || error}`)
      rows.push({
        "Company Name": company.name,
        TAN: company.tan.toUpperCase(),
        "Form Type": formTypeCd,
        Status: form.verStatus || "",
        "Acknowledgement No": ackNum,
        "RRR Number": rrr,
        PDF: "",
        "Financial Year": form.refYear || "",
        Quarter: form.financialQrtr || "",
        "Filing Date": form.ackDt || "",
      })
    }
  }

  await persistForm140ExtractRows(rows, formTypeCd)
  log(paths.logTag, label, `done rows=${rows.length}`)
  return rows
}

export async function fetchForm140ReceiptsBatch(input: {
  companies: FetchForm140BatchCompany[]
  formTypeCd?: AckFormTypeCd
  financialYears?: string[]
  quarters?: string[]
  concurrency?: number
  skipExistingPdfs?: boolean
}): Promise<{
  results: FetchForm140BatchResult[]
  rows: Form140ExtractRow[]
  jsonPath: string
  xlsxPath: string
  totalRows: number
  formTypeCd: AckFormTypeCd
}> {
  const formTypeCd = normalizeFormTypeCd(input.formTypeCd)
  const paths = getAckExtractPaths(formTypeCd)
  const concurrency = Math.min(Math.max(1, input.concurrency ?? 2), 4)
  console.log(
    `[${paths.logTag}] batch start companies=${input.companies.length} form=${formTypeCd} concurrency=${concurrency} fy=${input.financialYears || "all"} q=${input.quarters || "all"}`
  )

  const results = await runWithConcurrency(
    input.companies,
    concurrency,
    async (company, index) => {
      if (index > 0) {
        await waitForSecs(Math.min(index, concurrency) * 800)
      }

      console.log(
        `[${paths.logTag}] >>> company ${index + 1}/${input.companies.length}: ${company.name}`
      )
      try {
        if (!company.it_password?.trim()) {
          return {
            companyId: company.id,
            companyName: company.name,
            success: false,
            rows: [],
            error: "Missing IT portal password",
          } satisfies FetchForm140BatchResult
        }

        const rows = await fetchForm140Receipts({
          company: {
            name: company.name,
            tan: company.tan,
            it_password: company.it_password,
          },
          formTypeCd,
          financialYears: input.financialYears,
          quarters: input.quarters,
          skipExistingPdfs: input.skipExistingPdfs,
        })

        console.log(`[${paths.logTag}] <<< ${company.name} OK rows=${rows.length}`)
        return {
          companyId: company.id,
          companyName: company.name,
          success: true,
          rows,
        } satisfies FetchForm140BatchResult
      } catch (error: any) {
        const errMsg = error?.message || `Failed to extract ${formTypeCd}`
        console.error(`[${paths.logTag}] <<< ${company.name} FAIL`, errMsg)
        return {
          companyId: company.id,
          companyName: company.name,
          success: false,
          rows: [],
          error: errMsg,
        } satisfies FetchForm140BatchResult
      }
    }
  )

  const rows = results.flatMap((r) => r.rows)
  const persisted = await persistForm140ExtractRows(rows, formTypeCd)
  const successCount = results.filter((r) => r.success).length
  console.log(
    `[${paths.logTag}] batch done success=${successCount}/${results.length} rowsThisRun=${rows.length} totalSaved=${persisted.totalRows}`
  )

  return {
    results,
    rows,
    jsonPath: persisted.jsonPath,
    xlsxPath: persisted.xlsxPath,
    totalRows: persisted.totalRows,
    formTypeCd,
  }
}
