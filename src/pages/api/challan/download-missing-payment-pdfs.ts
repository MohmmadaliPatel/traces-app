import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { downloadMissingPaymentHistoryPdfs } from "src/scripts/downloadChallanPayment"
import {
  analyzePaymentHistoryGaps,
  paymentHistoryContentJsonPath,
  paymentHistoryGapsJsonPath,
  type PaymentHistoryRowInput,
} from "src/challan/utils/paymentHistoryFiles"
import {
  auditPaymentPdfChallanStatusCoverage,
  saveChallanStatusCoverageReport,
} from "src/challan/utils/challanStatusExcel"
import fs from "fs"

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, incomeTaxAct, missing } = req.body

    if (!companyId) {
      return res.status(400).json({ error: "Missing company ID" })
    }

    // Default old act (matches prior API behavior when incomeTaxAct omitted)
    const resolvedAct: "old" | "new" = incomeTaxAct === "new" ? "new" : "old"

    const company = await db.company.findUnique({
      where: { id: parseInt(String(companyId), 10) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    const skipNewActRadio = resolvedAct !== "new"

    const missingRows: PaymentHistoryRowInput[] | undefined = Array.isArray(missing)
      ? missing
          .filter((r: any) => r && typeof r.cin === "string" && r.cin.length > 0)
          .map((r: any) => ({
            cin: String(r.cin),
            paymentTime: r.paymentTime ? String(r.paymentTime) : undefined,
            assessmentYear: r.assessmentYear ? String(r.assessmentYear) : undefined,
            paymentType: r.paymentType ? String(r.paymentType) : undefined,
            actType: r.actType ? String(r.actType) : undefined,
          }))
      : undefined

    const result = await downloadMissingPaymentHistoryPdfs(
      company.tan,
      company.it_password,
      company.name,
      {
        skipNewActRadio,
        // New Act: download all available PDFs without date filter
        skipDateFilter: resolvedAct === "new",
        ...(missingRows && resolvedAct === "old" ? { missing: missingRows } : {}),
      }
    )

    // Refresh gaps JSON after downloads
    const contentPath = paymentHistoryContentJsonPath(company.name)
    if (fs.existsSync(contentPath)) {
      const content = JSON.parse(fs.readFileSync(contentPath, "utf8")) as {
        payments?: Parameters<typeof analyzePaymentHistoryGaps>[1]
        fetchedAt?: string
      }
      if (content.payments) {
        const gaps = analyzePaymentHistoryGaps(company.name, content.payments)
        fs.writeFileSync(
          paymentHistoryGapsJsonPath(company.name),
          JSON.stringify(
            {
              fetchedAt: content.fetchedAt ?? new Date().toISOString(),
              companyName: company.name,
              summary: gaps.summary,
              missing: gaps.missing,
              present: gaps.present,
            },
            null,
            2
          ),
          "utf8"
        )
      }
    }

    const coverageReport = await auditPaymentPdfChallanStatusCoverage(company.name)
    saveChallanStatusCoverageReport(company.name, coverageReport)

    return res.status(200).json({
      success: true,
      companyName: company.name,
      incomeTaxAct: resolvedAct,
      result,
      gapsRefreshed: true,
      challanStatusCoverage: coverageReport,
    })
  } catch (error: any) {
    console.error("Error downloading missing payment PDFs:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to download missing payment PDFs",
    })
  }
})
