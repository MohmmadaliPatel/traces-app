import { resolver } from "@blitzjs/rpc"
import db from "db"
import { z } from "zod"

const DeleteSmtpConfigSchema = z.object({
  id: z.number(),
})

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(DeleteSmtpConfigSchema),
  async ({ id }) => {
    const smtpConfig = await db.smtpConfig.delete({
      where: { id },
    })

    return { success: true, message: "SMTP configuration deleted successfully" }
  }
)
