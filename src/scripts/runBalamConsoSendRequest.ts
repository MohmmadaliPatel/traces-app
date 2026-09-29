/**
 * Run Conso send-request for Balam 2025-26 Q3 26Q.
 * CONSO_HEADLESS=1 npx tsx src/scripts/runBalamConsoSendRequest.ts
 */
import { PrismaClient } from "@prisma/client"
import NoticeDownloaderConso from "src/jobs/workers/NoticeDownloader-conso"

const TAN = "MUMC29054E"

async function main() {
  const db = new PrismaClient()
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

  const result = await worker.getTracesDatapuppeteer(companyData)
  console.log("SEND_REQUEST_RESULT", result)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
