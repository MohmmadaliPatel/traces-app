import fs from "fs"
import path from "path"
import db from "db"
import type { ExportFeature, ExportTable } from "./types"
import { todayStamp } from "./types"

const RRR_EXTRACT_JSON = path.join(
  process.cwd(),
  "public",
  "pdf",
  "return",
  "rrr-extract",
  "rrr_extract.json"
)

const ACK_ROOT = path.join(process.cwd(), "public", "pdf", "Acknowledgement")

type AckFormTypeCd = "T140" | "F26Q"

type RrrExtractRow = {
  "Company Name": string
  "Financial year": string | number
  Quarter: string
  "Filing Type": string
  returnType: string
  "Date of Tds return": string
  "RRR number": string
  "Acknowledgement number": string
}

type Form140ExtractRow = {
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

function form140JsonPath(formTypeCd: AckFormTypeCd): string {
  const dir = formTypeCd === "F26Q" ? "form26q" : "form140"
  return path.join(ACK_ROOT, dir, `${dir}_extract.json`)
}

export type ExportFilters = {
  companyId?: number
  fy?: string
  search?: string
  formTypeCd?: AckFormTypeCd
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

function formatPct(consumed: number, limit: number): string {
  if (limit <= 0) return "0.00"
  return ((consumed / limit) * 100).toFixed(2)
}

function dateStr(value: Date | string | null | undefined): string {
  if (!value) return ""
  const d = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(d.getTime())) return ""
  return d.toLocaleDateString("en-IN")
}

async function buildTldcTable(filters: ExportFilters): Promise<ExportTable> {
  const where: Record<string, unknown> = {}
  if (filters.companyId) where.companyId = filters.companyId
  if (filters.fy) where.fy = filters.fy
  if (filters.search) {
    where.OR = [
      { certNumber: { contains: filters.search } },
      { pan: { contains: filters.search } },
      { panName: { contains: filters.search } },
      { section: { contains: filters.search } },
      { NatureOfPayment: { contains: filters.search } },
    ]
  }

  const rows = await db.tldcData.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { company: { select: { name: true, tan: true } } },
    take: 100000,
  })

  const headers = [
    "ID",
    "Company",
    "Certificate Number",
    "DIN",
    "Financial Year",
    "PAN",
    "PAN Name",
    "Section",
    "Nature of Payment",
    "TDS Rate",
    "TDS Amount Limit",
    "TDS Amount Consumed",
    "Valid From",
    "Valid To",
    "Cancel Date",
    "Status",
  ]

  const dataRows = rows.map((item) => [
    item.id,
    item.company?.name || "",
    item.certNumber || "",
    item.din || "",
    item.fy || "",
    item.pan || "",
    item.panName || "",
    item.section || "",
    item.NatureOfPayment || "",
    item.tdsRate || "",
    item.tdsAmountLimit || "",
    item.tdsAmountConsumed || "",
    dateStr(item.validFrom),
    dateStr(item.validTo),
    dateStr(item.cancelDate),
    item.isActive ? "Active" : "Inactive",
  ])

  const fyPart = filters.fy ? `-${filters.fy}` : ""
  return {
    title: "TLDC Data",
    filename: `tldc${fyPart}-${todayStamp()}`,
    headers,
    rows: dataRows,
  }
}

async function buildLdcUtilisationTable(filters: ExportFilters): Promise<ExportTable> {
  const where: Record<string, unknown> = {}
  if (filters.companyId) where.companyId = filters.companyId
  if (filters.fy) where.fy = filters.fy
  if (filters.search) {
    where.OR = [
      { certNumber: { contains: filters.search } },
      { pan: { contains: filters.search } },
      { panName: { contains: filters.search } },
      { section: { contains: filters.search } },
    ]
  }

  const rows = await db.tldcData.findMany({
    where,
    orderBy: { updatedAt: "desc" },
    include: { company: { select: { name: true, tan: true } } },
    take: 100000,
  })

  const headers = [
    "Company",
    "TAN",
    "Certificate Number",
    "Financial Year",
    "PAN",
    "PAN Name",
    "Section",
    "TDS Rate",
    "Amount Limit",
    "Amount Consumed",
    "Amount Remaining",
    "Utilisation %",
    "Valid From",
    "Valid To",
    "Status",
  ]

  const dataRows = rows.map((item) => {
    const limit = parseAmount(item.tdsAmountLimit)
    const consumed = parseAmount(item.tdsAmountConsumed)
    const remaining = Math.max(0, limit - consumed)
    return [
      item.company?.name || "",
      item.company?.tan || "",
      item.certNumber || "",
      item.fy || "",
      item.pan || "",
      item.panName || "",
      item.section || "",
      item.tdsRate || "",
      limit,
      consumed,
      remaining,
      formatPct(consumed, limit),
      dateStr(item.validFrom),
      dateStr(item.validTo),
      item.isActive ? "Active" : "Inactive",
    ]
  })

  const fyPart = filters.fy ? `-${filters.fy}` : ""
  return {
    title: "LDC Utilisation",
    filename: `ldc-utilisation${fyPart}-${todayStamp()}`,
    headers,
    rows: dataRows,
  }
}

async function buildOutstandingDemandTable(filters: ExportFilters): Promise<ExportTable> {
  const where: Record<string, unknown> = {}
  if (filters.companyId) where.companyId = filters.companyId
  if (filters.fy) where.finYr = filters.fy

  const rows = await db.outstandingDemand.findMany({
    where,
    orderBy: { finYr: "desc" },
    include: { company: { select: { name: true, tan: true } } },
    take: 100000,
  })

  const headers = [
    "Company Name",
    "TAN",
    "Financial Year",
    "Assessment Order Demand",
    "CPC Demand",
    "Total Demand",
  ]

  const dataRows = rows.map((item) => {
    const aod = parseAmount(item.aodmnd)
    const cpc = parseAmount(item.cpcdmd)
    return [
      item.company?.name || "",
      item.company?.tan || "",
      item.finYr || "",
      item.aodmnd || "0.00",
      item.cpcdmd || "0.00",
      (aod + cpc).toFixed(2),
    ]
  })

  return {
    title: "Outstanding Demand",
    filename: `outstanding-demand-${todayStamp()}`,
    headers,
    rows: dataRows,
  }
}

async function buildReturnStatusTable(filters: ExportFilters): Promise<ExportTable> {
  const where: Record<string, unknown> = {}
  if (filters.companyId) where.companyId = filters.companyId
  if (filters.fy) where.finyear = filters.fy

  const rows = await db.returnStatus.findMany({
    where,
    orderBy: { finyear: "desc" },
    include: { company: { select: { name: true, tan: true } } },
    take: 100000,
  })

  const headers = [
    "Company Name",
    "TAN",
    "Financial Year",
    "Quarter",
    "Form Type",
    "Token Number",
    "Date of Filing",
    "Status",
    "Date of Processing",
    "Statement Type",
  ]

  const dataRows = rows.map((item) => [
    item.company?.name || "",
    item.company?.tan || "",
    item.finyear || "",
    item.quarter || "",
    item.formtype || "",
    item.tokenno || "",
    item.dtoffiling || "",
    item.status || "",
    item.dtofprcng || "",
    item.stmnttype || "",
  ])

  return {
    title: "Return Status",
    filename: `return-status-${todayStamp()}`,
    headers,
    rows: dataRows,
  }
}

function readJsonArray<T>(filePath: string): T[] {
  try {
    if (!fs.existsSync(filePath)) return []
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"))
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

async function buildRrrTable(_filters: ExportFilters): Promise<ExportTable> {
  const rows = readJsonArray<RrrExtractRow>(RRR_EXTRACT_JSON)
  const headers = [
    "Company Name",
    "Financial year",
    "Quarter",
    "Filing Type",
    "returnType",
    "Date of Tds return",
    "RRR number",
    "Acknowledgement number",
  ]

  const dataRows = rows.map((row) => [
    row["Company Name"] || "",
    row["Financial year"] ?? "",
    row.Quarter || "",
    row["Filing Type"] || "",
    row.returnType || "",
    row["Date of Tds return"] || "",
    row["RRR number"] || "",
    row["Acknowledgement number"] || "",
  ])

  return {
    title: "RRR Extract",
    filename: `rrr-extract-${todayStamp()}`,
    headers,
    rows: dataRows,
  }
}

async function buildForm140Table(filters: ExportFilters): Promise<ExportTable> {
  const formTypeCd: AckFormTypeCd = filters.formTypeCd === "F26Q" ? "F26Q" : "T140"
  const rows = readJsonArray<Form140ExtractRow>(form140JsonPath(formTypeCd))

  const headers = [
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
  ]

  const dataRows = rows.map((row) => [
    row["Company Name"] || "",
    row.TAN || "",
    row["Form Type"] || "",
    row.Status || "",
    row["Acknowledgement No"] || "",
    row["RRR Number"] || "",
    row.PDF || "",
    row["Financial Year"] ?? "",
    row.Quarter || "",
    row["Filing Date"] || "",
  ])

  return {
    title: formTypeCd === "F26Q" ? "Form 26Q Extract" : "Form 140 Extract",
    filename: `form140-extract-${formTypeCd.toLowerCase()}-${todayStamp()}`,
    headers,
    rows: dataRows,
  }
}

async function buildDeducteeMastersTable(filters: ExportFilters): Promise<ExportTable> {
  const where: Record<string, unknown> = {}
  if (filters.search) {
    where.OR = [
      { pan: { contains: filters.search } },
      { email: { contains: filters.search } },
      { name: { contains: filters.search } },
    ]
  }

  const rows = await db.deducteeMaster.findMany({
    where,
    orderBy: { pan: "asc" },
    take: 100000,
  })

  const headers = ["ID", "PAN", "Email", "Name", "Created At", "Updated At"]
  const dataRows = rows.map((item) => [
    item.id,
    item.pan || "",
    item.email || "",
    item.name || "",
    dateStr(item.createdAt),
    dateStr(item.updatedAt),
  ])

  return {
    title: "Deductee Masters",
    filename: `deductee-masters-${todayStamp()}`,
    headers,
    rows: dataRows,
  }
}

export async function buildFeatureTable(
  feature: ExportFeature,
  filters: ExportFilters = {}
): Promise<ExportTable> {
  switch (feature) {
    case "tldc":
      return buildTldcTable(filters)
    case "ldc-utilisation":
      return buildLdcUtilisationTable(filters)
    case "outstanding-demand":
      return buildOutstandingDemandTable(filters)
    case "return-status":
      return buildReturnStatusTable(filters)
    case "rrr":
      return buildRrrTable(filters)
    case "form140":
      return buildForm140Table(filters)
    case "deductee-masters":
      return buildDeducteeMastersTable(filters)
    default: {
      const _exhaustive: never = feature
      throw new Error(`Unsupported export feature: ${_exhaustive}`)
    }
  }
}

/** Absolute path helpers for docs / debugging — not used by export route. */
export function portalDownloadRoots(): Record<string, string> {
  return {
    traces: path.join(process.cwd(), "public", "pdf", "traces"),
    tracesExcel: path.join(process.cwd(), "public", "pdf", "traces_excel"),
    challans: path.join(process.cwd(), "public", "pdf", "challans"),
    form16: path.join(process.cwd(), "public", "pdf", "form16-download"),
    form16a: path.join(process.cwd(), "public", "pdf", "form16a-download"),
    tldc: path.join(process.cwd(), "public", "pdf", "tldc-downloads"),
    rrr: path.join(process.cwd(), "public", "pdf", "return", "rrr-extract"),
  }
}
