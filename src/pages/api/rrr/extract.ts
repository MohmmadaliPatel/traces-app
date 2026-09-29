import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { fetchRrrNumbersBatch } from "src/scripts/fetchRrrNumbers"

export const config = {
  api: {
    bodyParser: {
      sizeLimit: "2mb",
    },
    responseLimit: false,
  },
}

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method not allowed" })
  }

  const startedAt = Date.now()

  try {
    const { companyId, companyIds, formTypes, financialYears, quarters, concurrency } = req.body

    if (!formTypes?.length || !financialYears?.length || !quarters?.length) {
      return res.status(400).json({
        success: false,
        error: "formTypes, financialYears, and quarters are required",
      })
    }

    const ids: number[] = Array.isArray(companyIds)
      ? companyIds.map((id: any) => parseInt(String(id), 10)).filter((id: number) => !isNaN(id))
      : companyId
        ? [parseInt(String(companyId), 10)]
        : []

    if (ids.length === 0) {
      return res.status(400).json({
        success: false,
        error: "companyId or companyIds is required",
      })
    }

    console.log(`[RRR] API request companyIds=${ids.length}`, {
      formTypes,
      financialYears,
      quarters,
      concurrency,
    })

    const companies = await db.company.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        name: true,
        tan: true,
        it_password: true,
      },
    })

    if (companies.length === 0) {
      return res.status(404).json({ success: false, error: "No companies found" })
    }

    const companyById = new Map(companies.map((c) => [c.id, c]))
    const ordered = ids
      .map((id) => companyById.get(id))
      .filter((c): c is NonNullable<typeof c> => !!c)

    console.log(
      `[RRR] API resolved ${ordered.length} companies:`,
      ordered.map((c) => `${c.name} (${c.tan})`)
    )

    const batch = await fetchRrrNumbersBatch({
      companies: ordered,
      formTypes,
      financialYears,
      quarters,
      concurrency: typeof concurrency === "number" ? concurrency : 2,
    })

    const successCount = batch.results.filter((r) => r.success).length
    const errorCount = batch.results.length - successCount
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1)

    console.log(
      `[RRR] API finished in ${elapsedSec}s success=${successCount} errors=${errorCount} rows=${batch.rows.length}`
    )

    return res.status(200).json({
      success: errorCount === 0,
      rows: batch.rows,
      results: batch.results,
      totalRows: batch.totalRows,
      jsonPath: "/pdf/return/rrr-extract/rrr_extract.json",
      csvPath: "/pdf/return/rrr-extract/rrr_extract.csv",
      message: `Done in ${elapsedSec}s. Success: ${successCount}, Errors: ${errorCount}, Rows this run: ${batch.rows.length}, Total saved: ${batch.totalRows}`,
    })
  } catch (error) {
    console.error("[RRR] API Error:", error)
    return res.status(500).json({
      success: false,
      error: error instanceof Error ? error.message : "Failed to extract RRR numbers",
    })
  }
})
