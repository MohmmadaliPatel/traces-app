import { paginate } from "blitz"
import { resolver } from "@blitzjs/rpc"
import db, { Prisma } from "db"

interface GetDeducteeMastersInput
  extends Pick<Prisma.DeducteeMasterFindManyArgs, "where" | "orderBy" | "skip" | "take"> {}

export default resolver.pipe(
  resolver.authorize(),
  async ({ where, orderBy, skip = 0, take = 10000 }: GetDeducteeMastersInput) => {
    const {
      items: deducteeMasters,
      hasMore,
      nextPage,
      count,
    } = await paginate({
      maxTake: 1000000,
      skip,
      take,
      count: () => db.deducteeMaster.count({ where }),
      query: (paginateArgs) => db.deducteeMaster.findMany({ ...paginateArgs, where, orderBy }),
    })

    return {
      deducteeMasters,
      nextPage,
      hasMore,
      count,
    }
  }
)
