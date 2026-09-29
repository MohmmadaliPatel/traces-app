import type { Page } from "puppeteer"
import type { AxiosInstance } from "axios"
import type { TracesLoginResponse } from "./types"

import { createTracesHttp } from "./http"

import {
  generateCaptcha,
  isTransientTracesFailure,
  loginTraces,
  tracesRetryDelayMs,
} from "./auth"

import { resolveCaptchaFromImageBase64 } from "./captchaDecode"

import {
  TRACES61_DASHBOARD_URL,
  TRACES61_ORIGIN,
  TRACES61_PREAUTH_V2_URL,
  rewriteTracesRedirectLocation,
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
const redirectGuardHandlerKey = Symbol.for("traces61.redirectGuardHandler")

type PageWithGuard = Page & Record<symbol, unknown>

export async function attachTraces61RedirectGuard(page: Page): Promise<void> {
  const tagged = page as PageWithGuard
  if (tagged[redirectGuardKey]) {
    log("attachTraces61RedirectGuard", "already attached, skipping")
    return
  }

  log("attachTraces61RedirectGuard", "enabling request interception; rewriting traces.tdscpc.gov.in → traces61")
  tagged[redirectGuardKey] = true

  const handler = (req: { url: () => string; method: () => string; continue: (overrides?: { url?: string }) => Promise<void> }) => {
    // Never rewrite POST/PUT — interception + URL overrides drop form bodies and
    // can bounce JSF submits to traces61contents.tdscpc.gov.in/auth/ (404).
    if (req.method() !== "GET") {
      void req.continue()
      return
    }
    const url = rewriteTracesNewPortalUrlToTraces61(req.url())
    if (url !== req.url()) {
      void req.continue({ url })
    } else {
      void req.continue()
    }
  }

  tagged[redirectGuardHandlerKey] = handler
  await page.setRequestInterception(true)
  page.on("request", handler)
}

/**
 * Turn off the traces61 rewrite interceptor. Must run before JSF form POSTs
 * (Conso Go, KYC, etc.) — Chromium drops POST bodies while interception is on.
 */
export async function detachTraces61RedirectGuard(page: Page): Promise<void> {
  const tagged = page as PageWithGuard
  if (!tagged[redirectGuardKey]) {
    return
  }
  const handler = tagged[redirectGuardHandlerKey]
  if (typeof handler === "function") {
    page.off("request", handler as (...args: unknown[]) => void)
  }
  tagged[redirectGuardKey] = false
  tagged[redirectGuardHandlerKey] = undefined
  try {
    await page.setRequestInterception(false)
    log("detachTraces61RedirectGuard", "request interception disabled")
  } catch (err) {
    log(
      "detachTraces61RedirectGuard",
      "setRequestInterception(false) failed",
      err instanceof Error ? err.message : String(err)
    )
  }
}

const httpsUpgradeKey = Symbol.for("traces61.httpsUpgrade")

type CdpHeader = { name: string; value: string }

/**
 * After JSF Go, TRACES 302s to `http://traces61.../downloadreqspec.xhtml`.
 * Rewrite that Location to HTTPS at the **response** stage so the POST body
 * is already sent (Request-stage interception drops it and 404s).
 */
export async function attachTraces61HttpsUpgrade(page: Page): Promise<void> {
  const tagged = page as PageWithGuard
  if (tagged[httpsUpgradeKey]) {
    return
  }
  tagged[httpsUpgradeKey] = true
  const client = await page.createCDPSession()
  await client.send("Fetch.enable", {
    patterns: [
      { urlPattern: "*://traces61.tdscpc.gov.in/*", requestStage: "Response" },
      { urlPattern: "http://traces61.tdscpc.gov.in/*", requestStage: "Request" },
    ],
  })
  client.on(
    "Fetch.requestPaused",
    async (event: {
      requestId: string
      request: { url: string }
      responseStatusCode?: number
      responseHeaders?: CdpHeader[]
    }) => {
      try {
        const reqUrl = event.request.url
        if (!event.responseStatusCode && /^http:\/\//i.test(reqUrl)) {
          const httpsUrl = rewriteTracesRedirectLocation(reqUrl)
          log("attachTraces61HttpsUpgrade", `GET ${reqUrl} → ${httpsUrl}`)
          await client.send("Fetch.continueRequest", {
            requestId: event.requestId,
            url: httpsUrl,
          })
          return
        }

        const headers = event.responseHeaders || []
        const loc = headers.find((h) => h.name.toLowerCase() === "location")
        const rewritten = loc ? rewriteTracesRedirectLocation(loc.value, reqUrl) : ""
        if (loc && rewritten && rewritten !== loc.value) {
          log("attachTraces61HttpsUpgrade", `Location ${loc.value} → ${rewritten}`)
          const nextHeaders = headers.map((h) =>
            h.name.toLowerCase() === "location" ? { name: h.name, value: rewritten } : h
          )
          await client.send("Fetch.fulfillRequest", {
            requestId: event.requestId,
            responseCode: event.responseStatusCode || 302,
            responseHeaders: nextHeaders,
            body: Buffer.from("").toString("base64"),
          })
          return
        }
        if (event.responseStatusCode) {
          await client.send("Fetch.continueResponse", { requestId: event.requestId })
        } else {
          await client.send("Fetch.continueRequest", { requestId: event.requestId })
        }
      } catch (err) {
        log(
          "attachTraces61HttpsUpgrade",
          "Fetch continue failed",
          err instanceof Error ? err.message : String(err)
        )
        try {
          await client.send("Fetch.continueRequest", { requestId: event.requestId })
        } catch {
          /* request already continued or finished */
        }
      }
    }
  )
  log("attachTraces61HttpsUpgrade", "CDP Fetch: rewrite http Location → https on traces61 responses")
}

/** Call before Conso/JSF Go so the POST body is kept and the HTTP 302 is upgraded. */
export async function prepareTraces61FormSubmit(page: Page): Promise<void> {
  await detachTraces61RedirectGuard(page)
  await attachTraces61HttpsUpgrade(page)
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

    let loginRes: TracesLoginResponse
    try {
      const captchaMeta = await generateCaptcha(http, authApiSetCookieLines)
      const captchaText = await resolveCaptchaFromImageBase64(captchaMeta.image)
      loginRes = await loginTraces(
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
    } catch (err) {
      // TRACES answers 502 / 504 under load and the captcha service can drop a connection;
      // a gateway hiccup must not fail the whole job the way a rejected login does.
      if (!isTransientTracesFailure(err) || attempt >= maxAttempts) {
        throw err
      }
      const waitMs = tracesRetryDelayMs(attempt)
      jobLog(
        `TRACES login attempt ${attempt}/${maxAttempts} hit a transient error — ${
          (err as Error).message
        } — retrying in ${Math.round(waitMs / 1000)}s…`
      )
      await new Promise((resolve) => setTimeout(resolve, waitMs))
      continue
    }

    accessToken = loginRes.authTokenDto?.accessToken
    refreshToken = loginRes.authTokenDto?.refreshToken

    if (accessToken && refreshToken?.trim()) {
      jobLog(`TRACES login succeeded on attempt ${attempt}/${maxAttempts}`)
      break
    }

    const errorCode = loginRes.errorCode ?? "UNKNOWN"
    const errorMessage =
      loginRes.message ?? "TRACES API login did not return authTokenDto.accessToken"
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


