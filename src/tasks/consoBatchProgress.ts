import db from "db"

export type ConsoBatchProgressItem = {
  taskId: number
  status: string
  companyName: string
  tan: string
  financialYear: string
  quarter: string
  formType: string
  errorMessage: string | null
  updatedAt: Date
}

export type ConsoBatchProgress = {
  batchId: number
  createdAt: Date | null
  actionType: string | null
  counts: {
    total: number
    queued: number
    inProgress: number
    finished: number
    failed: number
    other: number
  }
  percent: number
  isComplete: boolean
  items: ConsoBatchProgressItem[]
}

export function emptyConsoBatchProgress(batchId: number): ConsoBatchProgress {
  return {
    batchId,
    createdAt: null,
    actionType: null,
    counts: { total: 0, queued: 0, inProgress: 0, finished: 0, failed: 0, other: 0 },
    percent: 0,
    isComplete: false,
    items: [],
  }
}

export async function loadConsoBatchProgress(batchId: number): Promise<ConsoBatchProgress> {
  const empty = emptyConsoBatchProgress(batchId)
  if (!batchId || batchId <= 0) return empty

  const batch = await db.taskBatch.findUnique({ where: { id: batchId } })
  if (!batch) return empty

  const tasks = await db.task.findMany({
    where: { BatchID: batchId },
    orderBy: { id: "asc" },
    include: {
      company: { select: { id: true, name: true, tan: true } },
    },
  })

  const histories = await db.uploadHistory.findMany({
    where: { batchId, type: "conso" },
  })

  const comboByTaskId = new Map<
    number,
    { financialYear?: string; quarter?: string; formType?: string; errorMessage?: string | null }
  >()
  for (const h of histories) {
    if (!h.errorMessage) continue
    try {
      const data = JSON.parse(h.errorMessage)
      for (const combo of data.combinations ?? []) {
        if (combo?.taskId) comboByTaskId.set(combo.taskId, combo)
      }
    } catch {
      /* ignore */
    }
  }

  const counts = {
    total: tasks.length,
    queued: 0,
    inProgress: 0,
    finished: 0,
    failed: 0,
    other: 0,
  }

  const items = tasks.map((t) => {
    const status = t.status || "Queued"
    if (status === "Queued") counts.queued++
    else if (status === "Started/In-Progress") counts.inProgress++
    else if (status === "Finished") counts.finished++
    else if (status === "Failed") counts.failed++
    else counts.other++

    const combo = comboByTaskId.get(t.id)
    return {
      taskId: t.id,
      status,
      companyName: t.company?.name || "",
      tan: t.company?.tan || "",
      financialYear: combo?.financialYear || "N/A",
      quarter: combo?.quarter || "N/A",
      formType: combo?.formType || "N/A",
      errorMessage: combo?.errorMessage || t.message || null,
      updatedAt: t.updatedAt,
    }
  })

  const done = counts.finished + counts.failed
  const percent = counts.total > 0 ? Math.round((done / counts.total) * 100) : 0
  const isComplete = counts.total > 0 && done >= counts.total

  let filters: Record<string, unknown> = {}
  try {
    filters = JSON.parse(batch.filters || "{}")
  } catch {
    /* ignore */
  }

  return {
    batchId,
    createdAt: batch.createdAt,
    actionType: (filters.actionType as string) || null,
    counts,
    percent,
    isComplete,
    items,
  }
}
