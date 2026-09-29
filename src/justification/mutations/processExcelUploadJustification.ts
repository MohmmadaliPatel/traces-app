import { resolver } from "@blitzjs/rpc"
import NoticeDownloaderQueue from "src/jobs/queue-justification"
import { z } from "zod"
import { CompanyCredentialsSchema } from "src/shared/types/companyCredentials"
import {
  generateAllJustificationPeriods,
  resolvePeriods,
} from "src/shared/excel/periods"
import { createBatchFromCompanies } from "src/shared/jobs/createBatchFromCompanies"

const ProcessExcelUploadSchema = z.object({
  companies: z.array(CompanyCredentialsSchema),
  financialYear: z.union([z.string(), z.array(z.string())]),
  quarter: z.union([z.string(), z.array(z.string())]),
  formType: z.union([z.string(), z.array(z.string())]).optional(),
  actionType: z.enum(["send_request", "download_file"]),
  jobTypes: z.array(z.string()),
  sendToAllPeriods: z.boolean().optional(),
})

export default resolver.pipe(
  resolver.zod(ProcessExcelUploadSchema),
  resolver.authorize(),
  async ({
    companies,
    financialYear,
    quarter,
    formType,
    actionType,
    jobTypes,
    sendToAllPeriods = false,
  }) => {
    const periods = resolvePeriods({
      financialYear,
      quarter,
      formType,
      sendToAllPeriods,
      defaults: { financialYear: "2026-27", quarter: "Q1", formType: "140" },
      allPeriodsFn: generateAllJustificationPeriods,
    })

    const result = await createBatchFromCompanies({
      companies,
      jobTypes,
      filters: {
        financialYear,
        quarter,
        formType,
        actionType,
        sendToAllPeriods,
        concurrency: 1,
      },
      historyType: "justification",
      periods,
      historyMeta: { concurrency: 1 },
      actionLabel: actionType === "send_request" ? "Send Request" : "Download File",
      queue: NoticeDownloaderQueue,
      buildQueuePayload: ({ taskId, period, jobTypes: jt }) => {
        const hasPeriod = Boolean(period.financialYear && period.quarter && period.formType)
        return {
          id: taskId,
          jobTypes: jt as any,
          financialYear: hasPeriod ? period.financialYear : undefined,
          quarter: hasPeriod ? period.quarter : undefined,
          formType: hasPeriod ? period.formType : undefined,
        }
      },
    })

    return {
      ...result,
      message: "Companies added to queue successfully (sequential)",
      concurrency: 1,
    }
  }
)
