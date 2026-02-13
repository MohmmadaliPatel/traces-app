import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const GetTaskBatchSchema = z.object({
  skip: z.number().optional(),
  take: z.number().optional(),
  orderBy: z.any().optional(),
  taskSkip: z.number().optional(),
  taskTake: z.number().optional(),
  taskOrderBy: z.any().optional(),
  taskFilters: z
    .object({
      status: z.array(z.string()).optional(),
      companyName: z.array(z.string()).optional(),
    })
    .optional(),
})

export default resolver.pipe(
  resolver.zod(GetTaskBatchSchema),
  async ({
    skip = 0,
    take = 10,
    orderBy = { id: "desc" },
    taskSkip = 0,
    taskTake = 10,
    taskOrderBy = { id: "asc" },
    taskFilters = {},
  }) => {
    const tasksBatch = await db.taskBatch.findMany({
      skip,
      take,
      orderBy,
      include: {
        _count: {
          select: { Task: true },
        },
        Task: {
          skip: taskSkip,
          take: taskTake,
          orderBy: taskOrderBy,
          where: {
            ...(taskFilters.status && taskFilters.status.length > 0
              ? { status: { in: taskFilters.status } }
              : {}),
            ...(taskFilters.companyName && taskFilters.companyName.length > 0
              ? { company: { name: { in: taskFilters.companyName } } }
              : {}),
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
        },
      },
    })

    const count = await db.taskBatch.count()

    return {
      tasksBatch,
      count,
    }
  }
)
