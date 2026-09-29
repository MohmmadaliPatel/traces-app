import { paginate } from "blitz"
import { resolver } from "@blitzjs/rpc"
import db, { Prisma } from "db"

interface GetLdcUtilisationInput
  extends Pick<Prisma.TldcDataFindManyArgs, "where" | "orderBy" | "skip" | "take"> {
  search?: string
}

function parseAmount(value: string | null | undefined): number {
  if (!value) return 0
  const n = Number(String(value).replace(/,/g, "").trim())
  return Number.isFinite(n) ? n : 0
}

export default resolver.pipe(
  resolver.authorize(),
  async ({ where, orderBy, skip = 0, take = 100, search }: GetLdcUtilisationInput) => {
    let searchWhere: Prisma.TldcDataWhereInput = { ...where }

    if (search) {
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

    const rows = tldcData.map((item) => {
      const amountLimit = parseAmount(item.tdsAmountLimit)
      const amountConsumed = parseAmount(item.tdsAmountConsumed)
      const amountRemaining = Math.max(0, amountLimit - amountConsumed)
      const utilisationPct = amountLimit > 0 ? (amountConsumed / amountLimit) * 100 : 0

      return {
        id: item.id,
        companyId: item.companyId,
        company: item.company,
        certNumber: item.certNumber,
        din: item.din,
        fy: item.fy,
        pan: item.pan,
        panName: item.panName,
        section: item.section,
        NatureOfPayment: item.NatureOfPayment,
        tdsRate: item.tdsRate,
        amountLimit,
        amountConsumed,
        amountRemaining,
        utilisationPct: Number(utilisationPct.toFixed(2)),
        validFrom: item.validFrom,
        validTo: item.validTo,
        cancelDate: item.cancelDate,
        isActive: item.isActive,
        updatedAt: item.updatedAt,
      }
    })

    return {
      rows,
      nextPage,
      hasMore,
      count,
    }
  }
)
