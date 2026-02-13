import Queue from "better-queue"
import db from "db"
import NoticeDownloaderChallanStatus from "./NoticeDownloader-challanStatus"
import { appendFileSync } from "fs"

const NoticeDownloaderChallanStatusQueue = new Queue<{
  id: number
  jobTypes: ("SendRequest" | "DownloadFile")[]
  challanStatusType?: "challan_status"
}>(
  async ({ id}, cb) => {
    try {
      console.log("QUEUE CHALLAN STATUS", id)

      const newNotices = [] as string[]
      const logger = {
        log: (message: string) => {
          console.log(message)
          appendFileSync(`logs/${id}-it.log`, message + "\n")
        },
      }

      const task = await db.task.findUnique({
        where: { id: parseInt(id) },
        include: { company: true, Batch: true },
      })

      if (!task || !task.company) {
        throw new Error("Task or company not found")
      }

      console.log("Company QUEUE CHALLAN STATUS", task.company.name)


      const noticeDownloaderChallanStatus = new NoticeDownloaderChallanStatus(
        task.company,
        logger,
        parseInt(id),
      )

      await noticeDownloaderChallanStatus.process()
      cb(null, newNotices)
    } catch (error) {
      cb(error)
    }
  },
  {
    maxRetries: 1,
    afterProcessDelay: 500,
    concurrent: 1,
    // @ts-ignore getTaskId exists in better-queue runtime options
    getTaskId: (task, cb) => cb(null, task.id),
  }
)

NoticeDownloaderChallanStatusQueue.on("task_started", async (TaskId) => {
  console.log("task_started")
  await db.task.update({ data: { status: "Started/In-Progress" }, where: { id: parseInt(TaskId) } })
})

NoticeDownloaderChallanStatusQueue.on("task_finish", async (TaskId) => {
  console.log("task_finish")
  const task = await db.task.findUnique({
    where: { id: parseInt(TaskId) },
    include: { company: true },
  })

  if (task && (task.status === "Cancelled" || task.status === "Removed")) {
    return
  }

  await db.task.update({ data: { status: "Finished" }, where: { id: parseInt(TaskId) } })

  // Update upload history status
  try {
    if (!task || !task.company) return

    await db.uploadHistory.updateMany({
      where: {
        batchId: task.BatchID,
        tan: task.company.tan,
      },
      data: {
        status: "Success",
      },
    })
  } catch (e) {
    console.error("Error updating upload history:", e)
  }
})

NoticeDownloaderChallanStatusQueue.on("task_failed", async (TaskId, err) => {
  console.log("task_failed")
  const task = await db.task.findUnique({
    where: { id: parseInt(TaskId) },
    include: { company: true },
  })

  if (task && (task.status === "Cancelled" || task.status === "Removed")) {
    return
  }

  await db.task.update({
    data: { status: "Failed" },
    where: { id: parseInt(TaskId) },
  })
  appendFileSync(`logs/${TaskId}.log`, JSON.stringify(err) + "\n")

  // Update upload history status
  try {
    if (!task || !task.company) return

    const errMessage =
      typeof err === "object" && err !== null && "message" in err
        ? (err as any).message
        : JSON.stringify(err) || "Unknown error"

    await db.uploadHistory.updateMany({
      where: {
        batchId: task.BatchID,
        tan: task.company.tan,
      },
      data: {
        status: "Failed",
        errorMessage: JSON.stringify({
          action: "Download Challan Status",
          error: errMessage,
        }),
      },
    })
  } catch (e) {
    console.error("Error updating upload history:", e)
  }
})

export default NoticeDownloaderChallanStatusQueue
