import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const DeleteTldcDataSchema = z.object({
  id: z.number(),
})

export default resolver.pipe(
  resolver.zod(DeleteTldcDataSchema),
  resolver.authorize(),
  async ({ id }) => {
    const tldcData = await db.tldcData.deleteMany({ where: { id } })
    return tldcData
  }
)

