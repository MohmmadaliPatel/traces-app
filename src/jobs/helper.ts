import db from "db"
import { isEqual, isNil, max, omitBy } from "lodash"
import { wrapper } from "axios-cookiejar-support"
import { CookieJar } from "tough-cookie"
import { HttpCookieProxyAgent, HttpsCookieProxyAgent } from "node-cookie-proxy-agent"
import axios from "axios"
import rateLimit from "axios-rate-limit"
import { HttpCookieAgent, HttpsCookieAgent } from "http-cookie-agent/http"
import CryptoJS from "crypto-js"

// Default function to handle 401 errors
let on401Handler: () => Promise<void> = async () => {
  console.log("401 Unauthorized detected. Please implement authentication refresh logic.")
}

// Function to set custom 401 handler
export function setOn401Handler(handler: () => Promise<void>) {
  on401Handler = handler
}

const jar = new CookieJar()
export const httpAgent = new HttpCookieAgent({
  cookies: { jar },
  keepAlive: true,
  keepAliveInitialDelay: 1000,
  maxSockets: 10,
})
export const httpsAgent = new HttpsCookieAgent({
  cookies: { jar },
  keepAlive: true,
  keepAliveInitialDelay: 1000,
  maxSockets: 10,
})

export function getAxiostClient() {
  const proxy = process.env.PROXY_URL
  const commonConfig = {
    jar,
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      "cache-control": "no-cache",
      pragma: "no-cache",
      "sec-fetch-dest": "empty",
      "sec-fetch-mode": "cors",
      "sec-fetch-site": "same-origin",
      "sec-gpc": "1",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.82 Safari/537.36",
    },
  }
  console.log({ proxy })

  let axiosInstance
  if (proxy) {
    const httpAgent = new HttpCookieProxyAgent(jar, proxy)
    const httpsAgent = new HttpsCookieProxyAgent(jar, proxy)
    axiosInstance = axios.create({
      httpAgent,
      httpsAgent,
      ...commonConfig,
    })
  } else {
    axiosInstance = rateLimit(axios.create({ ...commonConfig, httpAgent, httpsAgent }) as any, {
      maxRequests: 1,
      // maxRPS: 1,
    }) as any
  }

  // Add response interceptor to handle 401 errors
  axiosInstance.interceptors.response.use(
    (response) => response,
    async (error) => {
      const originalRequest = error.config

      if (error.response?.status === 401 && !originalRequest._retry) {
        originalRequest._retry = true

        try {
          console.log("401 Unauthorized detected. Calling handler function...")
          await on401Handler()
          console.log("Handler function completed. Retrying original request...")

          // Retry the original request
          return axiosInstance(originalRequest)
        } catch (handlerError) {
          console.error("Error in 401 handler:", handlerError)
          return Promise.reject(error)
        }
      }

      return Promise.reject(error)
    }
  )

  return axiosInstance
}

/**
 * Encrypts data using AES-256-CBC encryption with PBKDF2 key derivation
 * @param e - The string data to encrypt
 * @param t - The password to use for encryption
 * @returns String containing IV + Salt + Encrypted data (same format as CryptoJS)
 */
export function getEncryptedString(e: string, password: string): string {
  const base64Password = btoa(password)

  const n = CryptoJS.lib.WordArray.random(16) // Random 16-byte IV
  const s = CryptoJS.lib.WordArray.random(16) // Random 16-byte salt

  // Derive key using PBKDF2 with keySize 8 (8*4 = 32 bytes), 1000 iterations, SHA256
  const r = CryptoJS.PBKDF2(base64Password, s, {
    keySize: 8,
    iterations: 1000,
    hasher: CryptoJS.algo.SHA256,
  })

  // Encrypt using AES-CBC with PKCS7 padding
  const encrypted = CryptoJS.AES.encrypt(e, r, {
    iv: n,
    padding: CryptoJS.pad.Pkcs7,
    mode: CryptoJS.mode.CBC,
  })

  // Return concatenated IV + Salt + Encrypted data
  return (n + s + encrypted).toString()
}

/**
 * Decrypts data that was encrypted using AES-256-CBC encryption with PBKDF2 key derivation
 * @param encryptedHex - The encrypted string containing IV + Salt + Encrypted data
 * @param password - The password used for encryption
 * @returns Decrypted string data
 */
export function getDecryptedString(encryptedHex: string, password: string): string {
  const base64Password = btoa(password)
  // Check if encryptedHex is defined and has sufficient length
  if (!encryptedHex || encryptedHex.length < 64) {
    throw new Error("Invalid encrypted data: string is undefined or too short")
  }

  // Extract IV and Salt from the encrypted data
  const iv = CryptoJS.enc.Hex.parse(encryptedHex.substr(0, 32)) // first 16 bytes (32 hex chars)
  const salt = CryptoJS.enc.Hex.parse(encryptedHex.substr(32, 32)) // next 16 bytes (32 hex chars)
  const ciphertext = encryptedHex.substr(64) // remaining is the actual ciphertext

  // Derive key using PBKDF2 with SHA256
  const key = CryptoJS.PBKDF2(base64Password, salt, {
    keySize: 8, // 256-bit key (8 words * 32 bits)
    iterations: 1000,
    hasher: CryptoJS.algo.SHA256,
  })

  // Decrypt using AES-CBC
  const decrypted = CryptoJS.AES.decrypt(ciphertext, key, {
    iv: iv,
    padding: CryptoJS.pad.Pkcs7,
    mode: CryptoJS.mode.CBC,
  })

  return decrypted.toString(CryptoJS.enc.Utf8) // Convert back to text
}

/**
 * Common function to search for txt files in company folders and extract challan details
 * @param year - Financial year in format "2025-26"
 * @param companyName - Name of the company
 * @param tan - TAN number for matching returns
 * @param parseFunction - Function to parse txt content for challans
 * @param logger - Logger instance for logging
 * @returns Array of company data objects with challan details
 */
export async function findAndProcessTxtFiles(
  year: string | string[],
  companyName: string,
  tan: string,
  parseFunction: (content: string, name: string) => any[],
  logger: any
): Promise<any[]> {
  const fs = require("fs")
  const path = require("path")

  const results: any[] = []

  // Handle case where year might be an array (defensive programming)
  const yearString = Array.isArray(year) ? year[0] : year

  // If no valid year provided, return empty results
  if (!yearString || yearString === "") {
    logger.log(`❌ No valid financial year provided`)
    return results
  }

  console.log("year", yearString)
  const baseFolder = path.join(process.cwd(), "public", "pdf", "data", yearString)
  console.log("year", yearString, baseFolder)

  // Find matching company folder
  const companyFolder = findMatchingCompanyFolder(companyName, baseFolder)

  if (!companyFolder) {
    logger.log(`❌ Company folder not found for: ${companyName}`)
    return results
  }

  logger.log(`Found company folder: ${companyFolder}`)

  // Recursively find all .txt files in the company folder
  const txtFiles = findTxtFilesRecursively(companyFolder)

  if (txtFiles.length === 0) {
    logger.log(`No txt files found in ${companyFolder}`)
    return results
  }

  logger.log(`Found ${txtFiles.length} txt files for ${companyName}`)

  // Process each txt file
  for (const txtFilePath of txtFiles) {
    try {
      logger.log(`Processing: ${txtFilePath}`)

      // Extract formType and quarter from path
      const pathInfo = extractFormTypeAndQuarterFromPath(txtFilePath, companyFolder)
      if (!pathInfo) {
        logger.log(`Could not extract formType and quarter from path: ${txtFilePath}`)
        continue
      }

      const { formType, quarter, financialYear } = pathInfo

      const txtContent = fs.readFileSync(txtFilePath, "utf8")

      // Parse the txt file to extract challan details using provided function
      const challans = parseFunction(txtContent, companyName)

      if (challans.length > 0 && challans[0]) {
        const firstChallan: any = challans[0]
        logger.log(JSON.stringify(firstChallan))

        // Try to find matching record in returns.json
        const returnsPath = path.join(
          process.cwd(),
          "public",
          "pdf",
          "return",
          `F${formType}`,
          companyName,
          `returns.json`
        )

        if (fs.existsSync(returnsPath)) {
          try {
            const returnsContent = fs.readFileSync(returnsPath, "utf8")
            const allReturns: any[] = JSON.parse(returnsContent)

            const match = allReturns.find((rec) => {
              const matchSubmitUserId = (rec.submitUserId || "") === tan
              const matchForm =
                String((rec.formTypeCd || "").toUpperCase()) === `F${formType.toUpperCase()}`
              const matchRefYear = String(rec.refYear) === String(financialYear.split("-")[0])
              const matchQuarter =
                String(rec.financialQrtr || "").toUpperCase() === String(quarter).toUpperCase()
              return matchSubmitUserId && matchForm && matchRefYear && matchQuarter
            })

            if (match) {
              firstChallan.rrr = match["tempAckNo"]
            }
          } catch (e) {
            logger.log("Could not read or parse returns.json: " + e.message)
          }
        }

        // Round amount fields to remove decimal digits
        const roundedChallan = { ...firstChallan }
        for (const key in roundedChallan) {
          if (
            (key.startsWith("amt") || key === "chlnamt") &&
            typeof roundedChallan[key] === "number"
          ) {
            roundedChallan[key] = Math.floor(roundedChallan[key])
          }
        }

        const companyData = {
          companyName,
          formType,
          quarter,
          financialYear: financialYear ? parseInt(financialYear.split("-")[0] || "2025") : 2025,
          tan: tan,
          userId: "", // Will be filled by caller
          password: "", // Will be filled by caller
          ...roundedChallan,
        }

        results.push(companyData)
      }
    } catch (error) {
      logger.log(`Error processing txt file ${txtFilePath}: ${error.message}`)
    }
  }

  return results
}

/**
 * Recursively find all .txt files in a directory
 */
function findTxtFilesRecursively(dirPath: string): string[] {
  const fs = require("fs")
  const path = require("path")

  const txtFiles: string[] = []

  function scanDirectory(currentPath: string) {
    try {
      const items = fs.readdirSync(currentPath, { withFileTypes: true })

      for (const item of items) {
        const fullPath = path.join(currentPath, item.name)

        if (item.isDirectory()) {
          scanDirectory(fullPath)
        } else if (item.isFile() && item.name.endsWith(".txt")) {
          txtFiles.push(fullPath)
        }
      }
    } catch (error) {
      // Skip directories we can't read
    }
  }

  scanDirectory(dirPath)
  return txtFiles
}

/**
 * Extract formType and quarter from file path
 */
function extractFormTypeAndQuarterFromPath(
  txtFilePath: string,
  companyFolder: string
): { formType: string; quarter: string; financialYear: string } | null {
  const path = require("path")
  const relativePath = path.relative(companyFolder, txtFilePath)
  const pathParts = relativePath.split(path.sep)

  // Look for patterns like F24Q, F26Q, F27Q, F27EQ in the path
  const formTypePattern = /(\d+)(Q|EQ)/i
  const quarterPattern = /Q\d+|EQ/i

  let formType = ""
  let quarter = ""
  let financialYear = ""

  // Extract from path parts
  for (const part of pathParts) {
    // Check for form type
    const formMatch = part.match(formTypePattern)
    if (formMatch) {
      formType = formMatch[1] + formMatch[2].toUpperCase()
    }

    // Check for quarter
    const quarterMatch = part.match(quarterPattern)
    if (quarterMatch) {
      quarter = quarterMatch[0].toUpperCase()
    }

    // Check for financial year (format like 2025-26)
    const yearMatch = part.match(/(\d{4})-(\d{2})/)
    if (yearMatch) {
      financialYear = yearMatch[0]
    }
  }

  // If form type or quarter not found in path, try to extract from filename
  // Example: CHIT26Q2.txt -> formType: 26Q, quarter: Q2
  if (!formType || !quarter) {
    const filename = path.basename(txtFilePath, ".txt")

    // Pattern to match form type and quarter in filename
    // Matches patterns like: 24Q1, 26Q2, 27Q3, 27EQ4
    const filenamePattern = /(\d{2})(Q|EQ)(\d)/i
    const filenameMatch = filename.match(filenamePattern)

    if (filenameMatch) {
      if (!formType) {
        formType = filenameMatch[1] + filenameMatch[2].toUpperCase()
      }
      if (!quarter) {
        // Convert quarter number to Q format (1 -> Q1, 2 -> Q2, etc.)
        quarter = `Q${filenameMatch[3]}`
      }
    }
  }

  if (!formType || !quarter) {
    return null
  }

  // If financial year not found in path, try to infer from parent folder
  if (!financialYear) {
    const yearFolder = path.basename(path.dirname(companyFolder))
    const yearMatch = yearFolder.match(/(\d{4})-(\d{2})/)
    if (yearMatch) {
      financialYear = yearMatch[0]
    }
  }

  return { formType, quarter, financialYear: financialYear || "2025-26" }
}

/**
 * Find matching company folder (handles case variations)
 */
function findMatchingCompanyFolder(companyName: string, baseFolder: string): string | null {
  const fs = require("fs")
  const path = require("path")
  console.log("baseFolder", baseFolder)
  console.log("companyName", companyName)
  try {
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
