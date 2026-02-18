import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const GetOutstandingDemandSchema = z.object({
  where: z.any().optional(),
  orderBy: z.any().optional(),
  skip: z.number().optional(),
  take: z.number().optional(),
})

export default resolver.pipe(
  resolver.zod(GetOutstandingDemandSchema),
  resolver.authorize(),
  async ({ where, orderBy, skip = 0, take = 100 }) => {
    const outstandingDemand = await db.outstandingDemand.findMany({
      where,
      orderBy,
      skip,
      take,
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

    const count = await db.outstandingDemand.count({ where })

    return {
      outstandingDemand,
      count,
    }
  }
)
