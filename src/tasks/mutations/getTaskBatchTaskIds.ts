import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const GetTaskBatchTaskIdsSchema = z.object({
  batchId: z.number(),
  statusFilter: z.array(z.string()).optional(),
  companyNameFilter: z.array(z.string()).optional(),
})

export default resolver.pipe(
  resolver.zod(GetTaskBatchTaskIdsSchema),
  async ({ batchId, statusFilter, companyNameFilter }) => {
    const tasks = await db.task.findMany({
      where: {
        BatchID: batchId,
        ...(statusFilter && statusFilter.length > 0 ? { status: { in: statusFilter } } : {}),
        ...(companyNameFilter && companyNameFilter.length > 0
          ? { company: { name: { in: companyNameFilter } } }
          : {}),
      },
      select: {
        id: true,
        companyId: true,
      },
    })

    return {
      taskIds: tasks.map((t) => t.id),
      companyIds: tasks.map((t) => t.companyId),
    }
  }
)
