import db from "db"
import type { CompanyCredentials } from "src/shared/types/companyCredentials"

/** Upsert company by TAN; creates temporary company when missing. */
export async function upsertCompanyFromCredentials(
  company: CompanyCredentials,
  options: { isTemporary?: boolean } = {}
) {
  const isTemporary = options.isTemporary ?? true
  const tan = company.tan.trim().toUpperCase()

  const existing = await db.company.findUnique({ where: { tan } })
  if (!existing) {
    return db.company.create({
      data: {
        name: company.name,
        tan,
        it_password: company.it_password,
        user_id: company.user_id,
        password: company.password,
        isTemporary,
        emails: null,
      },
    })
  }

  return db.company.update({
    where: { tan },
    data: {
      name: company.name,
      it_password: company.it_password,
      user_id: company.user_id,
      password: company.password,
    },
  })
}
