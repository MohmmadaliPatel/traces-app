/**
 * One-off probe: drive the Statement Filed Status form once and capture the exact
 * DedStmtStatusServlet request/response contract, so the batch extractor can call the
 * servlet directly instead of driving selects + Go for every FY/quarter/form combination.
 *
 *   node scripts/run-ts.js src/scripts/probeStmtStatus.ts [TAN] [FY] [QUARTER] [FORM]
 *   e.g. ... MUMB21329A 2025 5 24Q      (quarter is the portal code: Q1=3 Q2=4 Q3=5 Q4=6)
 */
import fs from "fs"
import path from "path"
import db from "db"
import {
  attachTraces61RedirectGuard,
  loginWithTracesApiAndPreauth,
  traces61DedUrl,
} from "src/jobs/traces"

const OUT_DIR = path.join(process.cwd(), "public", "pdf", "clause34", "traces-crawl")
const delay = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  const tan = (process.argv[2] || "MUMB21329A").toUpperCase()
  const fy = process.argv[3] || "2025"
  const quarter = process.argv[4] || "5"
  const formType = process.argv[5] || "24Q"

  const company = await db.company.findUnique({ where: { tan } })
  if (!company) throw new Error(`Company ${tan} not found`)
  console.log(`[probe] ${company.name} (${tan}) FY=${fy} Q=${quarter} form=${formType}`)

  const puppeteer = require("puppeteer")
  const browser = await puppeteer.launch({
    headless: process.env.CRAWL_HEADLESS === "1",
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
    executablePath:
      process.platform === "darwin"
        ? "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
        : undefined,
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })

  const captured: any[] = []

  try {
    await loginWithTracesApiAndPreauth(
      page,
      { userId: company.user_id, password: company.password, tan: company.tan },
      { redirectGuard: true }
    )
    await attachTraces61RedirectGuard(page)
    await delay(5000)

    page.on("request", (req: any) => {
      const url = req.url()
      if (/Servlet/i.test(url)) {
        captured.push({
          kind: "request",
          url,
          method: req.method(),
          postData: req.postData() || null,
          headers: req.headers(),
        })
      }
    })
    page.on("response", async (res: any) => {
      const url = res.url()
      if (!/Servlet/i.test(url)) return
      let body = ""
      try {
        body = await res.text()
      } catch {
        /* ignore */
      }
      captured.push({ kind: "response", url, status: res.status(), body: body.slice(0, 6000) })
    })

    await page.goto(traces61DedUrl("stmtstatus.xhtml"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    await delay(3000)

    // Drive the three filters the way the page's own JSF handlers expect.
    for (const [selector, value] of [
      ["#financialYear", fy],
      ["#quarter", quarter],
      ["#formType", formType],
    ] as const) {
      await page.waitForSelector(selector, { visible: true, timeout: 20000 })
      await page.evaluate(
        `(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          el.value = ${JSON.stringify(value)};
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        })()`
      )
      await delay(1500)
      console.log(`[probe] set ${selector} = ${value}`)
    }

    await page.waitForSelector("#clickGo", { visible: true, timeout: 20000 })
    await page.click("#clickGo")
    console.log("[probe] clicked Go")
    await delay(9000)

    const gridDump = await page.evaluate(`(() => {
      const t = document.querySelector("#stmtFiledStatusTab");
      if (!t) return { found: false, tables: Array.from(document.querySelectorAll("table")).map(x => x.id).filter(Boolean) };
      const headers = Array.from(document.querySelectorAll(".ui-jqgrid-labels th")).map(h => (h.textContent||"").trim());
      const rows = Array.from(t.querySelectorAll("tr.jqgrow")).map(r =>
        Array.from(r.querySelectorAll("td")).map(c => (c.textContent||"").trim()));
      return { found: true, headers, rows };
    })()`)

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
    const stem = `stmtstatus-${tan}-${fy}-Q${quarter}-${formType}`
    const out = { tan, fy, quarter, formType, captured, gridDump }
    fs.writeFileSync(path.join(OUT_DIR, `${stem}.json`), JSON.stringify(out, null, 2), "utf-8")
    await page.screenshot({ path: path.join(OUT_DIR, `${stem}.png`), fullPage: true })
    console.log(`[probe] screenshot -> ${path.join(OUT_DIR, `${stem}.png`)}`)

    console.log("\n=== SERVLET CALLS ===")
    for (const c of captured) {
      if (c.kind === "request")
        console.log(`  -> ${c.method} ${c.url}${c.postData ? ` body=${c.postData}` : ""}`)
      else console.log(`  <- ${c.status} ${c.url}\n     ${String(c.body).slice(0, 800)}`)
    }
    console.log("\n=== GRID ===")
    console.log(JSON.stringify(gridDump, null, 2).slice(0, 3000))
  } finally {
    await browser.close().catch(() => undefined)
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("[probe] failed:", e)
    process.exit(1)
  })
