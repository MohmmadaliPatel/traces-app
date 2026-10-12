import puppeteer, { Browser, Page } from "puppeteer"
import { loginWithTracesApiAndPreauth, type LoginWithTracesApiAndPreauthOptions } from "./puppeteerSession"

export type TracesSession = {
  browser: Browser
  page: Page
  /** Closes the browser. Safe to call more than once. */
  close: () => Promise<void>
}

export type OpenTracesSessionOptions = {
  /** Chrome launch args (defaults suit headless servers). */
  args?: string[]
  /** Pass null to use the window size instead of the 800x600 default viewport. */
  defaultViewport?: null
  /** Runs on the new page before login, e.g. to set the download folder. */
  beforeLogin?: (page: Page) => Promise<void>
  login?: LoginWithTracesApiAndPreauthOptions
}

const DEFAULT_ARGS = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"]

export function chromeExecutablePath(): string | undefined {
  if (process.platform === "darwin") return "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
  if (process.platform === "win32") return "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
  return undefined // Linux: Puppeteer's bundled Chrome
}

/**
 * Launch a fresh browser and log in to TRACES with exactly these credentials.
 *
 * One browser per API call: a session is never kept between calls, so a request for one
 * company can never run on another company's TRACES login (which a shared module-level page
 * did, saving that company's data under the wrong companyId). Always call `close()` in a
 * `finally`; if login fails the browser is closed before the error is rethrown.
 */
export async function openTracesSession(
  credentials: { userId: string; password: string; tan?: string },
  options: OpenTracesSessionOptions = {}
): Promise<TracesSession> {
  const browser = await puppeteer.launch({
    headless: false,
    ...(options.defaultViewport === null ? { defaultViewport: null } : {}),
    args: options.args ?? DEFAULT_ARGS,
    executablePath: chromeExecutablePath(),
  })

  let closed = false
  const close = async () => {
    if (closed) return
    closed = true
    await browser.close().catch((err) => console.warn(`[TRACES] browser close failed: ${err?.message || err}`))
  }

  try {
    const page = await browser.newPage()
    if (options.beforeLogin) await options.beforeLogin(page)
    await loginWithTracesApiAndPreauth(page, credentials, options.login)
    return { browser, page, close }
  } catch (err) {
    await close()
    throw err
  }
}
