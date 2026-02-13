import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { createChallan } from "src/scripts/createChallan"

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, assessmentYear, sections } = req.body

    if (!companyId || !assessmentYear || !sections || sections.length === 0) {
      return res.status(400).json({ error: "Missing required fields" })
    }

    // Get company details
    const company = await db.company.findUnique({
      where: { id: parseInt(companyId) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    // Create challans for each section
    const results = await createChallan({
      companyName: company.name,
      companyCode: companyId.toString(),
      username: company.tan,
      password: company.it_password,
      assessmentYear,
      sections,
    })

    // Update database with results
    for (const result of results) {
      if (result.success) {
        await db.challanData.upsert({
          where: {
            companyId_assessmentYear_sectionCode: {
              companyId: parseInt(companyId),
              assessmentYear,
              sectionCode: result.sectionCode,
            },
          },
          create: {
            company: { connect: { id: parseInt(companyId) } },
            assessmentYear,
            sectionCode: result.sectionCode,
            sectionDesc: result.sectionDesc,
            amount: result.amount,
            pymntRefNum: result.pymntRefNum,
            status: "created",
          },
          update: {
            amount: result.amount,
            pymntRefNum: result.pymntRefNum,
            status: "created",
          },
        })
      }
    }

    return res.status(200).json({ success: true, results })
  } catch (error: any) {
    console.error("Error creating challan:", error)
    return res.status(500).json({ error: error.message || "Failed to create challan" })
  }
}

