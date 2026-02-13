import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const UpdateDeducteeMasterSchema = z.object({
  id: z.number(),
  pan: z.string().min(10).max(10).optional(),
  email: z.string().email().optional(),
  name: z.string().optional(),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(UpdateDeducteeMasterSchema),
  async (input) => {
    const { id, ...data } = input
    const updateData: any = {}

    if (data.pan) updateData.pan = data.pan.toUpperCase()
    if (data.email) updateData.email = data.email.toLowerCase().trim()
    if (data.name !== undefined) updateData.name = data.name?.trim() || null

    const deducteeMaster = await db.deducteeMaster.update({
      where: { id },
      data: updateData,
    })

    return deducteeMaster
  }
)
