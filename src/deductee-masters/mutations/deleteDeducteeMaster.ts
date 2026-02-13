import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const DeleteDeducteeMasterSchema = z.object({
  id: z.number(),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(DeleteDeducteeMasterSchema),
  async ({ id }) => {
    const deducteeMaster = await db.deducteeMaster.delete({
      where: { id },
    })

    return { success: true, message: "Deductee master deleted successfully" }
  }
)
