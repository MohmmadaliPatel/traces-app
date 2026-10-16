/**
 * Run Conso send-request for Balam 2025-26 Q3 26Q.
 *
 *   node scripts/run-ts.js src/scripts/runBalamConsoSendRequest.ts              # API flow
 *   node scripts/run-ts.js src/scripts/runBalamConsoSendRequest.ts --puppeteer  # old Puppeteer flow
 *
 * Both modes FILE A REAL CONSO REQUEST on TRACES.
 *
 * Every run records what it did under logs/traces-capture/<mode>-<timestamp>/ (gitignored):
 *   --puppeteer  the browser's clicks + every TRACES request/response (puppeteerTrafficCapture)
 *   API          every legacy page GET and form POST with the response HTML (TRACES_LEGACY_DUMP_DIR)
 * CONSO_HEADLESS=1 runs the Puppeteer mode without a visible window.
 */
import path from "path"
import dotenv from "dotenv"
import db from "db" // shared client: decrypts stored portal credentials
import NoticeDownloaderConso from "src/jobs/workers/NoticeDownloader-conso"
import { installPuppeteerTrafficCapture } from "src/jobs/traces/puppeteerTrafficCapture"

dotenv.config()

const TAN = "MUMC29054E"

async function main() {
  const usePuppeteer = process.argv.includes("--puppeteer")
  const stamp = new Date().toISOString().replace(/[:.]/g, "-")
  const captureDir = path.resolve("logs", "traces-capture", `conso-${usePuppeteer ? "puppeteer" : "api"}-${stamp}`)
  if (usePuppeteer) installPuppeteerTrafficCapture(captureDir)
  else process.env.TRACES_LEGACY_DUMP_DIR = captureDir
  console.log(`Recording TRACES traffic to ${captureDir}`)

  const company = await db.company.findFirst({ where: { tan: { equals: TAN } } })
  await db.$disconnect()
  if (!company?.user_id || !company.password) {
    throw new Error(`Company ${TAN} not found or missing TRACES credentials`)
  }

  const worker = new (NoticeDownloaderConso as any)(
    company,
    { log: (m: string) => console.log(m) },
    0,
    ["SendRequest"],
    "2025-26",
    "Q3",
    "26Q"
  )

  const companyData = await worker.readReturnsTxtFiles()
  if (!companyData) {
    throw new Error("No challan data found for Balam 2025-26 Q3 26Q")
  }
  console.log("Challan record", {
    bsr: companyData.bsr,
    csn: companyData.csn,
    dtoftaxdep: companyData.dtoftaxdep,
    chlnamt: companyData.chlnamt,
    rrr: companyData.rrr,
    pan1: companyData.pan1,
    amt1: companyData.amt1,
    pan2: companyData.pan2,
    pan3: companyData.pan3,
  })

  const result = usePuppeteer
    ? await worker.getTracesDatapuppeteer(companyData)
    : await worker.sendConsoRequestApi(companyData)
  console.log("SEND_REQUEST_RESULT", result)
  console.log(`Recorded TRACES traffic in ${captureDir}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
