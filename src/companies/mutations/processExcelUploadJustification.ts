import { resolver } from "@blitzjs/rpc"
import db from "db"
import NoticeDownloaderQueue from "src/jobs/queue-justification"
import { z } from "zod"

// Generate all possible financial year, quarter, and form type combinations
const generateAllPeriods = () => {
  const currentYear = new Date().getFullYear()
  const periods: { financialYear: string; quarter: string; formType: string }[] = []

  // Generate last 10 financial years
  for (let i = 0; i < 15; i++) {
    const year = currentYear - i
    const financialYear = `${year}-${(year + 1).toString().slice(-2)}`

    // All quarters
    const quarters = ["Q1", "Q2", "Q3", "Q4"]

    // All form types
    const formTypes = ["24Q", "26Q", "27Q", "27EQ"]

    for (const quarter of quarters) {
      for (const formType of formTypes) {
        periods.push({ financialYear, quarter, formType })
      }
    }
  }

  return periods
}

const ProcessExcelUploadSchema = z.object({
  companies: z.array(
    z.object({
      name: z.string(),
      tan: z.string(),
      it_password: z.string(),
      user_id: z.string(),
      password: z.string(),
    })
  ),
  financialYear: z.union([z.string(), z.array(z.string())]),
  quarter: z.union([z.string(), z.array(z.string())]),
  formType: z.union([z.string(), z.array(z.string())]).optional(),
  actionType: z.enum(["send_request", "download_file"]),
  jobTypes: z.array(z.string()),
  sendToAllPeriods: z.boolean().optional(),
})

export default resolver.pipe(
  resolver.zod(ProcessExcelUploadSchema),
  async ({
    companies,
    financialYear,
    quarter,
    formType,
    actionType,
    jobTypes,
    sendToAllPeriods = false,
  }) => {
    // Generate all possible periods if sendToAllPeriods is true
    let periods: { financialYear: string; quarter: string; formType: string | undefined }[] = []

    if (actionType === "download_file") {
      // For download action, no specific periods needed - just one entry per company
      periods = [{ financialYear: "", quarter: "", formType: undefined }]
    } else if (sendToAllPeriods) {
      // For send request with all periods
      periods = generateAllPeriods()
    } else {
      // For send request with specific periods - convert to arrays if they aren't already
      const financialYears = Array.isArray(financialYear)
        ? financialYear
        : financialYear
        ? [financialYear]
        : []
      const quarters = Array.isArray(quarter) ? quarter : quarter ? [quarter] : []
      const formTypes = formType ? (Array.isArray(formType) ? formType : [formType]) : [undefined]

      // Generate all combinations
      for (const fy of financialYears) {
        for (const q of quarters) {
          for (const ft of formTypes) {
            periods.push({ financialYear: fy, quarter: q, formType: ft })
          }
        }
      }
    }

    // Create task batch
    const taskBatch = await db.taskBatch.create({
      data: {
        jobTypes: JSON.stringify(jobTypes),
        module: "IT",
        filters: JSON.stringify({
          financialYear,
          quarter,
          formType,
          actionType,
          sendToAllPeriods,
        }),
      },
    })

    // Process each company - create ONE history entry per company with all combinations
    for (const company of companies) {
      try {
        // Check if company already exists (by TAN)
        let existingCompany = await db.company.findUnique({
          where: { tan: company.tan },
        })

        // If company doesn't exist, create a temporary one
        if (!existingCompany) {
          existingCompany = await db.company.create({
            data: {
              name: company.name,
              tan: company.tan,
              it_password: company.it_password,
              user_id: company.user_id,
              password: company.password,
              isTemporary: true, // Mark as temporary
              emails: null,
            },
          })
        } else {
          // Update existing company with new credentials
          existingCompany = await db.company.update({
            where: { tan: company.tan },
            data: {
              name: company.name,
              it_password: company.it_password,
              user_id: company.user_id,
              password: company.password,
            },
          })
        }

        // Create tasks for each period combination
        const taskIds: number[] = []
        const combinationsStatus: any[] = []

        for (const period of periods) {
          // Create task for this company and period
          const task = await db.task.create({
            data: {
              companyId: existingCompany.id,
              status: "Queued",
              BatchID: taskBatch.id,
              jobType: JSON.stringify(jobTypes),
            },
          })

          taskIds.push(task.id)

          // Track combination status
          combinationsStatus.push({
            taskId: task.id,
            financialYear: period.financialYear || "N/A",
            quarter: period.quarter || "N/A",
            formType: period.formType || "N/A",
            status: "Processing",
            errorMessage: null,
          })

          // Add to queue
          NoticeDownloaderQueue.push(
            {
              id: task.id,
              jobTypes: jobTypes as any,
              financialYear: actionType === "send_request" ? period.financialYear : undefined,
              quarter: actionType === "send_request" ? period.quarter : undefined,
              formType: actionType === "send_request" ? period.formType : undefined,
            },
            (err, newNoticeIds) => {
              if (err) {
                console.error(
                  `Failed to process company ${company.name} - ${period.financialYear} ${period.quarter} ${period.formType}:`,
                  err
                )
              }
            }
          )
        }

        // Create ONE upload history entry for this company with all combinations
        const historyData: any = {
          companyName: company.name,
          tan: company.tan,
          status: "Processing",
          financialYear:
            periods.length > 0 && periods[0] ? periods[0].financialYear || "N/A" : "N/A",
          quarter: periods.length > 0 && periods[0] ? periods[0].quarter || "N/A" : "N/A",
          batchId: taskBatch.id,
          type: "justification",
          // Store combinations and their statuses as JSON
          errorMessage: JSON.stringify({
            action: actionType === "send_request" ? "Send Request" : "Download File",
            combinations: combinationsStatus,
          }),
        }

        await db.uploadHistory.create({
          data: historyData,
        })
      } catch (error) {
        console.error(`Error creating tasks for company ${company.name}:`, error)
        // Create failed history entry
        await db.uploadHistory.create({
          data: {
            companyName: company.name,
            tan: company.tan,
            status: "Failed",
            errorMessage: JSON.stringify({
              action: actionType === "send_request" ? "Send Request" : "Download File",
              error: error.message || "Unknown error",
              combinations: [],
            }),
            financialYear: "N/A",
            quarter: "N/A",
            batchId: taskBatch.id,
            type: "justification",
          },
        })
      }
    }

    return {
      message: "Companies added to queue successfully",
      batchId: taskBatch.id,
    }
  }
)
