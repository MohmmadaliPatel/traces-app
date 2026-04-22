/**
 * TRACES legacy JSF app (post–preauth cookie bridge).
 * Must stay on the **traces61** host for Puppeteer automation. Do not set this to
 * `https://traces.tdscpc.gov.in` (new SPA portal) or the browser will leave the legacy UI.
 * Override via env if the portal moves.
 */
export const TRACES61_ORIGIN = process.env.TRACES61_ORIGIN ?? "https://traces61.tdscpc.gov.in"

export const TRACES61_PREAUTH_V2_URL =
  process.env.TRACES61_PREAUTH_V2_URL ?? `${TRACES61_ORIGIN}/app/preauthV2.xhtml`

/** Legacy ded dashboard; must use same host as {@link TRACES61_ORIGIN}. */
export const TRACES61_DASHBOARD_URL =
  process.env.TRACES61_DASHBOARD_URL ?? `${TRACES61_ORIGIN}/app/ded/dashboard.xhtml`

/**
 * Host for the TRACES **login service** JSON API (captcha + auth).
 * @see https://traces-app.tdscpc.gov.in/loginservice/api/auth/login
 */
export const TRACES_APP_API_ORIGIN =
  process.env.TRACES_APP_API_ORIGIN ??
  process.env.TRACES_API_BASE_URL ??
  "https://traces-app.tdscpc.gov.in"

export const TRACES_PATH_GENERATE_CAPTCHA =
  process.env.TRACES_PATH_GENERATE_CAPTCHA ?? "/loginservice/api/auth/generateCaptcha"

export const TRACES_PATH_LOGIN = process.env.TRACES_PATH_LOGIN ?? "/loginservice/api/auth/login"

/** Base URL for axios `createTracesHttp()` (captcha + login JSON API). */
export function getTracesApiBaseUrl(): string {
  return TRACES_APP_API_ORIGIN
}

/** Base URL with `/` for parsing `Set-Cookie` from TRACES JSON API (`traces-app…`). */
export function tracesAppCookieUrl(): string {
  const base = TRACES_APP_API_ORIGIN.replace(/\/+$/, "")
  return `${base}/`
}

/**
 * Request URL context for tough-cookie when reading cookies from captcha/login responses.
 * Using `/loginservice/.../login` ensures `Path=/loginservice/...` cookies are included in `getCookies`.
 */
export function tracesAppAuthCookieContextUrl(): string {
  const base = TRACES_APP_API_ORIGIN.replace(/\/+$/, "")
  return `${base}/loginservice/api/auth/login`
}

/** Full URL under `/app/ded/` e.g. `stmtstatus.xhtml` → `.../app/ded/stmtstatus.xhtml` */
export function traces61DedUrl(fileName: string): string {
  const f = fileName
    .replace(/^\/?(app\/ded\/)?/, "")
    .replace(/^\//, "")
  return `${TRACES61_ORIGIN}/app/ded/${f}`
}

/** Hostname for `TRACES61_ORIGIN` (for HTTP `Host` headers). */
export function traces61Host(): string {
  try {
    return new URL(TRACES61_ORIGIN).hostname
  } catch {
    return "traces61.tdscpc.gov.in"
  }
}

/** New SPA TRACES portal host — rewrite to traces61 for legacy automation. */
export const TRACES_NEW_PORTAL_HOST = "traces.tdscpc.gov.in"

/**
 * `Referer` for GET preauthV2 (browser sends the new portal origin).
 * Override with `TRACES_PREAUTH_REFERER` if needed.
 */
export const TRACES_PREAUTH_REFERER =
  process.env.TRACES_PREAUTH_REFERER ?? `https://${TRACES_NEW_PORTAL_HOST}/`

/** If a URL targets the new portal, rewrite it to {@link TRACES61_ORIGIN}. */
export function rewriteTracesNewPortalUrlToTraces61(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname === TRACES_NEW_PORTAL_HOST) {
      u.hostname = traces61Host()
      return u.toString()
    }
  } catch {
    /* ignore */
  }
  return url
}
