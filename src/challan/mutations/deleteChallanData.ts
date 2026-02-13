import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const DeleteChallanDataSchema = z.object({
  id: z.number(),
})

export default resolver.pipe(
  resolver.zod(DeleteChallanDataSchema),
  resolver.authorize(),
  async ({ id }) => {
    const challanData = await db.challanData.delete({
      where: { id },
    })

    return challanData
  }
)

