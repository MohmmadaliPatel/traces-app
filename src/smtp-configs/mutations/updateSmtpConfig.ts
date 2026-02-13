import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const UpdateSmtpConfigSchema = z.object({
  id: z.number(),
  name: z.string().min(1).optional(),
  host: z.string().min(1).optional(),
  port: z.number().int().min(1).max(65535).optional(),
  secure: z.boolean().optional(),
  user: z.string().min(1).optional(),
  password: z.string().min(1).optional(),
  fromEmail: z.string().email().optional(),
  isActive: z.boolean().optional(),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(UpdateSmtpConfigSchema),
  async (input) => {
    const { id, isActive, ...data } = input

    // If this config is being set as active, deactivate all others
    if (isActive === true) {
      await db.smtpConfig.updateMany({
        where: { isActive: true, id: { not: id } },
        data: { isActive: false },
      })
    }

    const smtpConfig = await db.smtpConfig.update({
      where: { id },
      data: data as any,
    })

    return smtpConfig
  }
)
