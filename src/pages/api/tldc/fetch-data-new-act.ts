import { withApiAuth } from "src/shared/http"
import { unmaskPortalCredentials } from "src/shared/security/portalCredentials"
import db from "db"
import { NextApiRequest, NextApiResponse } from "next"
import { fetchTldcDataNewAct } from "src/scripts/fetchTldcDataNewAct"
import { sendTldcError, sendTldcException, TldcWarning } from "src/tldc/errors"
import { serializeTldcRow } from "src/tldc/serialize"

/**
 * New Act TLDC fetch:
 * searchDeductor → download ready PDFs → initiate (default: only if no requests;
 * forceInitiate: always) → download again → parse → child-certificate → upsert
 */
export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const {
      tan,
      fy,
      credentials: rawCredentials,
      companyId,
      companyName,
      initiateIfNoRequest = true,
      forceInitiate = false,
      initiateMissing,
    } = req.body || {}
    // The UI sends a masked password; use the stored one for this company
    const credentials = await unmaskPortalCredentials(rawCredentials, { companyId, tan })

    if (
      !tan ||
      !fy ||
      !companyId ||
      !credentials ||
      !credentials.userId ||
      !credentials.password ||
      !credentials.tan
    ) {
      return sendTldcError(
        res,
        "LDC_INVALID_INPUT",
        "Missing required parameters (tan, fy, companyId, credentials)"
      )
    }

    const companyIdNum = parseInt(String(companyId), 10)
    const name =
      companyName ||
      (await db.company.findUnique({ where: { id: companyIdNum }, select: { name: true } }))
        ?.name ||
      tan

    console.log(
      `API: New Act TLDC fetch TAN=${tan} FY=${fy} companyId=${companyIdNum} initiateIfNoRequest=${Boolean(
        initiateIfNoRequest
      )} forceInitiate=${Boolean(forceInitiate)}`
    )

    const result = await fetchTldcDataNewAct({
      companyName: name,
      tan,
      fy,
      credentials,
      initiateIfNoRequest: initiateIfNoRequest !== false,
      forceInitiate: Boolean(forceInitiate),
      initiateMissing:
        typeof initiateMissing === "boolean" ? initiateMissing : undefined,
    })

    let created = 0
    let updated = 0
    const savedIds: number[] = []
    const warnings: TldcWarning[] = []

    for (const row of result.rows) {
      if (!row.certNumber) continue
      if (row.source === "searchDeductor") {
        warnings.push({
          certNumber: row.certNumber,
          errorCode: "LDC_CERT_DETAIL_FAILED",
          message: "Certificate detail unavailable; saved from search results only",
        })
      }
      try {
        const existing = await db.tldcData.findFirst({
          where: {
            companyId: companyIdNum,
            certNumber: row.certNumber,
            fy: row.fy,
          },
        })

        if (!existing) {
          const createdRow = await db.tldcData.create({
            data: {
              company: { connect: { id: companyIdNum } },
              certNumber: row.certNumber,
              din: row.din || "",
              fy: row.fy,
              pan: row.pan || "",
              panName: row.panName || "",
              section: row.section || "",
              NatureOfPayment: row.NatureOfPayment || "",
              tdsAmountLimit: row.tdsAmountLimit || "0",
              tdsAmountConsumed: row.tdsAmountConsumed || "0",
              tdsRate: row.tdsRate || "0",
              validFrom: row.validFrom,
              validTo: row.validTo,
              issueDate: row.issueDate,
              cancelDate: row.cancelDate,
              pdfPath: row.pdfPath ?? null,
              isActive: row.isActive,
            },
          })
          savedIds.push(createdRow.id)
          created++
        } else {
          await db.tldcData.update({
            where: { id: existing.id },
            data: {
              din: row.din || existing.din,
              pan: row.pan || existing.pan,
              panName: row.panName || existing.panName,
              section: row.section || existing.section,
              NatureOfPayment: row.NatureOfPayment || existing.NatureOfPayment,
              tdsAmountLimit: row.tdsAmountLimit || existing.tdsAmountLimit,
              tdsAmountConsumed: row.tdsAmountConsumed || existing.tdsAmountConsumed,
              tdsRate: row.tdsRate || existing.tdsRate,
              validFrom: row.validFrom,
              validTo: row.validTo,
              issueDate: row.issueDate ?? existing.issueDate,
              cancelDate: row.cancelDate,
              pdfPath: row.pdfPath ?? existing.pdfPath,
              isActive: row.isActive,
            },
          })
          savedIds.push(existing.id)
          updated++
        }
      } catch (dbError) {
        console.error(`DB error for ${row.certNumber}:`, dbError)
      }
    }

    const savedRecords = await db.tldcData.findMany({
      where: { id: { in: savedIds } },
      orderBy: { certNumber: "asc" },
    })

    return res.status(200).json({
      success: true,
      message: `New Act TLDC: ${created} created, ${updated} updated, ${result.missingCertNumbers.length} missing in PDFs${
        result.initiated.length ? `, ${result.initiated.length} initiate attempted` : ""
      }`,
      data: {
        created,
        updated,
        searchCount: result.certificatesFromSearch.length,
        downloadedPdfs: result.downloadedPdfs.length,
        parsedPdfs: result.parsedPdfs,
        missingCertNumbers: result.missingCertNumbers,
        initiated: result.initiated,
        pdfDir: result.pdfDir,
        records: savedRecords.map(serializeTldcRow),
        warnings,
      },
    })
  } catch (error) {
    console.error("API Error (New Act TLDC fetch):", error)
    return sendTldcException(res, error)
  }
})
