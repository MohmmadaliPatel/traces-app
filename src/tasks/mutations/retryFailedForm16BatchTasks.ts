import { resolver } from "@blitzjs/rpc"
import db from "db"
import NoticeDownloaderQueue from "src/jobs/queue-form16"
import { z } from "zod"

const RetryFailedForm16BatchTasksSchema = z.object({
  batchId: z.number(),
  taskIds: z.array(z.number()).optional(),
})

function normalizePeriodValue(value: string | undefined): string | undefined {
  if (!value || value === "N/A") return undefined
  return value
}

function buildTaskComboMap(histories: { errorMessage: string | null }[]) {
  const map = new Map<number, {
    financialYear?: string
    quarter?: string
    formType?: string
  }>()

  for (const history of histories) {
    if (!history.errorMessage) continue
    try {
      const data = JSON.parse(history.errorMessage)
      for (const combo of data.combinations ?? []) {
        if (combo.taskId) {
          map.set(combo.taskId, combo)
        }
      }
    } catch {
      // ignore parse errors
    }
  }

  return map
}

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(RetryFailedForm16BatchTasksSchema),
  async ({ batchId, taskIds }) => {
    const batch = await db.taskBatch.findUnique({ where: { id: batchId } })
    if (!batch) {
      throw new Error(`Batch #${batchId} not found`)
    }

    let filters: Record<string, unknown> = {}
    try {
      filters = JSON.parse(batch.filters || "{}")
    } catch {
      throw new Error("Could not parse batch filters")
    }

    const form16Type = filters.form16Type as "form16" | "form16a" | undefined
    if (!form16Type) {
      throw new Error("Retry is only supported for Form 16 / Form 16A batches")
    }

    if (filters.actionType === "sign_pdf") {
      throw new Error("Attach DSC batches cannot be retried from logs")
    }

    const actionType = filters.actionType as string | undefined
    let jobTypes: string[] = []
    try {
      jobTypes = JSON.parse(batch.jobTypes || "[]")
    } catch {
      throw new Error("Could not parse batch job types")
    }

    if (jobTypes.length === 0) {
      throw new Error("Batch has no job types configured")
    }

    const failedTasks = await db.task.findMany({
      where: {
        BatchID: batchId,
        status: "Failed",
        ...(taskIds && taskIds.length > 0 ? { id: { in: taskIds } } : {}),
      },
      include: { company: true },
    })

    if (failedTasks.length === 0) {
      return {
        success: true,
        retriedCount: 0,
        taskIds: [],
        message: "No failed tasks to retry",
      }
    }

    const histories = await db.uploadHistory.findMany({ where: { batchId } })
    const taskComboMap = buildTaskComboMap(histories)

    const retriedTaskIds: number[] = []

    for (const task of failedTasks) {
      const combo = taskComboMap.get(task.id)

      await db.task.update({
        where: { id: task.id },
        data: { status: "Queued", message: null },
      })

      const history = histories.find((h) => h.tan === task.company.tan)
      if (history?.errorMessage) {
        try {
          const data = JSON.parse(history.errorMessage)
          if (data.combinations && Array.isArray(data.combinations)) {
            const comboIndex = data.combinations.findIndex((c: { taskId: number }) => c.taskId === task.id)
            if (comboIndex !== -1) {
              data.combinations[comboIndex].status = "Processing"
              data.combinations[comboIndex].errorMessage = null
            }
            await db.uploadHistory.update({
              where: { id: history.id },
              data: {
                status: "Processing",
                errorMessage: JSON.stringify(data),
              },
            })
          }
        } catch {
          // continue queueing even if history update fails
        }
      }

      const periodFinancialYear =
        actionType === "send_request" ? normalizePeriodValue(combo?.financialYear) : undefined
      const periodQuarter =
        actionType === "send_request" ? normalizePeriodValue(combo?.quarter) : undefined
      const periodFormType =
        actionType === "send_request" ? normalizePeriodValue(combo?.formType) : undefined

      NoticeDownloaderQueue.push(
        {
          id: task.id,
          jobTypes: jobTypes as ("SendRequest" | "DownloadFile")[],
          financialYear: periodFinancialYear,
          quarter: periodQuarter,
          formType: periodFormType,
          form16Type,
        },
        (err) => {
          if (err) {
            console.error(
              `Retry failed for task ${task.id} (${task.company.name}):`,
              err
            )
          }
        }
      )

      retriedTaskIds.push(task.id)
    }

    return {
      success: true,
      retriedCount: retriedTaskIds.length,
      taskIds: retriedTaskIds,
      message: `Queued ${retriedTaskIds.length} failed task(s) for retry with the same batch configuration`,
    }
  }
)
