/**
 * Probe TRACES "Challan Status for Statement" (`chalnstmt.xhtml`) — the portal's own view of the
 * challans inside one filed statement. Used to verify clause 34(c) against the portal rather
 * than against the conso file the figures were extracted from.
 *
 *   node scripts/run-ts.js src/scripts/probeChallanStatus.ts [TAN] [FY] [QUARTER] [FORM]
 *   quarter is the portal code: Q1=3 Q2=4 Q3=5 Q4=6
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
  const tan = (process.argv[2] || "MUMW04565B").toUpperCase()
  const fy = process.argv[3] || "2025"
  const quarter = process.argv[4] || "4"
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

    page.on("response", async (res: any) => {
      const url = res.url()
      if (!/Servlet|\.xhtml/i.test(url)) return
      let body = ""
      try {
        const ct = String(res.headers()["content-type"] || "")
        if (/json|text\/plain/i.test(ct)) body = (await res.text()).slice(0, 8000)
      } catch {
        /* ignore */
      }
      if (body) captured.push({ url, status: res.status(), body })
    })

    await page.goto(traces61DedUrl("chalnstmt.xhtml"), {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    })
    await delay(3000)

    for (const [sel, val] of [
      ["#financialYear", fy],
      ["#quarter", quarter],
      ["#formType", formType],
    ] as const) {
      await page.waitForSelector(sel, { visible: true, timeout: 20000 })
      await page.evaluate(
        `(() => { const el=document.querySelector(${JSON.stringify(sel)});
          if(!el) return false; el.value=${JSON.stringify(val)};
          el.dispatchEvent(new Event("change",{bubbles:true})); return true; })()`
      )
      await delay(1500)
      console.log(`[probe] set ${sel} = ${val}`)
    }

    await page.waitForSelector("#clickGo", { visible: true, timeout: 20000 })
    await page.click("#clickGo")
    console.log("[probe] clicked Go")
    await delay(10000)

    const dump = await page.evaluate(`(() => {
      const txt = (el) => (el.textContent||"").trim().replace(/\\s+/g," ");
      const tables = Array.from(document.querySelectorAll("table")).map((t) => ({
        id: t.id || "",
        headers: Array.from(t.querySelectorAll("th")).map(txt).filter(Boolean),
        rows: Array.from(t.querySelectorAll("tr")).map((r) =>
          Array.from(r.querySelectorAll("td")).map(txt)).filter((r) => r.length && r.some(Boolean)),
      })).filter((t) => t.headers.length || t.rows.length);
      return { url: location.href, title: document.title, tables,
               body: (document.body.innerText||"").replace(/\\s+/g," ").slice(0,2500) };
    })()`)

    if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true })
    const stem = `chalnstmt-${tan}-${fy}-Q${quarter}-${formType}`
    fs.writeFileSync(path.join(OUT_DIR, `${stem}.json`), JSON.stringify({ dump, captured }, null, 2))
    await page.screenshot({ path: path.join(OUT_DIR, `${stem}.png`), fullPage: true })

    console.log(`\nURL: ${(dump as any).url}\nTITLE: ${(dump as any).title}`)
    for (const t of (dump as any).tables) {
      if (!t.rows.length && !t.headers.length) continue
      console.log(`\nTABLE ${t.id || "(unnamed)"}`)
      if (t.headers.length) console.log("  H: " + t.headers.join(" | "))
      t.rows.slice(0, 12).forEach((r: string[]) => console.log("  R: " + r.join(" | ")))
    }
    console.log("\nSERVLET CALLS:")
    captured.forEach((c) => console.log(`  ${c.status} ${c.url}\n     ${c.body.slice(0, 600)}`))
    console.log(`\nscreenshot -> ${path.join(OUT_DIR, `${stem}.png`)}`)
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
