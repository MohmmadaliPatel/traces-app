import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const UpsertTldcDataSchema = z.object({
  id: z.number().optional(),
  companyId: z.number(),
  din: z.string(),
  certNumber: z.string(),
  fy: z.string(),
  pan: z.string(),
  panName: z.string(),
  section: z.string(),
  NatureOfPayment: z.string(),
  tdsAmountLimit: z.string(),
  tdsAmountConsumed: z.string(),
  tdsRate: z.string(),
  validFrom: z.date(),
  validTo: z.date(),
  cancelDate: z.date().optional().nullable(),
  isActive: z.boolean().default(true),
})

export default resolver.pipe(
  resolver.zod(UpsertTldcDataSchema),
  resolver.authorize(),
  async ({ id, companyId, ...data }) => {
    const tldcData = await db.tldcData.upsert({
      where: { id: id ?? -1 },
      create: {
        company: {
          connect: { id: companyId },
        },
        ...data,
        din: data.din || "",
      },
      update: {
        ...data,
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
