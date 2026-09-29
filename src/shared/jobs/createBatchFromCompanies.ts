import db from "db"
import type { CompanyCredentials } from "src/shared/types/companyCredentials"
import type { PeriodOptionalForm } from "src/shared/excel/periods"
import { upsertCompanyFromCredentials } from "src/shared/jobs/upsertCompanyFromCredentials"

export type CombinationStatus = {
  taskId: number
  financialYear: string
  quarter: string
  formType: string
  status: string
  errorMessage: string | null
}

export type QueuePushPayload = {
  id: number
  jobTypes: string[]
  financialYear?: string
  quarter?: string
  formType?: string
  [key: string]: unknown
}

export type CreateBatchFromCompaniesInput = {
  companies: CompanyCredentials[]
  jobTypes: string[]
  module?: string
  filters: Record<string, unknown>
  /** UploadHistory.type */
  historyType: string
  /** Periods to create tasks for (one task per period). Empty/single empty for one-per-company. */
  periods: PeriodOptionalForm[]
  /** Build queue push payload for each task */
  buildQueuePayload: (args: {
    taskId: number
    period: PeriodOptionalForm
    jobTypes: string[]
  }) => QueuePushPayload
  /** Queue with .push(payload, cb) */
  queue: { push: (payload: any, cb?: (err?: any, result?: any) => void) => void }
  /** Extra fields merged into history errorMessage JSON */
  historyMeta?: Record<string, unknown>
  actionLabel: string
  /** Override financialYear/quarter stored on UploadHistory */
  historyFinancialYear?: string
  historyQuarter?: string
  /** When true, one task per company (ignore period cartesian for task count semantics of challan). */
  oneTaskPerCompany?: boolean
  /** Optional per-company history enrichment */
  enrichHistory?: (company: CompanyCredentials) => Record<string, unknown> | Promise<Record<string, unknown>>
}

/**
 * Shared TaskBatch + Task + UploadHistory + queue enqueue orchestrator
 * for Excel-driven batch portal jobs.
 */
export async function createBatchFromCompanies(input: CreateBatchFromCompaniesInput) {
  const {
    companies,
    jobTypes,
    module = "IT",
    filters,
    historyType,
    periods,
    buildQueuePayload,
    queue,
    historyMeta = {},
    actionLabel,
    oneTaskPerCompany = false,
  } = input

  const taskBatch = await db.taskBatch.create({
    data: {
      jobTypes: JSON.stringify(jobTypes),
      module,
      filters: JSON.stringify(filters),
    },
  })

  const effectivePeriods = oneTaskPerCompany
    ? [{ financialYear: "", quarter: "", formType: undefined }]
    : periods

  for (const company of companies) {
    try {
      const existingCompany = await upsertCompanyFromCredentials(company)

      const combinationsStatus: CombinationStatus[] = []
      const taskIds: number[] = []

      for (const period of effectivePeriods) {
        const task = await db.task.create({
          data: {
            companyId: existingCompany.id,
            status: "Queued",
            BatchID: taskBatch.id,
            jobType: JSON.stringify(jobTypes),
          },
        })
        taskIds.push(task.id)

        combinationsStatus.push({
          taskId: task.id,
          financialYear: period.financialYear || "N/A",
          quarter: period.quarter || "N/A",
          formType: period.formType || "N/A",
          status: "Processing",
          errorMessage: null,
        })

        const payload = buildQueuePayload({
          taskId: task.id,
          period,
          jobTypes,
        })

        queue.push(payload, (err) => {
          if (err) {
            console.error(
              `Failed to process company ${company.name} - ${period.financialYear} ${period.quarter} ${period.formType}:`,
              err
            )
          }
        })
      }

      const enrichment = input.enrichHistory ? await input.enrichHistory(company) : {}

      const historyFy =
        input.historyFinancialYear ??
        (effectivePeriods.length > 0 && effectivePeriods[0]
          ? effectivePeriods[0].financialYear || "N/A"
          : "N/A")
      const historyQ =
        input.historyQuarter ??
        (effectivePeriods.length > 0 && effectivePeriods[0]
          ? effectivePeriods[0].quarter || "N/A"
          : "N/A")

      await db.uploadHistory.create({
        data: {
          companyName: company.name,
          tan: company.tan,
          status: "Processing",
          financialYear: historyFy,
          quarter: historyQ,
          batchId: taskBatch.id,
          type: historyType,
          errorMessage: JSON.stringify({
            action: actionLabel,
            ...historyMeta,
            ...enrichment,
            ...(oneTaskPerCompany ? {} : { combinations: combinationsStatus }),
          }),
        },
      })
    } catch (error: any) {
      console.error(`Error creating tasks for company ${company.name}:`, error)
      const enrichment = input.enrichHistory ? await input.enrichHistory(company) : {}
      await db.uploadHistory.create({
        data: {
          companyName: company.name,
          tan: company.tan,
          status: "Failed",
          errorMessage: JSON.stringify({
            action: actionLabel,
            ...historyMeta,
            ...enrichment,
            error: error?.message || "Unknown error",
            combinations: [],
          }),
          financialYear: input.historyFinancialYear ?? "N/A",
          quarter: input.historyQuarter ?? "N/A",
          batchId: taskBatch.id,
          type: historyType,
        },
      })
    }
  }

  return {
    message: "Companies added to queue successfully",
    batchId: taskBatch.id,
    companyCount: companies.length,
    taskCount: companies.length * effectivePeriods.length,
  }
}
