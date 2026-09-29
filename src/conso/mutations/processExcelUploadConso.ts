import { resolver } from "@blitzjs/rpc"
import NoticeDownloaderQueue from "src/jobs/queue-conso"
import { z } from "zod"
import { CompanyCredentialsSchema } from "src/shared/types/companyCredentials"
import { generateAllPeriods, resolvePeriods } from "src/shared/excel/periods"
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
      downloadPlaceholder: actionType === "download_file",
      allPeriodsFn: generateAllPeriods,
    })

    return createBatchFromCompanies({
      companies,
      jobTypes,
      filters: {
        financialYear,
        quarter,
        formType,
        actionType,
        sendToAllPeriods,
      },
      historyType: "conso",
      periods,
      actionLabel: actionType === "send_request" ? "Send Request" : "Download File",
      queue: NoticeDownloaderQueue,
      buildQueuePayload: ({ taskId, period, jobTypes: jt }) => ({
        id: taskId,
        jobTypes: jt as any,
        financialYear: actionType === "send_request" ? period.financialYear : undefined,
        quarter: actionType === "send_request" ? period.quarter : undefined,
        formType: actionType === "send_request" ? period.formType : undefined,
      }),
    })
  }
)
