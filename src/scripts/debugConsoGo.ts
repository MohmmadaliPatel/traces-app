/**
 * Temporary diagnostic for Conso nsdlconsofile Go click.
 * Run: npx tsx src/scripts/debugConsoGo.ts
 */
import { PrismaClient } from "@prisma/client"
import puppeteer, { type Page } from "puppeteer"
import {
  prepareTraces61FormSubmit,
  loginWithTracesApiAndPreauth,
  traces61DedUrl,
} from "src/jobs/traces"
import { waitForSecs } from "src/utils/promises"
import fs from "fs"
import path from "path"

const TAN = "MUMC29054E"
const OUT = path.join(process.cwd(), "tmp", "conso-go-debug")

async function dump(page: Page, label: string) {
  fs.mkdirSync(OUT, { recursive: true })
  const html = await page.content()
  fs.writeFileSync(path.join(OUT, `${label}.html`), html)
  await page.screenshot({ path: path.join(OUT, `${label}.png`), fullPage: true })
  const info = await page.evaluate(`(() => {
    const btn = document.getElementById("download_conso");
    const form = btn && (btn.form || btn.closest("form"));
    const val = (id) => {
      const el = document.getElementById(id);
      return el ? el.value : "";
    };
    return {
      url: location.href,
      title: document.title,
      readyState: document.readyState,
      bodyLen: (document.body && document.body.innerText || "").length,
      bodyHead: (document.body && document.body.innerText || "").slice(0, 240),
      finYr: val("finYr"),
      qrtr: val("qrtr"),
      frmType: val("frmType"),
      hasSearch2: !!document.getElementById("search2"),
      hasSearch1: !!document.getElementById("search1"),
      hasGo: !!btn,
      formAction: form ? (form.getAttribute("action") || form.action) : null,
    };
  })()`)
  fs.writeFileSync(path.join(OUT, `${label}.json`), JSON.stringify(info, null, 2))
  console.log(`\n=== ${label} ===`)
  console.log(JSON.stringify(info, null, 2))
  return info as {
    url: string
    title: string
    hasSearch2: boolean
  }
}

async function main() {
  const db = new PrismaClient()
  const company = await db.company.findFirst({
    where: { tan: { equals: TAN } },
  })
  await db.$disconnect()
  if (!company?.user_id || !company.password) {
    throw new Error(`Company ${TAN} not found or missing TRACES credentials`)
  }
  console.log(`Loaded ${company.name} tan=${company.tan}`)

  const posts: string[] = []
  const redirects: string[] = []
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1920,1080"],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })
  page.on("request", (req) => {
    if (req.method() === "POST") {
      const line = `${req.method()} ${req.url()} resource=${req.resourceType()}`
      posts.push(line)
      console.log("POST", line)
    }
  })
  page.on("response", (res) => {
    const status = res.status()
    if (status >= 300 && status < 400) {
      const line = `${status} ${res.url()} -> ${res.headers().location || ""}`
      redirects.push(line)
      console.log("REDIRECT", line)
    }
  })

  await loginWithTracesApiAndPreauth(
    page,
    { userId: company.user_id, password: company.password, tan: company.tan },
    { log: (m) => console.log(m) }
  )

  await page.goto(traces61DedUrl("nsdlconsofile.xhtml"), {
    waitUntil: "networkidle2",
    timeout: 120000,
  })
  await page.waitForSelector("#finYr", { timeout: 30000 })
  await dump(page, "01-loaded")

  await page.select("#finYr", "2025")
  await waitForSecs(1500)
  await page.waitForFunction(
    `(() => {
      const el = document.getElementById("qrtr");
      return !!el && Array.from(el.options).some((o) => o.value === "3");
    })()`
  )
  await page.select("#qrtr", "5")
  await waitForSecs(500)
  await page.select("#frmType", "26Q")
  await waitForSecs(500)
  await dump(page, "02-selected")

  console.log("Preparing form submit (no Puppeteer intercept + HTTP→HTTPS upgrade), then Go")
  await prepareTraces61FormSubmit(page)
  const searchReady = page
    .waitForFunction(
      `(() => {
        return !!document.getElementById("search2")
          || /downloadreqspec\\.xhtml/i.test(location.href)
          || /Page Not Found/i.test(document.title)
          || /traces61contents/i.test(location.hostname);
      })()`,
      { timeout: 60000 }
    )
    .catch((e) => {
      console.log("wait after Go failed", e.message)
      return null
    })
  await page.click("#download_conso")
  await searchReady
  await page.waitForSelector("#search2", { visible: true, timeout: 60000 }).catch(() => null)
  await waitForSecs(1500)
  const afterClick = await dump(page, "03-after-page-click")

  console.log("\nAll POSTs:\n", posts.join("\n"))
  console.log("\nRedirects:\n", redirects.join("\n"))

  await browser.close()

  if (!afterClick.hasSearch2) {
    throw new Error(
      `Go did not load #search2. url=${afterClick.url} title=${afterClick.title}`
    )
  }
  console.log("SUCCESS: #search2 is present")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
