import path from "path"
import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import {
  fetchForm140ReceiptsBatch,
  getAckExtractPaths,
  type AckFormTypeCd,
  type FetchForm140BatchCompany,
} from "src/scripts/fetchForm140Receipts"

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "4mb",
    },
    responseLimit: false,
  },
}

function normalizeFormTypeCd(value: unknown): AckFormTypeCd {
  const upper = String(value || "T140")
    .trim()
    .toUpperCase()
  return upper === "F26Q" ? "F26Q" : "T140"
}

function normalizeCsvCompanies(raw: unknown): FetchForm140BatchCompany[] {
  if (!Array.isArray(raw)) return []
  const out: FetchForm140BatchCompany[] = []
  const seenTan = new Set<string>()

  raw.forEach((item: any, index: number) => {
    const name = String(
      item?.name || item?.company_name || item?.["Company Name"] || ""
    ).trim()
    const tan = String(
      item?.tan || item?.username || item?.Tan || item?.TAN || item?.["User ID"] || ""
    )
      .trim()
      .toUpperCase()
    const it_password = String(
      item?.it_password ||
        item?.["IT Password"] ||
        item?.itPassword ||
        item?.password ||
        ""
    ).trim()

    if (!name || !tan || !it_password) return
    if (seenTan.has(tan)) return
    seenTan.add(tan)

    out.push({
      id: Number.isFinite(Number(item?.id)) ? Number(item.id) : -(index + 1),
      name,
      tan,
      it_password,
    })
  })

  return out
}

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  const startedAt = Date.now()

  try {
    const {
      companyId,
      companyIds,
      companies: companiesBody,
      formTypeCd: formTypeCdBody,
      financialYears,
      quarters,
      concurrency,
      skipExistingPdfs,
    } = req.body || {}

    const formTypeCd = normalizeFormTypeCd(formTypeCdBody)
    const paths = getAckExtractPaths(formTypeCd)

    let ordered: FetchForm140BatchCompany[] = normalizeCsvCompanies(companiesBody)

    if (ordered.length === 0) {
      const ids: number[] = Array.isArray(companyIds)
        ? companyIds.map((id: any) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id))
        : companyId
          ? [parseInt(String(companyId), 10)]
          : []

      if (ids.length === 0) {
        return res.status(400).json({
          success: false,
          error: "Upload companies CSV or provide companyId/companyIds",
        })
      }

      const companies = await db.company.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          name: true,
          tan: true,
          it_password: true,
        },
      })

      if (companies.length === 0) {
        return res.status(404).json({ success: false, error: "No companies found" })
      }

      const companyById = new Map(companies.map((c) => [c.id, c]))
      ordered = ids
        .map((id) => companyById.get(id))
        .filter((c): c is NonNullable<typeof c> => !!c)
        .map((c) => ({
          id: c.id,
          name: c.name,
          tan: c.tan,
          it_password: c.it_password || "",
        }))
    }

    console.log(`[${paths.logTag}] API request companies=${ordered.length}`, {
      formTypeCd,
      financialYears,
      quarters,
      concurrency,
      source: Array.isArray(companiesBody) && companiesBody.length > 0 ? "csv" : "db",
    })

    console.log(
      `[${paths.logTag}] API resolved ${ordered.length} companies:`,
      ordered.map((c) => `${c.name} (${c.tan})`)
    )

    const batch = await fetchForm140ReceiptsBatch({
      companies: ordered,
      formTypeCd,
      financialYears: Array.isArray(financialYears) ? financialYears : undefined,
      quarters: Array.isArray(quarters) ? quarters : undefined,
      concurrency: typeof concurrency === "number" ? concurrency : 2,
      skipExistingPdfs: skipExistingPdfs !== false,
    })

    const successCount = batch.results.filter((r) => r.success).length
    const errorCount = batch.results.length - successCount
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)

    console.log(
      `[${paths.logTag}] API finished in ${elapsedSec}s success=${successCount} errors=${errorCount} rows=${batch.rows.length}`
    )

    return res.status(200).json({
      success: errorCount === 0,
      formTypeCd: batch.formTypeCd,
      rows: batch.rows,
      results: batch.results,
      totalRows: batch.totalRows,
      jsonPath: `/pdf/Acknowledgement/${paths.publicDir}/${path.basename(paths.json)}`,
      xlsxPath: `/pdf/Acknowledgement/${paths.publicDir}/${path.basename(paths.xlsx)}`,
      message: `Done in ${elapsedSec}s. Form: ${formTypeCd}. Success: ${successCount}, Errors: ${errorCount}, Rows this run: ${batch.rows.length}, Total saved: ${batch.totalRows}`,
    })
  } catch (error) {
    console.error("[AckExtract] API Error:", error)
    return res.status(500).json({
      success: false,
      error:
        error instanceof Error ? error.message : "Failed to extract acknowledgement receipts",
    })
  }
})
