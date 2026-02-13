import { resolver } from "@blitzjs/rpc"
import { z } from "zod"
import fs from "fs"
import path from "path"
import { sendForm16AEmail } from "src/utils/sendForm16AEmail"

const SendForm16EmailsSchema = z.object({
  companyName: z.string().optional(), // Optional - process all if not provided
  form16Type: z.enum(["form16", "form16a"]),
  financialYear: z.string().optional(), // Optional - process all if not provided
  quarter: z.string().optional(), // Optional - process all if not provided
  formType: z.string().optional(), // Optional - process all if not provided
})

interface EmailResult {
  pan: string
  pdfPath: string
  success: boolean
  error?: string
  email?: string
}

export default resolver.pipe(
  resolver.authorize(),
  resolver.zod(SendForm16EmailsSchema),
  async ({ companyName, form16Type, financialYear, quarter, formType }) => {
    const results: EmailResult[] = []
    let totalProcessed = 0
    let totalSuccess = 0
    let totalFailed = 0

    try {
      // Build the base folder path
      const basePath = path.join(process.cwd(), "public", "pdf", form16Type)

      if (!fs.existsSync(basePath)) {
        return {
          success: false,
          error: `Base folder not found: ${basePath}`,
          results: [],
          totalProcessed: 0,
          totalSuccess: 0,
          totalFailed: 0,
        }
      }

      // Get all company folders or specific company folder
      let companyFolders: string[] = []

      if (companyName && companyName.trim() !== "") {
        // Find specific company folder
        const companyFolderPath = findCompanyFolder(basePath, companyName)
        if (!companyFolderPath) {
          return {
            success: false,
            error: `Company folder not found for: ${companyName}`,
            results: [],
            totalProcessed: 0,
            totalSuccess: 0,
            totalFailed: 0,
          }
        }
        companyFolders = [companyFolderPath]
      } else {
        // Get all company folders
        const allFolders = fs.readdirSync(basePath, { withFileTypes: true })
        companyFolders = allFolders
          .filter((dirent) => dirent.isDirectory())
          .map((dirent) => path.join(basePath, dirent.name))
      }

      // Process each company folder
      for (const companyFolderPath of companyFolders) {
        const companyFolderName = path.basename(companyFolderPath)

        // Get all period folders in the company folder
        if (!fs.existsSync(companyFolderPath)) {
          continue
        }

        const periodFolders = fs.readdirSync(companyFolderPath, { withFileTypes: true })
        const validPeriodFolders = periodFolders.filter((dirent) => dirent.isDirectory())

        // Filter period folders based on provided parameters
        for (const periodFolder of validPeriodFolders) {
          const periodFolderName = periodFolder.name

          // Parse folder name: 26Q_FY2025-26_Q2
          const parsed = parsePeriodFolderName(periodFolderName)

          if (!parsed) continue

          // Check if this folder matches the provided filters
          if (formType && parsed.formType !== formType) continue
          if (financialYear && parsed.financialYear !== financialYear) continue
          if (quarter && parsed.quarter !== quarter) continue

          const periodFolderPath = path.join(companyFolderPath, periodFolderName)

          // Find all PDF files in the period folder
          const files = fs.readdirSync(periodFolderPath)
          const pdfFiles = files.filter((file) => file.toLowerCase().endsWith(".pdf"))

          // Process each PDF file
          for (const pdfFile of pdfFiles) {
            // Extract PAN from filename
            const pan = extractPanFromFilename(pdfFile)

            if (!pan) {
              results.push({
                pan: "UNKNOWN",
                pdfPath: path.join(periodFolderPath, pdfFile),
                success: false,
                error: `Could not extract PAN from filename (${companyFolderName})`,
              })
              totalProcessed++
              totalFailed++
              continue
            }

            const pdfPath = path.join(periodFolderPath, pdfFile)

            // Send email using the existing utility
            const emailResult = await sendForm16AEmail(
              pan,
              pdfPath,
              parsed.financialYear,
              parsed.quarter,
              parsed.formType
            )

            totalProcessed++

            if (emailResult.success) {
              totalSuccess++
              results.push({
                pan,
                pdfPath: `${companyFolderName}/${periodFolderName}/${pdfFile}`,
                success: true,
              })
            } else {
              totalFailed++
              results.push({
                pan,
                pdfPath: `${companyFolderName}/${periodFolderName}/${pdfFile}`,
                success: false,
                error: emailResult.error,
              })
            }
          }
        }
      }

      if (totalProcessed === 0) {
        return {
          success: false,
          error: "No PDF files found matching the specified criteria",
          results: [],
          totalProcessed: 0,
          totalSuccess: 0,
          totalFailed: 0,
        }
      }

      return {
        success: true,
        message: `Processed ${totalProcessed} emails: ${totalSuccess} sent, ${totalFailed} failed`,
        results,
        totalProcessed,
        totalSuccess,
        totalFailed,
      }
    } catch (error: any) {
      console.error("Error in sendForm16Emails:", error)
      return {
        success: false,
        error: error.message || "Failed to send emails",
        results,
        totalProcessed,
        totalSuccess,
        totalFailed,
      }
    }
  }
)

// Helper function to find company folder (case-insensitive and fuzzy match)
function findCompanyFolder(basePath: string, companyName: string): string | null {
  try {
    if (!fs.existsSync(basePath)) {
      return null
    }

    const folders = fs.readdirSync(basePath, { withFileTypes: true })
    const companyFolders = folders.filter((dirent) => dirent.isDirectory())

    // Normalize company name for comparison
    const normalizedSearchName = normalizeCompanyName(companyName)

    // Try exact match first
    for (const folder of companyFolders) {
      if (normalizeCompanyName(folder.name) === normalizedSearchName) {
        return path.join(basePath, folder.name)
      }
    }

    // Try fuzzy match
    for (const folder of companyFolders) {
      const normalizedFolderName = normalizeCompanyName(folder.name)
      if (
        normalizedFolderName.includes(normalizedSearchName) ||
        normalizedSearchName.includes(normalizedFolderName)
      ) {
        return path.join(basePath, folder.name)
      }
    }

    return null
  } catch (error) {
    console.error("Error finding company folder:", error)
    return null
  }
}

// Helper function to normalize company name for comparison
function normalizeCompanyName(name: string): string {
  return name
    .toLowerCase()
    .replace(/private limited/gi, "pvt ltd")
    .replace(/pvt\./gi, "pvt")
    .replace(/ltd\./gi, "ltd")
    .replace(/\s+/g, " ")
    .trim()
}

// Helper function to parse period folder name
function parsePeriodFolderName(folderName: string): {
  formType: string
  financialYear: string
  quarter: string
} | null {
  try {
    // Format: 26Q_FY2025-26_Q2
    const regex = /^(\w+)_FY(.+?)_(Q\d)$/
    const match = folderName.match(regex)

    if (!match || !match[1] || !match[2] || !match[3]) return null

    return {
      formType: match[1],
      financialYear: match[2],
      quarter: match[3],
    }
  } catch (error) {
    return null
  }
}

// Helper function to extract PAN from filename
function extractPanFromFilename(filename: string): string | null {
  // PAN format: AADCI5030Q (10 characters: 5 letters, 4 digits, 1 letter)
  const panRegex = /([A-Z]{5}[0-9]{4}[A-Z]{1})/
  const match = filename.match(panRegex)
  return match && match[1] ? match[1] : null
}
