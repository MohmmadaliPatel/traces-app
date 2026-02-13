import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { downloadChallans } from "src/scripts/downloadChallan"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId } = req.body

    if (!companyId) {
      return res.status(400).json({ error: "Missing company ID" })
    }

    // Get company details
    const company = await db.company.findUnique({
      where: { id: parseInt(companyId) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    // Download challans
    const result = await downloadChallans(
      company.tan,
      company.it_password,
      company.name,
    )

    return res.status(200).json({ success: true, result })
  } catch (error: any) {
    console.error("Error downloading challan:", error)
    return res.status(500).json({ error: error.message || "Failed to download challan" })
  }
}

