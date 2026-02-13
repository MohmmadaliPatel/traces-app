import { resolver } from "@blitzjs/rpc"
import db from "db"
import NoticeDownloaderChallanStatusQueue from "src/jobs/queue-challanStatus"
import { z } from "zod"
import * as fs from "fs"
import * as path from "path"

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
  challanStatusType: z.enum(["challan_status"]).optional(),
})

// Helper function to find matching company folder
function findMatchingCompanyFolder(companyName: string, baseFolder: string): string | null {
  try {
    if (!fs.existsSync(baseFolder)) {
      return null
    }

    const folders = fs
      .readdirSync(baseFolder, { withFileTypes: true })
      .filter((dirent: any) => dirent.isDirectory())
      .map((dirent: any) => dirent.name)

    // Normalize company name for comparison
    const normalizeName = (name: string) =>
      (name || "")
        .toLowerCase()
        .replace(/private limited/gi, "pvt ltd")
        .replace(/pvt\./gi, "pvt")
        .replace(/ltd\./gi, "ltd")
        .replace(/\s+/g, " ")
        .trim()

    const normalizedTarget = normalizeName(companyName)

    for (const folder of folders) {
      const normalizedFolder = normalizeName(folder)
      if (
        normalizedFolder.includes(normalizedTarget) ||
        normalizedTarget.includes(normalizedFolder)
      ) {
        return path.join(baseFolder, folder)
      }
    }
  } catch (error) {
    // Base folder doesn't exist or can't be read
  }

  return null
}

// Helper function to get challan details count
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
  async ({ companies, actionType, jobTypes, challanStatusType = "challan_status" }) => {
    // Create task batch
    const taskBatch = await db.taskBatch.create({
      data: {
        jobTypes: JSON.stringify(jobTypes),
        module: "IT",
        filters: JSON.stringify({
          actionType,
          challanStatusType,
        }),
      },
    })

    // Process each company - create ONE task and ONE history entry per company
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
              isTemporary: true,
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

        // Create ONE task for this company
        const task = await db.task.create({
          data: {
            companyId: existingCompany.id,
            status: "Queued",
            BatchID: taskBatch.id,
            jobType: JSON.stringify(jobTypes),
          },
        })

        // Add to queue
        NoticeDownloaderChallanStatusQueue.push(
          {
            id: task.id,
            jobTypes: jobTypes as any,
            challanStatusType: challanStatusType,
          },
          (err, newNoticeIds) => {
            if (err) {
              console.error(`Failed to process company ${company.name}:`, err)
            }
          }
        )

        // Get challan details count for this company
        const challanDetailsCount = getChallanDetailsCount(company.name)

        // Create ONE upload history entry for this company
        await db.uploadHistory.create({
          data: {
            companyName: company.name,
            tan: company.tan,
            status: "Processing",
            financialYear: "N/A",
            quarter: "N/A",
            batchId: taskBatch.id,
            type: challanStatusType,
            errorMessage: JSON.stringify({
              action: "Download Challan Status",
              challanDetailsCount: challanDetailsCount,
            }),
          },
        })
      } catch (error) {
        console.error(`Error creating tasks for company ${company.name}:`, error)

        // Try to get challan details count even if task creation failed
        const challanDetailsCount = getChallanDetailsCount(company.name)

        // Create failed history entry
        await db.uploadHistory.create({
          data: {
            companyName: company.name,
            tan: company.tan,
            status: "Failed",
            errorMessage: JSON.stringify({
              action: "Download Challan Status",
              challanDetailsCount: challanDetailsCount,
              error: "Error",
            }),
            financialYear: "N/A",
            quarter: "N/A",
            batchId: taskBatch.id,
            type: challanStatusType,
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
