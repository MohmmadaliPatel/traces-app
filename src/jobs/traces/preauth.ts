import type { AxiosInstance, AxiosResponse } from "axios"
import { CookieJar } from "tough-cookie"
import type { CookieParam } from "puppeteer"
import {
  TRACES61_ORIGIN,
  TRACES61_PREAUTH_V2_URL,
  TRACES_PREAUTH_REFERER,
  traces61Host,
} from "./constants"

const FILE = "src/jobs/traces/preauth.ts"
function log(fn: string, message: string, detail?: string) {
  const extra = detail ? ` ${detail}` : ""
  console.log(`[TRACES] ${FILE} · ${fn} — ${message}${extra}`)
}

/** Raw `Set-Cookie` header line(s) from an axios response (captcha, login, preauth, …). */
export function extractSetCookieLinesFromAxiosResponse(res: AxiosResponse): string[] {
  const raw = res.headers["set-cookie"]
  if (!raw) {
    return []
  }
  return Array.isArray(raw) ? raw : [raw]
}

/** Cookie name from the first `name=value` segment of a `Set-Cookie` line. */
export function firstCookieNameFromSetCookieLine(line: string): string {
  const pair = line.trim().split(";")[0] ?? ""
  const eq = pair.indexOf("=")
  return eq === -1 ? pair : pair.slice(0, eq).trim()
}

/**
 * Ensures preauthV2 `Set-Cookie` includes **JSESSIONID** (required for the legacy JSF app).
 * Any number of additional cookies is allowed.
 */
export function assertPreauthV2SetCookieLines(lines: string[]): void {
  const hasJsession = lines.some((line) => /^\s*JSESSIONID=/i.test(line.trim()))
  if (!hasJsession) {
    const names = lines.map(firstCookieNameFromSetCookieLine).join(", ")
    throw new Error(
      `[TRACES] ${FILE} · assertPreauthV2SetCookieLines — preauthV2 must set JSESSIONID; got ${lines.length} Set-Cookie line(s), name(s): ${names || "(none)"}`
    )
  }
}

export type TracesCookieBatch = {
  label: string
  lines: string[]
  /**
   * URL passed to tough-cookie `setCookie` / `getCookies`. Must sit under any restrictive
   * `Path=` on the lines (e.g. preauth `JSESSIONID; Path=/app` needs a path under `/app`, not `/`).
   */
  urlForJar: string
  /**
   * If set, each `CookieParam` gets `url` so Puppeteer/Chrome derives domain/path consistently
   * (see Puppeteer `CookieParam.url`).
   */
  puppeteerCookieUrl?: string
}

function mapSameSite(
  s: string | undefined
): "Strict" | "Lax" | "None" | undefined {
  if (!s) return undefined
  const u = String(s).toLowerCase()
  if (u === "strict") return "Strict"
  if (u === "lax") return "Lax"
  if (u === "none") return "None"
  return undefined
}

async function parseSetCookieLinesToPuppeteerCookies(
  setCookieLines: string[],
  urlForJar: string,
  puppeteerCookieUrl?: string
): Promise<CookieParam[]> {
  const jar = new CookieJar()
  for (const line of setCookieLines) {
    await jar.setCookie(line, urlForJar)
  }
  const cookies = await jar.getCookies(urlForJar)
  let fallbackHost: string
  try {
    fallbackHost = new URL(urlForJar).hostname
  } catch {
    fallbackHost = traces61Host()
  }
  return cookies.map((c) => {
    let domain = c.domain?.startsWith(".") ? c.domain.slice(1) : c.domain
    if (!domain) {
      domain = fallbackHost
    }
    const param: CookieParam = {
      name: c.key,
      value: c.value,
      domain,
      path: c.path || "/",
      expires:
        c.expires && c.expires !== "Infinity" ? Math.floor(c.expires.getTime() / 1000) : undefined,
      httpOnly: c.httpOnly,
      secure: c.secure,
      sameSite: mapSameSite(c.sameSite),
    }
    if (puppeteerCookieUrl) {
      param.url = puppeteerCookieUrl
    }
    return param
  })
}

function dedupeCookieParamsLatestLast(cookies: CookieParam[]): CookieParam[] {
  const m = new Map<string, CookieParam>()
  for (const c of cookies) {
    const domain = (c.domain ?? "").toLowerCase()
    const path = c.path ?? "/"
    m.set(`${domain}|${path}|${c.name}`, c)
  }
  return Array.from(m.values())
}

/**
 * Parse several `Set-Cookie` batches (different `urlForJar` per host: traces-app API vs traces61 preauth).
 * Later duplicates (same name+domain+path) win.
 */
export async function mergeCookieBatchesToPuppeteerCookies(
  batches: TracesCookieBatch[]
): Promise<CookieParam[]> {
  const merged: CookieParam[] = []
  for (const b of batches) {
    if (b.lines.length === 0) continue
    log(
      "mergeCookieBatchesToPuppeteerCookies",
      `batch "${b.label}"`,
      `lines=${b.lines.length} urlForJar=${b.urlForJar}`
    )
    const part = await parseSetCookieLinesToPuppeteerCookies(
      b.lines,
      b.urlForJar,
      b.puppeteerCookieUrl
    )
    merged.push(...part)
  }
  const deduped = dedupeCookieParamsLatestLast(merged)
  log("mergeCookieBatchesToPuppeteerCookies", "total Puppeteer cookie(s) after merge", String(deduped.length))
  return deduped
}

/** Log every raw `Set-Cookie` line and every resolved Puppeteer cookie (full name=value). */
export function logAllCookiesBeforePuppeteerSet(
  fromFn: string,
  batches: TracesCookieBatch[],
  puppeteerCookies: CookieParam[]
): void {
  log(fromFn, "════════ cookies before page.setCookie ════════")
  for (const b of batches) {
    log(fromFn, `raw Set-Cookie — ${b.label}`, `${b.lines.length} line(s)`)
    b.lines.forEach((line, i) => {
      console.log(`[TRACES] ${FILE} · ${fromFn} —   [${b.label}] ${i + 1}: ${line}`)
    })
  }
  log(fromFn, "resolved for Puppeteer", `${puppeteerCookies.length} cookie(s)`)
  for (const c of puppeteerCookies) {
    const u = "url" in c && c.url ? ` url=${c.url}` : ""
    console.log(
      `[TRACES] ${FILE} · ${fromFn} —   ${c.name}=${c.value} domain=${c.domain ?? ""} path=${c.path ?? "/"} httpOnly=${c.httpOnly} secure=${c.secure}${u}`
    )
  }
  log(fromFn, "══════════════════════════════════════════════")
}

/**
 * GET preauthV2 on traces61 using the **same** `AxiosInstance` as `generateCaptcha` / `loginTraces`
 * (`createTracesHttp()`), so shared defaults / interceptors / cookie behavior apply consistently.
 * The URL is absolute, so the client `baseURL` (traces-app) does not replace the host.
 */
export async function fetchPreauthV2SetCookieLines(
  http: AxiosInstance,
  accessToken: string,
  refreshToken: string
): Promise<string[]> {
  if (!refreshToken?.trim()) {
    throw new Error(`[TRACES] ${FILE} · fetchPreauthV2SetCookieLines — refreshToken is required for preauthV2`)
  }
  log("fetchPreauthV2SetCookieLines", "GET (shared traces Http client)", TRACES61_PREAUTH_V2_URL)
  const res = await http.get(TRACES61_PREAUTH_V2_URL, {
    headers: {
      accept: "*/*",
      "accept-language": "en-US,en;q=0.9",
      authorization: `Bearer ${accessToken}`,
      refreshtoken: refreshToken,
      "sec-ch-ua": '"Google Chrome";v="147", "Not.A/Brand";v="8", "Chromium";v="147"',
      "sec-ch-ua-mobile": "?0",
      "sec-ch-ua-platform": '"macOS"',
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-site",
      "x-bank-code": "null",
      "x-everify": "N",
      "x-requested-with": "XMLHttpRequest",
      referer: "https://traces.tdscpc.gov.in/",
    },
    maxRedirects: 10,
    validateStatus: (s) => s < 500,
  })
  log("fetchPreauthV2SetCookieLines", "response", `status=${res.status}`)
  if (res.status < 200 || res.status >= 400) {
    throw new Error(
      `[TRACES] ${FILE} · fetchPreauthV2SetCookieLines — HTTP ${res.status} from preauthV2 (expected 2xx)`
    )
  }
  const lines = extractSetCookieLinesFromAxiosResponse(res)
  if (lines.length === 0) {
    log("fetchPreauthV2SetCookieLines", "no set-cookie header (empty list)")
  } else {
    log("fetchPreauthV2SetCookieLines", "Set-Cookie line(s)", String(lines.length))
  }
  assertPreauthV2SetCookieLines(lines)
  log(
    "fetchPreauthV2SetCookieLines",
    "OK",
    `JSESSIONID present; names=${lines.map(firstCookieNameFromSetCookieLine).join(", ")}`
  )
  return lines
}

export async function setCookieLinesToPuppeteerCookies(
  setCookieLines: string[],
  urlForJar: string
): Promise<CookieParam[]> {
  log("setCookieLinesToPuppeteerCookies", "parsing for jar", `urlForJar=${urlForJar} lines=${setCookieLines.length}`)
  const cookies = await parseSetCookieLinesToPuppeteerCookies(setCookieLines, urlForJar, undefined)
  log("setCookieLinesToPuppeteerCookies", "tough-cookie result", `cookie(s)=${cookies.length}`)
  return cookies
}

/** Base URL with trailing path for tough-cookie (e.g. origin + "/"). */
export function traces61CookieUrl(): string {
  return `${TRACES61_ORIGIN}/`
}
