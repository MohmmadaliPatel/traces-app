/**
 * Run Conso download for Balam.
 * CONSO_HEADLESS=1 npx tsx src/scripts/runBalamConsoDownload.ts
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
    ["DownloadFile"],
    "2025-26",
    "Q3",
    "26Q"
  )

  await worker.downloadFile()
  console.log("DOWNLOAD_FINISHED")
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
