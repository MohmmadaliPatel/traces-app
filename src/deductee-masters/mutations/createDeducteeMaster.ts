import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const CreateDeducteeMasterSchema = z.object({
  pan: z.string().min(10).max(10),
  email: z.string().email(),
  name: z.string().optional(),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(CreateDeducteeMasterSchema),
  async (input) => {
    const deducteeMaster = await db.deducteeMaster.create({
      data: {
        pan: input.pan.toUpperCase(),
        email: input.email.toLowerCase().trim(),
        name: input.name?.trim() || null,
      },
    })

    return deducteeMaster
  }
)
