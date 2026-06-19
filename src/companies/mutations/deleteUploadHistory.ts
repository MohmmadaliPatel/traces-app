import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const DeleteUploadHistorySchema = z.object({
  ids: z.array(z.number()).min(1),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(DeleteUploadHistorySchema),
  async ({ ids }) => {
    const result = await db.uploadHistory.deleteMany({
      where: { id: { in: ids } },
    })

    return {
      success: true,
      deletedCount: result.count,
      message: `Deleted ${result.count} upload history record(s)`,
    }
  }
)
