/**
 * Reconcile the persisted TRACES statement records into clause 34(b) rows and regenerate the
 * working paper. Fast — it reads what /api/clause-34b/fetch already stored.
 *
 * POST { financialYear, dateSource? }  →  { success, counts, rows, downloadUrl }
 */
import path from "path"
import type { NextApiRequest, NextApiResponse } from "next"
import { withApiAuth } from "src/shared/http"
import { buildClause34Rows, type DateSource } from "src/clause34/buildClause34Rows"
import { buildClause34cRows } from "src/clause34/build34cRows"
import { writeClause34Workbook } from "src/clause34/clause34Workbook"
import { fyLabel, formatDdMmYyyy, daysBetween } from "src/clause34/dueDates"

export const config = {
  api: { bodyParser: { sizeLimit: "1mb" }, responseLimit: false },
}

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  const { financialYear, dateSource } = req.body ?? {}
  const startYear = Number(financialYear)
  if (!Number.isFinite(startYear)) {
    return res
      .status(400)
      .json({ success: false, error: 'financialYear is required (start year, e.g. "2025")' })
  }

  try {
    const source: DateSource = dateSource === "conso" ? "conso" : "stmtstatus"
    const { rows, counts } = await buildClause34Rows({ startYear, dateSource: source })
    if (!rows.length) {
      return res.status(400).json({
        success: false,
        error: "No statement data found — fetch from TRACES first",
      })
    }

    // 34(c) is carried forward from the prepared workbook and re-verified where a conso file
    // is still held; loading tie-checks the totals and throws on drift.
    const clause34c = buildClause34cRows()

    const fileName = `Clause 34(b) and 34(c) - Continuum Group - FY ${fyLabel(
      startYear
    )} (verified).xlsx`
    const outputPath = path.join(process.cwd(), "public", "pdf", "clause34", fileName)
    await writeClause34Workbook({ rows, startYear, outputPath, clause34c })

    return res.status(200).json({
      success: true,
      counts,
      dateSource: source,
      clause34c: {
        totals: clause34c.totals,
        mismatches: clause34c.mismatches,
        entities: clause34c.entities.map((e) => ({
          tan: e.entity.tan,
          sheet: e.entity.sheet,
          liable: e.liable,
          payable: e.totalPayable,
          paid: e.totalPaid,
          computed: e.computedFromEntries,
          difference: e.difference,
          challans: e.rows.length,
          excluded: e.excluded.length,
          unverified: e.rows.filter((r) => !r.verifiedAgainstConso).length,
        })),
      },
      downloadUrl: `/api/file/pdf/clause34/${encodeURIComponent(fileName)}`,
      rows: rows.map((r) => ({
        entity: r.entity.name,
        sheet: r.entity.sheet,
        tan: r.entity.tan,
        formType: r.formType,
        quarter: r.quarter,
        dueDate: formatDdMmYyyy(r.dueDate),
        dateOfFurnishing: formatDdMmYyyy(r.dateOfFurnishing),
        workbookDate: formatDdMmYyyy(r.workbookDate),
        basis: r.basis,
        comparison: r.comparison,
        correctionCount: r.correctionCount,
        status: r.status,
        timeliness: r.dateOfFurnishing
          ? daysBetween(r.dueDate, r.dateOfFurnishing) <= 0
            ? "Within due date"
            : `Late by ${daysBetween(r.dueDate, r.dateOfFurnishing)} day(s)`
          : "Date not available",
        remarks: r.remarks,
      })),
    })
  } catch (error: any) {
    console.error("[clause34/build] failed:", error)
    return res.status(500).json({ success: false, error: String(error?.message || error) })
  }
})
