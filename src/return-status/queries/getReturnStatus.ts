import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const GetReturnStatusSchema = z.object({
  where: z.any().optional(),
  orderBy: z.any().optional(),
  skip: z.number().optional(),
  take: z.number().optional(),
})

export default resolver.pipe(
  resolver.zod(GetReturnStatusSchema),
  resolver.authorize(),
  async ({ where, orderBy, skip = 0, take = 100 }) => {
    const returnStatus = await db.returnStatus.findMany({
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

    const count = await db.returnStatus.count({ where })

    return {
      returnStatus,
      count,
    }
  }
)
