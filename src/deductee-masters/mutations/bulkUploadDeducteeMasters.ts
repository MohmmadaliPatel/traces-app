import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

export default resolver.pipe(
  resolver.authorize(),
  async (rawInput, ctx) => {
    const { deducteeMasters } = rawInput as { deducteeMasters: any[] }
    const saved:any = []
    const updated:any = []
    const errors:any = []
    console.log("deducteeMasters", deducteeMasters)
    for (const master of deducteeMasters) {
      try {
        const existing = await db.deducteeMaster.findUnique({
          where: { pan: master.pan.toUpperCase() },
        })

        if (existing) {
          const updatedRecord = await db.deducteeMaster.update({
            where: { pan: master.pan.toUpperCase() },
            data: {
              email: master.email.toLowerCase().trim(),
              name: master.name?.trim() || null,
            },
          })
          updated.push(updatedRecord)
        } else {
          const created = await db.deducteeMaster.create({
            data: {
              pan: master.pan.toUpperCase(),
              email: master.email.toLowerCase().trim(),
              name: master.name?.trim() || null,
            },
          })
          saved.push(created)
        }
      } catch (error: any) {
        errors.push({
          pan: master.pan,
          error: error.message || "Failed to save",
        })
      }
    }

    return {
      saved: saved.length,
      updated: updated.length,
      errors: errors.length,
      errorDetails: errors,
      total: deducteeMasters.length,
    }
  }
)
