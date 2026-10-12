import db from "db"
import { unmaskPortalCredentials } from "src/shared/security/portalCredentials"
import { NextApiRequest, NextApiResponse } from "next"
import { fetchTldcData, processPdfFiles } from "src/scripts/fetchTldcData"
import { withApiAuth } from "src/shared/http"
import { updateTldcData } from "src/scripts/updateTldcData"
import { normalizeTaxYear } from "src/scripts/fetchTldcDataNewAct"
import { applyOldActVerificationRows } from "src/tldc/applyOldActVerification"
import { sendTldcError, sendTldcException, TldcWarning } from "src/tldc/errors"
import { serializeTldcRow } from "src/tldc/serialize"

/**
 * API endpoint to fetch TLDC data using Puppeteer
 * This keeps the Puppeteer code on the server side only
 */
export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { tan, year, credentials: rawCredentials, companyId, recordId } = req.body
    // The UI sends a masked password; use the stored one for this company
    const credentials = await unmaskPortalCredentials(rawCredentials, { companyId, tan })

    if (
      !tan ||
      !year ||
      !companyId ||
      !credentials ||
      !credentials.userId ||
      !credentials.password ||
      !credentials.tan
    ) {
      return sendTldcError(
        res,
        "LDC_INVALID_INPUT",
        "Missing required parameters (tan, year, companyId, credentials)"
      )
    }

    console.log(`API: Updating TLDC data for TAN: ${tan}, Year: ${year}`)

    // If recordId is provided, only update that specific record
    // Otherwise, update all records with empty panName for the company/FY
    const whereClause: any = {
      companyId: parseInt(companyId),
      // Accept the start year ("2024") or the stored FY label ("2024-25")
      fy: { in: Array.from(new Set([String(year), normalizeTaxYear(String(year))])) },
    }

    if (recordId) {
      whereClause.id = parseInt(recordId)
    } else {
      // Only update records with empty or missing panName
      whereClause.OR = [{ panName: "" }, { panName: null }]
    }

    const tldcDataArr = await db.tldcData.findMany({
      where: whereClause,
    })

    console.log(`TLDC rows to refresh: ${tldcDataArr.length}`)

    const updatedResult = await updateTldcData({
      year,
      tldcData: tldcDataArr,
      credentials,
    })

    // Update the TLDC data in the database with the detailed information from updatedResult
    const warnings: TldcWarning[] = updatedResult.data
      ? await applyOldActVerificationRows(parseInt(companyId), updatedResult.data)
      : []

    const savedRecords = await db.tldcData.findMany({
      where: { id: { in: tldcDataArr.map((r) => r.id) } },
      orderBy: { certNumber: "asc" },
    })

    return res.status(200).json({
      success: true,
      data: updatedResult.data,
      cached: updatedResult.cached || false,
      records: savedRecords.map(serializeTldcRow),
      warnings,
      message: "Successfully fetched TLDC data",
    })
  } catch (error) {
    console.error("API Error:", error)
    return sendTldcException(res, error)
  }
})
