import type { Page } from "puppeteer"
import { createTracesHttp } from "./http"
import { generateCaptcha, loginTraces } from "./auth"
import { resolveCaptchaFromImageBase64 } from "./captchaDecode"
import { TRACES61_DASHBOARD_URL } from "./constants"
import {
  fetchPreauthV2SetCookieLines,
  setCookieLinesToPuppeteerCookies,
  traces61CookieUrl,
} from "./preauth"

export async function applyTraces61Session(
  page: Page,
  accessToken: string,
  options?: { skipDashboard?: boolean }
): Promise<void> {
  const lines = await fetchPreauthV2SetCookieLines(accessToken)
  const jarUrl = traces61CookieUrl()
  const cookies = await setCookieLinesToPuppeteerCookies(lines, jarUrl)
  if (cookies.length > 0) {
    await page.setCookie(...cookies)
  }
  if (!options?.skipDashboard) {
    await page.goto(TRACES61_DASHBOARD_URL, {
      waitUntil: "networkidle2",
      timeout: 120000,
    })
  }
}

/**
 * New TRACES flow: API captcha + login → Bearer → GET preauthV2 → cookies → dashboard.
 */
export async function loginWithTracesApiAndPreauth(
  page: Page,
  credentials: { userId: string; password: string; tan?: string }
): Promise<void> {
  const http = createTracesHttp()
  const captchaMeta = await generateCaptcha(http)
  const captchaText = await resolveCaptchaFromImageBase64(captchaMeta.image)
  const loginRes = await loginTraces(http, {
    tan: credentials.tan,
    userId: credentials.userId,
    password: credentials.password,
    captcha: captchaText,
    captchaId: captchaMeta.id,
  })
  const accessToken = loginRes.authTokenDto?.accessToken
  if (!accessToken) {
    throw new Error("TRACES API login did not return authTokenDto.accessToken")
  }
  await applyTraces61Session(page, accessToken)
}
