import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const CreateSmtpConfigSchema = z.object({
  name: z.string().min(1),
  host: z.string().min(1),
  port: z.number().int().min(1).max(65535),
  secure: z.boolean().default(true),
  user: z.string().min(1),
  password: z.string().min(1),
  fromEmail: z.string().email(),
  isActive: z.boolean().default(false),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(CreateSmtpConfigSchema),
  async (input) => {
    // If this config is being set as active, deactivate all others
    if (input.isActive) {
      await db.smtpConfig.updateMany({
        where: { isActive: true },
        data: { isActive: false },
      })
    }

    const smtpConfig = await db.smtpConfig.create({
      data: input,
    })

    return smtpConfig
  }
)
