import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const GetUploadHistorySchema = z.object({
  skip: z.number().optional(),
  take: z.number().optional(),
  type: z.enum(["conso", "form16", "form16a", "challan_status", "justification"]).optional(),
  batchId: z.number().optional(),
  /** Optional status filter (e.g. "Failed" for retry views). */
  status: z.string().optional(),
})

export default resolver.pipe(
  resolver.zod(GetUploadHistorySchema),
  resolver.authorize(),
  async ({ skip = 0, take = 100, type, batchId, status }) => {
    const where: Record<string, unknown> = {}
    if (type) where.type = type
    if (batchId != null) where.batchId = batchId
    if (status) where.status = status

    const uploadHistory = await db.uploadHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    })

    const count = await db.uploadHistory.count({ where })

    return {
      uploadHistory,
      count,
      hasMore: skip + take < count,
    }
  }
)
