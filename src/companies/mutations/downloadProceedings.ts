import db, { Company, TaskBatch } from "db"
import NoticeDownloaderQueue from "src/jobs/queue-conso"

type DownloadProceedingsInput = {
  ids: number[]
  jobTypes: ("SendRequest" | "DownloadFile")[]
}

export function downloadNotices(
  company: Company,
  jobTypes: ("SendRequest" | "DownloadFile")[],
  taskBatch: TaskBatch
) {
  return new Promise(async (resolve, reject) => {
    const task = await db.task.create({
      data: {
        companyId: company.id,
        status: "Queued",
        BatchID: taskBatch.id,
        jobType: JSON.stringify(jobTypes),
      },
    })
    NoticeDownloaderQueue.push({ id: task.id, jobTypes }, (err, newNoticeIds) => {
      if (err) {
        reject(err)
      } else {
        resolve(newNoticeIds)
      }
    })
  })
}

export default async function downloadProceedings({ ids, jobTypes }: DownloadProceedingsInput) {
  await addtaskBatch(ids, jobTypes)
  return { message: "Task added to queue" }
}

export async function addtaskBatch(ids: number[], jobTypes: ("SendRequest" | "DownloadFile")[]) {
  const companies = await db.company.findMany({ where: { id: { in: ids } } })

  const taskBatch = await db.taskBatch.create({
    data: {
      jobTypes: JSON.stringify(jobTypes),
    },
  })

  void Promise.allSettled(companies.map((c) => downloadNotices(c, jobTypes, taskBatch))).then(
    async (batchRes) => {
      return { message: "Task added to queue" }
    }
  )
}
