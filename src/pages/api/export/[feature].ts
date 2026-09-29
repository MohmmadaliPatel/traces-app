import { withApiAuth } from "src/shared/http"
import type { NextApiRequest, NextApiResponse } from "next"
import {
  buildFeatureTable,
  isExportFeature,
  isExportFormat,
  sendExport,
  type ExportFilters,
} from "src/shared/export"

export const config = {
  api: {
    responseLimit: false,
  },
}

function parseOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === "") return undefined
  const n = Number(value)
  return Number.isFinite(n) ? n : undefined
}

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  const rawFeature = String(req.query.feature || "")
  if (!isExportFeature(rawFeature)) {
    return res.status(400).json({
      success: false,
      error: `Unknown feature "${rawFeature}". Supported: tldc, ldc-utilisation, outstanding-demand, return-status, rrr, form140, deductee-masters`,
    })
  }

  const format = req.body?.format
  if (!isExportFormat(format)) {
    return res.status(400).json({
      success: false,
      error: 'Invalid or missing format. Use "xlsx", "csv", or "pdf".',
    })
  }

  const filters: ExportFilters = {
    companyId: parseOptionalNumber(req.body?.companyId),
    fy: req.body?.fy ? String(req.body.fy).trim() : undefined,
    search: req.body?.search ? String(req.body.search).trim() : undefined,
    formTypeCd: req.body?.formTypeCd === "F26Q" ? "F26Q" : "T140",
  }

  try {
    const table = await buildFeatureTable(rawFeature, filters)
    if (table.rows.length === 0) {
      return res.status(404).json({
        success: false,
        error: "No data to export for the selected filters",
      })
    }
    await sendExport(res, table, format)
  } catch (error: any) {
    console.error(`Export error (${rawFeature}/${format}):`, error)
    return res.status(500).json({
      success: false,
      error: error?.message || "Failed to export data",
    })
  }
})
