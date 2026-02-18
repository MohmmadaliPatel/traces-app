import { NextApiRequest, NextApiResponse } from "next"
import { fetchReturnStatus } from "src/scripts/fetchReturnStatus"
import db from "db"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, credentials, financialYears, quarters, formTypes } = req.body

    if (
      !companyId ||
      !credentials ||
      !credentials.userId ||
      !credentials.password ||
      !credentials.tan ||
      !financialYears ||
      !quarters ||
      !formTypes
    ) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      })
    }

    console.log(
      `API: Fetching return status for company ID: ${companyId}, FY: ${financialYears}, Q: ${quarters}, Forms: ${formTypes}`
    )

    const result = await fetchReturnStatus({
      credentials,
      financialYears,
      quarters,
      formTypes,
    })

    if (!result.data || result.data.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No data received from portal",
      })
    }

    // Save to database
    const saved:any = []
    const updated:any = []
    const errors:any = []

    for (const item of result.data) {
      if (!item.data || !item.data.rows) continue

      for (const row of item.data.rows) {
        try {
          const existing = await db.returnStatus.findUnique({
            where: {
              companyId_finyear_quarter_formtype_tokenno: {
                companyId: parseInt(companyId),
                finyear: row.finyear,
                quarter: row.quarter,
                formtype: row.formtype,
                tokenno: row.tokenno,
              },
            },
          })

          if (existing) {
            const updatedRecord = await db.returnStatus.update({
              where: {
                companyId_finyear_quarter_formtype_tokenno: {
                  companyId: parseInt(companyId),
                  finyear: row.finyear,
                  quarter: row.quarter,
                  formtype: row.formtype,
                  tokenno: row.tokenno,
                },
              },
              data: {
                dtoffiling: row.dtoffiling || "",
                status: row.status || "",
                dtofprcng: row.dtofprcng || "",
                stmnttype: row.stmnttype || "",
                remarks: row.remarks || null,
                reason: row.reason || null,
                rejectionMsg: row.rejectionMsg || "",
              },
            })
            updated.push(updatedRecord)
          } else {
            const created = await db.returnStatus.create({
              data: {
                companyId: parseInt(companyId),
                finyear: row.finyear,
                quarter: row.quarter,
                formtype: row.formtype,
                tokenno: row.tokenno,
                dtoffiling: row.dtoffiling || "",
                status: row.status || "",
                dtofprcng: row.dtofprcng || "",
                stmnttype: row.stmnttype || "",
                remarks: row.remarks || null,
                reason: row.reason || null,
                rejectionMsg: row.rejectionMsg || "",
              },
            })
            saved.push(created)
          }
        } catch (error: any) {
          console.error(`Error saving return status:`, error)
          errors.push({
            tokenno: row.tokenno,
            error: error.message,
          })
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: result.data,
      saved: saved.length,
      updated: updated.length,
      errors: errors.length,
      message: `Successfully fetched and saved return status data. Saved: ${saved.length}, Updated: ${updated.length}`,
    })
  } catch (error) {
    console.error("API Error:", error)
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    })
  }
}
