import db, { MASKED_SECRET } from "db"

type PortalCredentials = { userId: string; password: string; tan: string }

/**
 * The UI receives MASKED_SECRET instead of the stored TRACES password and sends it back in
 * `credentials`. Swap it for the stored password of that company before logging in.
 * Real passwords (e.g. from external API clients) pass through unchanged.
 */
export async function unmaskPortalCredentials<T extends PortalCredentials | undefined>(
  credentials: T,
  lookup: { companyId?: number | string | null; tan?: string | null }
): Promise<T> {
  if (!credentials || credentials.password !== MASKED_SECRET) return credentials
  const id = lookup.companyId != null && lookup.companyId !== "" ? parseInt(String(lookup.companyId), 10) : NaN
  const tan = (lookup.tan || credentials.tan || "").trim().toUpperCase()
  const company = await db.company.findFirst({
    where: Number.isFinite(id) ? { id } : { tan },
    select: { password: true },
  })
  if (!company?.password) return credentials
  return { ...credentials, password: company.password }
}
