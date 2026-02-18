import db from "db"
import { NextApiRequest, NextApiResponse } from "next"
import { fetchTldcData, processPdfFiles } from "src/scripts/fetchTldcData"
import { updateTldcData } from "src/scripts/updateTldcData"

/**
 * API endpoint to fetch TLDC data using Puppeteer
 * This keeps the Puppeteer code on the server side only
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only allow POST requests
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { tan, year, credentials, companyId, recordId } = req.body

    if (
      !tan ||
      !year ||
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

    console.log(`API: Updating TLDC data for TAN: ${tan}, Year: ${year}`)

    // If recordId is provided, only update that specific record
    // Otherwise, update all records with empty panName for the company/FY
    const whereClause: any = {
      companyId: parseInt(companyId),
      fy: year,
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

    console.log("tldcDataArr", tldcDataArr)

    const updatedResult = await updateTldcData({
      year,
      tldcData: tldcDataArr,
      credentials,
    })

    // Update the TLDC data in the database with the detailed information from updatedResult
    if (companyId && updatedResult.data) {
      for (const data of updatedResult.data) {
        if (data.certNumber && data.pan) {
          try {
            // Find and update the existing TLDC data record
            await db.tldcData.updateMany({
              where: {
                companyId: parseInt(companyId),
                certNumber: data.certNumber,
                pan: data.pan,
              },
              data: {
                panName: data.panName || undefined,
                section: data.section || undefined,
                NatureOfPayment: data.NatureOfPayment || undefined,
                tdsAmountLimit: data.tdsAmountLimit || undefined,
                tdsAmountConsumed: data.tdsAmountConsumed || undefined,
                tdsRate: data.tdsRate || undefined,
                validFrom: data.validFrom ? new Date(data.validFrom) : undefined,
                validTo: data.validTo ? new Date(data.validTo) : undefined,
                cancelDate: data.cancelDate ? new Date(data.cancelDate) : undefined,
                updatedAt: new Date(),
              },
            })
            console.log(
              `✅ Updated TLDC data for certificate: ${data.certNumber}, PAN: ${data.pan}`
            )
          } catch (updateError) {
            console.error(
              `❌ Error updating TLDC data for certificate: ${data.certNumber}, PAN: ${data.pan}:`,
              updateError
            )
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: updatedResult.data,
      cached: updatedResult.cached || false,
      message: "Successfully fetched TLDC data",
    })
  } catch (error) {
    console.error("API Error:", error)
    return res.status(500).json({
      success: false,
      message: error instanceof Error ? error.message : "Unknown error occurred",
    })
  }
}
