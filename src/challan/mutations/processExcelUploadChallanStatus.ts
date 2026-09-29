import { resolver } from "@blitzjs/rpc"
import { z } from "zod"
import * as fs from "fs"
import * as path from "path"
import { findMatchingCompanyFolder } from "src/shared/jobs/workers/taskHelpers"
import { CompanyCredentialsSchema } from "src/shared/types/companyCredentials"
import { createBatchFromCompanies } from "src/shared/jobs/createBatchFromCompanies"

const ProcessExcelUploadSchema = z.object({
  companies: z.array(CompanyCredentialsSchema),
  financialYear: z.union([z.string(), z.array(z.string())]),
  quarter: z.union([z.string(), z.array(z.string())]),
  formType: z.union([z.string(), z.array(z.string())]).optional(),
  actionType: z.enum(["send_request", "download_file"]),
  jobTypes: z.array(z.string()),
  sendToAllPeriods: z.boolean().optional(),
  challanStatusType: z.enum(["challan_status"]).optional(),
  /** Only query TRACES for payment-history PDFs not already in challan status Excel (no txt fallback). */
  onlyPaymentPdfNotInExcel: z.boolean().optional(),
  /** list = unconsumed table → Excel only; full = View Amount + status Excel */
  mode: z.enum(["list", "full"]).optional(),
})

function getChallanDetailsCount(companyName: string): number {
  try {
    const baseFolder = path.join(process.cwd(), "public", "pdf", "form16a", "2025-26")
    const companyFolder = findMatchingCompanyFolder(companyName, baseFolder)

    if (!companyFolder) {
      return 0
    }

    const challanDetailsPath = path.join(companyFolder, "challan_details.json")

    if (!fs.existsSync(challanDetailsPath)) {
      return 0
    }

    const fileContent = fs.readFileSync(challanDetailsPath, "utf8")
    const challanData = JSON.parse(fileContent)

    if (challanData.challanDetails && Array.isArray(challanData.challanDetails)) {
      return challanData.challanDetails.length
    }

    return 0
  } catch (error) {
    console.error(`Error reading challan details for ${companyName}:`, error)
    return 0
  }
}

export default resolver.pipe(
  resolver.zod(ProcessExcelUploadSchema),
  resolver.authorize(),
  async ({
    companies,
    financialYear,
    actionType,
    jobTypes,
    challanStatusType = "challan_status",
    onlyPaymentPdfNotInExcel = false,
    mode = "full",
  }) => {
    const financialYears = Array.isArray(financialYear)
      ? financialYear.filter(Boolean)
      : financialYear
        ? [financialYear]
        : []

    // Dynamic import keeps Puppeteer / fs job code out of the client bundle
    const { default: NoticeDownloaderChallanStatusQueue } = await import(
      "src/jobs/queue-challanStatus"
    )

    return createBatchFromCompanies({
      companies,
      jobTypes,
      filters: {
        actionType,
        challanStatusType,
        onlyPaymentPdfNotInExcel,
        mode,
        financialYears,
      },
      historyType: challanStatusType,
      periods: [{ financialYear: "", quarter: "", formType: undefined }],
      oneTaskPerCompany: true,
      historyFinancialYear: financialYears.length > 0 ? financialYears.join(",") : "all",
      historyQuarter: "N/A",
      historyMeta: {
        mode,
        financialYears,
      },
      actionLabel: mode === "list" ? "Fetch Unconsumed List" : "Download Challan Status",
      enrichHistory: (company) => ({
        challanDetailsCount: getChallanDetailsCount(company.name),
      }),
      queue: NoticeDownloaderChallanStatusQueue,
      buildQueuePayload: ({ taskId, jobTypes: jt }) => ({
        id: taskId,
        jobTypes: jt as any,
        challanStatusType,
      }),
    })
  }
)
