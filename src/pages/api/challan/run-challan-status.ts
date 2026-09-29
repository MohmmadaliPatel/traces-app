import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import NoticeDownloaderChallanStatus from "src/jobs/NoticeDownloader-challanStatus"

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, onlyPaymentPdfNotInExcel = true, financialYears, mode } = req.body

    if (!companyId) {
      return res.status(400).json({ error: "Missing company ID" })
    }

    const company = await db.company.findUnique({
      where: { id: parseInt(String(companyId), 10) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    if (!company.user_id?.trim() || !company.password?.trim()) {
      return res.status(400).json({
        success: false,
        status: "Failed",
        error: "Company missing TRACES credentials (user_id / password)",
      })
    }

    const logger = {
      log: (message: string) => {
        console.log(`[run-challan-status][${company.name}] ${message}`)
      },
    }

    const targetFinancialYears = Array.isArray(financialYears)
      ? financialYears.map(String).filter(Boolean)
      : []

    const downloader = new NoticeDownloaderChallanStatus(company, logger, 0, {
      onlyPaymentPdfNotInExcel: onlyPaymentPdfNotInExcel !== false,
      targetFinancialYears,
      mode: mode === "list" ? "list" : "full",
    })

    const details =
      mode === "list"
        ? await downloader.scrapeUnconsumedListPuppeteer()
        : await downloader.queryChallanStatusPuppeteer()

    const status =
      details && typeof details === "object" && (details as { success?: boolean }).success === false
        ? "Failed"
        : "Completed"

    return res.status(200).json({
      success: status === "Completed",
      status,
      companyName: company.name,
      tan: company.tan,
      details,
    })
  } catch (error: any) {
    console.error("Error running challan status:", error)
    return res.status(500).json({
      success: false,
      status: "Failed",
      error: error.message || "Failed to run challan status",
    })
  }
})
