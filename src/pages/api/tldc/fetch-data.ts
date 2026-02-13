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
    const { tan, year, credentials, companyId } = req.body

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

    console.log(`API: Fetching TLDC data for TAN: ${tan}, Year: ${year}`)

    const result = await fetchTldcData({
      tan,
      year,
      credentials,
    })

    console.log("result", result)
    console.log("result.data", result.data)
    const tldcDataArr: any[] = []

    if (companyId && result.data?.extractedData && Array.isArray(result.data.extractedData)) {
      for (const data of result.data.extractedData) {
        console.log("Processing extracted data:", data)
        if (data.certNumber && data.din) {
          try {
            // Check if a record already exists by DIN (unique identifier)
            const existingRecord = await db.tldcData.findFirst({
              where: {
                certNumber: data.certNumber,
                fy: data.fy || year,
                companyId: parseInt(companyId),
              },
            })

            if (!existingRecord) {
              // Create a new record with the DIN
              const fyString = data.fy || `${year}-${(parseInt(year) + 1) % 100}`
              const tldcData = await db.tldcData.create({
                data: {
                  company: {
                    connect: { id: parseInt(companyId) },
                  },
                  certNumber: data.certNumber,
                  din: data.din, // Add DIN to the record
                  fy: fyString,
                  pan: data.pan || "",
                  isActive: true,
                  // Default values for other required fields
                  panName: data.panName || "",
                  section: data.section || "",
                  NatureOfPayment: data.NatureOfPayment || "",
                  tdsAmountLimit: data.tdsAmountLimit || "0",
                  tdsAmountConsumed: data.tdsAmountConsumed || "0",
                  tdsRate: data.tdsRate || "0",
                  validFrom: new Date(),
                  validTo: new Date(new Date().setFullYear(new Date().getFullYear() + 1)),
                },
              })
              tldcDataArr.push(tldcData)
              console.log(
                `✅ Created new TLDC data record for DIN: ${data.din}, Cert: ${data.certNumber}`
              )
            } else {
              // Update existing record
              const tldcData = await db.tldcData.update({
                where: { id: existingRecord.id },
                data: {
                  certNumber: data.certNumber,
                  pan: data.pan || existingRecord.pan,
                  panName: data.panName || existingRecord.panName,
                  updatedAt: new Date(),
                },
              })
              tldcDataArr.push(tldcData)
              console.log(
                `✅ Updated existing TLDC data record for DIN: ${data.din}, Cert: ${data.certNumber}`
              )
            }
          } catch (dbError) {
            console.error("Error saving TLDC data:", dbError)
          }
        }
      }
    }

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
      data: result.data,
      cached: result.cached || false,
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
