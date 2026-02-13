import { resolver } from "@blitzjs/rpc"
import db from "db"
import { glob } from "glob"
import path from "path"
import NoticeDownloaderQueue from "src/jobs/queue-form16"
import { z } from "zod"
import fs from "fs/promises";
import { spawn } from "child_process"


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
  actionType: z.enum(["send_request", "download_file", "sign_pdf"]),
  jobTypes: z.array(z.string()),
  sendToAllPeriods: z.boolean().optional(),
  form16Type: z.enum(["form16", "form16a"]).optional(),
  certificateName: z.string()
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
    form16Type = "form16",
    certificateName
  }) => {
    // Generate all possible periods if sendToAllPeriods is true
    let periods: { financialYear: string; quarter: string; formType: string | undefined }[] = []

    if (actionType === "sign_pdf") {
      const pdfs = [] as string[]
      for (const company of companies) {
        const companyPath = path.join(process.cwd(), "public", "pdf", "form16a", company.name)
        const files = await glob("**/*.pdf", {
            cwd: companyPath,
            absolute: true
          });
        pdfs.push(...files)
      }
      const inputJSON = {
        "CertificateName": certificateName,
        "Pdfs": pdfs.map(p => ({ InputPath: p, OutputPath: p }))
      }

       // ---- save to file ----
      const tempDir = path.join(process.cwd(), "temp");
      await fs.mkdir(tempDir, { recursive: true });

      const timestamp = Date.now();
      const inputJsonFilePath = path.join(tempDir, `input-${timestamp}.json`);

      await fs.writeFile(
        inputJsonFilePath,
        JSON.stringify(inputJSON, null, 2),
        "utf8"
      );
      await runPdfSigner(inputJsonFilePath)

      return pdfs
    }
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
          form16Type,
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
          console.log("period PROCESS EXCEL UPLOAD FORM16", period)
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

          console.log("combinationsStatus PROCESS EXCEL UPLOAD FORM16", combinationsStatus);


          // Add to queue
          NoticeDownloaderQueue.push(
            {
              id: task.id,
              jobTypes: jobTypes as any,
              financialYear: actionType === "send_request" ? period.financialYear : undefined,
              quarter: actionType === "send_request" ? period.quarter : undefined,
              formType: actionType === "send_request" ? period.formType : undefined,
              form16Type: form16Type,
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
          type: form16Type,
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
            type: form16Type,
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



function runPdfSigner(inputJsonPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const exePath = path.join(
      process.cwd(),
      "pdf-signer",
      "pdf-signer.exe"
    );

    const child = spawn(exePath, [inputJsonPath], {
      cwd: process.cwd(),
      windowsHide: true,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", data => {
      console.log(data.toString("utf8"))
    });

    child.stderr.on("data", data => {
      console.log(data.toString("utf8"))
    });

    child.on("error", err => {
      reject(err);
    });

    child.on("close", code => {
      if (code !== 0) {
        reject(
          new Error(
            `pdf-signer exited with code ${code}\n${stderr}`
          )
        );
      } else {
        resolve(stdout);
      }
    });
  });
}