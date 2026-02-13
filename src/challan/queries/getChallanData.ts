import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const GetChallanDataSchema = z.object({
  where: z
    .object({
      companyId: z
        .union([z.number(), z.object({ in: z.array(z.number()) })])
        .optional(),
      assessmentYear: z.string().optional(),
      sectionCode: z.string().optional(),
      status: z.string().optional(),
    })
    .optional(),
  orderBy: z
    .object({
      createdAt: z.enum(["asc", "desc"]).optional(),
      updatedAt: z.enum(["asc", "desc"]).optional(),
      assessmentYear: z.enum(["asc", "desc"]).optional(),
    })
    .optional(),
  skip: z.number().optional(),
  take: z.number().optional(),
})

export default resolver.pipe(
  resolver.zod(GetChallanDataSchema),
  resolver.authorize(),
  async ({ where = {}, orderBy, skip = 0, take = 100 }) => {
    const challanData = await db.challanData.findMany({
      where,
      orderBy: orderBy || { updatedAt: "desc" },
      skip,
      take,
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

    const count = await db.challanData.count({ where })

    return { challanData, count }
  }
)

