import type { Page, ElementHandle } from "puppeteer"

const FILE = "src/utils/puppeteerWaits.ts"

function log(fn: string, message: string, detail?: string) {
  const extra = detail ? ` ${detail}` : ""
  console.log(`[PUPPETEER_WAITS] ${FILE} · ${fn} — ${message}${extra}`)
}

export type WaitForSelectorLongOptions = {
  /** Total time to keep trying (default 5 minutes) */
  timeoutMs?: number
  /** How often to re-check for the element (default 10 seconds) */
  pollIntervalMs?: number
  /** Whether the element must be visible (default true for robustness) */
  visible?: boolean
  /** Optional human-friendly name for logging */
  label?: string
}

export type WaitForEitherSelectorLongOptions = WaitForSelectorLongOptions & {
  /** Optional human-friendly name for the group of selectors */
  label?: string
}

/**
 * Waits for a selector up to 5 minutes by default, polling every 10s.
 * Resilient to transient Puppeteer protocol / navigation errors:
 * if the page is temporarily unresponsive or context is lost during a slow load,
 * it will keep retrying until the element appears or hard timeout.
 *
 * Use this after any click or navigation where the next expected element
 * may take a long time (>30s) to appear due to network/server delay.
 */
export async function waitForSelectorLong(
  page: Page,
  selector: string,
  options: WaitForSelectorLongOptions = {}
): Promise<ElementHandle<Element>> {
  const fn = "waitForSelectorLong"
  const timeoutMs = options.timeoutMs ?? 300000 // 5 minutes
  const pollIntervalMs = options.pollIntervalMs ?? 10000 // 10 seconds
  const visible = options.visible ?? true
  const label = options.label ?? selector

  const start = Date.now()
  let lastError: any = null
  let attempt = 0

  log(
    fn,
    `start waiting for ${label}`,
    `timeout=${timeoutMs}ms poll=${pollIntervalMs}ms visible=${visible}`
  )

  while (Date.now() - start < timeoutMs) {
    attempt++

    // Fast-fail: if the TRACES "Requested resource could not be found" error page appears
    // during a long wait (e.g. after a navigation or click), abort immediately and let
    // the caller close the browser and retry the whole flow from the start.
    try {
      if (await isResourceNotFoundErrorOnPage(page)) {
        const errMsg = `RESOURCE_NOT_FOUND_ERROR: "Requested resource could not be found" page appeared while waiting for ${label}`
        log(fn, errMsg, `attempt=${attempt} elapsed=${Date.now() - start}ms`)
        throw new Error(errMsg)
      }
    } catch (chkErr: any) {
      if (/RESOURCE_NOT_FOUND_ERROR/i.test(chkErr?.message || "")) {
        throw chkErr
      }
      // Otherwise ignore transient check errors and continue polling
    }

    try {
      // Prefer $ over waitForSelector inside loop so we control the polling and error handling.
      const el = await page.$(selector)
      if (el) {
        if (visible) {
          const isVisible = await page.evaluate((sel) => {
            const node = document.querySelector(sel)
            if (!node) return false
            const style = window.getComputedStyle(node as Element)
            const rect = (node as Element).getBoundingClientRect()
            return (
              style &&
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              style.opacity !== "0" &&
              rect.width > 0 &&
              rect.height > 0
            )
          }, selector)
          if (isVisible) {
            log(fn, `found visible ${label}`, `attempt=${attempt} elapsed=${Date.now() - start}ms`)
            return el
          }
          // Not yet visible, continue polling
        } else {
          log(fn, `found ${label}`, `attempt=${attempt} elapsed=${Date.now() - start}ms`)
          return el
        }
      }
    } catch (err: any) {
      // Transient errors are common during slow navigations or context swaps.
      // Log at debug level and keep going.
      lastError = err
      const msg = err?.message || String(err)
      if (!msg.includes("Protocol error") && !msg.includes("Execution context was destroyed")) {
        // Only log non-common transient noises
        log(fn, `transient error while looking for ${label}`, msg.slice(0, 200))
      }
    }

    // Small delay before next poll
    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  // Final attempt with native waitForSelector to give a clear error if possible
  try {
    const el = await page.waitForSelector(selector, {
      visible,
      timeout: 5000,
    })
    if (el) {
      log(fn, `late find for ${label} (after hard timeout)`, `still succeeded`)
      return el
    }
  } catch (e) {
    lastError = e
  }

  const elapsed = Date.now() - start
  const errMsg = lastError?.message || String(lastError) || "unknown"
  log(fn, `timed out waiting for ${label}`, `elapsed=${elapsed}ms lastErr=${errMsg.slice(0, 200)}`)
  throw new Error(
    `waitForSelectorLong: could not find ${label} within ${timeoutMs}ms (polling every ${pollIntervalMs}ms). Last error: ${errMsg}`
  )
}

/**
 * Waits for ANY of the provided selectors (first match wins).
 * Useful when the next UI state can be one of several possible elements.
 */
export async function waitForEitherSelectorLong(
  page: Page,
  selectors: string[],
  options: WaitForEitherSelectorLongOptions = {}
): Promise<{ element: ElementHandle<Element>; matchedSelector: string }> {
  const fn = "waitForEitherSelectorLong"
  const timeoutMs = options.timeoutMs ?? 300000
  const pollIntervalMs = options.pollIntervalMs ?? 10000
  const visible = options.visible ?? true
  const label = options.label ?? selectors.join(" | ")

  const start = Date.now()
  let attempt = 0
  let lastError: any = null

  log(
    fn,
    `start waiting for any of [${selectors.join(", ")}]`,
    `timeout=${timeoutMs}ms poll=${pollIntervalMs}ms`
  )

  while (Date.now() - start < timeoutMs) {
    attempt++

    // Fast-fail on the "Requested resource could not be found" error page during polling.
    try {
      if (await isResourceNotFoundErrorOnPage(page)) {
        const errMsg = `RESOURCE_NOT_FOUND_ERROR: "Requested resource could not be found" page appeared while waiting for any of [${selectors.join(", ")}]`
        log(fn, errMsg, `attempt=${attempt} elapsed=${Date.now() - start}ms`)
        throw new Error(errMsg)
      }
    } catch (chkErr: any) {
      if (/RESOURCE_NOT_FOUND_ERROR/i.test(chkErr?.message || "")) {
        throw chkErr
      }
    }

    for (const sel of selectors) {
      try {
        const el = await page.$(sel)
        if (el) {
          if (visible) {
            const isVisible = await page.evaluate((s) => {
              const node = document.querySelector(s)
              if (!node) return false
              const style = window.getComputedStyle(node as Element)
              const rect = (node as Element).getBoundingClientRect()
              return (
                style &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                style.opacity !== "0" &&
                rect.width > 0 &&
                rect.height > 0
              )
            }, sel)
            if (isVisible) {
              log(
                fn,
                `found ${sel} (from ${label})`,
                `attempt=${attempt} elapsed=${Date.now() - start}ms`
              )
              return { element: el, matchedSelector: sel }
            }
          } else {
            log(
              fn,
              `found ${sel} (from ${label})`,
              `attempt=${attempt} elapsed=${Date.now() - start}ms`
            )
            return { element: el, matchedSelector: sel }
          }
        }
      } catch (err: any) {
        lastError = err
        const msg = err?.message || String(err)
        if (!msg.includes("Protocol error") && !msg.includes("Execution context")) {
          log(fn, `transient error checking ${sel}`, msg.slice(0, 160))
        }
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs))
  }

  // One last short native attempt for the first selector to surface a good error
  try {
    const firstSel = selectors[0]
    if (firstSel) {
      const el = await page.waitForSelector(firstSel, { visible, timeout: 3000 })
      if (el) {
        return { element: el, matchedSelector: firstSel }
      }
    }
  } catch (e) {
    lastError = e
  }

  const elapsed = Date.now() - start
  const errMsg = lastError?.message || String(lastError) || "unknown"
  const safeLabel = label || selectors.join(" | ")
  log(fn, `timed out waiting for any of [${selectors.join(", ")}]`, `elapsed=${elapsed}ms`)
  throw new Error(
    `waitForEitherSelectorLong: none of [${selectors.join(
      ", "
    )}] appeared for ${safeLabel} within ${timeoutMs}ms. Last error: ${errMsg}`
  )
}

/**
 * Helper to detect if the current page is showing the TRACES "Requested resource could not be found" error.
 * This is a dead-end error page that can appear after navigations or clicks due to session/state issues.
 * When detected, callers should close the browser and retry the whole flow from login.
 */
export async function isResourceNotFoundErrorOnPage(page: Page): Promise<boolean> {
  try {
    const isNotFound = await page.evaluate(() => {
      const bodyHtml = (document.body?.innerHTML || "").toLowerCase()

      // Primary signal: the exact message in the provided HTML structure
      if (bodyHtml.includes("requested resource could not be found")) {
        return true
      }

      // Check the specific structure from the error page:
      // <div id="content"> ... <h5 class="fieldLevelInfo ..."> ... <span class="infoMsg">Requested resource could not be found</span>
      const content = document.getElementById("content")
      if (content) {
        const infoMsg = content.querySelector(".infoMsg, span.infoMsg")
        if (infoMsg && /requested resource could not be found/i.test(infoMsg.textContent || "")) {
          return true
        }
        // Also accept if the whole content block contains the phrase
        if (/requested resource could not be found/i.test(content.textContent || "")) {
          return true
        }
      }

      // Fallbacks: look for the h5 with the class or the go-home button on that error page
      const h5Info = document.querySelector("h5.fieldLevelInfo")
      if (h5Info && /requested resource could not be found/i.test(h5Info.textContent || "")) {
        return true
      }

      const goHome = document.querySelector('input.button[value*="Go to Home" i], input.button[onclick*="home.html" i]')
      if (goHome && /requested resource could not be found/i.test(document.body?.textContent || "")) {
        return true
      }

      return false
    })
    return !!isNotFound
  } catch {
    // Eval failed (navigation, context destroyed, etc.) — treat as not this error for now.
    // The outer retry logic or subsequent checks will catch the real state.
    return false
  }
}

/**
 * Helper to detect if the current page is showing a TRACES captcha challenge.
 * Call this after critical clicks/submits where a secondary captcha may appear.
 */
export async function isCaptchaChallengeOnPage(page: Page): Promise<boolean> {
  try {
    const hasCaptcha = await page.evaluate(() => {
      const html = (document.body?.innerHTML || "").toLowerCase()
      if (html.includes("captcha") || html.includes("verification code")) return true

      const captchaInputs = document.querySelectorAll(
        'input[name*="captcha" i], input[id*="captcha" i], input[placeholder*="captcha" i], #j_captcha, input[name="j_captcha"]'
      )
      if (captchaInputs.length > 0) return true

      const captchaImgs = document.querySelectorAll(
        'img[src*="captcha" i], img[src*="Captcha" i], img[alt*="captcha" i], img[title*="captcha" i]'
      )
      if (captchaImgs.length > 0) return true

      // Common TRACES captcha container ids/classes seen in practice
      if (
        document.querySelector("#captcha, .captcha, [id*='captcha'], [class*='captcha']")
      ) {
        return true
      }

      return false
    })
    return !!hasCaptcha
  } catch {
    // If evaluation fails due to navigation, treat as no captcha (the outer retry logic will handle page state)
    return false
  }
}

/**
 * Convenience: after a click or navigation, wait for a selector using the long 5min/10s poll.
 * Throws only after full timeout. Transient errors are swallowed during polling.
 */
export async function waitAfterActionForSelector(
  page: Page,
  selector: string,
  actionDescription: string,
  options: WaitForSelectorLongOptions = {}
): Promise<ElementHandle<Element>> {
  log(
    "waitAfterActionForSelector",
    `after ${actionDescription}, waiting for ${selector}`
  )
  return waitForSelectorLong(page, selector, {
    ...options,
    label: `${selector} (after ${actionDescription})`,
  })
}

export const DEFAULT_LONG_WAIT = {
  timeoutMs: 300000,
  pollIntervalMs: 10000,
} as const
