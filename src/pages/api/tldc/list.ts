import { withApiAuth } from "src/shared/http"
import db, { Prisma } from "db"
import { NextApiRequest, NextApiResponse } from "next"
import { normalizeTaxYear } from "src/scripts/fetchTldcDataNewAct"
import { sendTldcError, sendTldcException } from "src/tldc/errors"
import { serializeTldcRow, tldcActForFy } from "src/tldc/serialize"

const MAX_TAKE = 5000

/**
 * Client-facing read of stored TLDC certificates (old and new Act).
 * Body: { companyId? | tan?, fy?, act?: "old" | "new", certNumber?, pan?, isActive?, skip?, take? }
 * Dates are DD-MM-YYYY (IST); run fetch-data / update-data first to refresh from TRACES.
 */
export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, tan, fy, act, certNumber, pan, isActive, skip = 0, take = 1000 } =
      req.body || {}

    if (!companyId && !tan) {
      return sendTldcError(res, "LDC_INVALID_INPUT", "Provide companyId or tan")
    }
    if (act != null && act !== "old" && act !== "new") {
      return sendTldcError(res, "LDC_INVALID_INPUT", 'act must be "old" or "new"')
    }

    const company = await db.company.findFirst({
      where: companyId ? { id: parseInt(String(companyId), 10) } : { tan: String(tan) },
      select: { id: true, name: true, tan: true },
    })
    if (!company) {
      return sendTldcError(res, "LDC_COMPANY_NOT_FOUND")
    }

    const where: Prisma.TldcDataWhereInput = { companyId: company.id }
    if (fy) where.fy = { in: Array.from(new Set([String(fy), normalizeTaxYear(String(fy))])) }
    if (certNumber) where.certNumber = String(certNumber).toUpperCase()
    if (pan) where.pan = String(pan).toUpperCase()
    if (typeof isActive === "boolean") where.isActive = isActive

    const rows = await db.tldcData.findMany({
      where,
      orderBy: [{ fy: "desc" }, { certNumber: "asc" }],
    })
    // Act is derived from the FY, so filter after the query
    const filtered = act ? rows.filter((r) => tldcActForFy(r.fy) === act) : rows
    const takeNum = Math.min(Math.max(parseInt(String(take), 10) || 0, 1), MAX_TAKE)
    const skipNum = Math.max(parseInt(String(skip), 10) || 0, 0)

    return res.status(200).json({
      success: true,
      company,
      count: filtered.length,
      skip: skipNum,
      take: takeNum,
      records: filtered.slice(skipNum, skipNum + takeNum).map(serializeTldcRow),
    })
  } catch (error) {
    console.error("API Error (TLDC list):", error)
    return sendTldcException(res, error)
  }
})
