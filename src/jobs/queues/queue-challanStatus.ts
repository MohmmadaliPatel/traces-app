import db from "db"
import NoticeDownloaderChallanStatus from "../workers/NoticeDownloader-challanStatus"
import { createNoticeQueue } from "src/shared/jobs/createNoticeQueue"

const NoticeDownloaderChallanStatusQueue = createNoticeQueue<{
  id: number
  jobTypes: ("SendRequest" | "DownloadFile")[]
  challanStatusType?: "challan_status"
}>({
  uploadHistoryStrategy: "simple",
  process: async ({ id }, logger) => {
    const task = await db.task.findUnique({
      where: { id: parseInt(String(id), 10) },
      include: { company: true, Batch: true },
    })

    let onlyPaymentPdfNotInExcel = false
    let targetFinancialYears: string[] = []
    let mode: "list" | "full" = "full"
    if (task?.Batch?.filters) {
      try {
        const filters = JSON.parse(task.Batch.filters) as {
          onlyPaymentPdfNotInExcel?: boolean
          financialYears?: string[]
          mode?: "list" | "full"
        }
        onlyPaymentPdfNotInExcel = filters.onlyPaymentPdfNotInExcel === true
        if (Array.isArray(filters.financialYears)) {
          targetFinancialYears = filters.financialYears.filter(Boolean)
        }
        if (filters.mode === "list" || filters.mode === "full") {
          mode = filters.mode
        }
      } catch {
        // ignore invalid filters JSON
      }
    }

    if (!task || !task.company) {
      throw new Error("Task or company not found")
    }

    const noticeDownloaderChallanStatus = new NoticeDownloaderChallanStatus(
      task.company,
      logger,
      parseInt(String(id), 10),
      { onlyPaymentPdfNotInExcel, targetFinancialYears, mode }
    )

    await noticeDownloaderChallanStatus.process()
  },
})

export default NoticeDownloaderChallanStatusQueue
