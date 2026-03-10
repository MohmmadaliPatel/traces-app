import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const GetUploadHistorySchema = z.object({
  skip: z.number().optional(),
  take: z.number().optional(),
  type: z.enum(["conso", "form16", "form16a", "challan_status", "justification"]).optional(),
  batchId: z.number().optional(),
})

export default resolver.pipe(
  resolver.zod(GetUploadHistorySchema),
  async ({ skip = 0, take = 100, type, batchId }) => {
    const where:any = type ? { type } : {}
    if (batchId) {
      where.batchId = {
        equals: 16,
      }
      where.status = {
        equals: "Failed",
      }
    }
    const uploadHistory = await db.uploadHistory.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take,
    })

    // Log only company names
    console.log("Company Names:",uploadHistory.length, uploadHistory.map((u) => u.companyName))


    const count = await db.uploadHistory.count({ where })

    return {
      uploadHistory,
      count,
      hasMore: skip + take < count,
    }
  }
)
