/**
 * Pull TRACES "Statement Filed Status" for ONE company.
 *
 * One company per request on purpose: a TRACES login plus 16 servlet calls takes about a
 * minute, so a 20-company sweep in a single request would exceed any sensible HTTP timeout.
 * The page loops companies and shows progress, the same way /return-status does.
 *
 * POST { tan, financialYear }  →  { success, rows, originals, emptyCombinations, failedCombinations }
 */
import type { NextApiRequest, NextApiResponse } from "next"
import { withApiAuth } from "src/shared/http"
import { fetchStatementStatusBatch } from "src/clause34/fetchStatementStatus"

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" }, responseLimit: false },
}

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  const { tan, financialYear } = req.body ?? {}
  if (!tan || typeof tan !== "string") {
    return res.status(400).json({ success: false, error: "tan is required" })
  }
  if (!financialYear || typeof financialYear !== "string") {
    return res
      .status(400)
      .json({ success: false, error: 'financialYear is required (start year, e.g. "2025")' })
  }

  try {
    const [result] = await fetchStatementStatusBatch({
      tans: [tan.toUpperCase()],
      financialYear,
    })
    if (!result) {
      return res.status(500).json({ success: false, error: "No result returned" })
    }

    const originals = result.rows.filter((r) => /regular/i.test(r.stmnttype || "")).length
    return res.status(200).json({
      success: result.success,
      tan: result.tan,
      companyName: result.companyName,
      rows: result.rows.length,
      originals,
      emptyCombinations: result.emptyCombinations,
      failedCombinations: result.failedCombinations,
      error: result.error,
    })
  } catch (error: any) {
    console.error("[clause34/fetch] failed:", error)
    return res.status(500).json({ success: false, error: String(error?.message || error) })
  }
})
