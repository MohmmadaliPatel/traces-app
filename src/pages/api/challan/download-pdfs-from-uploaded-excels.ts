import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { downloadChallanPayments } from "src/scripts/downloadChallanPayment"
import {
  buildDepositDatesFilterRange,
  incomeTaxActForDepositDate,
} from "src/challan/utils/paymentHistoryFiles"
import type { PaymentUnconsumedRow } from "src/shared/excel/paymentUnconsumed"

type UploadRow = PaymentUnconsumedRow

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { rows } = req.body as { rows?: UploadRow[] }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ error: "No Excel rows provided" })
    }

    // Group by TAN
    const byTan = new Map<string, UploadRow[]>()
    for (const row of rows) {
      const tan = String(row.tan || "")
        .trim()
        .toUpperCase()
      const dateOfDeposit = String(row.dateOfDeposit || "").trim()
      if (!tan || !dateOfDeposit) continue
      const list = byTan.get(tan) || []
      list.push({ ...row, tan, dateOfDeposit })
      byTan.set(tan, list)
    }

    if (byTan.size === 0) {
      return res.status(400).json({
        error: "No valid rows with TAN and Date of Deposit found",
      })
    }

    const results: Array<{
      tan: string
      companyName?: string
      success: boolean
      error?: string
      rowCount: number
      fromDate?: string
      toDate?: string
      acts?: string[]
      downloaded?: unknown
    }> = []

    for (const [tan, tanRows] of byTan) {
      const company = await db.company.findFirst({
        where: { tan },
      })

      if (!company) {
        results.push({
          tan,
          companyName: tanRows[0]?.companyName,
          success: false,
          error: `Company not found for TAN ${tan}`,
          rowCount: tanRows.length,
        })
        continue
      }

      if (!company.it_password?.trim()) {
        results.push({
          tan,
          companyName: company.name,
          success: false,
          error: "Company missing IT password",
          rowCount: tanRows.length,
        })
        continue
      }

      const dates = tanRows.map((r) => r.dateOfDeposit)

      // On/before 30-Apr-2026 → Old Act; after → New Act (separate date ranges per act)
      const datesByAct: Record<"old" | "new", string[]> = { old: [], new: [] }
      for (const d of dates) {
        datesByAct[incomeTaxActForDepositDate(d)].push(d)
      }

      const acts = (["old", "new"] as const).filter((act) => datesByAct[act].length > 0)
      if (acts.length === 0) {
        results.push({
          tan,
          companyName: company.name,
          success: false,
          error: "Could not parse Date of Deposit values",
          rowCount: tanRows.length,
        })
        continue
      }

      const actResults: unknown[] = []
      try {
        for (const act of acts) {
          const range = buildDepositDatesFilterRange(datesByAct[act])
          if (!range) {
            throw new Error(`Could not parse Date of Deposit values for ${act} act`)
          }
          const downloaded = await downloadChallanPayments(
            company.tan,
            company.it_password,
            company.name,
            range.fromDate,
            range.toDate,
            undefined,
            undefined,
            { skipNewActRadio: act !== "new" }
          )
          actResults.push({
            act,
            fromDate: range.fromDate,
            toDate: range.toDate,
            rowCount: datesByAct[act].length,
            downloaded,
          })
        }

        const overallRange = buildDepositDatesFilterRange(dates)
        results.push({
          tan,
          companyName: company.name,
          success: true,
          rowCount: tanRows.length,
          fromDate: overallRange?.fromDate,
          toDate: overallRange?.toDate,
          acts: [...acts],
          downloaded: actResults,
        })
      } catch (err: any) {
        const overallRange = buildDepositDatesFilterRange(dates)
        results.push({
          tan,
          companyName: company.name,
          success: false,
          error: err?.message || "Download failed",
          rowCount: tanRows.length,
          fromDate: overallRange?.fromDate,
          toDate: overallRange?.toDate,
          acts: [...acts],
        })
      }
    }

    const successCount = results.filter((r) => r.success).length
    return res.status(200).json({
      success: successCount > 0,
      companies: byTan.size,
      successCount,
      failedCount: results.length - successCount,
      results,
    })
  } catch (error: any) {
    console.error("Error downloading PDFs from uploaded Excels:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to download PDFs from uploaded Excels",
    })
  }
})
