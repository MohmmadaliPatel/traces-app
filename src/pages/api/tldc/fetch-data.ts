import { withApiAuth } from "src/shared/http"
import { unmaskPortalCredentials } from "src/shared/security/portalCredentials"
import db from "db"
import { NextApiRequest, NextApiResponse } from "next"
import { fetchTldcData, processPdfFiles } from "src/scripts/fetchTldcData"
import { updateTldcData } from "src/scripts/updateTldcData"
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
    const { tan, year, credentials: rawCredentials, companyId } = req.body
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
                  pdfPath: data.pdfPath || null,
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
                  pdfPath: data.pdfPath || existingRecord.pdfPath,
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
    const warnings: TldcWarning[] = updatedResult.data
      ? await applyOldActVerificationRows(parseInt(companyId), updatedResult.data)
      : []

    const savedRecords = await db.tldcData.findMany({
      where: { id: { in: tldcDataArr.map((r) => r.id) } },
      orderBy: { certNumber: "asc" },
    })

    return res.status(200).json({
      success: true,
      data: result.data,
      cached: result.cached || false,
      records: savedRecords.map(serializeTldcRow),
      warnings,
      message: "Successfully fetched TLDC data",
    })
  } catch (error) {
    console.error("API Error:", error)
    return sendTldcException(res, error)
  }
})
