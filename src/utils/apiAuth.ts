import { getSession, hash256 } from "@blitzjs/auth"
import crypto from "crypto"
import db from "db"
import { NextApiRequest, NextApiResponse } from "next"
import { Role } from "types"

export type AuthenticatedUser = {
  userId: number
  role: Role
}

export type ApiAuthContext = {
  user: AuthenticatedUser
}

export const PUBLIC_RPC_PATHS = [
  "/api/rpc/login",
  "/api/rpc/logout",
  "/api/rpc/forgotPassword",
  "/api/rpc/getMachineId",
  "/api/rpc/getTrialExpiryDate",
  "/api/rpc/saveConfig",
  "/api/rpc/getCurrentUser",
]

export function isPublicRpcPath(url: string): boolean {
  return PUBLIC_RPC_PATHS.some((path) => url.includes(path))
}

export function generateApiTokenValue(): string {
  return `tt_${crypto.randomBytes(16).toString("hex")}`
}

export async function authenticateBearerToken(
  req: NextApiRequest
): Promise<AuthenticatedUser | null> {
  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith("Bearer ")) return null

  const token = authHeader.slice(7).trim()
  if (!token.startsWith("tt_")) return null

  const hashedToken = hash256(token)
  const apiToken = await db.apiToken.findUnique({
    where: { hashedToken },
    include: { user: true },
  })

  if (!apiToken) return null
  if (apiToken.expiresAt && apiToken.expiresAt < new Date()) return null

  await db.apiToken.update({
    where: { id: apiToken.id },
    data: { lastUsedAt: new Date() },
  })

  return {
    userId: apiToken.userId,
    role: apiToken.user.role as Role,
  }
}

export async function authenticateSession(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<AuthenticatedUser | null> {
  const session = await getSession(req, res)
  if (!session.userId) return null

  return {
    userId: session.userId as number,
    role: ((session.$publicData as { role?: Role }).role || "USER") as Role,
  }
}

export async function authenticateRequest(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<AuthenticatedUser | null> {
  const bearerUser = await authenticateBearerToken(req)
  if (bearerUser) return bearerUser
  return authenticateSession(req, res)
}

export async function requireAuth(
  req: NextApiRequest,
  res: NextApiResponse
): Promise<AuthenticatedUser | null> {
  const user = await authenticateRequest(req, res)
  if (!user) {
    res.status(401).json({ error: "Unauthorized" })
    return null
  }
  return user
}

export function withApiAuth(
  handler: (
    req: NextApiRequest,
    res: NextApiResponse,
    ctx: ApiAuthContext
  ) => void | Promise<void | NextApiResponse>
) {
  return async (req: NextApiRequest, res: NextApiResponse) => {
    const user = await requireAuth(req, res)
    if (!user) return
    return handler(req, res, { user })
  }
}
