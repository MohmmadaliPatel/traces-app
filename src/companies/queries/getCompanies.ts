import { paginate } from "blitz"
import { resolver } from "@blitzjs/rpc"
import db, { maskCompanySecrets, Prisma } from "db"

interface GetCompaniesInput
  extends Pick<Prisma.CompanyFindManyArgs, "where" | "orderBy" | "skip" | "take"> {}

export default resolver.pipe(
  resolver.authorize(),
  async ({ where, orderBy, skip = 0, take = 100000 }: GetCompaniesInput) => {
    // TODO: in multi-tenant app, you must add validation to ensure correct tenant
    const {
      items: companies,
      hasMore,
      nextPage,
      count,
    } = await paginate({
      maxTake: 1000000,
      skip,
      take,
      count: () => db.company.count({ where }),
      query: (paginateArgs) => db.company.findMany({ ...paginateArgs, where, orderBy,include:{tasks:true} }),
    })

    return {
      // Portal passwords never go to the browser; writes that send the mask back keep the stored value
      companies: maskCompanySecrets(companies),
      nextPage,
      hasMore,
      count,
    }
  }
)
