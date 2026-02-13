import { setupBlitzServer } from "@blitzjs/next"
import { AuthServerPlugin, PrismaStorage } from "@blitzjs/auth"
import { simpleRolesIsAuthorized } from "@blitzjs/auth"
import { BlitzLogger, BlitzServerMiddleware } from "blitz"
import db from "db"
import { authConfig } from "./blitz-client"
import { xssRegex, crlfRegex, XMLRegex } from "./utils/waf/specialchars.regex"
import { NextApiRequest, NextApiResponse } from "next"

// Enhanced validation helpers
const isStringUnsafe = (value: string): boolean => {
  const patterns = {
    xss: xssRegex,
    crlf: crlfRegex,
    xml: XMLRegex,
  }
  return Object.values(patterns).some((pattern) => pattern.test(value))
}

const hasUnsafeValues = (obj: any): boolean => {
  if (typeof obj === "string") {
    return isStringUnsafe(obj)
  }
  if (Array.isArray(obj)) {
    return obj.some((item) => hasUnsafeValues(item))
  }
  if (typeof obj === "object" && obj !== null) {
    return Object.values(obj).some((value) => hasUnsafeValues(value))
  }
  return false
}

const isUrlSafe = (url: string): boolean => {
  try {
    const decodedUrl = decodeURIComponent(url)
    return !isStringUnsafe(decodedUrl)
  } catch {
    return false
  }
}

// Cookie validation helper
const areCookiesSafe = (cookies: { [key: string]: string }): boolean => {
  return !Object.entries(cookies).some(([key, value]) => {
    // Check both cookie names and values
    return isStringUnsafe(key) || isStringUnsafe(value)
  })
}

// Enhanced security middleware
const securityMiddleware: any = async (req: NextApiRequest, res: NextApiResponse, next) => {
  try {
    // Add security headers
    res.setHeader("Content-Security-Policy", "default-src 'self'")
    res.setHeader("X-Content-Type-Options", "nosniff")
    res.setHeader("X-Frame-Options", "DENY")
    res.setHeader("X-XSS-Protection", "1; mode=block")
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin")
    res.setHeader("Permissions-Policy", "geolocation=(), microphone=(), camera=()")

    // Validate client IP
    const clientIP = (req.headers["x-forwarded-for"] as string) || req.socket.remoteAddress
    if (!clientIP) {
      res.status(403).json({ message: "Unable to determine client IP" })
      return
    }

    // Validate URL path
    const path = req.url || ""
    if (!isUrlSafe(path)) {
      res.status(403).json({ message: "Invalid URL path" })
      return
    }

    // Validate cookies
    if (req.cookies && !areCookiesSafe(req.cookies as { [key: string]: string })) {
      res.status(403).json({ message: "Invalid cookie values detected" })
      return
    }

    // Define endpoints that should skip body validation due to legitimate JSON data
    const skipBodyValidationEndpoints = [
      "/api/rpc/getAdditionalNoticeNoticeSummary",
      "/api/rpc/upsertGstNotices",
      "/api/rpc/upsertNotices",
      "/api/rpc/upsertResponses",
      "/api/rpc/upsertProcedding",
    ]

    const shouldSkipBodyValidation = skipBodyValidationEndpoints.some((endpoint) =>
      req.url?.includes(endpoint)
    )

    // Validate all request components regardless of method
    const validationChecks = [
      // Check query parameters
      req.query && hasUnsafeValues(req.query) && "query parameters",
      // Check body payload (skip for certain endpoints)
      !shouldSkipBodyValidation &&
        req.body &&
        (() => {
          const bodyStr = JSON.stringify(req.body)
          return (
            (xssRegex.test(bodyStr) || crlfRegex.test(bodyStr) || XMLRegex.test(bodyStr)) &&
            "request body"
          )
        })(),
    ].filter(Boolean)

    if (validationChecks.length > 0) {
      res.status(403).json({
        message: `Invalid ${validationChecks.join(", ")} detected`,
      })
      return
    }

    await next()
  } catch (error) {
    console.error("Security middleware error:", error)
    res.status(500).json({ message: "Internal server error" })
  }
}

export const { gSSP, gSP, api } = setupBlitzServer({
  plugins: [
    AuthServerPlugin({
      ...authConfig,
      storage: PrismaStorage(db),
      isAuthorized: simpleRolesIsAuthorized,
      secureCookies:
        process.env.NODE_ENV === "production" && process.env.DISABLE_SECURE_COOKIE !== "true",
    }),
    BlitzServerMiddleware(securityMiddleware),
    BlitzServerMiddleware(async (req, res: any, next) => {
      res.blitzCtx.makeCookiesHttpOnly = () => {
        // Modify Set-Cookie header to enforce HttpOnly
        const setCookieHeader = res.getHeader("Set-Cookie")

        if (setCookieHeader) {
          let cookies = Array.isArray(setCookieHeader) ? setCookieHeader : [setCookieHeader]

          cookies = cookies.map((cookie) => {
            // Ensure HttpOnly is set
            return cookie.includes("HttpOnly") ? cookie : cookie + "; HttpOnly"
          })

          res.setHeader("Set-Cookie", cookies)
        }
      }

      await next()
    }),
  ],
  logger: BlitzLogger({}),
})
