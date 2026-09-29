import { EventEmitter } from "events"
import db from "db"
import { loadConsoBatchProgress, type ConsoBatchProgress } from "src/tasks/consoBatchProgress"

const emitter = new EventEmitter()
emitter.setMaxListeners(100)

function eventName(batchId: number) {
  return `batch:${batchId}`
}

export function subscribeBatchProgress(
  batchId: number,
  listener: (progress: ConsoBatchProgress) => void
) {
  const name = eventName(batchId)
  emitter.on(name, listener)
  return () => {
    emitter.off(name, listener)
  }
}

export function listenerCountForBatch(batchId: number) {
  return emitter.listenerCount(eventName(batchId))
}

export async function notifyBatchProgress(batchId: number | null | undefined) {
  try {
    if (!batchId || listenerCountForBatch(batchId) === 0) return
    const progress = await loadConsoBatchProgress(batchId)
    emitter.emit(eventName(batchId), progress)
  } catch (error) {
    console.error("notifyBatchProgress failed", error)
  }
}

export async function notifyBatchProgressForTask(taskId: number) {
  try {
    const task = await db.task.findUnique({
      where: { id: taskId },
      select: { BatchID: true },
    })
    if (!task?.BatchID) return
    await notifyBatchProgress(task.BatchID)
  } catch (error) {
    console.error("notifyBatchProgressForTask failed", error)
  }
}
