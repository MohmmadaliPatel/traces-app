/**
 * Dump TRACES filedownload list for Balam.
 * CONSO_HEADLESS=1 npx tsx src/scripts/debugConsoDownload.ts
 */
import { PrismaClient } from "@prisma/client"
import puppeteer from "puppeteer"
import { loginWithTracesApiAndPreauth, prepareTraces61FormSubmit, traces61DedUrl } from "src/jobs/traces"
import { waitForSecs } from "src/utils/promises"
import fs from "fs"
import path from "path"

const TAN = "MUMC29054E"
const OUT = path.join(process.cwd(), "tmp", "conso-download-debug")

async function main() {
  const db = new PrismaClient()
  const company = await db.company.findFirst({ where: { tan: { equals: TAN } } })
  await db.$disconnect()
  if (!company?.user_id || !company.password) {
    throw new Error(`Company ${TAN} not found or missing credentials`)
  }

  fs.mkdirSync(OUT, { recursive: true })
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1920,1080"],
  })
  const page = await browser.newPage()
  await page.setViewport({ width: 1920, height: 1080 })

  await loginWithTracesApiAndPreauth(
    page,
    { userId: company.user_id, password: company.password, tan: company.tan },
    { log: (m) => console.log(m) }
  )

  await page.goto(traces61DedUrl("filedownload.xhtml"), {
    waitUntil: "networkidle2",
    timeout: 120000,
  })
  await prepareTraces61FormSubmit(page)
  await page.waitForSelector("#search3", { timeout: 30000 })
  await page.click("#search3")
  await waitForSecs(3000)

  const dump = await page.evaluate(`(() => {
    const reqList = document.getElementById("reqList")
    const gview = document.getElementById("gview_reqList")
    const grows = reqList ? Array.from(reqList.querySelectorAll("tr.jqgrow")) : []
    const allTr = gview ? Array.from(gview.querySelectorAll("tr")) : []
    const sampleGrow = grows.slice(0, 3).map((tr) => ({
      id: tr.id,
      tds: Array.from(tr.querySelectorAll("td")).map((td) => (td.textContent || "").trim()),
    }))
    const sampleAll = allTr.slice(0, 6).map((tr) => ({
      id: tr.id,
      cls: tr.className,
      tdCount: tr.querySelectorAll("td").length,
      thCount: tr.querySelectorAll("th").length,
      text: (tr.textContent || "").trim().slice(0, 180),
    }))
    const pager = document.getElementById("sp_1_pager")
    return {
      url: location.href,
      title: document.title,
      hasSearch3: !!document.getElementById("search3"),
      hasReqList: !!reqList,
      hasGview: !!gview,
      jqgrowCount: grows.length,
      gviewTrCount: allTr.length,
      pagerText: pager ? (pager.textContent || "").trim() : null,
      sampleGrow,
      sampleAll,
    }
  })()`)
  fs.writeFileSync(path.join(OUT, "dom.json"), JSON.stringify(dump, null, 2))
  console.log("DOM", JSON.stringify(dump, null, 2))

  const api = await page.evaluate(`(async () => {
    const url = "/app/srv/GetReqListServlet?reqtype=0&_search=false&nd=" + Date.now() + "&rows=50&page=1&sidx=reqNo&sord=desc"
    const res = await fetch(url, {
      credentials: "same-origin",
      headers: { "X-Requested-With": "XMLHttpRequest", Accept: "application/json, text/javascript, */*; q=0.01" },
    })
    const text = await res.text()
    let json = null
    try { json = JSON.parse(text) } catch (e) { json = { parseError: String(e), textHead: text.slice(0, 400) } }
    return { status: res.status, json }
  })()`)
  fs.writeFileSync(path.join(OUT, "api.json"), JSON.stringify(api, null, 2))
  const apiResult = api as { status?: number; json?: { rows?: any[] } }
  const rows = apiResult.json?.rows || []
  console.log("API status", apiResult.status, "rowCount", rows.length, "keys", rows[0] ? Object.keys(rows[0]) : [])
  console.log(
    "API sample",
    rows.slice(0, 5).map((r) => ({
      reqNo: r.reqNo || r.requestNumber || r.id,
      status: r.status,
      dntype: r.dntype || r.fileProcessed,
      fin: r.fin || r.finYr || r.financialYear,
      qrtr: r.qrtr || r.quarter,
      frmType: r.frmType || r.formType,
      reqDate: r.reqDate,
      cell: r.cell,
    }))
  )

  await page.screenshot({ path: path.join(OUT, "filedownload.png"), fullPage: true })
  await browser.close()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
