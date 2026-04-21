/**
 * TRACES legacy JSF app (post–preauth cookie bridge).
 * Override via env if the portal moves.
 */
export const TRACES61_ORIGIN = process.env.TRACES61_ORIGIN ?? "https://traces61.tdscpc.gov.in"

export const TRACES61_PREAUTH_V2_URL =
  process.env.TRACES61_PREAUTH_V2_URL ?? `${TRACES61_ORIGIN}/app/preauthV2.xhtml`

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

/** Full URL under `/app/ded/` e.g. `stmtstatus.xhtml` → `.../app/ded/stmtstatus.xhtml` */
export function traces61DedUrl(fileName: string): string {
  const f = fileName
    .replace(/^\/?(app\/ded\/)?/, "")
    .replace(/^\//, "")
  return `${TRACES61_ORIGIN}/app/ded/${f}`
}
