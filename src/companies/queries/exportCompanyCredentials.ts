import { resolver } from "@blitzjs/rpc"
import db from "db"

/**
 * Every saved company with its real portal passwords, for the Companies page download.
 *
 * This is the one deliberate exception to "portal passwords never go to the browser"
 * (db/credentialEncryption.ts): every other resolver still returns MASKED_SECRET. It is only
 * called on demand (invoke), never through useQuery, so the values are not kept in the
 * client query cache.
 */
export default resolver.pipe(resolver.authorize(), async (_input: {}, ctx) => {
  const companies = await db.company.findMany({
    orderBy: { name: "asc" },
    select: {
      name: true,
      tan: true,
      it_password: true,
      user_id: true,
      password: true,
      dscCertificateName: true,
      emails: true,
    },
  })
  console.log(
    `[companies] credentials export: ${companies.length} companies by user ${ctx.session.userId}`
  )
  return companies
})
