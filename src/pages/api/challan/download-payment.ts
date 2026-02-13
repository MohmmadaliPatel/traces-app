import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { downloadChallanPayments } from "src/scripts/downloadChallanPayment"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, fromDate, toDate, assessmentYear, paymentType } = req.body

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

    // Download challan payments with filters
    const result = await downloadChallanPayments(
      company.tan,
      company.it_password,
      company.name,
      fromDate,
      toDate,
      assessmentYear,
      paymentType
    )

    return res.status(200).json({ success: true, result })
  } catch (error: any) {
    console.error("Error downloading challan payments:", error)
    return res.status(500).json({
      error: error.message || "Failed to download challan payments",
    })
  }
}
