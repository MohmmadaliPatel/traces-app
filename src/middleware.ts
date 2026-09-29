import { NextResponse, type NextRequest } from "next/server"

/**
 * License JWT enforcement is intentionally disabled.
 * Historical verification/redirect logic lived here; restore from git history
 * (or REFACTOR-LOG) when product wants middleware licensing active again.
 */
export async function middleware(_req: NextRequest) {
  return NextResponse.next()
}
