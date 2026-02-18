import { NextApiRequest, NextApiResponse } from "next"
import { fetchOutstandingDemand } from "src/scripts/fetchOutstandingDemand"
import db from "db"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, credentials } = req.body

    if (!companyId || !credentials || !credentials.userId || !credentials.password || !credentials.tan) {
      return res.status(400).json({
        success: false,
        message: "Missing required parameters",
      })
    }

    console.log(`API: Fetching outstanding demand for company ID: ${companyId}`)

    const result = await fetchOutstandingDemand({ credentials })

    if (!result.data || !result.data.rows) {
      return res.status(400).json({
        success: false,
        message: "No data received from portal",
      })
    }

    // Combine main data with prior years data
    let allRows = [...result.data.rows]

    // Remove "Prior Years" entry (fin: 1) and add actual prior years data
    allRows = allRows.filter((row: any) => row.fin !== 1)

    if (result.priorYearsData && result.priorYearsData.rows) {
      allRows = [...allRows, ...result.priorYearsData.rows]
    }

    // Save to database
    const saved:any = []
    const updated:any = []
    const errors:any = []

    for (const row of allRows) {
      try {
        const existing = await db.outstandingDemand.findUnique({
          where: {
            companyId_finYr: {
              companyId: parseInt(companyId),
              finYr: row.finYr,
            },
          },
        })

        if (existing) {
          const updatedRecord = await db.outstandingDemand.update({
            where: {
              companyId_finYr: {
                companyId: parseInt(companyId),
                finYr: row.finYr,
              },
            },
            data: {
              fin: String(row.fin),
              aodmnd: row.aodmnd || "0.00",
              cpcdmd: row.cpcdmd || "0.00",
            },
          })
          updated.push(updatedRecord)
        } else {
          const created = await db.outstandingDemand.create({
            data: {
              companyId: parseInt(companyId),
              finYr: row.finYr,
              fin: String(row.fin),
              aodmnd: row.aodmnd || "0.00",
              cpcdmd: row.cpcdmd || "0.00",
            },
          })
          saved.push(created)
        }
      } catch (error: any) {
        console.error(`Error saving demand for ${row.finYr}:`, error)
        errors.push({
          finYr: row.finYr,
          error: error.message,
        })
      }
    }

    return res.status(200).json({
      success: true,
      data: allRows,
      saved: saved.length,
      updated: updated.length,
      errors: errors.length,
      message: `Successfully fetched and saved outstanding demand data. Saved: ${saved.length}, Updated: ${updated.length}`,
    })
  } catch (error) {
    console.error("API Error:", error)
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    })
  }
}
