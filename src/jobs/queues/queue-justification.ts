import db from "db"
import NoticeDownloaderJustification from "../workers/NoticeDownloader-justification"
import { createNoticeQueue } from "src/shared/jobs/createNoticeQueue"

/** Prefer per-task push values; fall back to a scalar from batch filters (ignore arrays). */
function resolvePeriodField(
  fromPush: string | undefined,
  fromFilters: unknown,
  fallback = ""
): string {
  if (typeof fromPush === "string" && fromPush.length > 0) return fromPush
  if (typeof fromFilters === "string" && fromFilters.length > 0) return fromFilters
  return fallback
}

const NoticeDownloaderQueue = createNoticeQueue<{
  id: number
  jobTypes: ("SendRequest" | "DownloadFile")[]
  financialYear?: string
  quarter?: string
  formType?: string
}>({
  afterProcessDelay: 200,
  uploadHistoryStrategy: "combinations",
  process: async ({ id, jobTypes, financialYear, quarter, formType }, logger) => {
    const task = await db.task.findUnique({
      where: { id: parseInt(String(id), 10) },
      include: { company: true, Batch: true },
    })

    const taskBatch = await db.taskBatch.findUnique({
      where: { id: task?.BatchID! },
      include: { Task: true },
    })

    let parsedFilters: any = {}
    try {
      if (taskBatch?.filters) {
        parsedFilters = JSON.parse(taskBatch.filters)
      }
    } catch (error) {
      console.error("Error parsing filters:", error)
    }

    const resolvedFy = resolvePeriodField(financialYear, parsedFilters.financialYear)
    const resolvedQuarter = resolvePeriodField(quarter, parsedFilters.quarter)
    const resolvedFormType = resolvePeriodField(formType, parsedFilters.formType)

    const noticeDownloaderJustification = new NoticeDownloaderJustification(
      task?.company!,
      logger,
      parseInt(String(id), 10),
      jobTypes as ("SendRequest" | "DownloadFile")[],
      resolvedFy,
      resolvedQuarter,
      resolvedFormType
    )
    await noticeDownloaderJustification.process()
  },
})

export default NoticeDownloaderQueue
