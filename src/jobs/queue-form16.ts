import Queue from "better-queue"
import db from "db"
import NoticeDownloaderForm16 from "./NoticeDownloader-form16"
import { appendFileSync } from "fs"
const NoticeDownloaderQueue = new Queue<{
  id: number
  jobTypes: ("SendRequest" | "DownloadFile")[]
  financialYear?: string
  quarter?: string
  formType?: string
  form16Type?: "form16" | "form16a"
}>(
  async ({ id, jobTypes, financialYear, quarter, formType, form16Type }, cb) => {
    try {

      console.log("QUEUE FORM16", id, jobTypes, financialYear, quarter, formType, form16Type);

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

      const taskBatch = await db.taskBatch.findUnique({
        where: { id: task?.BatchID! },
        include: { Task: true },
      })
      console.log("taskBatch QUEUE FORM16", taskBatch?.Task?.length)

      // Parse filters from taskBatch to get financial year, quarter, and form type
      let parsedFilters: any = {}
      try {
        if (taskBatch?.filters) {
          parsedFilters = JSON.parse(taskBatch.filters)
        }
      } catch (error) {
        console.error("Error parsing filters:", error)
      }

      const isLastCompany =
        taskBatch?.Task?.findIndex((t) => t.id === parseInt(id)) ===
        (taskBatch?.Task?.length || 0) - 1
      console.log("Company QUEUE FORM16", task?.company?.name)
      console.log("Financial Year QUEUE FORM16:", parsedFilters.financialYear || financialYear)
      console.log("Quarter QUEUE FORM16:", parsedFilters.quarter || quarter)
      console.log("Form Type QUEUE FORM16:", parsedFilters.formType || formType)
      console.log("Form 16 Type QUEUE FORM16:", parsedFilters.form16Type || form16Type || "form16")

      console.log("isLastCompany QUEUE FORM16", isLastCompany)
      const noticeDowmloaderForm16 = new NoticeDownloaderForm16(
        task?.company!,
        logger,
        parseInt(id),
        jobTypes as ("SendRequest" | "DownloadFile")[],
        parsedFilters.financialYear || financialYear || "",
        parsedFilters.quarter || quarter || "",
        parsedFilters.formType || formType || "",
        parsedFilters.form16Type || form16Type || "form16"
      )
      await noticeDowmloaderForm16.process()
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
    // store: {
    //   type: "sql",
    //   dialect: "sqlite",
    //   path: "queue.db",
    // },
  }
)

NoticeDownloaderQueue.on("task_started", async (TaskId) => {
  console.log("task_started")
  await db.task.update({ data: { status: "Started/In-Progress" }, where: { id: parseInt(TaskId) } })
})

NoticeDownloaderQueue.on("task_finish", async (TaskId) => {
  console.log("task_finish")
  const task = await db.task.findUnique({
    where: { id: parseInt(TaskId) },
    include: { company: true },
  })
  if (task && (task.status === "Cancelled" || task.status === "Removed")) {
    return
  }
  await db.task.update({ data: { status: "Finished" }, where: { id: parseInt(TaskId) } })

  // Update combination status in upload history
  try {
    if (!task || !task.company) return

    const history = await db.uploadHistory.findFirst({
      where: {
        batchId: task.BatchID,
        tan: task.company.tan,
      },
    })

    if (history && history.errorMessage) {
      try {
        const data = JSON.parse(history.errorMessage)
        if (data.combinations && Array.isArray(data.combinations)) {
          // Find and update the combination status
          const combinationIndex = data.combinations.findIndex(
            (c: any) => c.taskId === parseInt(TaskId)
          )
          if (combinationIndex !== -1) {
            data.combinations[combinationIndex].status = "Success"
          }

          // Check if all combinations are done
          const allDone = data.combinations.every(
            (c: any) => c.status === "Success" || c.status === "Failed"
          )
          const anyFailed = data.combinations.some((c: any) => c.status === "Failed")

          await db.uploadHistory.update({
            where: { id: history.id },
            data: {
              errorMessage: JSON.stringify(data),
              status: allDone ? (anyFailed ? "Failed" : "Success") : "Processing",
            },
          })
        }
      } catch (e) {
        console.error("Error updating combination status:", e)
      }
    }
  } catch (e) {
    console.error("Error finding upload history:", e)
  }
})

NoticeDownloaderQueue.on("task_failed", async (TaskId, err) => {
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

  // Update combination status in upload history
  try {
    if (!task || !task.company) return

    const history = await db.uploadHistory.findFirst({
      where: {
        batchId: task.BatchID,
        tan: task.company.tan,
      },
    })

    if (history && history.errorMessage) {
      try {
        const data = JSON.parse(history.errorMessage)
        if (data.combinations && Array.isArray(data.combinations)) {
          // Find and update the combination status
          const combinationIndex = data.combinations.findIndex(
            (c: any) => c.taskId === parseInt(TaskId)
          )
          if (combinationIndex !== -1) {
            data.combinations[combinationIndex].status = "Failed"
            const errMessage =
              typeof err === "object" && err !== null && "message" in err
                ? (err as any).message
                : JSON.stringify(err) || "Unknown error"
            data.combinations[combinationIndex].errorMessage = errMessage
          }

          // Check if all combinations are done
          const allDone = data.combinations.every(
            (c: any) => c.status === "Success" || c.status === "Failed"
          )
          const anyFailed = data.combinations.some((c: any) => c.status === "Failed")

          await db.uploadHistory.update({
            where: { id: history.id },
            data: {
              errorMessage: JSON.stringify(data),
              status: allDone ? (anyFailed ? "Failed" : "Success") : "Processing",
            },
          })
        }
      } catch (e) {
        console.error("Error updating combination status:", e)
      }
    }
  } catch (e) {
    console.error("Error finding upload history:", e)
  }
})

export default NoticeDownloaderQueue
