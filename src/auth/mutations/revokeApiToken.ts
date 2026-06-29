import { NotFoundError } from "blitz"
import { resolver } from "@blitzjs/rpc"
import { z } from "zod"
import db from "db"

const RevokeApiTokenSchema = z.object({
  id: z.number().int().positive(),
})

export default resolver.pipe(
  resolver.zod(RevokeApiTokenSchema),
  resolver.authorize(),
  async ({ id }, ctx) => {
    const token = await db.apiToken.findFirst({
      where: {
        id,
        userId: ctx.session.userId as number,
      },
    })

    if (!token) throw new NotFoundError()

    await db.apiToken.delete({ where: { id } })
    return { success: true }
  }
)
