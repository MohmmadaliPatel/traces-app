import db from "db"
import NoticeDownloaderConso from "../workers/NoticeDownloader-conso"
import { createNoticeQueue } from "src/shared/jobs/createNoticeQueue"

const NoticeDownloaderQueue = createNoticeQueue<{
  id: number
  jobTypes: ("SendRequest" | "DownloadFile")[]
  financialYear?: string
  quarter?: string
  formType?: string
}>({
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

    const noticeDownloaderConso = new NoticeDownloaderConso(
      task?.company!,
      logger,
      parseInt(String(id), 10),
      jobTypes as ("SendRequest" | "DownloadFile")[],
      parsedFilters.financialYear || financialYear || "",
      parsedFilters.quarter || quarter || "",
      parsedFilters.formType || formType || ""
    )
    await noticeDownloaderConso.process()
  },
})

export default NoticeDownloaderQueue
