/**
 * Dev tool: record what a Puppeteer flow does on the TRACES legacy portal, so the same
 * flow can be rebuilt over plain HTTP (see `legacyForms.ts`).
 *
 * Patches `require("puppeteer").launch` (the workers call it that way) and, on every page
 * of each launched browser, records into `outDir`:
 *   - every click / type / select / key press the flow makes, with the target element's
 *     outerHTML, its form, the form's live values, and the page HTML just before a click;
 *   - every *.tdscpc.gov.in request (method, URL, form body) and response (status,
 *     Location, Set-Cookie names, body for documents / XHR / scripts);
 *   - native JS dialogs and console errors.
 * Cookie, Authorization and refresh-token values are redacted. `timeline.jsonl` lists the
 * events in order; bodies and DOM snapshots are numbered files next to it.
 */
import fs from "fs"
import path from "path"

const REDACTED_HEADERS = new Set(["cookie", "authorization", "refreshtoken"])

function isTracesUrl(url: string): boolean {
  try {
    return /(^|\.)tdscpc\.gov\.in$/i.test(new URL(url).hostname)
  } catch {
    return false
  }
}

function slug(value: string): string {
  let base = value
  try {
    const u = new URL(value)
    base = u.pathname.split("/").filter(Boolean).slice(-1)[0] || u.hostname
  } catch {
    /* not a URL */
  }
  return base.replace(/[^A-Za-z0-9._-]+/g, "_").slice(0, 60)
}

function redactHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(headers)) {
    const k = key.toLowerCase()
    if (k === "set-cookie") {
      out[key] = String(value)
        .split("\n")
        .map((line) => line.replace(/^([^=]+)=[^;]*/, "$1=<redacted>"))
        .join("\n")
    } else {
      out[key] = REDACTED_HEADERS.has(k) ? "<redacted>" : value
    }
  }
  return out
}

export type PuppeteerTrafficCapture = { outDir: string; restore: () => void }

export function installPuppeteerTrafficCapture(outDir: string): PuppeteerTrafficCapture {
  fs.mkdirSync(outDir, { recursive: true })
  const timeline = path.join(outDir, "timeline.jsonl")
  let seq = 0
  const nextId = () => String(++seq).padStart(4, "0")
  const write = (entry: Record<string, unknown>) =>
    fs.appendFileSync(timeline, JSON.stringify({ t: new Date().toISOString(), ...entry }) + "\n")
  const save = (name: string, content: string | Buffer) => {
    fs.writeFileSync(path.join(outDir, name), content)
    return name
  }
  const seenScripts = new Set<string>()

  const attachPage = (page: any) => {
    if (!page || page.__tracesCapture) return
    page.__tracesCapture = true

    page.on("request", async (req: any) => {
      if (!isTracesUrl(req.url())) return
      const id = nextId()
      req.__captureId = id
      let body: string | undefined = req.postData()
      if (!body && typeof req.hasPostData === "function" && req.hasPostData()) {
        body = await req.fetchPostData().catch(() => undefined)
      }
      write({
        id,
        kind: "request",
        method: req.method(),
        url: req.url(),
        type: req.resourceType(),
        navigation: req.isNavigationRequest(),
        redirectedFrom: req.redirectChain().slice(-2, -1)[0]?.url(),
        headers: redactHeaders(req.headers()),
        body,
      })
    })

    page.on("response", async (res: any) => {
      if (!isTracesUrl(res.url())) return
      const req = res.request()
      const id = req.__captureId ?? nextId()
      const status = res.status()
      const type = req.resourceType()
      const entry: Record<string, unknown> = {
        id,
        kind: "response",
        status,
        url: res.url(),
        type,
        headers: redactHeaders(res.headers()),
      }
      const isRedirect = status >= 300 && status < 400
      const wanted = ["document", "xhr", "fetch", "script", "other"].includes(type)
      if (wanted && !isRedirect && !(type === "script" && seenScripts.has(res.url()))) {
        try {
          const buf: Buffer = await res.buffer()
          if (type === "script") seenScripts.add(res.url())
          const ct = String(res.headers()["content-type"] ?? "")
          const ext = /json/.test(ct) ? "json" : /javascript/.test(ct) || type === "script" ? "js" : /pdf/.test(ct) ? "pdf" : "html"
          entry.bodyFile = save(`${id}-${type}-${slug(res.url())}.${ext}`, buf)
        } catch (err: any) {
          entry.bodyError = String(err?.message || err)
        }
      }
      write(entry)
    })

    page.on("dialog", (dialog: any) =>
      write({ kind: "dialog", type: dialog.type(), message: dialog.message(), defaultValue: dialog.defaultValue() })
    )
    page.on("framenavigated", (frame: any) => {
      if (frame === page.mainFrame()) write({ kind: "navigated", url: frame.url() })
    })
    page.on("console", (msg: any) => {
      if (msg.type() === "error") write({ kind: "console-error", text: msg.text() })
    })

    /** Element + its form's live values (what the browser would submit right now). */
    const describe = (selector: string) =>
      page
        .evaluate((sel: string) => {
          const el = document.querySelector(sel) as HTMLElement | null
          if (!el) return null
          const form = el.closest("form")
          const formState = form
            ? Array.from(form.elements).map((e: any) => ({
                tag: e.tagName.toLowerCase(),
                type: e.type,
                id: e.id || undefined,
                name: e.name || undefined,
                value: e.value,
                checked: e.type === "checkbox" || e.type === "radio" ? e.checked : undefined,
                disabled: e.disabled || undefined,
              }))
            : null
          return {
            outerHTML: el.outerHTML.slice(0, 4000),
            formId: form ? form.id || form.getAttribute("name") : null,
            formAction: form?.getAttribute("action") ?? null,
            formState,
          }
        }, selector)
        .catch((err: any) => ({ error: String(err?.message || err) }))

    const recordAction = async (action: string, selector?: string, extra: Record<string, unknown> = {}, withDom = false) => {
      const id = nextId()
      let domFile: string | undefined
      if (withDom) {
        const html: string = await page.content().catch(() => "")
        if (html) domFile = save(`${id}-dom-before-${slug(action)}.html`, html)
      }
      write({
        id,
        kind: "action",
        action,
        selector,
        url: page.url(),
        element: selector ? await describe(selector) : undefined,
        domFile,
        ...extra,
      })
    }

    const click = page.click.bind(page)
    page.click = async (selector: string, options?: unknown) => {
      await recordAction(`click ${selector}`, selector, {}, true)
      return click(selector, options)
    }
    const type = page.type.bind(page)
    page.type = async (selector: string, text: string, options?: unknown) => {
      await recordAction(`type ${selector}`, selector, { text })
      return type(selector, text, options)
    }
    const select = page.select.bind(page)
    page.select = async (selector: string, ...values: string[]) => {
      await recordAction(`select ${selector}`, selector, { values })
      return select(selector, ...values)
    }
    const keyboard = page.keyboard
    const press = keyboard.press.bind(keyboard)
    keyboard.press = async (key: string, options?: unknown) => {
      await recordAction(`key ${key}`, undefined, {}, true)
      return press(key, options)
    }
  }

  const attachBrowser = (browser: any) => {
    const newPage = browser.newPage.bind(browser)
    browser.newPage = async (...args: unknown[]) => {
      const page = await newPage(...args)
      attachPage(page)
      return page
    }
    browser.on("targetcreated", async (target: any) => {
      if (target.type() === "page") attachPage(await target.page().catch(() => null))
    })
    write({ kind: "browser-launched" })
  }

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const puppeteerModule = require("puppeteer")
  const originalLaunch = puppeteerModule.launch
  puppeteerModule.launch = async (...args: unknown[]) => {
    const browser = await originalLaunch.apply(puppeteerModule, args)
    attachBrowser(browser)
    return browser
  }

  return {
    outDir,
    restore: () => {
      puppeteerModule.launch = originalLaunch
    },
  }
}
