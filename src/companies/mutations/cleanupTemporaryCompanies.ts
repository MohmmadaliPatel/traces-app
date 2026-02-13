import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const CleanupTemporaryCompaniesSchema = z.object({
  olderThanDays: z.number().optional().default(30),
})

export default resolver.pipe(
  resolver.zod(CleanupTemporaryCompaniesSchema),
  async ({ olderThanDays }) => {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - olderThanDays)

    // Find temporary companies older than cutoff date
    const temporaryCompanies = await db.company.findMany({
      where: {
        isTemporary: true,
        createdAt: {
          lt: cutoffDate,
        },
      },
      include: {
        tasks: true,
      },
    })

    // Filter companies where all tasks are completed or failed
    const companiesToDelete = temporaryCompanies.filter((company) => {
      const allTasksComplete = company.tasks.every(
        (task) => task.status === "Finished" || task.status === "Failed"
      )
      return allTasksComplete
    })

    // Delete companies
    const deletedIds:any = []
    for (const company of companiesToDelete) {
      try {
        await db.company.delete({
          where: { id: company.id },
        })
        deletedIds.push(company.id)
      } catch (error) {
        console.error(`Failed to delete company ${company.id}:`, error)
      }
    }

    return {
      message: `Cleaned up ${deletedIds.length} temporary companies`,
      deletedCount: deletedIds.length,
      deletedIds,
    }
  }
)
