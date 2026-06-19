import type { Page } from "puppeteer"
import type { AxiosInstance } from "axios"

import { createTracesHttp } from "./http"

import { generateCaptcha, loginTraces } from "./auth"

import { resolveCaptchaFromImageBase64 } from "./captchaDecode"

import {
  TRACES61_DASHBOARD_URL,
  TRACES61_ORIGIN,
  TRACES61_PREAUTH_V2_URL,
  rewriteTracesNewPortalUrlToTraces61,
  tracesAppAuthCookieContextUrl,
} from "./constants"

import {
  fetchPreauthV2SetCookieLines,
  logAllCookiesBeforePuppeteerSet,
  mergeCookieBatchesToPuppeteerCookies,
  type TracesCookieBatch,
} from "./preauth"



const FILE = "src/jobs/traces/puppeteerSession.ts"



function log(fn: string, message: string, detail?: string) {

  const extra = detail ? ` ${detail}` : ""

  console.log(`[TRACES] ${FILE} · ${fn} — ${message}${extra}`)

}



const redirectGuardKey = Symbol.for("traces61.redirectGuard")



export async function attachTraces61RedirectGuard(page: Page): Promise<void> {

  if ((page as unknown as Record<symbol, boolean>)[redirectGuardKey]) {

    log("attachTraces61RedirectGuard", "already attached, skipping")

    return

  }

  log("attachTraces61RedirectGuard", "enabling request interception; rewriting traces.tdscpc.gov.in → traces61")

  ;(page as unknown as Record<symbol, boolean>)[redirectGuardKey] = true

  await page.setRequestInterception(true)

  page.on("request", (req) => {

    const url = rewriteTracesNewPortalUrlToTraces61(req.url())

    if (url !== req.url()) {

      void req.continue({ url })

    } else {

      void req.continue()

    }

  })

}



export type ApplyTraces61SessionOptions = {

  /** Same `AxiosInstance` as captcha + login (`createTracesHttp()`); used for preauthV2 GET. */

  tracesHttp: AxiosInstance

  /** From `authTokenDto.refreshToken` — sent as `RefreshToken` header on preauthV2. */

  refreshToken: string

  skipDashboard?: boolean

  /** Raw `Set-Cookie` lines from TRACES JSON API (captcha + login) — merged with preauth. */

  authApiSetCookieLines?: string[]

}



export async function applyTraces61Session(

  page: Page,

  accessToken: string,

  options: ApplyTraces61SessionOptions

): Promise<void> {

  log("applyTraces61Session", "calling fetchPreauthV2SetCookieLines (preauthV2 + Bearer, shared Http client)")

  const preauthLines = await fetchPreauthV2SetCookieLines(

    options.tracesHttp,

    accessToken,

    options.refreshToken

  )



  const batches: TracesCookieBatch[] = []

  const authLines = options?.authApiSetCookieLines ?? []

  if (authLines.length > 0) {

    const authCtx = tracesAppAuthCookieContextUrl()
    batches.push({
      label: "traces-app JSON API (generateCaptcha + loginTraces)",
      lines: authLines,
      urlForJar: authCtx,
      puppeteerCookieUrl: authCtx,
    })
  }

  batches.push({
    label: "traces61 preauthV2.xhtml",
    lines: preauthLines,
    urlForJar: TRACES61_PREAUTH_V2_URL,
    puppeteerCookieUrl: TRACES61_PREAUTH_V2_URL,
  })



  const cookies = await mergeCookieBatchesToPuppeteerCookies(batches)

  logAllCookiesBeforePuppeteerSet("applyTraces61Session", batches, cookies)

  if (cookies.length > 0) {
    log("applyTraces61Session", "priming traces61 origin before setCookie", TRACES61_ORIGIN)
    await page.goto(TRACES61_ORIGIN, { waitUntil: "domcontentloaded", timeout: 120000 })
    for (const cookie of cookies) {
      try {
        await page.setCookie(cookie)
      } catch (err) {
        log(
          "applyTraces61Session",
          `page.setCookie failed for ${cookie.name}`,
          err instanceof Error ? err.message : String(err)
        )
        throw err
      }
    }
    log("applyTraces61Session", "page.setCookie completed", cookies.map((c) => c.name).join(", "))
  }

  const goToDashboard = options?.skipDashboard === false

  if (goToDashboard) {

    log("applyTraces61Session", "navigating to dashboard", TRACES61_DASHBOARD_URL)

    await page.goto(TRACES61_DASHBOARD_URL, {

      waitUntil: "networkidle2",

      timeout: 120000,

    })

  } else {

    log("applyTraces61Session", "skipDashboard=true; caller should page.goto traces61DedUrl(...)")

  }

}



export type LoginWithTracesApiAndPreauthOptions = {

  /** When false, navigate to legacy ded dashboard after cookies (may redirect to new portal). Default true. */

  skipDashboard?: boolean

  /**

   * When true (default), rewrite navigations to `traces.tdscpc.gov.in` to traces61.

   * Set false if the page uses its own `setRequestInterception` — merge

   * {@link rewriteTracesNewPortalUrlToTraces61} into that handler instead.

   */

  redirectGuard?: boolean

  /** Max captcha+login attempts before failing (default 5). */

  maxLoginAttempts?: number

  /** Optional sink for retry / failure messages (e.g. job logger). */

  log?: (message: string) => void

}



export const TRACES_DEFAULT_MAX_LOGIN_ATTEMPTS = 5



const CAPTCHA_RETRY_ERROR_CODES = new Set(["CPT403", "CPT401", "CPT400"])



function isRetryableLoginFailure(loginRes: {
  errorCode?: string
  message?: string
}): boolean {
  const code = (loginRes.errorCode ?? "").toUpperCase()
  if (CAPTCHA_RETRY_ERROR_CODES.has(code)) return true
  const msg = (loginRes.message ?? "").toLowerCase()
  return (
    msg.includes("captcha") ||
    msg.includes("verification code") ||
    msg.includes("image data")
  )
}



/**

 * TRACES flow: API captcha + login → Bearer → GET preauthV2 → cookies.

 * By default does not load the dashboard (avoids redirect to new portal); callers `goto` {@link traces61DedUrl}.

 */

export async function loginWithTracesApiAndPreauth(

  page: Page,

  credentials: { userId: string; password: string; tan?: string },

  options?: LoginWithTracesApiAndPreauthOptions

): Promise<void> {

  const jobLog = options?.log ?? ((message: string) => log("loginWithTracesApiAndPreauth", message))

  const maxAttempts = options?.maxLoginAttempts ?? TRACES_DEFAULT_MAX_LOGIN_ATTEMPTS

  jobLog(

    `TRACES API login starting (up to ${maxAttempts} captcha+login attempts); tan=${credentials.tan ? "(set)" : "(empty)"} userId=${credentials.userId ? "(set)" : "(empty)"}`

  )

  const http = createTracesHttp()

  let accessToken: string | undefined

  let refreshToken: string | undefined

  let authApiSetCookieLines: string[] = []

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {

    authApiSetCookieLines = []

    const captchaMeta = await generateCaptcha(http, authApiSetCookieLines)

    const captchaText = await resolveCaptchaFromImageBase64(captchaMeta.image)

    const loginRes = await loginTraces(

      http,

      {

        tan: credentials.tan,

        userId: credentials.userId,

        password: credentials.password,

        captcha: captchaText,

        captchaId: captchaMeta.id,

      },

      authApiSetCookieLines

    )

    accessToken = loginRes.authTokenDto?.accessToken

    refreshToken = loginRes.authTokenDto?.refreshToken

    if (accessToken && refreshToken?.trim()) {

      jobLog(`TRACES login succeeded on attempt ${attempt}/${maxAttempts}`)

      break

    }

    const errorCode = loginRes.errorCode ?? "UNKNOWN"

    const errorMessage = loginRes.message ?? "TRACES API login did not return authTokenDto.accessToken"

    jobLog(

      `TRACES login attempt ${attempt}/${maxAttempts} failed — errorCode=${errorCode} message=${errorMessage}`

    )

    if (attempt >= maxAttempts) {

      throw new Error(

        `TRACES login failed after ${maxAttempts} attempts: ${errorCode} — ${errorMessage}`

      )

    }

    if (!isRetryableLoginFailure(loginRes)) {

      throw new Error(`TRACES login failed (non-retryable): ${errorCode} — ${errorMessage}`)

    }

    jobLog(`Retrying TRACES login (new captcha)…`)

    await new Promise((resolve) => setTimeout(resolve, 800))

  }

  if (!accessToken) {

    throw new Error("TRACES API login did not return authTokenDto.accessToken")

  }

  if (!refreshToken?.trim()) {

    throw new Error(

      "TRACES API login did not return authTokenDto.refreshToken (required for preauthV2 RefreshToken header)"

    )

  }

  log(

    "loginWithTracesApiAndPreauth",

    "API login returned Bearer + refreshToken; merging auth API + preauth cookies for Puppeteer",

    `authApi Set-Cookie lines=${authApiSetCookieLines.length}`

  )

  const redirectGuard = options?.redirectGuard !== false

  log(

    "loginWithTracesApiAndPreauth",

    "options",

    `redirectGuard=${redirectGuard} skipDashboard=${options?.skipDashboard !== false}`

  )

  if (redirectGuard) {

    await attachTraces61RedirectGuard(page)

  } else {

    log("loginWithTracesApiAndPreauth", "redirectGuard=false; merge rewrite in your request handler if needed")

  }

  const skipDashboard = options?.skipDashboard !== false

  await applyTraces61Session(page, accessToken, {

    tracesHttp: http,

    refreshToken,

    skipDashboard,

    authApiSetCookieLines,

  })

  log("loginWithTracesApiAndPreauth", "finished; session cookies on page, ready for traces61DedUrl goto")

}


