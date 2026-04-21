import { AxiosInstance } from "axios"
import {
  createTracesHttp,
  createAuthenticatedTracesClient,
  resolveCaptchaFromImageBase64,
  generateCaptcha,
  loginTraces,
} from "./traces"
import { fetchCertificateStatistics } from "./traces/dashboard"

export {
  createTracesHttp,
  createAuthenticatedTracesClient,
  resolveCaptchaFromImageBase64,
  generateCaptcha,
  loginTraces,
} from "./traces"
export type { TracesLoginResponse, GenerateCaptchaResponse } from "./traces/types"

/** @deprecated Use createAuthenticatedTracesClient from ./traces */
export function createTracesApiClient() {
  return createTracesHttp()
}

/** @deprecated Use createAuthenticatedTracesClient from ./traces */
export function createAuthedTracesClient(accessToken: string) {
  return createAuthenticatedTracesClient(accessToken)
}

export { fetchCertificateStatistics } from "./traces/dashboard"

/**
 * Full flow: captcha → login → bearer → certificate-Statistics (logged).
 * Env: TRACES_TAN (preferred) or TRACES_USER_ID (TAN for API userId), TRACES_PASSWORD, TRACES_FIN_YEAR (default 2026).
 */
export async function runTracesApiDashboardProbe(client?: AxiosInstance): Promise<void> {
  const tan = process.env.TRACES_TAN ?? process.env.TRACES_USER_ID
  const password = process.env.TRACES_PASSWORD
  const finYear = process.env.TRACES_FIN_YEAR ?? "2026"

  if (!tan || !password) {
    throw new Error("Set TRACES_TAN (or TRACES_USER_ID as TAN) and TRACES_PASSWORD in the environment.")
  }

  const http = client ?? createTracesHttp()

  console.log("Fetching captcha…")
  const captchaMeta = await generateCaptcha(http)
  const captchaText = await resolveCaptchaFromImageBase64(captchaMeta.image)
  console.log("Captcha resolved, logging in…")

  const loginRes = await loginTraces(http, {
    tan,
    password,
    captcha: captchaText,
    captchaId: captchaMeta.id,
  })

  const accessToken = loginRes.authTokenDto!.accessToken!
  console.log("Login OK; access token received.")

  const authed = createAuthenticatedTracesClient(accessToken)
  const stats = await fetchCertificateStatistics(authed, { userId: tan, finYear })
  console.log("certificate-Statistics response:", JSON.stringify(stats, null, 2))
}

export default class NoticeDownloaderTracesApi {
  client: AxiosInstance

  constructor() {
    this.client = createTracesHttp()
  }

  async runDashboardProbe(): Promise<void> {
    return runTracesApiDashboardProbe(this.client)
  }
}

const isDirectRun =
  typeof process !== "undefined" && process.argv[1]?.includes("NoticeDownloader-tracesApi")

if (isDirectRun) {
  void runTracesApiDashboardProbe().catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
}
