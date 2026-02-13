import { paginate } from "blitz"
import { resolver } from "@blitzjs/rpc"
import db, { Prisma } from "db"

interface GetTldcDataInput
  extends Pick<Prisma.TldcDataFindManyArgs, "where" | "orderBy" | "skip" | "take"> {
  search?: string
}

export default resolver.pipe(
  resolver.authorize(),
  async ({ where, orderBy, skip = 0, take = 100, search }: GetTldcDataInput) => {
    // Build search criteria
    let searchWhere: Prisma.TldcDataWhereInput = { ...where }

    if (search) {
      // Convert search to lowercase for case-insensitive search in SQLite
      const searchLower = search.toLowerCase()
      searchWhere = {
        ...searchWhere,
        OR: [
          { certNumber: { contains: search } },
          { pan: { contains: search } },
          { panName: { contains: search } },
          { section: { contains: search } },
          { NatureOfPayment: { contains: search } },
        ],
      }
    }

    const {
      items: tldcData,
      hasMore,
      nextPage,
      count,
    } = await paginate({
      maxTake: 1000000,
      skip,
      take,
      count: () => db.tldcData.count({ where: searchWhere }),
      query: (paginateArgs) =>
        db.tldcData.findMany({
          ...paginateArgs,
          where: searchWhere,
          orderBy: orderBy || { updatedAt: "desc" },
          include: {
            company: {
              select: {
                id: true,
                name: true,
                tan: true,
              },
            },
          },
        }),
    })

    return {
      tldcData,
      nextPage,
      hasMore,
      count,
    }
  }
)
