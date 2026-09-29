import { withApiAuth } from "src/shared/http"
import db from "db"
import { NextApiRequest, NextApiResponse } from "next"
import { updateTldcDataNewAct } from "src/scripts/fetchTldcDataNewAct"

/**
 * New Act TLDC update: refresh existing DB rows via child-certificate API.
 */
export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { tan, fy, credentials, companyId, companyName, recordId } = req.body || {}

    if (
      !tan ||
      !credentials ||
      !credentials.userId ||
      !credentials.password ||
      !credentials.tan
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      })
    }

    const companyIdNum = companyId != null ? parseInt(String(companyId), 10) : undefined

    const where: any = {}
    if (recordId != null) {
      where.id = parseInt(String(recordId), 10)
    } else {
      if (companyIdNum != null) where.companyId = companyIdNum
      if (fy) where.fy = String(fy)
    }

    const records = await db.tldcData.findMany({
      where,
      select: { id: true, certNumber: true, pan: true, fy: true },
    })

    if (records.length === 0) {
      return res.status(200).json({
        success: true,
        message: "No TLDC records found to update",
        data: { updated: 0 },
      })
    }

    const name =
      companyName ||
      (companyIdNum != null
        ? (
            await db.company.findUnique({
              where: { id: companyIdNum },
              select: { name: true },
            })
          )?.name
        : undefined)

    const rows = await updateTldcDataNewAct({
      tan,
      credentials,
      records,
      companyName: name,
    })

    let updated = 0
    for (const row of rows) {
      if (!row.certNumber) continue
      const result = await db.tldcData.updateMany({
        where: {
          ...(companyIdNum != null ? { companyId: companyIdNum } : {}),
          certNumber: row.certNumber,
          fy: row.fy,
        },
        data: {
          din: row.din || undefined,
          pan: row.pan || undefined,
          panName: row.panName || undefined,
          section: row.section || undefined,
          NatureOfPayment: row.NatureOfPayment || undefined,
          tdsAmountLimit: row.tdsAmountLimit || undefined,
          tdsAmountConsumed: row.tdsAmountConsumed || undefined,
          tdsRate: row.tdsRate || undefined,
          validFrom: row.validFrom,
          validTo: row.validTo,
          isActive: row.isActive,
        },
      })
      updated += result.count
    }

    return res.status(200).json({
      success: true,
      message: `New Act TLDC updated ${updated} record(s)`,
      data: { updated, fetched: rows.length },
    })
  } catch (error) {
    console.error("API Error (New Act TLDC update):", error)
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    })
  }
})
