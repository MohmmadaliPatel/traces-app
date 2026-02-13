import { resolver } from "@blitzjs/rpc"
import db from "db"

export default resolver.pipe(resolver.authorize(), async () => {
  const smtpConfigs = await db.smtpConfig.findMany({
    orderBy: { createdAt: "desc" },
  })

  const activeConfig = await db.smtpConfig.findFirst({
    where: { isActive: true },
  })

  return {
    smtpConfigs,
    activeConfig,
  }
})
