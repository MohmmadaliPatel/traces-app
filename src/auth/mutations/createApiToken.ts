import { resolver } from "@blitzjs/rpc"
import { hash256 } from "@blitzjs/auth"
import { z } from "zod"
import db from "db"
import { generateApiTokenValue } from "src/utils/apiAuth"

const CreateApiTokenSchema = z.object({
  name: z.string().min(1).max(100),
  expiresInDays: z.number().int().positive().optional(),
})

export default resolver.pipe(
  resolver.zod(CreateApiTokenSchema),
  resolver.authorize(),
  async ({ name, expiresInDays }, ctx) => {
    const token = generateApiTokenValue()
    const hashedToken = hash256(token)
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
      : null

    const record = await db.apiToken.create({
      data: {
        name,
        hashedToken,
        prefix: token.slice(0, 11),
        expiresAt,
        userId: ctx.session.userId as number,
      },
    })

    return {
      id: record.id,
      name: record.name,
      prefix: record.prefix,
      token,
      expiresAt: record.expiresAt,
      createdAt: record.createdAt,
    }
  }
)
