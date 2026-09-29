import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "GET") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const companies = await db.company.findMany({
      where: { isTemporary: false },
      select: { id: true, name: true, tan: true },
      orderBy: { name: "asc" },
    })

    return res.status(200).json({
      success: true,
      count: companies.length,
      companies,
    })
  } catch (error: any) {
    console.error("Error listing companies:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to list companies",
    })
  }
})
