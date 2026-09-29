import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { downloadCsiFiles } from "src/scripts/downloadChallanPayment"

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, fromDate, toDate, incomeTaxAct } = req.body

    if (!companyId) {
      return res.status(400).json({ error: "Missing company ID" })
    }
    if (!fromDate || !toDate) {
      return res.status(400).json({ error: "From date and to date are required for CSI download" })
    }

    const company = await db.company.findUnique({
      where: { id: parseInt(companyId) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    const skipNewActRadio = incomeTaxAct !== "new"

    const result = await downloadCsiFiles(
      company.tan,
      company.it_password,
      company.name,
      fromDate,
      toDate,
      { skipNewActRadio }
    )

    return res.status(200).json({ success: true, result })
  } catch (error: any) {
    console.error("Error downloading CSI files:", error)
    return res.status(500).json({
      error: error.message || "Failed to download CSI files",
    })
  }
})
