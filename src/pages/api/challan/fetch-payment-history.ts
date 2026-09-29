import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { fetchPaymentHistory } from "src/scripts/fetchPaymentHistory"

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, financialYears, acts, actType } = req.body

    if (!companyId) {
      return res.status(400).json({ error: "Missing company ID" })
    }

    const company = await db.company.findUnique({
      where: { id: parseInt(String(companyId), 10) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    const parsedActs = Array.isArray(acts)
      ? (acts.filter((a: string) => a === "O" || a === "N") as Array<"O" | "N">)
      : undefined

    const parsedFinancialYears = Array.isArray(financialYears)
      ? financialYears.map(String)
      : undefined

    const result = await fetchPaymentHistory({
      tan: company.tan,
      itPassword: company.it_password,
      companyName: company.name,
      actType: actType === "O" || actType === "N" ? actType : undefined,
      acts: parsedActs,
      financialYears: parsedFinancialYears,
    })

    return res.status(200).json({
      success: true,
      companyName: company.name,
      tan: company.tan,
      financialYears: result.financialYears,
      payments: result.payments,
      gaps: result.gaps,
      contentJsonPath: result.contentJsonPath,
      gapsJsonPath: result.gapsJsonPath,
    })
  } catch (error: any) {
    console.error("Error fetching payment history:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to fetch payment history",
    })
  }
})
