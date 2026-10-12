import { withApiAuth } from "src/shared/http"
import { unmaskPortalCredentials } from "src/shared/security/portalCredentials"
import db from "db"
import { NextApiRequest, NextApiResponse } from "next"
import { updateTldcDataNewAct } from "src/scripts/fetchTldcDataNewAct"
import { sendTldcError, sendTldcException, TldcWarning } from "src/tldc/errors"
import { serializeTldcRow } from "src/tldc/serialize"

/**
 * New Act TLDC update: refresh existing DB rows via child-certificate API.
 */
export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { tan, fy, credentials: rawCredentials, companyId, companyName, recordId } = req.body || {}
    // The UI sends a masked password; use the stored one for this company
    const credentials = await unmaskPortalCredentials(rawCredentials, { companyId, tan })

    if (
      !tan ||
      !credentials ||
      !credentials.userId ||
      !credentials.password ||
      !credentials.tan
    ) {
      return sendTldcError(res, "LDC_INVALID_INPUT", "Missing required parameters (tan, credentials)")
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
        data: { updated: 0, fetched: 0, records: [], warnings: [] },
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
    const warnings: TldcWarning[] = []
    const refreshed = new Set(rows.map((row) => row.certNumber.toUpperCase()))
    for (const record of records) {
      if (!refreshed.has(record.certNumber.toUpperCase())) {
        warnings.push({
          certNumber: record.certNumber,
          errorCode: "LDC_CERT_DETAIL_FAILED",
          message: "Certificate detail unavailable from TRACES; stored values left unchanged",
        })
      }
    }
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
          issueDate: row.issueDate ?? undefined,
          pdfPath: row.pdfPath ?? undefined,
          isActive: row.isActive,
        },
      })
      updated += result.count
    }

    const savedRecords = await db.tldcData.findMany({
      where: { id: { in: records.map((r) => r.id) } },
      orderBy: { certNumber: "asc" },
    })

    return res.status(200).json({
      success: true,
      message: `New Act TLDC updated ${updated} record(s)`,
      data: {
        updated,
        fetched: rows.length,
        records: savedRecords.map(serializeTldcRow),
        warnings,
      },
    })
  } catch (error) {
    console.error("API Error (New Act TLDC update):", error)
    return sendTldcException(res, error)
  }
})
