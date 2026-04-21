import axios from "axios"
import { CookieJar } from "tough-cookie"
import type { CookieParam } from "puppeteer"
import { TRACES61_ORIGIN, TRACES61_PREAUTH_V2_URL } from "./constants"

export async function fetchPreauthV2SetCookieLines(accessToken: string): Promise<string[]> {
  const res = await axios.get(TRACES61_PREAUTH_V2_URL, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
    },
    maxRedirects: 10,
    validateStatus: (s) => s < 500,
  })

  const raw = res.headers["set-cookie"]
  if (!raw) {
    return []
  }
  return Array.isArray(raw) ? raw : [raw]
}

export async function setCookieLinesToPuppeteerCookies(
  setCookieLines: string[],
  urlForJar: string
): Promise<CookieParam[]> {
  const jar = new CookieJar()
  for (const line of setCookieLines) {
    await jar.setCookie(line, urlForJar)
  }
  const cookies = await jar.getCookies(urlForJar)
  return cookies.map((c) => ({
    name: c.key,
    value: c.value,
    domain: c.domain?.startsWith(".") ? c.domain.slice(1) : c.domain,
    path: c.path || "/",
    expires:
      c.expires && c.expires !== "Infinity" ? Math.floor(c.expires.getTime() / 1000) : undefined,
    httpOnly: c.httpOnly,
    secure: c.secure,
    sameSite: mapSameSite(c.sameSite),
  }))
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

/** Base URL with trailing path for tough-cookie (e.g. origin + "/"). */
export function traces61CookieUrl(): string {
  return `${TRACES61_ORIGIN}/`
}
