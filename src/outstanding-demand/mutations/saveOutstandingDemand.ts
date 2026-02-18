import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const DemandRowSchema = z.object({
  finYr: z.string(),
  fin: z.string(),
  aodmnd: z.string(),
  cpcdmd: z.string(),
})

const SaveOutstandingDemandSchema = z.object({
  companyId: z.number(),
  demands: z.array(DemandRowSchema),
})

export default resolver.pipe(
  resolver.zod(SaveOutstandingDemandSchema),
  resolver.authorize(),
  async ({ companyId, demands }) => {
    const saved:any = []
    const updated:any = []
    const errors:any = []

    for (const demand of demands) {
      try {
        // Skip "Prior Years" entries as they will be expanded
        if (demand.fin === "1") {
          continue
        }

        const existing = await db.outstandingDemand.findUnique({
          where: {
            companyId_finYr: {
              companyId,
              finYr: demand.finYr,
            },
          },
        })

        if (existing) {
          const updated_record = await db.outstandingDemand.update({
            where: {
              companyId_finYr: {
                companyId,
                finYr: demand.finYr,
              },
            },
            data: {
              fin: demand.fin,
              aodmnd: demand.aodmnd,
              cpcdmd: demand.cpcdmd,
            },
          })
          updated.push(updated_record)
        } else {
          const created = await db.outstandingDemand.create({
            data: {
              companyId,
              finYr: demand.finYr,
              fin: demand.fin,
              aodmnd: demand.aodmnd,
              cpcdmd: demand.cpcdmd,
            },
          })
          saved.push(created)
        }
      } catch (error: any) {
        errors.push({
          finYr: demand.finYr,
          error: error.message || "Failed to save demand",
        })
      }
    }

    return {
      saved: saved.length,
      updated: updated.length,
      errors: errors.length,
      errorDetails: errors,
    }
  }
)
