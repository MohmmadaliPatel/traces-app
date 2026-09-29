import db from "db"
import NoticeDownloaderForm16 from "../workers/NoticeDownloader-form16"
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
  form16Type?: "form16" | "form16a"
  portalMode?: "new" | "old"
  /** Certificate chosen in the UI. Only the name travels — a PIN must never reach Redis. */
  certificateName?: string
}>({
  uploadHistoryStrategy: "combinations",
  process: async (
    { id, jobTypes, financialYear, quarter, formType, form16Type, portalMode, certificateName },
    logger
  ) => {
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
    const resolvedForm16Type =
      form16Type ||
      (typeof parsedFilters.form16Type === "string" ? parsedFilters.form16Type : "form16")
    const resolvedPortalMode =
      portalMode ||
      (parsedFilters.portalMode === "old" || parsedFilters.portalMode === "new"
        ? parsedFilters.portalMode
        : "new")

    const noticeDownloaderForm16 = new NoticeDownloaderForm16(
      task?.company!,
      logger,
      parseInt(String(id), 10),
      jobTypes as ("SendRequest" | "DownloadFile")[],
      resolvedFy,
      resolvedQuarter,
      resolvedFormType,
      resolvedForm16Type as "form16" | "form16a",
      resolvedPortalMode as "new" | "old",
      certificateName ||
        (typeof parsedFilters.certificateName === "string" ? parsedFilters.certificateName : "")
    )
    await noticeDownloaderForm16.process()
  },
})

export default NoticeDownloaderQueue
