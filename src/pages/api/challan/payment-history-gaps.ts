import { withApiAuth } from "src/utils/apiAuth"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { readCachedPaymentHistoryGaps } from "src/scripts/fetchPaymentHistory"
import {
  auditPaymentPdfChallanStatusCoverage,
  loadChallanStatusCoverageReport,
  lookupCoverageByCin,
  saveChallanStatusCoverageReport,
} from "src/challan/utils/challanStatusExcel"

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const companyId = req.query.companyId

    if (!companyId) {
      return res.status(400).json({ error: "Missing companyId query parameter" })
    }

    const company = await db.company.findUnique({
      where: { id: parseInt(String(companyId), 10) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    const cached = readCachedPaymentHistoryGaps(company.name)

    const refreshCoverage = req.query.refreshCoverage === "true"
    let challanStatusCoverage = loadChallanStatusCoverageReport(company.name)
    if (refreshCoverage) {
      challanStatusCoverage = await auditPaymentPdfChallanStatusCoverage(company.name)
      saveChallanStatusCoverageReport(company.name, challanStatusCoverage)
    }

    const enrichRow = (row: Record<string, unknown>) => {
      const cin = String(row.cin ?? "")
      const pdfExists = Boolean(row.pdfExists)
      let challanStatusInExcel: boolean | null = null
      if (pdfExists && cin) {
        const found = lookupCoverageByCin(challanStatusCoverage, cin)
        challanStatusInExcel = found === undefined ? null : found
      }
      return { ...row, challanStatusInExcel }
    }

    if (!cached.content && !cached.gaps) {
      return res.status(200).json({
        success: true,
        cached: false,
        companyName: company.name,
        tan: company.tan,
        message: "No cached payment history. Use Fetch from portal first.",
        payments: [],
        gaps: null,
        challanStatusCoverage,
      })
    }

    const allRows = (cached.gaps?.all ?? cached.content?.payments ?? []).map((r) =>
      enrichRow(r as Record<string, unknown>)
    )
    const gaps = cached.gaps
      ? {
          ...cached.gaps,
          all: allRows,
          missing: (cached.gaps.missing ?? []).map((r) => enrichRow(r as Record<string, unknown>)),
          present: (cached.gaps.present ?? []).map((r) => enrichRow(r as Record<string, unknown>)),
        }
      : null

    return res.status(200).json({
      success: true,
      cached: true,
      companyName: company.name,
      tan: company.tan,
      fetchedAt: cached.gaps?.fetchedAt ?? cached.content?.fetchedAt,
      payments: cached.content?.payments ?? [],
      gaps,
      challanStatusCoverage,
    })
  } catch (error: any) {
    console.error("Error reading payment history gaps:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to read payment history gaps",
    })
  }
})
