/**
 * Two-pass discovery crawl of the legacy TRACES deductor portal (traces61, JSF).
 *
 *   node scripts/run-ts.js src/scripts/crawlTracesPages.ts [TAN]
 *
 * Pass 1 (inventory) — log in, land on the dashboard and harvest every `/app/ded/*.xhtml`
 *   reference reachable from the DOM (anchors, onclick handlers, form actions) and from the
 *   raw HTML source (catches menu targets built in JS). Merged with the pages this codebase
 *   is already known to use, so the probe never misses a page just because the menu hid it.
 *
 * Pass 2 (probe) — visit each page in turn and record what data it actually offers: title,
 *   reachability, every <select> and its options, inputs, buttons, grid column headers, and
 *   every servlet / XHR the page fires. Saves HTML + screenshot + JSON per page.
 *
 * Outputs to public/pdf/clause34/traces-crawl/:
 *   page-inventory.json      — pass 1 result
 *   page-data-inventory.json — pass 2 result, machine readable
 *   page-data-inventory.md   — pass 2 result, readable
 *   pages/<name>.{html,png,json}
 *
 * Read-only: it navigates and reads. It never clicks a submit/Go control, so no request is
 * ever raised against the deductor's account.
 */
import fs from "fs"
import path from "path"
import db from "db"
import {
  attachTraces61RedirectGuard,
  loginWithTracesApiAndPreauth,
  traces61DedUrl,
  TRACES61_ORIGIN,
  TRACES_NEW_PORTAL_HOST,
} from "src/jobs/traces"

const OUT_DIR = path.join(process.cwd(), "public", "pdf", "clause34", "traces-crawl")
const PAGES_DIR = path.join(OUT_DIR, "pages")

/** Pages this repo already drives — probed even if the menu does not surface them. */
const KNOWN_PAGES = [
  "dashboard.xhtml",
  "stmtstatus.xhtml",
  "filedownload.xhtml",
  "nsdlconsofile.xhtml",
  "downloadreqspec.xhtml",
  "download16.xhtml",
  "download16a.xhtml",
  "justrepdwnld.xhtml",
  "unconschallandetail.xhtml",
  "outstandingdemand.xhtml",
  "dedinbox.xhtml",
  "197certiverfication.xhtml",
]

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

function ensureDirs() {
  for (const dir of [OUT_DIR, PAGES_DIR]) {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  }
}

function log(msg: string, extra?: unknown) {
  if (extra !== undefined) console.log(`[crawl] ${msg}`, extra)
  else console.log(`[crawl] ${msg}`)
}

async function launchBrowser() {
  const puppeteer = require("puppeteer")
  return puppeteer.launch({
    headless: process.env.CRAWL_HEADLESS === "1",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : process.platform === "win32"
        ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe"
        : undefined,
  })
}

// ---------------------------------------------------------------- pass 1

type DiscoveredLink = {
  page: string
  href: string
  text: string
  source: "anchor" | "onclick" | "form" | "html-source"
}

async function discoverPages(page: any): Promise<DiscoveredLink[]> {
  log("pass 1 — harvesting menu / links from dashboard")
  await page.goto(traces61DedUrl("dashboard.xhtml"), {
    waitUntil: "networkidle2",
    timeout: 120000,
  })
  await delay(4000)

  const fromDom: DiscoveredLink[] = await page.evaluate(`(() => {
    const out = [];
    const norm = (raw) => {
      if (!raw) return null;
      const m = String(raw).match(/([A-Za-z0-9_.-]+\\.xhtml)/);
      return m ? m[1] : null;
    };
    document.querySelectorAll("a[href]").forEach((a) => {
      const p = norm(a.getAttribute("href"));
      if (p) out.push({ page: p, href: a.getAttribute("href"), text: (a.textContent || "").trim().replace(/\\s+/g, " "), source: "anchor" });
    });
    document.querySelectorAll("[onclick]").forEach((el) => {
      const p = norm(el.getAttribute("onclick"));
      if (p) out.push({ page: p, href: el.getAttribute("onclick"), text: (el.textContent || "").trim().replace(/\\s+/g, " "), source: "onclick" });
    });
    document.querySelectorAll("form[action]").forEach((f) => {
      const p = norm(f.getAttribute("action"));
      if (p) out.push({ page: p, href: f.getAttribute("action"), text: "(form action)", source: "form" });
    });
    return out;
  })()`)

  // JS-built menus: scrape the raw document for anything that looks like a ded page.
  const html: string = await page.content()
  const fromSource: DiscoveredLink[] = [
    ...new Set((html.match(/[A-Za-z0-9_.-]+\.xhtml/g) || []).map((s) => s)),
  ].map((p) => ({ page: p, href: p, text: "", source: "html-source" as const }))

  fs.writeFileSync(path.join(OUT_DIR, "dashboard.html"), html, "utf-8")

  const all = [...fromDom, ...fromSource]
  const seen = new Set<string>()
  const merged: DiscoveredLink[] = []
  for (const link of all) {
    const key = `${link.page}|${link.source}|${link.text}`
    if (seen.has(key)) continue
    seen.add(key)
    merged.push(link)
  }

  const uniquePages = [...new Set(merged.map((l) => l.page))]
  log(`pass 1 — ${uniquePages.length} distinct page(s) referenced`, uniquePages)
  return merged
}

// ---------------------------------------------------------------- pass 2

type PageProbe = {
  page: string
  requestedUrl: string
  finalUrl: string
  title: string
  reachable: boolean
  notFound: boolean
  menuLabels: string[]
  selects: { id: string; name: string; options: { value: string; text: string }[] }[]
  inputs: { id: string; name: string; type: string }[]
  buttons: { id: string; text: string }[]
  grids: { id: string; headers: string[] }[]
  tableCount: number
  xhr: { url: string; status: number; contentType: string; sample: string }[]
  bodyText: string
  error?: string
}

const PROBE_SCRIPT = `(() => {
  const txt = (el) => (el.textContent || "").trim().replace(/\\s+/g, " ");
  const selects = Array.from(document.querySelectorAll("select")).map((s) => ({
    id: s.id || "", name: s.getAttribute("name") || "",
    options: Array.from(s.options).map((o) => ({ value: o.value, text: txt(o) })),
  }));
  const inputs = Array.from(document.querySelectorAll("input")).map((i) => ({
    id: i.id || "", name: i.getAttribute("name") || "", type: i.getAttribute("type") || "text",
  })).filter((i) => i.id || i.name);
  const buttons = Array.from(document.querySelectorAll("button, input[type=button], input[type=submit], a.btn")).map((b) => ({
    id: b.id || "", text: txt(b) || b.getAttribute("value") || "",
  })).filter((b) => b.id || b.text);
  const grids = Array.from(document.querySelectorAll("table")).map((t) => ({
    id: t.id || "",
    headers: Array.from(t.querySelectorAll("th")).map(txt).filter(Boolean),
  })).filter((g) => g.headers.length > 0);
  const body = document.body ? txt(document.body) : "";
  return {
    title: document.title || "",
    selects, inputs, buttons, grids,
    tableCount: document.querySelectorAll("table").length,
    bodyText: body.slice(0, 4000),
    notFound: /page not found|requested resource could not be found|not authorized/i.test(body + " " + document.title),
  };
})()`

/** True when TRACES has bounced us off the legacy app back to the new SPA / login. */
function isSessionLost(url: string): boolean {
  return (
    url.includes(TRACES_NEW_PORTAL_HOST) || /\/auth\/?$/.test(url) || url.includes("login.xhtml")
  )
}

function probeJsonPath(pageName: string): string {
  return path.join(PAGES_DIR, `${pageName.replace(/[^A-Za-z0-9_.-]/g, "_")}.json`)
}

/** Rebuild the aggregate from the per-page JSONs, so a mid-run crash never loses work. */
function collectProbesFromDisk(pageNames: string[]): PageProbe[] {
  const out: PageProbe[] = []
  for (const name of pageNames) {
    const file = probeJsonPath(name)
    if (!fs.existsSync(file)) continue
    try {
      out.push(JSON.parse(fs.readFileSync(file, "utf-8")))
    } catch {
      /* skip a half-written file */
    }
  }
  return out
}

async function probePage(page: any, pageName: string): Promise<PageProbe> {
  const requestedUrl = traces61DedUrl(pageName)
  const xhr: PageProbe["xhr"] = []

  const onResponse = async (response: any) => {
    const url = response.url()
    if (!/\/app\/(srv|ded)\/|Servlet/i.test(url)) return
    if (url === requestedUrl) return
    const contentType = String(response.headers()["content-type"] || "")
    let sample = ""
    try {
      if (/json|text/i.test(contentType)) sample = (await response.text()).slice(0, 1500)
    } catch {
      /* body already consumed or navigation raced it */
    }
    xhr.push({ url, status: response.status(), contentType, sample })
  }

  page.on("response", onResponse)
  try {
    // domcontentloaded, not networkidle2: several TRACES pages poll forever and never idle.
    await page.goto(requestedUrl, { waitUntil: "domcontentloaded", timeout: 60000 })
    await delay(3000)

    if (isSessionLost(page.url())) {
      throw new Error(`SESSION_LOST (landed on ${page.url()})`)
    }

    const probe: any = await page.evaluate(PROBE_SCRIPT)
    const menuLabels: string[] = await page.evaluate(
      `Array.from(document.querySelectorAll("#menu a, .menu a, ul.nav a, li a")).map((a) => (a.textContent||"").trim().replace(/\\s+/g," ")).filter(Boolean).slice(0, 120)`
    )

    const safe = pageName.replace(/[^A-Za-z0-9_.-]/g, "_")
    fs.writeFileSync(path.join(PAGES_DIR, `${safe}.html`), await page.content(), "utf-8")
    await page.screenshot({ path: path.join(PAGES_DIR, `${safe}.png`), fullPage: true })

    const result: PageProbe = {
      page: pageName,
      requestedUrl,
      finalUrl: page.url(),
      title: probe.title,
      reachable: !probe.notFound,
      notFound: probe.notFound,
      menuLabels,
      selects: probe.selects,
      inputs: probe.inputs,
      buttons: probe.buttons,
      grids: probe.grids,
      tableCount: probe.tableCount,
      xhr,
      bodyText: probe.bodyText,
    }
    fs.writeFileSync(path.join(PAGES_DIR, `${safe}.json`), JSON.stringify(result, null, 2), "utf-8")
    return result
  } catch (error: any) {
    return {
      page: pageName,
      requestedUrl,
      finalUrl: "",
      title: "",
      reachable: false,
      notFound: false,
      menuLabels: [],
      selects: [],
      inputs: [],
      buttons: [],
      grids: [],
      tableCount: 0,
      xhr,
      bodyText: "",
      error: String(error?.message || error),
    }
  } finally {
    page.off("response", onResponse)
  }
}

// ---------------------------------------------------------------- report

function writeReport(tan: string, links: DiscoveredLink[], probes: PageProbe[], relogins: number) {
  fs.writeFileSync(
    path.join(OUT_DIR, "page-data-inventory.json"),
    JSON.stringify({ tan, crawledAt: new Date().toISOString(), relogins, probes }, null, 2),
    "utf-8"
  )
  writeMarkdown(tan, links, probes)
}

function writeMarkdown(tan: string, links: DiscoveredLink[], probes: PageProbe[]) {
  const lines: string[] = []
  lines.push(`# TRACES legacy portal — page & data inventory`)
  lines.push("")
  lines.push(
    `Crawled ${new Date().toISOString()} as TAN \`${tan}\` against \`${TRACES61_ORIGIN}\`.`
  )
  lines.push("")
  lines.push(
    `Pass 1 found **${new Set(links.map((l) => l.page)).size}** referenced pages; pass 2 probed **${
      probes.length
    }** of them, **${probes.filter((p) => p.reachable).length}** reachable.`
  )
  lines.push("")

  lines.push(`## Summary`)
  lines.push("")
  lines.push(`| Page | Title | Reachable | Selects | Grids | Servlet calls |`)
  lines.push(`|---|---|---|---|---|---|`)
  for (const p of probes) {
    lines.push(
      `| \`${p.page}\` | ${p.title || "—"} | ${p.reachable ? "yes" : p.error ? "error" : "no"} | ${
        p.selects.length
      } | ${p.grids.length} | ${p.xhr.length} |`
    )
  }
  lines.push("")

  lines.push(`## Per-page detail`)
  for (const p of probes) {
    lines.push("")
    lines.push(`### \`${p.page}\` — ${p.title || "(no title)"}`)
    lines.push("")
    lines.push(`- URL: ${p.requestedUrl}`)
    if (p.finalUrl && p.finalUrl !== p.requestedUrl) lines.push(`- Redirected to: ${p.finalUrl}`)
    lines.push(`- Reachable: ${p.reachable ? "yes" : "no"}`)
    if (p.error) lines.push(`- Error: ${p.error}`)

    if (p.selects.length) {
      lines.push(`- Filters:`)
      for (const s of p.selects) {
        const opts = s.options
          .slice(0, 12)
          .map((o) => `${o.text || "(blank)"}=${o.value}`)
          .join(", ")
        lines.push(
          `  - \`#${s.id || s.name}\` → ${s.options.length} option(s): ${opts}${
            s.options.length > 12 ? ", …" : ""
          }`
        )
      }
    }
    if (p.grids.length) {
      lines.push(`- Grid columns:`)
      for (const g of p.grids) {
        lines.push(`  - \`${g.id || "(unnamed table)"}\`: ${g.headers.join(" | ")}`)
      }
    }
    if (p.xhr.length) {
      lines.push(`- Servlet / XHR calls observed:`)
      for (const x of p.xhr) {
        lines.push(`  - \`${x.url}\` → ${x.status} ${x.contentType}`)
        if (x.sample) lines.push(`    - sample: \`${x.sample.slice(0, 300).replace(/`/g, "'")}\``)
      }
    }
    if (p.buttons.length) {
      lines.push(
        `- Controls: ${p.buttons
          .slice(0, 15)
          .map((b) => (b.id ? `#${b.id}` : b.text))
          .join(", ")}`
      )
    }
  }

  fs.writeFileSync(path.join(OUT_DIR, "page-data-inventory.md"), lines.join("\n"), "utf-8")
}

// ---------------------------------------------------------------- main

/**
 * Open a freshly logged-in page with the traces61 redirect guard attached.
 *
 * The guard matters: without it a GET that TRACES decides to bounce lands on the new SPA
 * (`traces.tdscpc.gov.in/auth/`), which detaches the frame and poisons every later probe.
 */
async function createSession(browser: any, company: any) {
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  await loginWithTracesApiAndPreauth(
    page,
    { userId: company.user_id, password: company.password, tan: company.tan },
    { redirectGuard: true }
  )
  await attachTraces61RedirectGuard(page)
  // Session cookies need a beat after API login before /app/ded pages answer.
  await delay(5000)
  return page
}

async function main() {
  ensureDirs()
  const tan = (process.argv[2] || "MUMB21329A").toUpperCase()

  const company = await db.company.findUnique({ where: { tan } })
  if (!company) throw new Error(`Company ${tan} not found — run importClause34Companies.ts first`)
  log(`using ${company.name} (${tan})`)

  const browser = await launchBrowser()
  let page: any = null

  try {
    log("logging in to TRACES…")
    page = await createSession(browser, company)
    log("login ok")

    const links = await discoverPages(page)
    fs.writeFileSync(
      path.join(OUT_DIR, "page-inventory.json"),
      JSON.stringify({ tan, crawledAt: new Date().toISOString(), links }, null, 2),
      "utf-8"
    )

    const discovered = [...new Set(links.map((l) => l.page))]
    const toProbe = [...new Set([...KNOWN_PAGES, ...discovered])]
      .filter((p) => !/^(login|preauth|error|logout)/i.test(p))
      .filter((p) => !/\.js\.xhtml$/i.test(p))
      .sort()

    // Resume: a probe that already wrote its JSON is not repeated, so a captcha failure
    // part-way through costs only the pages that were still outstanding.
    const force = process.env.CRAWL_FORCE === "1"
    const pending = toProbe.filter((name) => force || !fs.existsSync(probeJsonPath(name)))
    log(`pass 2 — ${toProbe.length} page(s) in scope, ${pending.length} still to probe`)

    let relogins = 0
    for (const [i, pageName] of pending.entries()) {
      log(`  [${i + 1}/${pending.length}] ${pageName}`)
      let probe = await probePage(page, pageName)

      // A lost session or a detached frame makes every later probe fail too — rebuild and retry once.
      const needsRecovery =
        probe.error && /SESSION_LOST|detached|Target closed|Session closed/i.test(probe.error)
      if (needsRecovery) {
        relogins++
        log(`      session lost (${probe.error}) — re-logging in (${relogins})`)
        await page.close().catch(() => undefined)
        // Back off before asking the captcha solver again; rapid repeat logins make it miss.
        await delay(10000 + relogins * 5000)
        page = await createSession(browser, company)
        probe = await probePage(page, pageName)
      }

      log(
        `      ${probe.reachable ? "ok" : probe.error ? "ERROR" : "not found"} — "${
          probe.title
        }" ` +
          `selects=${probe.selects.length} grids=${probe.grids.length} xhr=${probe.xhr.length}` +
          (probe.error ? ` :: ${probe.error.slice(0, 80)}` : "")
      )
      await delay(1500)
    }

    const probes = collectProbesFromDisk(toProbe)
    writeReport(tan, links, probes, relogins)
    log(
      `done — ${probes.filter((p) => p.reachable).length}/${
        probes.length
      } reachable, ${relogins} re-login(s)`
    )
    log(`output: ${OUT_DIR}`)
  } finally {
    await browser.close().catch(() => undefined)
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[crawl] failed:", err)
    process.exit(1)
  })
