import { resolver } from "@blitzjs/rpc"
import db from "db"

export default resolver.pipe(resolver.authorize(), async (_input, ctx) => {
  const tokens = await db.apiToken.findMany({
    where: { userId: ctx.session.userId as number },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      prefix: true,
      expiresAt: true,
      lastUsedAt: true,
      createdAt: true,
    },
  })

  return { tokens }
})
