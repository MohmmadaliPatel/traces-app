import { paginate } from "blitz"
import { resolver } from "@blitzjs/rpc"
import db, { Prisma } from "db"

export default resolver.pipe(resolver.authorize(), async () => {
  const companies = await db.company.findMany({ select: { id: true, name: true } })
  return companies
})
