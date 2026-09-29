import db from "db"
import { appendFileSync } from "fs"
import { notifyBatchProgressForTask } from "src/shared/jobs/batchProgressBus"

function parseTaskId(TaskId: string | number): number {
  return typeof TaskId === "number" ? TaskId : parseInt(String(TaskId), 10)
}

function errMessage(err: unknown): string {
  if (typeof err === "object" && err !== null && "message" in err) {
    return String((err as any).message)
  }
  return JSON.stringify(err) || "Unknown error"
}

/** Update per-combination status JSON stored on UploadHistory.errorMessage (Conso/Form16/Justification). */
export async function updateCombinationUploadHistory(
  TaskId: string | number,
  status: "Success" | "Failed",
  err?: unknown
) {
  const id = parseTaskId(TaskId)
  const task = await db.task.findUnique({
    where: { id },
    include: { company: true },
  })
  if (!task || !task.company) return
  if (task.status === "Cancelled" || task.status === "Removed") return

  const history = await db.uploadHistory.findFirst({
    where: {
      batchId: task.BatchID,
      tan: task.company.tan,
    },
  })
  if (!history?.errorMessage) return

  try {
    const data = JSON.parse(history.errorMessage)
    if (!data.combinations || !Array.isArray(data.combinations)) return

    const combinationIndex = data.combinations.findIndex((c: any) => c.taskId === id)
    if (combinationIndex !== -1) {
      data.combinations[combinationIndex].status = status
      if (status === "Failed") {
        data.combinations[combinationIndex].errorMessage = errMessage(err)
      }
    }

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
  } catch (e) {
    console.error("Error updating combination status:", e)
  }
}

/** Simple Success/Failed update for one-task-per-company jobs (Challan Status). */
export async function updateSimpleUploadHistory(
  TaskId: string | number,
  status: "Success" | "Failed",
  err?: unknown
) {
  const id = parseTaskId(TaskId)
  const task = await db.task.findUnique({
    where: { id },
    include: { company: true },
  })
  if (!task || !task.company) return
  if (task.status === "Cancelled" || task.status === "Removed") return

  try {
    if (status === "Success") {
      await db.uploadHistory.updateMany({
        where: { batchId: task.BatchID, tan: task.company.tan },
        data: { status: "Success" },
      })
    } else {
      await db.uploadHistory.updateMany({
        where: { batchId: task.BatchID, tan: task.company.tan },
        data: {
          status: "Failed",
          errorMessage: JSON.stringify({
            action: "Download Challan Status",
            error: errMessage(err),
          }),
        },
      })
    }
  } catch (e) {
    console.error("Error updating upload history:", e)
  }
}

export async function markTaskStarted(TaskId: string | number) {
  await db.task.update({
    data: { status: "Started/In-Progress" },
    where: { id: parseTaskId(TaskId) },
  })
}

export async function markTaskFinished(TaskId: string | number) {
  const id = parseTaskId(TaskId)
  const task = await db.task.findUnique({ where: { id } })
  if (task && (task.status === "Cancelled" || task.status === "Removed")) return false
  await db.task.update({ data: { status: "Finished" }, where: { id } })
  return true
}

export async function markTaskFailed(TaskId: string | number, err: unknown) {
  const id = parseTaskId(TaskId)
  const task = await db.task.findUnique({ where: { id } })
  if (task && (task.status === "Cancelled" || task.status === "Removed")) return false
  await db.task.update({ data: { status: "Failed" }, where: { id } })
  appendFileSync(`logs/${id}.log`, JSON.stringify(err) + "\n")
  return true
}

export type UploadHistoryStrategy = "combinations" | "simple"

export function attachStandardQueueHandlers(
  queue: {
    on: (event: string, handler: (...args: any[]) => any) => any
  },
  strategy: UploadHistoryStrategy = "combinations"
) {
  queue.on("task_started", async (TaskId) => {
    console.log("task_started")
    await markTaskStarted(TaskId)
    await notifyBatchProgressForTask(parseTaskId(TaskId))
  })

  queue.on("task_finish", async (TaskId) => {
    console.log("task_finish")
    const ok = await markTaskFinished(TaskId)
    if (!ok) return
    if (strategy === "combinations") {
      await updateCombinationUploadHistory(TaskId, "Success")
    } else {
      await updateSimpleUploadHistory(TaskId, "Success")
    }
    await notifyBatchProgressForTask(parseTaskId(TaskId))
  })

  queue.on("task_failed", async (TaskId, err) => {
    console.log("task_failed")
    const ok = await markTaskFailed(TaskId, err)
    if (!ok) return
    if (strategy === "combinations") {
      await updateCombinationUploadHistory(TaskId, "Failed", err)
    } else {
      await updateSimpleUploadHistory(TaskId, "Failed", err)
    }
    await notifyBatchProgressForTask(parseTaskId(TaskId))
  })
}
