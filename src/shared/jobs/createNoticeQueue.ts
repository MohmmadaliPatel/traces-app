import Queue from "better-queue"
import { appendFileSync } from "fs"
import {
  attachStandardQueueHandlers,
  type UploadHistoryStrategy,
} from "src/shared/jobs/uploadHistory"

export type NoticeQueueLogger = { log: (message: string) => void }

export function createTaskFileLogger(taskId: number | string): NoticeQueueLogger {
  return {
    log: (message: string) => {
      console.log(message)
      appendFileSync(`logs/${taskId}-it.log`, message + "\n")
    },
  }
}

export type CreateNoticeQueueOptions<TTask> = {
  process: (task: TTask, logger: NoticeQueueLogger) => Promise<void>
  /** better-queue concurrency (default 1) */
  concurrent?: number
  afterProcessDelay?: number
  maxRetries?: number
  uploadHistoryStrategy?: UploadHistoryStrategy
}

/**
 * Factory for in-process better-queue workers used by Conso / Form16 / Justification / Challan Status.
 * Keeps lifecycle (start/finish/fail + upload history) consistent across features.
 */
export function createNoticeQueue<TTask extends { id: number }>(
  options: CreateNoticeQueueOptions<TTask>
) {
  const {
    process,
    concurrent = 1,
    afterProcessDelay = 500,
    maxRetries = 1,
    uploadHistoryStrategy = "combinations",
  } = options

  const queue = new Queue<TTask>(
    async (task, cb) => {
      try {
        const logger = createTaskFileLogger(task.id)
        await process(task, logger)
        cb(null, [] as string[])
      } catch (error) {
        cb(error)
      }
    },
    {
      maxRetries,
      afterProcessDelay,
      concurrent,
      // @ts-ignore getTaskId exists in better-queue runtime options
      getTaskId: (task, cb) => cb(null, task.id),
    }
  )

  attachStandardQueueHandlers(queue, uploadHistoryStrategy)
  return queue
}
