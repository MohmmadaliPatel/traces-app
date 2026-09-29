import { resolver } from "@blitzjs/rpc"
import { glob } from "glob"
import path from "path"
import NoticeDownloaderQueue from "src/jobs/queue-form16"
import { z } from "zod"
import { CompanyCredentialsSchema } from "src/shared/types/companyCredentials"
import {
  generateAllPeriods,
  generateAllForm16aNewActPeriods,
  resolvePeriods,
} from "src/shared/excel/periods"
import { createBatchFromCompanies } from "src/shared/jobs/createBatchFromCompanies"
import { attachDscToForm16aPdfs } from "src/form16/utils/signForm16Pdfs"

const ProcessExcelUploadSchema = z.object({
  companies: z.array(CompanyCredentialsSchema),
  financialYear: z.union([z.string(), z.array(z.string())]),
  quarter: z.union([z.string(), z.array(z.string())]),
  formType: z.union([z.string(), z.array(z.string())]).optional(),
  actionType: z.enum(["send_request", "download_file", "sign_pdf"]),
  jobTypes: z.array(z.string()),
  sendToAllPeriods: z.boolean().optional(),
  form16Type: z.enum(["form16", "form16a"]).optional(),
  /** Form 16A: "new" = REST tdscertificatesservice; "old" = traces61 Puppeteer */
  portalMode: z.enum(["new", "old"]).optional(),
  certificateName: z.string(),
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
    form16Type = "form16",
    portalMode = "new",
    certificateName,
  }) => {
    if (actionType === "sign_pdf") {
      const pdfs = [] as string[]
      const folderName = form16Type === "form16" ? "form16" : "form16a"
      for (const company of companies) {
        const companyPath = path.join(process.cwd(), "public", "pdf", folderName, company.name)
        const files = await glob("**/*.pdf", {
          cwd: companyPath,
          absolute: true,
        })
        pdfs.push(...files)
      }
      if (pdfs.length === 0) {
        throw new Error("No PDFs found for the selected company/companies")
      }

      // Goes through attachDsc rather than the raw signer so this path also gets the
      // single-signer lock, the PIN timeout, and post-signing verification.
      const dscResult = await attachDscToForm16aPdfs({
        companyName: companies[0]?.name || "",
        tan: companies[0]?.tan,
        dscCertificateName: certificateName,
        pdfPaths: pdfs,
      })

      if (!dscResult.signed) {
        throw new Error(
          dscResult.error || dscResult.skippedReason || "DSC could not be attached to the PDFs"
        )
      }

      return pdfs
    }

    const isForm16a = form16Type === "form16a"
    const useNewPortal = isForm16a && portalMode === "new"

    // New portal Form 16A: always expand FY × Q × formType.
    // Old portal / Form 16 download: one empty period per company.
    const periods = resolvePeriods({
      financialYear,
      quarter,
      formType,
      sendToAllPeriods,
      downloadPlaceholder: !useNewPortal && actionType === "download_file",
      defaults: useNewPortal
        ? { financialYear: "2026-27", quarter: "Q1", formType: "131" }
        : undefined,
      allPeriodsFn: useNewPortal ? generateAllForm16aNewActPeriods : generateAllPeriods,
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
        form16Type,
        portalMode: isForm16a ? portalMode : undefined,
        certificateName: certificateName || undefined,
      },
      historyType: form16Type,
      periods,
      actionLabel: actionType === "send_request" ? "Send Request" : "Download File",
      queue: NoticeDownloaderQueue,
      buildQueuePayload: ({ taskId, period, jobTypes: jt }) => {
        const passPeriod =
          useNewPortal || actionType === "send_request"
            ? Boolean(period.financialYear && period.quarter && period.formType)
            : false
        return {
          id: taskId,
          jobTypes: jt as any,
          financialYear: passPeriod ? period.financialYear : undefined,
          quarter: passPeriod ? period.quarter : undefined,
          formType: passPeriod ? period.formType : undefined,
          form16Type,
          portalMode: isForm16a ? portalMode : undefined,
          certificateName: certificateName || undefined,
        }
      },
    })
  }
)

