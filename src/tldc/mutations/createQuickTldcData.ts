import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const CreateQuickTldcDataSchema = z.object({
  companyId: z.number(),
  certNumber: z.string(),
  pan: z.string(),
  fy: z.string(),
})

export default resolver.pipe(
  resolver.zod(CreateQuickTldcDataSchema),
  resolver.authorize(),
  async ({ companyId, certNumber, pan, fy }) => {
    // Check if record already exists
    const existing = await db.tldcData.findFirst({
      where: {
        companyId,
        certNumber,
        fy,
      },
    })

    if (existing) {
      throw new Error("TLDC record with this certificate number and financial year already exists for this company")
    }

    // Create with minimal fields - other fields will be populated by update
    const tldcData = await db.tldcData.create({
      data: {
        company: {
          connect: { id: companyId },
        },
        certNumber,
        pan,
        fy,
        din: "",
        panName: "",
        section: "",
        NatureOfPayment: "",
        tdsAmountLimit: "",
        tdsAmountConsumed: "",
        tdsRate: "",
        validFrom: new Date(),
        validTo: new Date(),
        isActive: true,
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            tan: true,
          },
        },
      },
    })
    return tldcData
  }
)
