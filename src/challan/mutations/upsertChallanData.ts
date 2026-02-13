import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const UpsertChallanDataSchema = z.object({
  id: z.number().optional(),
  companyId: z.number(),
  assessmentYear: z.string(),
  sectionCode: z.string(),
  sectionDesc: z.string(),
  amount: z.string(),
  pymntRefNum: z.string().optional().nullable(),
  status: z.string().optional(),
  filePath: z.string().optional().nullable(),
})

export default resolver.pipe(
  resolver.zod(UpsertChallanDataSchema),
  resolver.authorize(),
  async ({ id, companyId, ...data }) => {
    const challanData = await db.challanData.upsert({
      where: { id: id ?? -1 },
      create: {
        ...data,
        company: { connect: { id: companyId } },
      },
      update: {
        ...data,
        company: { connect: { id: companyId } },
      },
      include: {
        company: {
          select: {
            id: true,
            name: true,
            tan: true,
            user_id: true,
          },
        },
      },
    })

    return challanData
  }
)

