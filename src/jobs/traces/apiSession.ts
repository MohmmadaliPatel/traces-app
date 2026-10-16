/**
 * API-only session for the TRACES legacy (old) portal at traces61.tdscpc.gov.in.
 *
 * Replaces the Puppeteer session for legacy-portal automation:
 *
 *   captcha → loginservice API login (Bearer + refresh token)
 *   → GET traces61 /app/preauthV2.xhtml with the Bearer (SSO cookie bridge, sets JSESSIONID)
 *   → plain HTTP (axios + tough-cookie jar) against the legacy JSF pages / servlets.
 *
 * No browser is launched. Callers that used `openTracesSession(page)` can now use
 * `openTraces61ApiSession()` and call the legacy endpoints directly:
 *
 *  - dashboard widgets   → POST page with empty body (e.g. dashbdoutdmnd.xhtml)
 *  - jqGrid JSON feeds   → POST /app/ded/srv/<X>Servlet with `_search=false&nd=…&rows=…&page=…`
 *  - full JSF pages      → GET, then POST forms with javax.faces.ViewState
 */
import axios, { AxiosInstance, AxiosRequestConfig, AxiosResponse } from "axios"
import { CookieJar } from "tough-cookie"
import {
  TRACES61_ORIGIN,
  TRACES61_PREAUTH_V2_URL,
  TRACES_NEW_PORTAL_HOST,
  TRACES_PREAUTH_REFERER,
  rewriteTracesHttpToHttps,
  tracesAppAuthCookieContextUrl,
  traces61Host,
} from "./constants"
import { createTracesHttp } from "./http"
import {
  generateCaptcha,
  isRetryableTracesLoginFailure,
  isTransientTracesFailure,
  loginTraces,
  tracesRetryDelayMs,
  TRACES_MAX_LOGIN_ATTEMPTS,
} from "./auth"
import { resolveCaptchaFromImageBase64 } from "./captchaDecode"
import { extractSetCookieLinesFromAxiosResponse } from "./preauth"
import { extractViewStateFromHtml } from "./legacyHtml"
import type { TracesLoginResponse } from "./types"

const FILE = "src/jobs/traces/apiSession.ts"
function log(fn: string, message: string, detail?: string) {
  const extra = detail ? ` ${detail}` : ""
  console.log(`[TRACES] ${FILE} · ${fn} — ${message}${extra}`)
}

export type TracesCredentials = { userId: string; password: string; tan?: string }

export type OpenTraces61ApiSessionOptions = {
  /** Max captcha+login attempts (default {@link TRACES_MAX_LOGIN_ATTEMPTS}). */
  maxLoginAttempts?: number
  /** Optional sink for progress messages (e.g. job logger). */
  log?: (message: string) => void
  /** Optional live check after the session is built (GET dashboard, read-only). Default true. */
  verifySession?: boolean
}

export type Traces61ApiSession = {
  /** Axios client pinned to traces61 with the cookie jar wired in (send + capture). */
  client: AxiosInstance
  /** Cookie jar for the whole flow (traces-app API cookies + traces61 legacy cookies). */
  jar: CookieJar
  credentials: TracesCredentials
  /** Bearer token from the loginservice API (fresh after login / relogin). */
  accessToken: string
  /** Refresh token required by preauthV2. */
  refreshToken: string
  /** True when the legacy portal serves the JSF dashboard for this session (read-only GET). */
  isSessionValid: () => Promise<boolean>
  /** Re-run captcha login + preauth and rebuild the traces61 cookies. */
  relogin: () => Promise<void>
  /** Compatibility no-op (Puppeteer sessions had `close()`); clears nothing server-side. */
  close: () => Promise<void>
}

const DEFAULT_BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36"

/** Full URL helper for legacy pages (kept in sync with constants.ts). */
export function traces61Url(pathOrUrl: string): string {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl
  const clean = pathOrUrl.replace(/^\/+/, "")
  return `${TRACES61_ORIGIN}/${clean}`
}

/** True when a redirect Location points at the *new* portal (session dead → re-login). */
export function isRedirectToNewPortal(location: string | undefined | null): boolean {
  if (!location) return false
  try {
    return new URL(location).hostname === TRACES_NEW_PORTAL_HOST
  } catch {
    return false
  }
}

/**
 * GET a legacy URL following redirects manually so every `Set-Cookie` hop is captured by
 * the jar (axios hides intermediate responses). Locations are rewritten http→https and
 * the new portal is never followed (the 302 response is returned instead).
 */
export async function legacyGet(
  session: Pick<Traces61ApiSession, "client">,
  pathOrUrl: string,
  config: AxiosRequestConfig = {}
): Promise<AxiosResponse> {
  let url = traces61Url(pathOrUrl)
  for (let hop = 0; hop < 10; hop++) {
    const res = await session.client.get(url, {
      ...config,
      maxRedirects: 0,
      validateStatus: () => true,
    })
    const location = res.headers["location"]
    if (!location || ![301, 302, 303, 307, 308].includes(res.status)) return res
    const next = rewriteTracesHttpToHttps(new URL(location, url).toString())
    if (isRedirectToNewPortal(next)) return res // caller inspects status/location
    url = next
  }
  throw new Error(`[TRACES] ${FILE} · legacyGet — too many redirects for ${pathOrUrl}`)
}

/** Standard jqGrid POST body used by every legacy servlet feed. */
export function jqGridBody(page = 1, rows = 100): string {
  return `_search=false&nd=${Date.now()}&rows=${rows}&page=${page}&sidx=&sord=asc`
}

type LegacyServletOptions = { body?: string | URLSearchParams; headers?: Record<string, string> }

/**
 * POST a legacy servlet and return the raw reply text.
 *
 * Redirects are not followed: a servlet only redirects when the session is gone (to the new
 * portal), and following it would turn that into a confusing "non-JSON reply" error.
 */
export async function postLegacyServletText(
  session: Pick<Traces61ApiSession, "client">,
  pathOrUrl: string,
  options: LegacyServletOptions = {}
): Promise<string> {
  const url = traces61Url(pathOrUrl)
  const body =
    options.body instanceof URLSearchParams
      ? options.body.toString()
      : (options.body ?? jqGridBody())
  const res = await session.client.post(url, body, {
    maxRedirects: 0,
    validateStatus: () => true,
    responseType: "text",
    transformResponse: [(data) => data],
    headers: {
      Accept: "application/json, text/javascript, */*; q=0.01",
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      "X-Requested-With": "XMLHttpRequest",
      ...options.headers,
    },
  })
  const text = Buffer.isBuffer(res.data) ? res.data.toString("utf8") : String(res.data ?? "")
  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const location = res.headers["location"]
    const target = location
      ? rewriteTracesHttpToHttps(new URL(location, url).toString())
      : "(no Location header)"
    throw new Error(
      isRedirectToNewPortal(target)
        ? `[TRACES] ${FILE} · postLegacyServletText — session expired: ${pathOrUrl} redirected to the new portal (${target})`
        : `[TRACES] ${FILE} · postLegacyServletText — unexpected HTTP ${res.status} redirect from ${pathOrUrl} to ${target}`
    )
  }
  if (res.status >= 400) {
    throw new Error(
      `[TRACES] ${FILE} · postLegacyServletText — HTTP ${res.status} from ${pathOrUrl}: ${text.slice(0, 200)}`
    )
  }
  return text
}

/** POST a legacy jqGrid servlet and return parsed JSON. */
export async function postLegacyServletJson(
  session: Pick<Traces61ApiSession, "client">,
  pathOrUrl: string,
  options: LegacyServletOptions = {}
): Promise<any> {
  const text = await postLegacyServletText(session, pathOrUrl, options)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(
      `[TRACES] ${FILE} · postLegacyServletJson — non-JSON reply from ${pathOrUrl}: ${text.slice(0, 160)}`
    )
  }
}

/**
 * Read a DownloadServlet reply. TRACES answers with either a bare URL or JSON
 * (`{ success: url }` / `[{ success: url }]`); the Puppeteer flows accepted both.
 */
export function parseDownloadServletReply(text: string): string {
  const reply = String(text ?? "").trim()
  if (/^https?:\/\//i.test(reply)) return reply.replace(/^http:\/\//i, "https://")
  try {
    const parsed = JSON.parse(reply)
    const url =
      typeof parsed === "string"
        ? parsed
        : parsed?.success || (Array.isArray(parsed) && parsed[0]?.success) || ""
    return typeof url === "string" ? url.trim() : ""
  } catch {
    return ""
  }
}

/** Ask DownloadServlet for the file URL of a Requested Downloads row (`reqNo`). */
export async function fetchLegacyDownloadUrl(
  session: Pick<Traces61ApiSession, "client">,
  reqNo: string
): Promise<{ url: string; reply: string }> {
  const reply = await postLegacyServletText(session, "app/srv/DownloadServlet", {
    body: `reqNo=${encodeURIComponent(reqNo)}`,
  })
  return { url: parseDownloadServletReply(reply), reply }
}

/** Extract `javax.faces.ViewState` from a legacy page's HTML (MyFaces). */
export function extractJsfViewState(html: string): string {
  return extractViewStateFromHtml(html)
}

/**
 * Perform the API login + preauth and build a fresh traces61 cookie jar.
 * Shared by `openTraces61ApiSession` and `relogin`.
 */
async function buildTraces61Jar(
  credentials: TracesCredentials,
  options: OpenTraces61ApiSessionOptions
): Promise<{ jar: CookieJar; accessToken: string; refreshToken: string }> {
  const jobLog = options.log ?? ((message: string) => log("buildTraces61Jar", message))
  const maxAttempts = options.maxLoginAttempts ?? TRACES_MAX_LOGIN_ATTEMPTS
  const http = createTracesHttp()

  const jar = new CookieJar()
  const appLoginUrl = tracesAppAuthCookieContextUrl()

  let accessToken: string | undefined
  let refreshToken: string | undefined

  // Same retry policy as `loginWithTracesApiAndPreauth`: a new captcha only for captcha
  // mismatches, backoff only for gateway/network hiccups, and an immediate stop on anything
  // else (a wrong password retried five times can lock the TRACES account).
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    jobLog(`TRACES API login attempt ${attempt}/${maxAttempts}`)
    // Raw Set-Cookie lines from captcha + login — the login-service session cookies make
    // the preauth SSO bridge reliable (flaky without them).
    const apiSetCookieLines: string[] = []
    let loginRes: TracesLoginResponse
    try {
      const captchaMeta = await generateCaptcha(http, apiSetCookieLines)
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
        apiSetCookieLines
      )
    } catch (err: any) {
      if (!isTransientTracesFailure(err) || attempt >= maxAttempts) throw err
      const waitMs = tracesRetryDelayMs(attempt)
      jobLog(
        `TRACES API login attempt ${attempt}/${maxAttempts} hit a transient error — ${err?.message || err} — retrying in ${Math.round(waitMs / 1000)}s…`
      )
      await new Promise((r) => setTimeout(r, waitMs))
      continue
    }

    accessToken = loginRes.authTokenDto?.accessToken
    refreshToken = loginRes.authTokenDto?.refreshToken
    if (accessToken && refreshToken?.trim()) {
      for (const line of apiSetCookieLines) {
        jar.setCookieSync(line, appLoginUrl)
      }
      jobLog(`TRACES API login succeeded on attempt ${attempt}/${maxAttempts}`)
      break
    }

    const errorCode = loginRes.errorCode ?? "UNKNOWN"
    const errorMessage = loginRes.message ?? "TRACES API login did not return authTokenDto.accessToken"
    jobLog(`TRACES API login attempt ${attempt}/${maxAttempts} failed — errorCode=${errorCode} message=${errorMessage}`)
    if (attempt >= maxAttempts) {
      throw new Error(
        `[TRACES] ${FILE} · buildTraces61Jar — login failed after ${maxAttempts} attempts: ${errorCode} — ${errorMessage}`
      )
    }
    if (!isRetryableTracesLoginFailure(loginRes)) {
      throw new Error(
        `[TRACES] ${FILE} · buildTraces61Jar — login failed (non-retryable): ${errorCode} — ${errorMessage}`
      )
    }
    jobLog("Retrying TRACES login (new captcha)…")
    await new Promise((r) => setTimeout(r, 800))
  }

  if (!accessToken) {
    throw new Error(`[TRACES] ${FILE} · buildTraces61Jar — login failed after ${maxAttempts} attempt(s)`)
  }
  if (!refreshToken?.trim()) {
    throw new Error(`[TRACES] ${FILE} · buildTraces61Jar — login returned no refreshToken (required for preauthV2)`)
  }

  const appCookieHeader = await jar.getCookieString(appLoginUrl)

  // preauthV2 — the SSO bridge that turns the Bearer into a legacy JSESSIONID.
  let preauthRes: AxiosResponse | undefined
  let preauthUrl = TRACES61_PREAUTH_V2_URL
  for (let hop = 0; hop < 10; hop++) {
    const hopRes = await http.get(preauthUrl, {
      headers: {
        accept: "*/*",
        "accept-language": "en-US,en;q=0.9",
        authorization: `Bearer ${accessToken}`,
        refreshtoken: refreshToken,
        cookie: appCookieHeader,
        "x-requested-with": "XMLHttpRequest",
        referer: TRACES_PREAUTH_REFERER,
      },
      maxRedirects: 0,
      validateStatus: () => true,
      timeout: 120000,
    })
    preauthRes = hopRes
    for (const line of extractSetCookieLinesFromAxiosResponse(hopRes)) {
      jar.setCookieSync(line, preauthUrl)
    }
    const location = hopRes.headers["location"]
    if (!location || ![301, 302, 303, 307, 308].includes(hopRes.status)) break
    preauthUrl = rewriteTracesHttpToHttps(new URL(location, preauthUrl).toString())
  }

  if (!preauthRes || preauthRes.status < 200 || preauthRes.status >= 400) {
    throw new Error(
      `[TRACES] ${FILE} · buildTraces61Jar — preauthV2 HTTP ${preauthRes?.status ?? "no response"}: ${JSON.stringify(preauthRes?.data ?? "").slice(0, 200)}`
    )
  }

  // JSESSIONID (Path=/app) is what the legacy JSF app authenticates with.
  const host61 = traces61Host()
  const cookiesFor61 = await jar.getCookies(`${TRACES61_ORIGIN}/app/preauthV2.xhtml`)
  const hasJsession = cookiesFor61.some((c) => c.key === "JSESSIONID")
  if (!hasJsession) {
    const names = cookiesFor61.map((c) => c.key).join(", ")
    throw new Error(
      `[TRACES] ${FILE} · buildTraces61Jar — preauthV2 set no JSESSIONID for ${host61}; got: ${names || "(none)"}`
    )
  }

  log("buildTraces61Jar", "session jar ready", `traces61 cookies=${cookiesFor61.length}`)
  return { jar, accessToken, refreshToken }
}

/** Attach the jar to an axios client: send Cookie, capture Set-Cookie on every response. */
function wireCookieJar(client: AxiosInstance, jarRef: { current: CookieJar }): void {
  client.interceptors.request.use(async (config) => {
    const url = axios.getUri(config)
    const cookie = await jarRef.current.getCookieString(url)
    if (cookie) config.headers.Cookie = cookie
    return config
  })
  client.interceptors.response.use((res) => {
    const lines = extractSetCookieLinesFromAxiosResponse(res)
    for (const line of lines) {
      jarRef.current.setCookieSync(line, axios.getUri(res.config))
    }
    return res
  })
}

/**
 * Open an API-only TRACES legacy session (no Puppeteer).
 * One session per call — never shared across companies (same rule as `openTracesSession`).
 */
export async function openTraces61ApiSession(
  credentials: TracesCredentials,
  options: OpenTraces61ApiSessionOptions = {}
): Promise<Traces61ApiSession> {
  const { jar, accessToken, refreshToken } = await buildTraces61Jar(credentials, options)
  const jarRef = { current: jar }

  const client = axios.create({
    baseURL: TRACES61_ORIGIN,
    timeout: 120000,
    headers: {
      "User-Agent": DEFAULT_BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
    },
  })
  wireCookieJar(client, jarRef)

  const session: Traces61ApiSession = {
    client,
    jar,
    credentials,
    accessToken,
    refreshToken,
    isSessionValid: async () => {
      try {
        const res = await legacyGet(session, "app/ded/dashboard.xhtml")
        return res.status === 200 && !isRedirectToNewPortal(res.headers["location"])
      } catch {
        return false
      }
    },
    relogin: async () => {
      const fresh = await buildTraces61Jar(credentials, options)
      jarRef.current = fresh.jar
      ;(session as any).accessToken = fresh.accessToken
      ;(session as any).refreshToken = fresh.refreshToken
      log("relogin", "session rebuilt")
    },
    close: async () => {
      /* nothing server-side to clean up */
    },
  }

  // Keep `session.jar` pointing at the live jar even after relogin() swaps it.
  Object.defineProperty(session, "jar", {
    get: () => jarRef.current,
    enumerable: true,
    configurable: false,
  })

  if (options.verifySession !== false) {
    const ok = await session.isSessionValid()
    if (!ok) {
      throw new Error(
        `[TRACES] ${FILE} · openTraces61ApiSession — legacy session not valid (dashboard redirects to new portal)`
      )
    }
    log("openTraces61ApiSession", "session verified (dashboard serves JSF)")
  }

  return session
}
