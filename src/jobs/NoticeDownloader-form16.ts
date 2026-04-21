import { AxiosInstance } from "axios"
import { readFile } from "fs-extra"
import dotenv from "dotenv"
import axiosRetry from "axios-retry"
import { writeFileSync } from "fs"
import { ensureDir, unlinkSync } from "fs-extra"
import { Company } from "@prisma/client"
import db from "db"
import { findAndProcessTxtFiles, getAxiostClient, setOn401Handler } from "./helper"
import path from "path"
import { waitForSecs } from "src/utils/promises"
import dayjs from "dayjs"
import customParseFormat from "dayjs/plugin/customParseFormat"
import { exec } from "child_process"
import { access, constants } from "fs/promises"
import * as fs from "fs"
import express, { response } from "express"
import puppeteer from "puppeteer-extra"
import StealthPlugin from "puppeteer-extra-plugin-stealth"
import * as XLSX from "xlsx"
import { parseForm16AFile } from "src/utils/form16AParserExact"
import { generateForm16APdf } from "src/utils/form16APdfGeneratorExact"
import { loginWithTracesApiAndPreauth, traces61DedUrl } from "./traces"
puppeteer.use(StealthPlugin())

dayjs.extend(customParseFormat)

export default class NoticeDownloaderForm16 {
  axiosClient: AxiosInstance
  profileDetails: any

  constructor(
    private company: Company,
    private logger: { log: (msg: string) => void },
    private taskId: number,
    private jobTypes: ("SendRequest" | "DownloadFile")[],
    private financialYear: string = "",
    private quarter: string = "",
    private formType: string = "",
    private form16Type: "form16" | "form16a" = "form16"
  ) {
    this.axiosClient = getAxiostClient()
    axiosRetry(this.axiosClient, {
      retries: 2,
      retryDelay: (retryCount) => {
        console.log(`Retry attempt: ${retryCount}`)
        return retryCount * 1000 < 3000 ? 3000 : retryCount * 1000 // Increasing delay (1s, 2s, 3s, etc.)
      },
    })
    // Set up 401 handler
    this.setup401Handler()

    // Log the parameters for debugging
    this.logger.log(`Financial Year NOTICE DOWNLOADER FORM16: ${this.financialYear}`)
    this.logger.log(`Quarter NOTICE DOWNLOADER FORM16: ${this.quarter}`)
    this.logger.log(`Form Type NOTICE DOWNLOADER FORM16: ${this.formType}`)
    this.logger.log(`Form 16 Type NOTICE DOWNLOADER FORM16: ${this.form16Type}`)
  }

  private setup401Handler() {
    setOn401Handler(async () => {
      try {
        this.logger.log("401 Unauthorized detected. Attempting re-authentication...")
        await this.handleReAuthentication()
        this.logger.log("Re-authentication completed successfully")
      } catch (error) {
        this.logger.log(`Re-authentication failed: ${error.message}`)
        throw error
      }
    })
  }

  private async handleReAuthentication() {
    await this.loadLoginPage()
    const panResponse = await this.verifyPan()
    await waitForSecs(5000)
    const res = await this.verifyPassword(panResponse.reqId, panResponse.role)
    const shouldForceLogin = res.messages.some((m) => m.code === "EF00177")
    const InvalidPassword = res.messages.some((m) => m.code === "EF00027")

    if (InvalidPassword) {
      this.logger.log("Invalid password during re-authentication")
      await this.addMessageToTask("Invalid password during re-authentication")
      throw new Error("Invalid password during re-authentication")
    }

    this.logger.log(JSON.stringify(res, null, 2))

    if (shouldForceLogin) {
      this.logger.log("User is already logged in on another device. Forcing login...")
      await waitForSecs(5000)
      await this.forceLogin(panResponse.reqId, panResponse.role)
      this.logger.log("Force login completed")
    }
  }

  async loadLoginPage() {
    const res = await this.axiosClient.get(
      "https://eportal.incometax.gov.in/iec/foservices/#/login",
      {
        headers: {
          "Content-Type": "text/html; charset=utf-8",
        },
      }
    )
  }
  get encodedPassword() {
    return Buffer.from(this.company.it_password).toString("base64")
  }

  get Pan() {
    return this.company.tan.toUpperCase()
  }

  async getConfig() {
    return dotenv.parse(await readFile(".env.production"))
  }

  decodeEscapes(str) {
    return str.replace(/\\x([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  }

  cleanFileName(file: string) {
    let _file = file.replace(/[/\\?%*:|"<>]/g, "-")
    const { ext } = path.parse(_file)
    if (ext !== ".pdf") {
      _file = path.format({ ...path.parse(_file), base: "", ext: ".pdf" })
    }
    return _file
  }

  async addMessageToTask(msg: string) {
    const task = await db.task.findUnique({
      where: { id: this.taskId },
      select: { message: true },
    })

    if (task?.message?.includes(msg)) {
      return // Skip if message already exists
    }

    const updatedMessage = task?.message ? `${task.message}\n${msg}` : msg

    return db.task.update({
      where: { id: this.taskId },
      data: {
        message: { set: updatedMessage },
      },
    })
  }

  async verifyPan() {
    try {
      this.logger.log("Verifying Pan")
      const res = await this.axiosClient.post(
        "https://eportal.incometax.gov.in/iec/loginapi/login",
        {
          entity: this.Pan,
          serviceName: "wLoginService",
        }
      )
      return res.data
    } catch (error) {
      this.logger.log(`Cannot verify Pan '${this.Pan}'`)
      await this.addMessageToTask("Cannot verify Pan")
      throw error
    }
  }

  async verifyPassword(reqId: string, role: string) {
    try {
      this.logger.log("Verifying Password")
      console.log(
        JSON.stringify({
          errors: [],
          reqId: reqId,
          entity: this.Pan,
          entityType: "PAN",
          role,
          uidValdtnFlg: "true",
          aadhaarMobileValidated: "false",
          secAccssMsg: "",
          secLoginOptions: "",
          dtoService: "LOGIN",
          exemptedPan: "false",
          userConsent: "",
          imgByte: null,
          pass: this.encodedPassword,
          passValdtnFlg: null,
          otpGenerationFlag: null,
          otp: null,
          otpValdtnFlg: null,
          otpSourceFlag: null,
          contactPan: null,
          contactMobile: null,
          contactEmail: null,
          email: null,
          mobileNo: null,
          forgnDirEmailId: null,
          imagePath: null,
          serviceName: "loginService",
        })
      )
      const res = await this.axiosClient.post(
        "https://eportal.incometax.gov.in/iec/loginapi/login",
        {
          errors: [],
          reqId: reqId,
          entity: this.Pan,
          entityType: "PAN",
          role,
          uidValdtnFlg: "true",
          aadhaarMobileValidated: "false",
          secAccssMsg: "",
          secLoginOptions: "",
          dtoService: "LOGIN",
          exemptedPan: "false",
          userConsent: "",
          imgByte: null,
          pass: this.encodedPassword,
          passValdtnFlg: null,
          otpGenerationFlag: null,
          otp: null,
          otpValdtnFlg: null,
          otpSourceFlag: null,
          contactPan: null,
          contactMobile: null,
          contactEmail: null,
          email: null,
          mobileNo: null,
          forgnDirEmailId: null,
          imagePath: null,
          serviceName: "loginService",
        }
      )
      return res.data
    } catch (error) {
      this.logger.log(`Cannot verify Password for Pan '${this.Pan}'`)
      await this.addMessageToTask("Cannot verify Password")
      throw error
    }
  }

  async forceLogin(reqId: string, role: string) {
    try {
      this.logger.log("Trying to force login")
      const res = await this.axiosClient.post(
        "https://eportal.incometax.gov.in/iec/loginapi/login",
        {
          errors: [],
          reqId: reqId,
          entity: this.Pan,
          entityType: "PAN",
          role,
          uidValdtnFlg: "true",
          aadhaarMobileValidated: "false",
          secAccssMsg: "",
          secLoginOptions: "",
          dtoService: "LOGIN",
          exemptedPan: "false",
          userConsent: "",
          imgByte: null,
          pass: this.encodedPassword,
          passValdtnFlg: null,
          otpGenerationFlag: null,
          otp: null,
          otpValdtnFlg: null,
          otpSourceFlag: null,
          contactPan: null,
          contactMobile: null,
          contactEmail: null,
          email: null,
          mobileNo: null,
          forgnDirEmailId: null,
          imagePath: null,
          serviceName: "loginService",
          aadhaarLinkedWithUserId: "Y",
          userType: "IND",
          remark: "Continue",
          lastLoginSuccessFlag: "true",
        }
      )
      // this.logger.log(JSON.stringify(res.data, null, 2))
      return res.data
    } catch (error) {
      this.logger.log(`Unable to login forcefully`)
      await this.addMessageToTask("Unable to login forcefully")
      throw error
    }
  }

  async login() {
    await this.loadLoginPage()
    const panResponse = await this.verifyPan()
    await waitForSecs(5000)
    const res = await this.verifyPassword(panResponse.reqId, panResponse.role)
    const shouldForceLogin = res.messages.some((m) => m.code === "EF00177")
    const InvalidPassword = res.messages.some((m) => m.code === "EF00027")
    if (InvalidPassword) {
      this.logger.log("Invalid password")
      await this.addMessageToTask("Invalid password")
      return
    }
    this.logger.log(JSON.stringify(res, null, 2))

    if (shouldForceLogin) {
      this.logger.log("It seems this user is already logged in someother device")
      await waitForSecs(5000)
      await this.forceLogin(panResponse.reqId, panResponse.role)
    }
  }

  async fileExists(filePath) {
    try {
      await access(filePath, constants.F_OK)
      return true // File exists
    } catch (error) {
      return false // File does not exist
    }
  }

  async getProfileDetails() {
    const res = await this.axiosClient.post(
      "https://eportal.incometax.gov.in/iec/servicesapi/auth/saveEntity",
      {
        serviceName: "userProfileService",
        userId: this.company.tan,
      }
    )
    this.profileDetails = res.data
  }

  async getReturnsData(type: any) {
    // Fetch all pages of returns data and save results in a JSON array
    const allData: any[] = []
    let currentPage = 0
    const pageSize = 5
    let hasMore = true

    try {
      while (hasMore) {
        const payload = {
          serviceName: "viewFiledForms",
          entityNum: this.Pan,
          formTypeCd: type,
          currentPage: currentPage.toString(),
          pageSize: pageSize.toString(),
          filterParameterDetails: [],
        }

        const res = await this.axiosClient.post(
          "https://eportal.incometax.gov.in/iec/servicesapi/auth/saveEntity",
          payload,
          {
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
          }
        )

        // Assume data list is in res.data.data or similar; adjust as per actual API response
        const list = res.data?.forms || []
        allData.push(...list)

        // Determine if there are more pages
        if (list.length < pageSize) {
          hasMore = false
        } else {
          currentPage += 1
        }
      }

      // Sort the data
      // 1. Primary sort by refYear
      // 2. For same entityNum, financialQrtr, refYear - sort by ackDt (latest first)
      allData.sort((a, b) => {
        // First compare by refYear
        const refYearDiff = (b.refYear || 0) - (a.refYear || 0)
        if (refYearDiff !== 0) return refYearDiff

        // If same refYear, check if entityNum and financialQrtr are also same
        if (
          a.entityNum === b.entityNum &&
          a.financialQrtr === b.financialQrtr &&
          a.refYear === b.refYear
        ) {
          // Parse ackDt dates in format "31-Jul-2025"
          const dateA = this.parseAckDate(a.ackDt)
          const dateB = this.parseAckDate(b.ackDt)

          // Sort by date descending (latest first)
          return dateB.getTime() - dateA.getTime()
        }

        return 0
      })
      const sanitizedCompanyName = this.company.name.replace(/[\/\\?%*:|"<>]/g, "_")

      const path = `./public/pdf/return/${type}/${this.company.name}`
      if (!fs.existsSync(path)) {
        fs.mkdirSync(path, { recursive: true })
      }
      try {
        await fs.promises.writeFile(
          `${path}/returns.json`,
          JSON.stringify(allData, null, 2),
          "utf-8"
        )
        this.logger.log(`Saved returns data to ${path}/${sanitizedCompanyName}.json`)
      } catch (e) {
        this.logger.log(
          `Failed to write returns data JSON: ${e instanceof Error ? e.message : String(e)}`
        )
        throw new Error(
          `Failed to write returns data JSON: ${e instanceof Error ? e.message : String(e)}`
        )
      }
    } catch (error) {
      console.log("error", error)
      this.logger.log(`Error in getReturnsData: ${error}`)
      throw new Error(`Error in getReturnsData: ${error.message}`)
    }
  }

  parseAckDate(dateStr: string): Date {
    // Parse date in format "31-Jul-2025"
    if (!dateStr) return new Date(0)

    try {
      const parts = dateStr.split("-")
      if (parts.length !== 3) return new Date(0)

      const dayStr = parts[0]
      const monthStr = parts[1]
      const yearStr = parts[2]

      if (!dayStr || !monthStr || !yearStr) return new Date(0)

      const day = parseInt(dayStr)
      const year = parseInt(yearStr)

      const monthMap: { [key: string]: number } = {
        Jan: 0,
        Feb: 1,
        Mar: 2,
        Apr: 3,
        May: 4,
        Jun: 5,
        Jul: 6,
        Aug: 7,
        Sep: 8,
        Oct: 9,
        Nov: 10,
        Dec: 11,
      }

      const month = monthMap[monthStr]
      if (month === undefined) return new Date(0)

      return new Date(year, month, day)
    } catch (error) {
      return new Date(0)
    }
  }

  async makeReturnsExcel() {
    const fs = require("fs")
    const path = require("path")

    const baseReturnsDir = path.join(process.cwd(), "public", "pdf", "return")
    const workbook = XLSX.utils.book_new()
    let totalRecords = 0

    try {
      // Check if base returns directory exists
      if (!fs.existsSync(baseReturnsDir)) {
        this.logger.log(`Returns directory not found: ${baseReturnsDir}`)
        return []
      }

      // Read all return type directories (26Q, 24Q, 27EQ, 27Q, etc.)
      const returnTypeDirs = fs
        .readdirSync(baseReturnsDir, { withFileTypes: true })
        .filter((dirent: any) => dirent.isDirectory())
        .map((dirent: any) => dirent.name)

      this.logger.log(
        `Found ${returnTypeDirs.length} return type directories: ${returnTypeDirs.join(", ")}`
      )
      const result: any[] = []

      // Process each return type directory
      for (const returnType of returnTypeDirs) {
        const returnsDir = path.join(baseReturnsDir, returnType)

        // Read all company directories in this return type
        const companyDirs = fs
          .readdirSync(returnsDir, { withFileTypes: true })
          .filter((dirent: any) => dirent.isDirectory())
          .map((dirent: any) => dirent.name)

        this.logger.log(`Processing ${returnType}: Found ${companyDirs.length} company directories`)

        // Process each company directory
        for (const companyName of companyDirs) {
          const companyDir = path.join(returnsDir, companyName)
          const jsonFilePath = path.join(companyDir, `returns.json`)

          // Check if JSON file exists
          if (!fs.existsSync(jsonFilePath)) {
            this.logger.log(`JSON file not found for company: ${companyName}`)
            continue
          }

          try {
            // Read and parse JSON file
            const fileContent = fs.readFileSync(jsonFilePath, "utf8")
            const returnsData = JSON.parse(fileContent)

            // Extract required fields from each return
            if (Array.isArray(returnsData)) {
              for (const returnRecord of returnsData) {
                result.push({
                  "Company Name": companyName,
                  "Financial year": returnRecord.refYear || "",
                  Quarter: returnRecord.financialQrtr || "",
                  "Filing Type": returnRecord.filingTypeCd || "",
                  returnType: returnType || "",
                  "Date of Tds return": returnRecord.ackDt || "",
                  "RRR number": returnRecord.tempAckNo || "",
                  "Acknowledgement number": returnRecord.ackNum || "",
                })
              }
            }
          } catch (error) {
            this.logger.log(`Error processing JSON file for ${companyName}: ${error.message}`)
          }
        }

        // Sort the data
        // 1. Primary sort: Company Name (alphabetical)
        // 2. Secondary sort: Financial year (descending - latest first)
        // 3. Tertiary sort: Quarter (Q4, Q3, Q2, Q1)
        result.sort((a, b) => {
          // First compare by company name (alphabetical)
          const companyNameA = (a["Company Name"] || "").toString()
          const companyNameB = (b["Company Name"] || "").toString()
          const companyDiff = companyNameA.localeCompare(companyNameB)
          if (companyDiff !== 0) return companyDiff

          // Then compare by financial year (descending)
          const yearDiff = (b["Financial year"] || 0) - (a["Financial year"] || 0)
          if (yearDiff !== 0) return yearDiff

          // Finally, if same company and year, sort by quarter: Q4 > Q3 > Q2 > Q1
          const quarterOrder: { [key: string]: number } = {
            Q4: 4,
            Q3: 3,
            Q2: 2,
            Q1: 1,
          }

          const quarterA = quarterOrder[a.Quarter] || 0
          const quarterB = quarterOrder[b.Quarter] || 0

          return quarterB - quarterA
        })

        // Add sheet for this return type if there's data
        if (result.length > 0) {
          const worksheet = XLSX.utils.json_to_sheet(result)
          XLSX.utils.book_append_sheet(workbook, worksheet, returnType)
          totalRecords += result.length
          this.logger.log(`Added sheet '${returnType}' with ${result.length} records`)
        } else {
          this.logger.log(`No records found for return type ${returnType}`)
        }
      }

      // Write the Excel file
      if (totalRecords > 0) {
        // Also save the combined data as JSON
        const jsonFilePath = path.join(baseReturnsDir, "all_returns.json")
        fs.writeFileSync(jsonFilePath, JSON.stringify(result, null, 2), "utf8")
        this.logger.log(`JSON file written to ${jsonFilePath} with ${result.length} records`)
        const excelFilePath = path.join(baseReturnsDir, "all_returns.xlsx")
        XLSX.writeFile(workbook, excelFilePath)
        this.logger.log(`Excel file written to ${excelFilePath} with ${totalRecords} total records`)
      } else {
        this.logger.log("No return records found to write to Excel")
      }

      this.logger.log(`Completed processing ${returnTypeDirs.length} return types`)
      return totalRecords
    } catch (error) {
      this.logger.log(`Error in makeReturnsExcel: ${error.message}`)
      throw error
    }
  }

  normalizeCompanyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/\s+/g, " ") // Normalize multiple spaces to single space
      .replace(/private limited/gi, "pvt ltd")
      .replace(/pvt\./gi, "pvt")
      .replace(/ltd\./gi, "ltd")
      .trim()
  }

  findMatchingCompanyFolder(companyName: string, baseFolder: string): string | null {
    const fs = require("fs")
    const path = require("path")

    // First try exact match
    const exactPath = path.join(baseFolder, companyName)
    if (fs.existsSync(exactPath)) {
      return exactPath
    }

    // If exact match fails, try to find a matching folder
    if (!fs.existsSync(baseFolder)) {
      return null
    }

    const normalizedSearchName = this.normalizeCompanyName(companyName)
    const folders = fs
      .readdirSync(baseFolder, { withFileTypes: true })
      .filter((dirent: any) => dirent.isDirectory())
      .map((dirent: any) => dirent.name)

    for (const folder of folders) {
      const normalizedFolderName = this.normalizeCompanyName(folder)
      if (normalizedFolderName === normalizedSearchName) {
        return path.join(baseFolder, folder)
      }
    }

    return null
  }

  async readReturnsTxtFiles() {
    try {
      // Use the common function
      const results = await findAndProcessTxtFiles(
        this.financialYear, // Already in 2025-26 format
        this.company.name,
        this.company.tan || "",
        this.parseTxtFileForChallans.bind(this), // Pass the class method
        this.logger
      )
      console.log("RESULTS", results)

      // Filter results for the specific form type and quarter we're looking for
      const matchingResult = results.find(
        (result) =>
          (Array.isArray(this.formType)
            ? this.formType.includes(result.formType)
            : result.formType === this.formType) &&
          (Array.isArray(this.quarter)
            ? this.quarter.includes(result.quarter)
            : result.quarter === this.quarter)
      )
      console.log("MATCHING RESULT", matchingResult, this.formType, this.quarter)
      if (matchingResult) {
        // Add company credentials
        matchingResult.userId = this.company.user_id || ""
        matchingResult.password = this.company.password || ""
        return matchingResult
      }

      return null
    } catch (error) {
      this.logger.log(`Error in readReturnsTxtFiles: ${error.message}`)
      throw error
    }
  }

  parseTxtFileForChallans(txtContent: string, companyName: string) {
    const lines = txtContent.split("\n")
    const allChallans: any[] = []
    let currentChallan: any = null
    let currentDeductees: any[] = []

    for (const line of lines) {
      const normalizedLine = line.replace(/\^{2,}/g, "^")
      const fields = normalizedLine.split("^")

      // Check if this is a CD (Challan Details) row
      // Each CD row marks the START of a new challan
      if (fields.length > 1 && fields[1] === "CD") {
        // IMPORTANT: Process the PREVIOUS challan before starting a new one
        // This ensures we don't mix deductees from different challans
        if (currentChallan && currentDeductees.length > 0) {
          const uniquePans = new Set(currentDeductees.map((d) => d.pan).filter((p) => p))

          // Collect ALL challans regardless of unique PAN count
          if (uniquePans.size >= 1) {
            // Remove duplicate (PAN, amount) pairs
            // Keep only unique combinations of PAN and amount
            const uniqueDeductees: any[] = []
            const seenPairs = new Set<string>()

            for (const deductee of currentDeductees) {
              if (deductee.pan) {
                const pairKey = `${deductee.pan}|${deductee.amount}`
                if (!seenPairs.has(pairKey)) {
                  seenPairs.add(pairKey)
                  uniqueDeductees.push(deductee)
                }
              }
            }

            // Get up to 3 unique DD rows (unique PAN+amount combinations)
            const panData: any = {}
            const ddRowsToStore = Math.min(uniqueDeductees.length, 3)

            for (let i = 0; i < ddRowsToStore; i++) {
              const deductee = uniqueDeductees[i]
              if (deductee.pan) {
                const panIndex = i + 1
                panData[`pan${panIndex}`] = deductee.pan
                panData[`amt${panIndex}`] = deductee.amount
              }
            }

            allChallans.push({
              ...currentChallan,
              ...panData,
              totalUniquePans: uniquePans.size,
              totalDDRows: currentDeductees.length, // Track total DD rows (before deduplication)
              totalUniquePairs: uniqueDeductees.length, // Track unique (PAN, amount) pairs
            })
          }
        }

        // Now start a fresh NEW challan with empty deductees array
        // This prevents mixing deductees from the previous challan
        currentChallan = {
          bsr: fields[7] || "", // BSR code
          dtoftaxdep: fields[8] || "", // Date
          csn: fields[6] || "", // CSN
          chlnamt: fields[9] ? parseFloat(fields[9]) : 0, // Amount
        }
        // RESET deductees array for the new challan
        currentDeductees = []
      }
      // Check if this is a DD (Deductee Details) row
      // These rows belong to the current challan until we hit the next CD row
      else if (fields.length > 1 && fields[1] === "DD") {
        if (currentChallan) {
          currentDeductees.push({
            pan: fields[7] || "", // PAN
            amount: fields[9] ? parseFloat(fields[9]) : 0, // Amount
          })
        }
      }
    }

    // Process the last challan
    if (currentChallan && currentDeductees.length > 0) {
      const uniquePans = new Set(currentDeductees.map((d) => d.pan).filter((p) => p))

      if (uniquePans.size >= 1) {
        // Remove duplicate (PAN, amount) pairs
        // Keep only unique combinations of PAN and amount
        const uniqueDeductees: any[] = []
        const seenPairs = new Set<string>()

        for (const deductee of currentDeductees) {
          if (deductee.pan) {
            const pairKey = `${deductee.pan}|${deductee.amount}`
            if (!seenPairs.has(pairKey)) {
              seenPairs.add(pairKey)
              uniqueDeductees.push(deductee)
            }
          }
        }

        // Get up to 3 unique DD rows (unique PAN+amount combinations)
        const panData: any = {}
        const ddRowsToStore = Math.min(uniqueDeductees.length, 3)

        for (let i = 0; i < ddRowsToStore; i++) {
          const deductee = uniqueDeductees[i]
          if (deductee.pan) {
            const panIndex = i + 1
            panData[`pan${panIndex}`] = deductee.pan
            panData[`amt${panIndex}`] = deductee.amount
          }
        }

        allChallans.push({
          ...currentChallan,
          ...panData,
          totalUniquePans: uniquePans.size,
          totalDDRows: currentDeductees.length, // Track total DD rows (before deduplication)
          totalUniquePairs: uniqueDeductees.length, // Track unique (PAN, amount) pairs
        })
      }
    }

    // Now select the best CD row based on priority:
    // Priority: Max unique (PAN,amount) pairs first (3 > 2 > 1), then max unique PANs (3 > 2 > 1)
    // Note: We deduplicate (PAN, amount) pairs to ensure no two entries have identical PAN AND amount
    // 1. 1 CD with 3 unique (PAN,amount) pairs and 3 unique PANs
    // 2. 1 CD with 3 unique (PAN,amount) pairs and 2 unique PANs
    // 3. 1 CD with 3 unique (PAN,amount) pairs and 1 unique PAN
    // 4. 1 CD with 2 unique (PAN,amount) pairs and 2 unique PANs
    // 5. 1 CD with 2 unique (PAN,amount) pairs and 1 unique PAN
    // 6. 1 CD with 1 unique (PAN,amount) pair
    let selectedChallan: any = null

    this.logger.log(`Company Name: ${companyName}`)
    this.logger.log(`Total CD rows found: ${allChallans.length}`)

    // Priority 1: 1 CD with 3 unique (PAN,amount) pairs and 3 unique PANs
    selectedChallan = allChallans.find((c) => c.totalUniquePairs >= 3 && c.totalUniquePans >= 3)
    if (selectedChallan) {
      this.logger.log(
        `✓ Priority 1: Found 1 CD with ${
          selectedChallan.totalUniquePairs
        } unique (PAN,amt) pairs and 3 unique PANs: ${JSON.stringify(selectedChallan)}`
      )
      return [selectedChallan]
    }

    // Priority 2: 1 CD with 3 unique (PAN,amount) pairs and 2 unique PANs
    selectedChallan = allChallans.find((c) => c.totalUniquePairs >= 3 && c.totalUniquePans === 2)
    if (selectedChallan) {
      this.logger.log(
        `✓ Priority 2: Found 1 CD with ${
          selectedChallan.totalUniquePairs
        } unique (PAN,amt) pairs and 2 unique PANs: ${JSON.stringify(selectedChallan)}`
      )
      return [selectedChallan]
    }

    // Priority 3: 1 CD with 3 unique (PAN,amount) pairs and 1 unique PAN
    selectedChallan = allChallans.find((c) => c.totalUniquePairs >= 3 && c.totalUniquePans === 1)
    if (selectedChallan) {
      this.logger.log(
        `✓ Priority 3: Found 1 CD with ${
          selectedChallan.totalUniquePairs
        } unique (PAN,amt) pairs and 1 unique PAN: ${JSON.stringify(selectedChallan)}`
      )
      return [selectedChallan]
    }

    // Priority 4: 1 CD with 2 unique (PAN,amount) pairs and 2 unique PANs
    selectedChallan = allChallans.find((c) => c.totalUniquePairs === 2 && c.totalUniquePans === 2)
    if (selectedChallan) {
      this.logger.log(
        `⚠ Priority 4: Found 1 CD with 2 unique (PAN,amt) pairs and 2 unique PANs: ${JSON.stringify(
          selectedChallan
        )}`
      )
      return [selectedChallan]
    }

    // Priority 5: 1 CD with 2 unique (PAN,amount) pairs and 1 unique PAN
    selectedChallan = allChallans.find((c) => c.totalUniquePairs === 2 && c.totalUniquePans === 1)
    if (selectedChallan) {
      this.logger.log(
        `⚠ Priority 5: Found 1 CD with 2 unique (PAN,amt) pairs and 1 unique PAN: ${JSON.stringify(
          selectedChallan
        )}`
      )
      return [selectedChallan]
    }

    // Priority 6: 1 CD with 1 unique (PAN,amount) pair
    selectedChallan = allChallans.find((c) => c.totalUniquePairs === 1 && c.totalUniquePans === 1)
    if (selectedChallan) {
      this.logger.log(
        `⚠ Priority 6: Found 1 CD with 1 unique (PAN,amt) pair: ${JSON.stringify(selectedChallan)}`
      )
      return [selectedChallan]
    }

    // Fallback: Return the first available CD row
    if (allChallans.length > 0) {
      selectedChallan = allChallans[0]
      this.logger.log(
        `⚠ Fallback: Returning first available CD (${
          selectedChallan.totalUniquePairs
        } unique pairs, ${selectedChallan.totalUniquePans} unique PANs): ${JSON.stringify(
          selectedChallan
        )}`
      )
      return [selectedChallan]
    }

    this.logger.log(`✗ No CD rows found`)
    return []
  }

  async compareChallan() {
    const fs = require("fs")
    const path = require("path")

    // Paths to the JSON files
    const file1Path = path.join(process.cwd(), "public", "pdf", "return", "challan_details_1.json")
    const file2Path = path.join(process.cwd(), "public", "pdf", "return", "challan_details.json")
    const outPath = path.join(
      process.cwd(),
      "public",
      "pdf",
      "return",
      "challan_details_extra_in_1.json"
    )

    // Read and parse both JSON files
    let challan1 = []
    let challan2 = []

    try {
      challan1 = JSON.parse(fs.readFileSync(file1Path, "utf8"))
    } catch (e) {
      this.logger?.log?.("Failed to read challan_details_1.json: " + e.message)
      throw e
    }

    try {
      challan2 = JSON.parse(fs.readFileSync(file2Path, "utf8"))
    } catch (e) {
      this.logger?.log?.("Failed to read challan_details.json: " + e.message)
      throw e
    }

    // Helper to create stable, order-sensitive stringified representation for comparison
    function stableStringify(obj) {
      if (Array.isArray(obj)) {
        return "[" + obj.map(stableStringify).join(",") + "]"
      } else if (obj && typeof obj === "object") {
        // sort keys
        return (
          "{" +
          Object.keys(obj)
            .sort()
            .map((k) => JSON.stringify(k) + ":" + stableStringify(obj[k]))
            .join(",") +
          "}"
        )
      } else {
        return JSON.stringify(obj)
      }
    }

    // Build a Set of stringified objects from challan2
    const challan2Set = new Set(challan2.map((o) => stableStringify(o)))

    // Find all objects in challan1 not found in challan2
    const extraObjects = challan1.filter((obj) => !challan2Set.has(stableStringify(obj)))

    // Log the total number missing
    this.logger?.log?.(`Total objects in challan_details_1.json: ${challan1.length}`)
    this.logger?.log?.(`Total objects in challan_details.json: ${challan2.length}`)
    this.logger?.log?.(`Total number missing in challan_details.json: ${extraObjects.length}`)

    // Write the missing objects to a new JSON file
    fs.writeFileSync(outPath, JSON.stringify(extraObjects, null, 2), "utf8")
    this.logger?.log?.(
      `compareChallan: ${extraObjects.length} objects from challan_details_1.json not found in challan_details.json. Output written to ${outPath}`
    )
    return extraObjects
  }

  async getTracesData(company: any) {
    try {
      this.logger.log(`Getting Traces Data for ${JSON.stringify(company)}`)
      const isManualCaptcha = process.env.IS_CAPTCHA_MANUAL == "true"

      // Function to get captcha image
      const getCaptchaImage = async () => {
        return this.axiosClient.get("https://www.tdscpc.gov.in/app/srv/GetCaptchaImg", {
          headers: {
            accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            connection: "keep-alive",
            host: "www.tdscpc.gov.in",
            referer: "https://www.tdscpc.gov.in/app/login.xhtml?usr=Ded",
            "sec-ch-ua": '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "image",
            "sec-fetch-mode": "no-cors",
            "sec-fetch-site": "same-origin",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36",
          },
          responseType: "arraybuffer",
        })
      }

      let captchaValue
      const captchaResponse = await getCaptchaImage()

      const login = await this.axiosClient.get(
        "https://www.tdscpc.gov.in/app/login.xhtml?usr=Ded",
        {
          headers: {
            accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9,en-IN;q=0.8",
            connection: "keep-alive",
            host: "www.tdscpc.gov.in",
            "sec-ch-ua": '"Microsoft Edge";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "none",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
          },
          // Log the response headers of this API call
          // The response from this call can be intercepted below (outside this config, after the request)
          // Example (assuming you assign the result to a variable):
          // const response = await this.axiosClient.get("...", { headers: { ... } });
        }
      )

      if (isManualCaptcha) {
        // Save captcha image to a temporary file
        const captchaName = `captcha_${this.taskId}_${Date.now()}.png`
        const captchaPath = `./public/temp/${captchaName}`
        await ensureDir("./public/temp")
        writeFileSync(captchaPath, captchaResponse.data)

        // Create a simple Express server to show captcha and accept input
        const captchaServer = express()
        const port = 3333

        captchaValue = await new Promise((resolve) => {
          captchaServer.use(express.static("./public"))
          captchaServer.use(express.json())

          // Endpoint to receive captcha solution
          captchaServer.post("/submit-captcha", (req, res) => {
            const { captcha } = req.body
            res.json({ success: true })
            resolve(captcha)

            // Close server after receiving input
            setTimeout(() => {
              server.close()
              // Clean up the temporary captcha file
              try {
                unlinkSync(captchaPath)
              } catch (e) {}
            }, 500)
          })

          // HTML page to show captcha
          captchaServer.get("/captcha", (req, res) => {
            res.send(`
              <html>
                <head>
                  <title>Enter Captcha</title>
                  <style>
                    body { font-family: Arial; text-align: center; margin-top: 50px; }
                    img { margin: 20px 0; border: 1px solid #ccc; }
                    input { padding: 10px; font-size: 16px; width: 150px; }
                    button { padding: 10px 20px; background: #4CAF50; color: white; border: none; cursor: pointer; }
                  </style>
                </head>
                <body>
                  <h2>Please enter the captcha text</h2>
                  <p>For Company: ${this.company.name}</p>
                  <img src="/temp/${captchaName}" alt="Captcha">
                  <form id="captchaForm">
                    <input type="text" id="captchaInput" autocomplete="off" autofocus><br><br>
                    <button type="submit">Submit</button>
                  </form>
                  <script>
                    document.getElementById('captchaForm').addEventListener('submit', async (e) => {
                      e.preventDefault();
                      const captcha = document.getElementById('captchaInput').value;
                      await fetch('/submit-captcha', {
                        method: 'POST',
                        headers: {'Content-Type': 'application/json'},
                        body: JSON.stringify({captcha})
                      });
                      window.close();
                    });
                  </script>
                </body>
              </html>
            `)
          })

          const server = captchaServer.listen(port, () => {
            // Open the URL in the default browser
            const startCmd =
              process.platform === "win32"
                ? "start"
                : process.platform === "darwin"
                ? "open"
                : "xdg-open"
            exec(`${startCmd} http://localhost:${port}/captcha`)
          })
        })
      } else {
        // Use automatic captcha solving
        const data = await this.axiosClient.post(process.env.SERVER_URL + "/captcha/decode", {
          captcha: captchaResponse.data,
          //machineId: process.env.MACHINE_ID,
          isSuperAdmin: true,
        })
        captchaValue = data.data.captcha
      }

      const formData = new URLSearchParams()
      formData.append("search1", "on")
      formData.append("username", company.user_id.toUpperCase())
      formData.append("j_username", company.user_id.toUpperCase() + "^" + company.tan.toUpperCase())
      formData.append("selradio", "D")
      formData.append("ticker", "")
      formData.append("j_password", company.password)
      formData.append("j_tanPan", company.tan.toUpperCase())
      formData.append("j_captcha", captchaValue)
      // Log the formData for debugging

      // Attempt authentication with the captcha
      const res = await this.axiosClient.post(
        "https://www.tdscpc.gov.in/app/j_security_check",
        formData,
        {
          headers: {
            accept:
              "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9",
            "cache-control": "max-age=0",
            connection: "keep-alive",
            "content-type": "application/x-www-form-urlencoded",
            host: "www.tdscpc.gov.in",
            origin: "https://www.tdscpc.gov.in",
            referer: "https://www.tdscpc.gov.in/app/login.xhtml?usr=Ded",
            "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "document",
            "sec-fetch-mode": "navigate",
            "sec-fetch-site": "same-origin",
            "sec-fetch-user": "?1",
            "upgrade-insecure-requests": "1",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
          },
        }
      )
      // Final auth step
      const res2 = await this.axiosClient.get("https://www.tdscpc.gov.in/app/", {
        headers: {
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          "Accept-Encoding": "gzip, deflate, br, zstd",
          "Accept-Language": "en-US,en;q=0.9",
          "Cache-Control": "max-age=0",
          Connection: "keep-alive",
          Host: "www.tdscpc.gov.in",
          "Sec-Fetch-Dest": "document",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Site": "cross-site",
          "Sec-Fetch-User": "?1",
          "Upgrade-Insecure-Requests": "1",
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
          "sec-ch-ua": '"Google Chrome";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
          "sec-ch-ua-mobile": "?0",
          "sec-ch-ua-platform": '"Windows"',
        },
      })

      const reqList = await this.axiosClient.get(
        `https://www.tdscpc.gov.in/app/srv/GetReqListServlet?reqtype=0&_search=false&nd=${Date.now()}&rows=10&page=1&sidx=reqNo&sord=asc`,
        {
          headers: {
            accept: "application/json, text/javascript, */*; q=0.01",
            "accept-encoding": "gzip, deflate, br, zstd",
            "accept-language": "en-US,en;q=0.9,en-IN;q=0.8",
            connection: "keep-alive",
            host: "www.tdscpc.gov.in",
            referer: "https://www.tdscpc.gov.in/app/ded/filedownload.xhtml",
            "sec-ch-ua": '"Microsoft Edge";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
            "sec-ch-ua-mobile": "?0",
            "sec-ch-ua-platform": '"Windows"',
            "sec-fetch-dest": "empty",
            "sec-fetch-mode": "cors",
            "sec-fetch-site": "same-origin",
            "user-agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
            "x-requested-with": "XMLHttpRequest",
          },
        }
      )

      // Filter reqList.data.rows for all available NSDL Conso files
      const allAvailableFiles = (reqList.data.rows || []).filter(
        (row: any) => row.status === "Available" && row.dntype === "NSDL Conso File"
      )

      if (allAvailableFiles.length === 0) {
        this.logger.log("No NSDL Conso files available")
        return {
          success: false,
          reason: "No NSDL Conso files available",
          company: company.companyName,
          formType: company.formType,
          tan: company.tan,
        }
      }

      this.logger.log(`Found ${allAvailableFiles.length} available NSDL Conso files`)

      // Group by financial year, quarter, and form type
      // Keep only the latest file (by reqDate) for each unique combination
      const groupedFiles = new Map<string, any>()

      allAvailableFiles.forEach((file: any) => {
        const key = `${file.fin}_${file.qrtr}_${file.frmType}`

        // Parse reqDate (format: "25-Oct-2025")
        const parseDate = (dateStr: string) => {
          if (!dateStr) return new Date(0)
          try {
            const parts = dateStr.split("-")
            if (parts.length !== 3) return new Date(0)
            const day = parts[0]
            const month = parts[1]
            const year = parts[2]
            if (!day || !month || !year) return new Date(0)

            const monthMap: Record<string, number> = {
              Jan: 0,
              Feb: 1,
              Mar: 2,
              Apr: 3,
              May: 4,
              Jun: 5,
              Jul: 6,
              Aug: 7,
              Sep: 8,
              Oct: 9,
              Nov: 10,
              Dec: 11,
            }
            return new Date(parseInt(year), monthMap[month] || 0, parseInt(day))
          } catch {
            return new Date(0)
          }
        }

        const currentFileDate = parseDate(file.reqDate)

        if (!groupedFiles.has(key)) {
          groupedFiles.set(key, file)
        } else {
          const existingFile = groupedFiles.get(key)
          const existingFileDate = parseDate(existingFile.reqDate)

          // Keep the file with the latest reqDate
          if (currentFileDate > existingFileDate) {
            groupedFiles.set(key, file)
          }
        }
      })

      const filesToDownload = Array.from(groupedFiles.values())
      this.logger.log(`After filtering duplicates: ${filesToDownload.length} files to download`)

      // Log details of files to download
      filesToDownload.forEach((file: any) => {
        this.logger.log(
          `Will download: FY ${file.finYr}, ${file.qrtr}, ${file.frmType}, Req: ${file.reqNo}, Date: ${file.reqDate}`
        )
      })

      // Download all files
      const downloadResults: any[] = []

      for (const fileToDownload of filesToDownload) {
        const reqNo = fileToDownload.reqNo
        this.logger.log(
          `\nDownloading file for: FY ${fileToDownload.finYr}, ${fileToDownload.qrtr}, ${fileToDownload.frmType}`
        )
        try {
          const formData6 = new URLSearchParams()
          formData6.append("reqNo", reqNo)
          const downloadServlet = await this.axiosClient.post(
            `https://www.tdscpc.gov.in/app/srv/DownloadServlet`,
            formData6,
            {
              headers: {
                accept: "*/*",
                "accept-encoding": "gzip, deflate, br, zstd",
                "accept-language": "en-US,en;q=0.9,en-IN;q=0.8",
                connection: "keep-alive",
                "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
                host: "www.tdscpc.gov.in",
                origin: "https://www.tdscpc.gov.in",
                referer: "https://www.tdscpc.gov.in/app/ded/filedownload.xhtml",
                "sec-ch-ua": '"Microsoft Edge";v="141", "Not?A_Brand";v="8", "Chromium";v="141"',
                "sec-ch-ua-mobile": "?0",
                "sec-ch-ua-platform": '"Windows"',
                "sec-fetch-dest": "empty",
                "sec-fetch-mode": "cors",
                "sec-fetch-site": "same-origin",
                "user-agent":
                  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0",
                "x-requested-with": "XMLHttpRequest",
              },
            }
          )

          // Extract download URL
          let downloadUrl
          if (
            downloadServlet &&
            downloadServlet.data &&
            typeof downloadServlet.data === "string" &&
            downloadServlet.data.startsWith("https://")
          ) {
            downloadUrl = downloadServlet.data
          } else if (
            downloadServlet &&
            downloadServlet.data &&
            typeof downloadServlet.data === "object" &&
            downloadServlet.data.success
          ) {
            downloadUrl = downloadServlet.data.success
          } else if (
            downloadServlet &&
            Array.isArray(downloadServlet.data) &&
            downloadServlet.data.length > 0 &&
            downloadServlet.data[0].success
          ) {
            downloadUrl = downloadServlet.data[0].success
          }

          if (!downloadUrl) {
            this.logger.log(`Could not find download URL for reqNo: ${reqNo}`)
            downloadResults.push({
              success: false,
              reason: "Could not find download URL",
              finYr: fileToDownload.finYr,
              qrtr: fileToDownload.qrtr,
              frmType: fileToDownload.frmType,
              reqNo: reqNo,
            })
            continue
          }

          // Build the file save path
          const companyDir = (company.name || "UNKNOWN_COMPANY").replace(/[/\\?%*:|"<>]/g, "_")
          const formTypeDir = fileToDownload.frmType.replace(/[/\\?%*:|"<>]/g, "_")
          const finYrDir = fileToDownload.finYr.replace(/[/\\?%*:|"<>]/g, "_")
          const qrtrDir = fileToDownload.qrtr

          // Extract filename from URL, or create a meaningful name
          let fileName = "file"
          try {
            const urlParts = downloadUrl.split("/")
            fileName = urlParts.reverse().find((part) => part.includes(".")) || `${reqNo}.zip`
          } catch (e) {
            fileName = `${reqNo}.zip`
          }

          // Ensure directory exists
          const fs = require("fs")
          const pathModule = require("path")

          const targetDir = pathModule.join(
            process.cwd(),
            "public",
            "pdf",
            "traces",
            companyDir,
            finYrDir,
            qrtrDir,
            formTypeDir
          )
          fs.mkdirSync(targetDir, { recursive: true })

          // The full path to save the file
          const targetFilePath = pathModule.join(targetDir, fileName)

          // Download and save the file (streamed for large files)
          const axios = require("axios")
          const downloadResponse = await axios.get(downloadUrl, {
            responseType: "stream",
          })

          await new Promise((resolve, reject) => {
            const writer = fs.createWriteStream(targetFilePath)
            downloadResponse.data.pipe(writer)
            let error = null
            writer.on("error", (err) => {
              error = err
              writer.close()
              reject(err)
            })
            writer.on("close", () => {
              if (!error) {
                resolve(void 0)
              } else {
                reject(error)
              }
            })
          })

          this.logger.log(`✓ File downloaded: ${targetFilePath}`)

          downloadResults.push({
            success: true,
            tanReqNo: `${company.tan.toUpperCase()}_${reqNo}`,
            company: company.name,
            filePath: targetFilePath,
            finYr: fileToDownload.finYr,
            qrtr: fileToDownload.qrtr,
            frmType: fileToDownload.frmType,
            reqNo: reqNo,
            reqDate: fileToDownload.reqDate,
          })

          // Small delay between downloads to avoid rate limiting
          await new Promise((resolve) => setTimeout(resolve, 1000))
        } catch (err) {
          this.logger.log(`✗ Failed to download file for reqNo ${reqNo}: ${err.message}`)
          downloadResults.push({
            success: false,
            reason: `Failed to download: ${err.message}`,
            finYr: fileToDownload.finYr,
            qrtr: fileToDownload.qrtr,
            frmType: fileToDownload.frmType,
            reqNo: reqNo,
          })
        }
      }

      // Summary
      const successCount = downloadResults.filter((r) => r.success).length
      const failCount = downloadResults.filter((r) => !r.success).length

      this.logger.log(`\n=== Download Summary ===`)
      this.logger.log(`Total files processed: ${downloadResults.length}`)
      this.logger.log(`Successfully downloaded: ${successCount}`)
      this.logger.log(`Failed: ${failCount}`)

      // Return overall result
      if (successCount > 0) {
        return {
          success: true,
          company: company.name,
          tan: company.tan.toUpperCase(),
          downloadResults: downloadResults,
          summary: {
            total: downloadResults.length,
            success: successCount,
            failed: failCount,
          },
        }
      } else {
        return {
          success: false,
          reason: "All downloads failed",
          company: company.name,
          tan: company.tan,
          downloadResults: downloadResults,
        }
      }
    } catch (error) {
      console.log("error", error)

      this.logger.log(`Cannot Login ${error}`)
      if (error.message.includes("connection refused")) {
        await this.addMessageToTask(`Captcha Failed`)
      } else {
        await this.addMessageToTask(`Login Failed`)
      }

      return {
        success: false,
        reason: error.message || String(error),
        company: company?.name || "Unknown",
        formType: company?.formType || "Unknown",
        tan: company?.tan || "Unknown",
      }
    }
  }

  async getTracesFilepuppeteer(record: any) {
    const puppeteer = require("puppeteer")
    const fs = require("fs")
    console.log("record", record)

    try {
      this.logger.log(`Starting TRACES automation for ${record.companyName}`)

      const browser = await puppeteer.launch({
        headless: false,
        args: ["--start-maximized"],
      })

      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })

      this.logger.log("TRACES API login + preauth (traces61)…")
      await loginWithTracesApiAndPreauth(page, {
        userId: record.user_id,
        password: record.password,
        tan: record.tan,
      })
      this.logger.log("Login successful")

      this.logger.log("Navigating to consolidated file page...")
      await page.goto(traces61DedUrl("filedownload.xhtml"), {
        waitUntil: "networkidle2",
      })

      // Select financial year, quarter, and form type

      await waitForSecs(2000)

      await page.waitForSelector("#search3")
      await page.click("#search3")

      await waitForSecs(2000)

      // await page.waitForNavigation({ waitUntil: "networkidle2" })
      // INSERT_YOUR_CODE

      // Wait for the reqList table to load
      await page.waitForSelector("#reqList")

      // Setup for downloading files
      const pathModule = require("path")
      const fsModule = require("fs")
      const safeCompany = (record.name || "UNKNOWN_COMPANY").replace(/[/\\?%*:|"<>]/g, "_")
      const downloadResults: any[] = []
      const allFilesInfo: any[] = [] // Track all files for duplicate filtering

      // Parse reqDate (format: "25-Oct-2025" or "2025-10-25")
      const parseDate = (dateStr: string) => {
        if (!dateStr) return new Date(0)
        try {
          const parts = dateStr.split("-")
          if (parts.length !== 3) return new Date(0)

          const part1 = parts[1]
          if (!part1) return new Date(0)

          // Check if format is "25-Oct-2025" or "2025-10-25"
          if (part1.length === 3) {
            // Format: "25-Oct-2025"
            const day = parts[0]
            const month = part1
            const year = parts[2]
            if (!day || !month || !year) return new Date(0)

            const monthMap: Record<string, number> = {
              Jan: 0,
              Feb: 1,
              Mar: 2,
              Apr: 3,
              May: 4,
              Jun: 5,
              Jul: 6,
              Aug: 7,
              Sep: 8,
              Oct: 9,
              Nov: 10,
              Dec: 11,
            }
            return new Date(parseInt(year), monthMap[month] || 0, parseInt(day))
          } else {
            // Format: "2025-10-25" or other numeric format
            const year = parts[0]
            const month = part1
            const day = parts[2]
            if (!day || !month || !year) return new Date(0)
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
          }
        } catch {
          return new Date(0)
        }
      }

      // Helper function to check if file should be downloaded (duplicate filtering)
      const shouldDownloadFile = (file: any) => {
        const finYear = file.financialYear.split("-")[0]
        const key = `${finYear}_${file.quarter}_${file.formType}`

        // Check if we already have this file downloaded or tracked
        const existingDownload = allFilesInfo.find((f) => {
          const fFinYear = f.financialYear.split("-")[0]
          const fKey = `${fFinYear}_${f.quarter}_${f.formType}`
          return fKey === key
        })

        if (!existingDownload) {
          allFilesInfo.push(file)
          return true
        }

        // Compare dates - only download if this file is newer
        const currentFileDate = parseDate(file.requestDate)
        const existingFileDate = parseDate(existingDownload.requestDate)

        if (currentFileDate > existingFileDate) {
          // Replace the old file info with new one
          const index = allFilesInfo.indexOf(existingDownload)
          allFilesInfo[index] = file
          return true
        }

        return false
      }

      // Process pages one by one
      let currentPage = 1
      let hasNextPage = true

      while (hasNextPage) {
        this.logger.log(`\n=== Processing page ${currentPage} ===`)

        // Get rows from current page
        const pageRows = await page.evaluate(() => {
          const table = document.querySelector("#reqList")
          if (!table) return []
          const rows: any[] = []
          const trs = table.querySelectorAll("tr")
          for (let i = 0; i < trs.length; i++) {
            const tr: any = trs[i]
            const columns = tr.querySelectorAll("td")
            if (!columns || columns.length < 8) continue

            rows.push({
              requestDate: columns[0]?.textContent?.trim() || "",
              requestNumber: columns[1]?.textContent?.trim() || "",
              financialYear: columns[2]?.textContent?.trim() || "",
              quarter: columns[3]?.textContent?.trim() || "",
              formType: columns[4]?.textContent?.trim() || "",
              fileProcessed: columns[5]?.textContent?.trim() || "",
              status: columns[6]?.textContent?.trim() || "",
              remarks: columns[7]?.textContent?.trim() || "",
              rowIdx: tr.getAttribute("id"),
            })
          }
          return rows
        })

        this.logger.log(`Found ${pageRows.length} rows on page ${currentPage}`)

        // Filter available NSDL Conso files on this page
        const availableFiles = pageRows.filter(
          (row: any) =>
            row.status.toLowerCase() === "available" &&
            row.fileProcessed.toLowerCase() ===
              (this.form16Type === "form16a" ? "bulk form 16a file" : "bulk form 16 file")
        )

        this.logger.log(`Found ${availableFiles.length} available Form 16 files on this page`)

        // Download files from this page
        for (const fileToDownload of availableFiles) {
          try {
            // Check if we should download this file (duplicate filtering)
            if (!shouldDownloadFile(fileToDownload)) {
              this.logger.log(
                `Skipping duplicate: FY ${fileToDownload.financialYear}, ${fileToDownload.quarter}, ${fileToDownload.formType} (older than previously found)`
              )
              continue
            }

            const reqNo = fileToDownload.requestNumber
            this.logger.log(
              `\nDownloading: FY ${fileToDownload.financialYear}, ${fileToDownload.quarter}, ${fileToDownload.formType}, Req: ${reqNo}`
            )

            // Click on the row
            await page.evaluate((rowId) => {
              const tr: any = document.querySelector(`#reqList tr[id="${rowId}"]`)
              if (tr) tr.click()
            }, fileToDownload.rowIdx)

            this.logger.log(`Clicked on request row: ${reqNo}`)

            // Wait for the download link/button to appear
            await waitForSecs(1000)
            let downloadSelector = "#downloadhttp"
            try {
              await page.waitForSelector(downloadSelector, { timeout: 5000 })
            } catch (e) {
              this.logger.log(`Download button not found for reqNo: ${reqNo}`)
              downloadResults.push({
                success: false,
                reason: "Download button not found",
                finYr: fileToDownload.financialYear,
                qrtr: fileToDownload.quarter,
                frmType: fileToDownload.formType,
                reqNo: reqNo,
              })
              continue
            }

            // Setup download directory
            const formTypeDir = fileToDownload.formType.replace(/[/\\?%*:|"<>]/g, "_")
            const finYrDir = fileToDownload.financialYear.replace(/[/\\?%*:|"<>]/g, "_")
            const qrtrDir = fileToDownload.quarter

            const targetDir = pathModule.join(
              process.cwd(),
              "public",
              "pdf",
              this.form16Type === "form16a" ? "form16a-download" : "form16-download",
              safeCompany,
              finYrDir,
              qrtrDir,
              formTypeDir
            )

            if (!fsModule.existsSync(targetDir)) {
              fsModule.mkdirSync(targetDir, { recursive: true })
            }

            // Setup Puppeteer download behavior
            const cdp = await page.target().createCDPSession()
            await cdp.send("Page.setDownloadBehavior", {
              behavior: "allow",
              downloadPath: targetDir,
            })

            // Click the download button
            let clickSuccess = false
            const selectors = ["#downloadhttp"]
            for (const sel of selectors) {
              const el = await page.$(sel)
              if (el) {
                await el.click()
                clickSuccess = true
                break
              }
            }

            if (!clickSuccess) {
              const [downloadEl] = await page.$x(
                "//a[contains(translate(text(), 'abcdefghijklmnopqrstuvwxyz', 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'), 'DOWNLOAD')]"
              )
              if (downloadEl) {
                await downloadEl.click()
                clickSuccess = true
              }
            }

            if (!clickSuccess) {
              this.logger.log(`Download button not clickable for reqNo: ${reqNo}`)
              downloadResults.push({
                success: false,
                reason: "Download button not clickable",
                finYr: fileToDownload.financialYear,
                qrtr: fileToDownload.quarter,
                frmType: fileToDownload.formType,
                reqNo: reqNo,
              })
              continue
            }

            // Wait for download to finish
            const waitForDownload = async (dir: string, timeoutMs = 30000) => {
              const start = Date.now()
              while (Date.now() - start < timeoutMs) {
                const files = fsModule
                  .readdirSync(dir)
                  .filter((f: string) => /\.(zip|tds|txt|7z)$/i.test(f))
                  .filter((f: string) => !f.endsWith(".crdownload"))
                if (files.length > 0) {
                  let latest = files[0]
                  let latestMtime = fsModule.statSync(pathModule.join(dir, latest)).mtimeMs
                  for (const f of files) {
                    const mtime = fsModule.statSync(pathModule.join(dir, f)).mtimeMs
                    if (mtime > latestMtime) {
                      latest = f
                      latestMtime = mtime
                    }
                  }
                  return pathModule.join(dir, latest)
                }
                await new Promise((res) => setTimeout(res, 1000))
              }
              return null
            }

            const downloadedFilePath = await waitForDownload(targetDir, 45000)

            if (!downloadedFilePath) {
              this.logger.log(`File did not download for reqNo: ${reqNo}`)
              downloadResults.push({
                success: false,
                reason: "File did not download in time",
                finYr: fileToDownload.financialYear,
                qrtr: fileToDownload.quarter,
                frmType: fileToDownload.formType,
                reqNo: reqNo,
              })
              continue
            }

            this.logger.log(`✓ File downloaded: ${downloadedFilePath}`)

            downloadResults.push({
              success: true,
              tanReqNo: `${(record.tan || "").toUpperCase()}_${reqNo}`,
              company: record.name,
              filePath: downloadedFilePath,
              finYr: fileToDownload.financialYear,
              qrtr: fileToDownload.quarter,
              frmType: fileToDownload.formType,
              reqNo: reqNo,
              reqDate: fileToDownload.requestDate,
            })

            // Small delay between downloads
            await new Promise((resolve) => setTimeout(resolve, 1500))
          } catch (err: any) {
            this.logger.log(
              `✗ Failed to download file for reqNo ${fileToDownload.requestNumber}: ${err.message}`
            )
            downloadResults.push({
              success: false,
              reason: `Failed to download: ${err.message}`,
              finYr: fileToDownload.financialYear,
              qrtr: fileToDownload.quarter,
              frmType: fileToDownload.formType,
              reqNo: fileToDownload.requestNumber,
            })
          }
        }

        // Check if next page button is available and not disabled
        const nextPageInfo = await page.evaluate(() => {
          const nextButton = document.querySelector("#next_pager")
          if (!nextButton) return { exists: false, disabled: true }

          const classList = nextButton.className || ""
          const isDisabled = classList.includes("ui-state-disabled")

          return {
            exists: true,
            disabled: isDisabled,
            classList: classList,
          }
        })

        this.logger.log(
          `Next button - exists: ${nextPageInfo.exists}, disabled: ${nextPageInfo.disabled}`
        )

        if (nextPageInfo.exists && !nextPageInfo.disabled) {
          // Click next button and wait for table to update
          try {
            await page.click("#next_pager")
            this.logger.log("Clicked next page button")

            // Wait for the table to update
            await waitForSecs(2000)

            currentPage++
          } catch (error) {
            this.logger.log(`Failed to click next page: ${error.message}`)
            hasNextPage = false
          }
        } else {
          hasNextPage = false
        }
      }

      this.logger.log(`\nProcessed ${currentPage} pages in total`)

      // Close browser
      await browser.close()

      // Summary
      const successCount = downloadResults.filter((r) => r.success).length
      const failCount = downloadResults.filter((r) => !r.success).length

      this.logger.log(`\n=== Download Summary ===`)
      this.logger.log(`Total files tracked: ${allFilesInfo.length}`)
      this.logger.log(`Total downloads attempted: ${downloadResults.length}`)
      this.logger.log(`Successfully downloaded: ${successCount}`)
      this.logger.log(`Failed: ${failCount}`)

      if (downloadResults.length === 0) {
        this.logger.log("No Form 16 files available to download")
        return {
          success: false,
          reason: "No Form 16 files available",
          company: record.name,
          tan: record.tan,
        }
      }

      // Return overall result (same structure as getTracesData)
      if (successCount > 0) {
        return {
          success: true,
          company: record.name,
          tan: (record.tan || "").toUpperCase(),
          downloadResults: downloadResults,
          summary: {
            total: downloadResults.length,
            success: successCount,
            failed: failCount,
          },
        }
      } else {
        return {
          success: false,
          reason: "All downloads failed",
          company: record.name,
          tan: record.tan,
          downloadResults: downloadResults,
        }
      }
    } catch (error) {
      this.logger.log(`Error in TRACES automation: ${error.message}`)
      throw error
    }
  }

  async getTracesDatapuppeteer(record: any) {
    const puppeteer = require("puppeteer")
    const fs = require("fs")

    try {
      this.logger.log(`Starting TRACES automation for ${record.companyName}`)

      const browser = await puppeteer.launch({
        headless: false,
        args: ["--start-maximized"],
      })

      const page = await browser.newPage()
      await page.setViewport({ width: 1920, height: 1080 })

      this.logger.log("TRACES API login + preauth (traces61)…")
      await loginWithTracesApiAndPreauth(page, {
        userId: record.userId,
        password: record.password,
        tan: record.tan,
      })
      this.logger.log("Login successful")

      const isForm16A = this.form16Type === "form16a"
      const formUrl = isForm16A
        ? traces61DedUrl("download16a.xhtml")
        : traces61DedUrl("download16.xhtml")

      this.logger.log(`Navigating to ${isForm16A ? "Form 16A" : "Form 16"} download page...`)
      await page.goto(formUrl, {
        waitUntil: "networkidle2",
      })

      // Step 6: Select financial year
      this.logger.log(
        `Selecting financial year... ${this.financialYear},type: ${typeof this.financialYear}`
      )
      await page.waitForSelector("#bulkfinYr")

      // Extract year from financialYear (e.g., "2024-25" -> "2024")
      const year = this.financialYear ? String(this.financialYear).split("-")[0] : "2025"
      await page.select("#bulkfinYr", year)
      this.logger.log(`Selected financial year: ${year}`)

      // Step 7: If Form 16A, select quarter and form type
      if (isForm16A) {
        this.logger.log("Selecting quarter and form type for Form 16A...")

        // Map quarter to option value (Q1->3, Q2->4, Q3->5, Q4->6)
        const quarterMap: { [key: string]: string } = {
          Q1: "3",
          Q2: "4",
          Q3: "5",
          Q4: "6",
        }
        const quarterValue = quarterMap[this.quarter] || "3"

        await page.waitForSelector("#bulkquarter")
        await page.select("#bulkquarter", quarterValue)
        this.logger.log(`Selected quarter: ${this.quarter} (${quarterValue})`)

        await page.waitForSelector("#bulkformType")
        await page.select("#bulkformType", record.formType || this.formType)
        this.logger.log(`Selected form type: ${record.formType || this.formType}`)
      }

      // Step 8: Click Go button
      this.logger.log("Clicking Go button...")
      await page.click("#bulkGo")
      await waitForSecs(2000)
      this.logger.log("Go button clicked")

      this.logger.log("Checking and clicking Go button if present...")
      const goButton = await page.$("#clickGo")
      if (goButton) {
        await goButton.click()
        await waitForSecs(5000)
        this.logger.log("Go button clicked")
      } else {
        this.logger.log("Go button ('#clickGo') not found, proceeding ahead")
      }

      // Step 9: Click Submit button
      this.logger.log("Clicking Submit button...")
      await page.waitForSelector("#j_id1972728517_7cc7de5f")
      await page.click("#j_id1972728517_7cc7de5f")
      await waitForSecs(5000)
      this.logger.log("Submit button clicked")

      // Step 8: Click radio button for search2
      this.logger.log("Selecting search option 2...")
      await page.waitForSelector("#search2")
      await page.click("#search2")

      // Step 9: Click Proceed button
      await page.waitForSelector("#normalkyc")
      await page.click("#normalkyc")
      await waitForSecs(2000)
      // await page.waitForNavigation({ waitUntil: "networkidle2" })
      this.logger.log("Proceed clicked")

      // Step 10: Fill in challan details
      this.logger.log("Filling challan details...")
      // await page.waitForSelector("#token")
      await page.type("#token", record.rrr || "")
      await page.type("#bsr", record.bsr || "")

      // Format date if needed (DDMMYYYY to DD-MMM-YYYY)
      const formatDate = (dateStr: string) => {
        if (!dateStr || dateStr.length !== 8) return dateStr
        const day = dateStr.slice(0, 2)
        const monthNum = parseInt(dateStr.slice(2, 4))
        const monthNames = [
          "Jan",
          "Feb",
          "Mar",
          "Apr",
          "May",
          "Jun",
          "Jul",
          "Aug",
          "Sep",
          "Oct",
          "Nov",
          "Dec",
        ]
        const monthName = monthNames[monthNum - 1] || ""
        const year = dateStr.slice(4, 8)
        return `${day}-${monthName}-${year}`
      }

      await page.type("#dtoftaxdep", formatDate(record.dtoftaxdep) || "")
      await page.type("#csn", record.csn || "")
      await page.type("#chlnamt", String(record.chlnamt || ""))
      await page.type("#pan1", record.pan1 || "")
      await page.type("#amt1", String(record.amt1 || ""))
      await page.type("#pan2", record.pan2 || "")
      await page.type("#amt2", String(record.amt2 || ""))
      await page.type("#pan3", record.pan3 || "")
      await page.type("#amt3", String(record.amt3 || ""))

      this.logger.log("Challan details filled")

      // Step 11: Click Proceed for KYC
      await page.click("#clickKYC")
      await waitForSecs(2000)
      this.logger.log("KYC Proceed clicked")

      // If there are less than 3 PAN details, handle the popup by hitting Enter
      const panFieldsCount = [record.pan1, record.pan2, record.pan3].filter(
        (pan) => pan && `${pan}`.trim()
      ).length

      if (panFieldsCount < 3) {
        // Wait for potential popup to appear and send Enter
        try {
          await waitForSecs(1000)
          await page.keyboard.press("Enter")
          this.logger.log("Popup detected (less than 3 PAN), pressed Enter to dismiss.")
        } catch (e) {
          this.logger.log("No popup detected after KYC click, or failed to send Enter.")
        }
      }

      // Step 12: Click "Proceed with Transaction"
      await page.waitForSelector("#redirect")
      await page.click("#redirect")
      await waitForSecs(2000)
      this.logger.log("Transaction initiated")

      // Wait a bit to see the result
      await waitForSecs(1000)

      // Close browser
      await browser.close()

      this.logger.log(`TRACES automation completed successfully for ${record.companyName}`)
      return { success: true }
    } catch (error) {
      this.logger.log(`Error in TRACES automation: ${error.message}`)
      throw error
    }
  }

  async extractTdsDataFromTraces(successfulDownloads?: any[]) {
    const fs = require("fs")
    const path = require("path")
    const XLSX = require("xlsx")

    try {
      // If no downloads passed as parameter, try reading from file (backwards compatibility)
      let downloads = successfulDownloads
      if (!downloads || downloads.length === 0) {
        const successfulDownloadsPath = path.join(
          process.cwd(),
          "public",
          "pdf",
          "return",
          "successful_downloads.json"
        )

        if (!fs.existsSync(successfulDownloadsPath)) {
          this.logger.log(
            `No successful downloads provided and file not found at ${successfulDownloadsPath}`
          )
          return
        }

        downloads = JSON.parse(fs.readFileSync(successfulDownloadsPath, "utf8"))
      }

      if (!downloads || downloads.length === 0) {
        this.logger.log("No successful downloads to process")
        return
      }

      this.logger.log(`Found ${downloads.length} successful downloads to process`)

      // Step 2: Process each download
      for (const download of downloads) {
        try {
          const { tanReqNo, filePath, company, formType, finYr, qrtr, tan } = download

          this.logger.log(`\nProcessing: ${company} - ${formType}`)

          if (!fs.existsSync(filePath)) {
            this.logger.log(`❌ File not found: ${filePath}`)
            continue
          }

          // Step 3: Extract the zip file with password (use company TAN as password)
          const password = tan || this.company.tan || tanReqNo

          // Create a unique temporary directory for this specific ZIP file
          // Use the ZIP file name (without extension) to create a unique folder
          const zipFileName = path.basename(filePath, path.extname(filePath))
          const sanitizedZipName = zipFileName.replace(/[^a-zA-Z0-9]/g, "_")
          const tempDir = path.join(
            process.cwd(),
            "public",
            "pdf",
            "temp_extract",
            `${company?.replace(/[^a-zA-Z0-9]/g, "_")}`,
            sanitizedZipName
          )
          fs.mkdirSync(tempDir, { recursive: true })

          // Extract the zip file using 7-Zip (Windows) or unzip (Linux/Mac)
          let extractSuccess = false
          let txtContent = ""

          try {
            const { execSync } = require("child_process")

            // Try different extraction methods based on platform
            if (process.platform === "win32") {
              // Try using 7-Zip on Windows
              try {
                // Try common 7-Zip installation paths
                const sevenZipPaths = [
                  "C:\\Program Files\\7-Zip\\7z.exe",
                  "C:\\Program Files (x86)\\7-Zip\\7z.exe",
                  path.join(process.cwd(), "7z", "7z.exe"), // Local installation
                  path.join(process.cwd(), "7z", "7za.exe"), // Portable 7za
                ]

                let sevenZipPath = null
                for (const p of sevenZipPaths) {
                  if (fs.existsSync(p)) {
                    sevenZipPath = p as any
                    break
                  }
                }

                // If 7-Zip not found, download portable version
                if (!sevenZipPath) {
                  this.logger.log(`⚠ 7-Zip not found, downloading portable version...`)
                  try {
                    const portableDir = path.join(process.cwd(), "7z")
                    fs.mkdirSync(portableDir, { recursive: true })
                    const portablePath = path.join(portableDir, "7za.exe")

                    // Download 7za.exe (standalone version)
                    const axios = require("axios")
                    const response = await axios.get("https://www.7-zip.org/a/7za920.zip", {
                      responseType: "arraybuffer",
                    })

                    // Save the zip file
                    const tempZipPath = path.join(portableDir, "7za.zip")
                    fs.writeFileSync(tempZipPath, response.data)

                    // Extract using AdmZip (this one is not password protected)
                    const AdmZip = require("adm-zip")
                    const zip = new AdmZip(tempZipPath)
                    zip.extractAllTo(portableDir, true)

                    // Clean up temp zip
                    fs.unlinkSync(tempZipPath)

                    if (fs.existsSync(portablePath)) {
                      sevenZipPath = portablePath
                      this.logger.log(`✓ Portable 7-Zip downloaded to ${portablePath}`)
                    }
                  } catch (dlError) {
                    this.logger.log(`❌ Failed to download portable 7-Zip: ${dlError.message}`)
                  }
                }

                if (sevenZipPath) {
                  execSync(`"${sevenZipPath}" x -p"${password}" -o"${tempDir}" -y "${filePath}"`, {
                    stdio: "pipe",
                  })
                  extractSuccess = true
                  this.logger.log(`✓ Extracted using 7-Zip`)
                } else {
                  // Try PowerShell Expand-Archive (doesn't support passwords, but try anyway)
                  this.logger.log(`⚠ 7-Zip not found, trying alternative method...`)
                }
              } catch (e) {
                this.logger.log(`❌ 7-Zip extraction failed: ${e.message}`)
              }
            } else {
              // Try unzip on Linux/Mac
              try {
                execSync(`unzip -P "${password}" -o "${filePath}" -d "${tempDir}"`, {
                  stdio: "pipe",
                })
                extractSuccess = true
                this.logger.log(`✓ Extracted using unzip`)
              } catch (e) {
                this.logger.log(`❌ Unzip extraction failed: ${e.message}`)
              }
            }

            if (!extractSuccess) {
              this.logger.log(`❌ Could not extract password-protected zip: ${filePath}`)
              // Clean up temp directory
              fs.rmSync(tempDir, { recursive: true, force: true })
              continue
            }

            // Find the tds or txt file in the extracted directory
            const extractedFiles = fs.readdirSync(tempDir)
            const txtFile = extractedFiles.find(
              (file) => file.toLowerCase().endsWith(".tds") || file.toLowerCase().endsWith(".txt")
            )

            if (!txtFile) {
              this.logger.log(`❌ No tds/txt file found after extraction`)
              // Clean up temp directory
              fs.rmSync(tempDir, { recursive: true, force: true })
              continue
            }

            this.logger.log(`Found file: ${txtFile}`)

            // Read the file content
            const txtFilePath = path.join(tempDir, txtFile)
            txtContent = fs.readFileSync(txtFilePath, "utf8")

            // Clean up temp directory
            // fs.rmSync(tempDir, { recursive: true, force: true })
          } catch (error) {
            this.logger.log(`❌ Failed to extract and read file: ${error.message}`)
            // Clean up temp directory
            try {
              // fs.rmSync(tempDir, { recursive: true, force: true })
            } catch (e) {
              // Ignore cleanup errors
            }
            continue
          }

          // // Step 4: Replace multiple ^ with single ^
          // txtContent = txtContent.replace(/\^{2,}/g, "^")

          // Step 5: Parse the txt content to extract CD and DD rows
          const lines = txtContent.split("\n")
          const cdRows: any[] = []
          const ddRows: any[] = []
          let currentCDData: any = null

          for (const line of lines) {
            const fields = line.split("^")

            // Check if this is a CD (Challan Details) row
            if (fields.length > 1 && fields[1] === "CD") {
              // Store the current CD data for later association with DD rows

              currentCDData = {
                "Challan Date":
                  fields[10] && /^\d{8}$/.test(fields[10])
                    ? `${fields[10].substring(0, 2)}-${fields[10].substring(
                        2,
                        4
                      )}-${fields[10].substring(4)}`
                    : fields[10] || "",
                Tax: fields[11] ? fields[11].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
                Interest: fields[12] ? fields[12].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
                Fee: fields[13] ? fields[13].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
                "Other Amount": fields[14] ? fields[14].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
                "Total Amount Deposited": fields[16]
                  ? fields[16].replace(/^0+(\d+\.\d{2})$/, "$1")
                  : "",
                "Challan No": fields[8] || "",
                BSR: fields[9] || "",
              }

              // Add the CD row to cdRows array (all fields)
              cdRows.push(currentCDData)
            }
            // Check if this is a DD (Deductee Details) row
            else if (fields.length > 1 && fields[1] === "DD") {
              // Add the DD row with all fields plus the 4 CD columns
              let currentDDData: any

              if (formType == "26Q") {
                currentDDData = {
                  Name: fields[8] || "",
                  PAN: fields[7] || "",
                  "Amount Paid/Credited": fields[14]
                    ? fields[14].replace(/^0+(\d+\.\d{2})$/, "$1")
                    : "",
                  "Paid/Credited date":
                    fields[15] && /^\d{8}$/.test(fields[15])
                      ? `${fields[15].substring(0, 2)}-${fields[15].substring(
                          2,
                          4
                        )}-${fields[15].substring(4)}`
                      : fields[15] || "",
                  "Deduction Date":
                    fields[16] && /^\d{8}$/.test(fields[16])
                      ? `${fields[16].substring(0, 2)}-${fields[16].substring(
                          2,
                          4
                        )}-${fields[16].substring(4)}`
                      : fields[16] || "",
                  "Tax Deducted & Deposited": fields[9]
                    ? fields[9].replace(/^0+(\d+\.\d{2})$/, "$1")
                    : "",
                  "Deduction Rate": fields[18] ? fields[18].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
                  Section: fields[21] || "",
                }
              } else if (formType == "27Q") {
                currentDDData = {
                  Name: fields[8] || "",
                  PAN: fields[7] || "",
                  "Amount Paid/Credited": fields[14]
                    ? fields[14].replace(/^0+(\d+\.\d{2})$/, "$1")
                    : "",
                  "Paid/Credited date":
                    fields[15] && /^\d{8}$/.test(fields[15])
                      ? `${fields[15].substring(0, 2)}-${fields[15].substring(
                          2,
                          4
                        )}-${fields[15].substring(4)}`
                      : fields[15] || "",
                  "Deduction Date":
                    fields[16] && /^\d{8}$/.test(fields[16])
                      ? `${fields[16].substring(0, 2)}-${fields[16].substring(
                          2,
                          4
                        )}-${fields[16].substring(4)}`
                      : fields[16] || "",
                  "Tax Deducted & Deposited": fields[9]
                    ? fields[9].replace(/^0+(\d+\.\d{2})$/, "$1")
                    : "",
                  "Deduction Rate": fields[18] ? fields[18].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
                  Section: fields[22] || "",
                }
              } else if (formType == "24Q") {
                currentDDData = {
                  Name: fields[8] || "",
                  PAN: fields[7] || "",
                  "Amount Paid/Credited": fields[14]
                    ? fields[14].replace(/^0+(\d+\.\d{2})$/, "$1")
                    : "",
                  "Paid/Credited date":
                    fields[15] && /^\d{8}$/.test(fields[15])
                      ? `${fields[15].substring(0, 2)}-${fields[15].substring(
                          2,
                          4
                        )}-${fields[15].substring(4)}`
                      : fields[15] || "",
                  "Deduction Date":
                    fields[16] && /^\d{8}$/.test(fields[16])
                      ? `${fields[16].substring(0, 2)}-${fields[16].substring(
                          2,
                          4
                        )}-${fields[16].substring(4)}`
                      : fields[16] || "",
                  "Tax Deducted & Deposited": fields[9]
                    ? fields[9].replace(/^0+(\d+\.\d{2})$/, "$1")
                    : "",
                  "Deduction Rate": fields[18] ? fields[18].replace(/^0+(\d+\.\d{2})$/, "$1") : "",
                  Section: fields[21] || "",
                }
              }

              // Add the 4 columns from the corresponding CD row
              if (currentCDData) {
                currentDDData["challanDate"] = currentCDData["Challan Date"] || ""
                currentDDData["Tax"] = currentCDData["Tax"] || ""
                currentDDData["Interest"] = currentCDData["Interest"] || ""
                currentDDData["Fee"] = currentCDData["Fee"] || ""
                currentDDData["Other Amount"] = currentCDData["Other Amount"] || ""
                currentDDData["Total Amount Deposited"] =
                  currentCDData["Total Amount Deposited"] || ""
                currentDDData["challanNo"] = currentCDData["Challan No"] || ""
                currentDDData["BSR"] = currentCDData["BSR"] || ""
              } else {
                currentDDData["challanDate"] = ""
                currentDDData["Tax"] = ""
                currentDDData["Interest"] = ""
                currentDDData["Fee"] = ""
                currentDDData["Other Amount"] = ""
                currentDDData["Total Amount Deposited"] = ""
                currentDDData["challanNo"] = ""
                currentDDData["BSR"] = ""
              }

              ddRows.push(currentDDData)
            }
          }

          this.logger.log(`Extracted ${cdRows.length} CD rows and ${ddRows.length} DD rows`)

          // Step 6: Create Excel file with two sheets
          const workbook = XLSX.utils.book_new()

          // Create CD sheet
          const cdSheet = XLSX.utils.json_to_sheet(cdRows)
          XLSX.utils.book_append_sheet(workbook, cdSheet, "Challan Details")

          // Create DD sheet
          const ddSheet = XLSX.utils.json_to_sheet(ddRows)
          XLSX.utils.book_append_sheet(workbook, ddSheet, "Deductee Details")

          // Save the Excel file
          const sanitizedCompanyName = company.replace(/[/\\?%*:|"<>]/g, "_")
          const outputDir = path.join(
            process.cwd(),
            "public",
            "pdf",
            "traces_excel",
            sanitizedCompanyName
          )

          // Ensure directory exists
          fs.mkdirSync(outputDir, { recursive: true })

          const outputFilePath = path.join(outputDir, `${formType}_FY${finYr}_${qrtr}.xlsx`)
          XLSX.writeFile(workbook, outputFilePath)

          this.logger.log(`✓ Excel file created: ${outputFilePath}`)
          console.log(formType, typeof formType)
          // Step 7: If Form 16A, parse and generate PDFs
          if (this.form16Type === "form16a") {
            try {
              this.logger.log(`\n📄 Processing Form 16A for PDF generation...`)

              // Parse the Form 16A file
              const form16AData = parseForm16AFile(txtContent)

              if (form16AData.length === 0) {
                this.logger.log(`⚠️  No Form 16A records found in file`)
                continue
              }

              this.logger.log(`✓ Found ${form16AData.length} Form 16A record(s)`)

              // Create PDF output directory
              const pdfOutputDir = path.join(
                process.cwd(),
                "public",
                "pdf",
                "form16a",
                sanitizedCompanyName,
                `${formType}_FY${finYr}_${qrtr}`
              )
              fs.mkdirSync(pdfOutputDir, { recursive: true })

              // Generate PDF for each deductee
              for (let i = 0; i < form16AData.length; i++) {
                const record = form16AData[i]
                if (!record) continue

                try {
                  // Generate PDF filename based on PAN and certificate number
                  const pan = record.deducteeData.pan || "UNKNOWN"
                  const pdfFileName = `${pan}_${formType}_${finYr}_${qrtr}.pdf`
                  const pdfOutputPath = path.join(pdfOutputDir, pdfFileName)

                  this.logger.log(`  Generating PDF ${i + 1}/${form16AData.length}: ${pdfFileName}`)

                  // Generate PDF
                  await generateForm16APdf({
                    outputPath: pdfOutputPath,
                    data: record,
                  })

                  this.logger.log(`  ✓ PDF generated: ${pdfFileName}`)
                } catch (pdfError: any) {
                  this.logger.log(
                    `  ❌ Failed to generate PDF for record ${i + 1}: ${pdfError.message}`
                  )
                  // Continue with next record
                }
              }

              this.logger.log(`✓ Finished generating PDFs for ${form16AData.length} record(s)`)
            } catch (pdfGenError: any) {
              this.logger.log(`❌ Error generating PDFs: ${pdfGenError.message}`)
              // Continue with next download
            }
          }
        } catch (error) {
          this.logger.log(`❌ Error processing ${download.company}: ${error.message}`)
        }
      }

      this.logger.log("\n✓ Finished processing all successful downloads")
    } catch (error) {
      this.logger.log(`Error in extractTdsDataFromTraces: ${error.message}`)
      throw error
    }
  }

  async verifyReturnsTxtFiles() {
    const fs = require("fs")
    const path = require("path")
    const XLSX = require("xlsx")

    try {
      // Step 1: Read TDS Entity List Excel file
      const tdsEntityPath = path.join(process.cwd(), "public", "pdf", "TDS Entity List.xlsx")

      if (!fs.existsSync(tdsEntityPath)) {
        this.logger.log(`TDS Entity List not found at ${tdsEntityPath}`)
        return []
      }

      const workbook = XLSX.readFile(tdsEntityPath)
      const sheetName = workbook.SheetNames[0]
      const sheet = workbook.Sheets[sheetName]
      const entities = XLSX.utils.sheet_to_json(sheet)

      this.logger.log(`Found ${entities.length} entities in TDS Entity List`)

      const results: any[] = []
      const companiesWithoutReturns: any[] = []
      const companiesVerificationList: any[] = []
      const baseFolder = path.join(process.cwd(), "public", "pdf", "202526")

      // Step 2: Process each entity/company
      for (const entity of entities) {
        const companyName = entity["Company Name"] || ""

        if (!companyName) {
          this.logger.log(`Skipping entity with no company name`)
          continue
        }

        // Track company status
        const companyStatus: any = {
          companyName,
          tan: entity["User ID"] || "",
          userId: entity["User ID_1"] || "",
          status: "pending",
          formTypes: [],
          hasReturns: false,
          issues: [],
        }

        // Find matching company folder (handles case variations and Pvt Ltd vs Private Limited)
        const companyFolder = this.findMatchingCompanyFolder(companyName, baseFolder)

        // Check if company folder exists
        if (!companyFolder) {
          this.logger.log(`❌ Company folder not found for: ${companyName}`)
          companyStatus.status = "no_folder"
          companyStatus.issues.push("Company folder not found")
          companiesWithoutReturns.push(companyStatus)
          companiesVerificationList.push(companyStatus)
          continue
        }

        this.logger.log(`Found company folder: ${companyFolder}`)

        const originalFolder = path.join(companyFolder, "Original")

        if (!fs.existsSync(originalFolder)) {
          this.logger.log(`❌ Original folder not found: ${originalFolder}`)
          companyStatus.status = "no_original_folder"
          companyStatus.issues.push("Original folder not found")
          companiesWithoutReturns.push(companyStatus)
          companiesVerificationList.push(companyStatus)
          continue
        }

        // Step 3: Find all form types available for this company
        const formTypes = fs
          .readdirSync(originalFolder, { withFileTypes: true })
          .filter((dirent: any) => dirent.isDirectory())
          .map((dirent: any) => dirent.name)

        if (formTypes.length === 0) {
          this.logger.log(`❌ No form types found for: ${companyName}`)
          companyStatus.status = "no_form_types"
          companyStatus.issues.push("No form type folders found")
          companiesWithoutReturns.push(companyStatus)
          companiesVerificationList.push(companyStatus)
          continue
        }

        this.logger.log(`Company: ${companyName} - Found form types: ${formTypes.join(", ")}`)
        companyStatus.formTypes = formTypes

        let hasValidReturns = false

        // Step 4: Process each form type
        for (const formType of formTypes) {
          const formTypeFolder = path.join(originalFolder, formType)

          // Only process Q1 quarter
          const quarter = "Q1"
          const quarterFolder = path.join(formTypeFolder, quarter)

          // Check if Q1 folder exists
          if (!fs.existsSync(quarterFolder)) {
            this.logger.log(`⚠ Q1 folder not found in ${formTypeFolder}`)
            companyStatus.issues.push(`Q1 folder not found for form type ${formType}`)
            continue
          }

          // Find txt files
          const txtFiles = fs
            .readdirSync(quarterFolder)
            .filter((file: string) => file.endsWith(".txt"))

          if (txtFiles.length === 0) {
            this.logger.log(`⚠ No txt files in ${quarterFolder}`)
            companyStatus.issues.push(`No txt files in ${formType}/Q1`)
            continue
          }

          // Process each txt file
          for (const txtFile of txtFiles) {
            const txtFilePath = path.join(quarterFolder, txtFile)

            try {
              const txtContent = fs.readFileSync(txtFilePath, "utf8")

              // Parse the txt file to extract challan details
              const challans = this.parseTxtFileForChallans(txtContent, companyName)

              // Create ONE object per company+formType using the first challan
              if (challans.length > 0 && challans[0]) {
                const firstChallan: any = challans[0]

                // Read all_returns.json and find matching record
                try {
                  const allReturnsPath = path.join(
                    process.cwd(),
                    "public",
                    "pdf",
                    "return",
                    "all_returns.json"
                  )
                  if (fs.existsSync(allReturnsPath)) {
                    const allReturnsContent = fs.readFileSync(allReturnsPath, "utf8")
                    let allReturns: any[] = []
                    try {
                      allReturns = JSON.parse(allReturnsContent)
                    } catch (e) {
                      this.logger.log("Failed to parse all_returns.json: " + e.message)
                    }
                    // Normalize company name for better matching
                    const normalizeName = (name: string) =>
                      (name || "")
                        .toLowerCase()
                        .replace(/private limited/gi, "pvt ltd")
                        .replace(/pvt\./gi, "pvt")
                        .replace(/ltd\./gi, "ltd")
                        .replace(/\s+/g, " ")
                        .trim()

                    // Try to find a matching record in all_returns.json
                    const match = allReturns.find((rec) => {
                      const matchCompany =
                        normalizeName(rec["Company Name"]) === normalizeName(companyName)
                      const matchForm =
                        String((rec.returnType || "").toUpperCase()) ===
                        String(formType).toUpperCase()
                      const matchQuarter =
                        String(rec.Quarter || "").toUpperCase() === String(quarter).toUpperCase()
                      const matchYear = String(rec["Financial year"]) === String(2025)
                      return matchCompany && matchForm && matchQuarter && matchYear
                    })
                    if (match) {
                      firstChallan.rrr = match["RRR number"]
                    }
                  }
                } catch (e) {
                  this.logger.log("Could not read or parse all_returns.json: " + e.message)
                }

                const companyData = {
                  companyName,
                  formType,
                  quarter,
                  financialYear: 2025,
                  tan: entity["User ID"] || "",
                  userId: entity["User ID_1"] || "",
                  password: entity["Password _1"] || "",
                  ...firstChallan,
                }

                results.push(companyData)
                hasValidReturns = true
                this.logger.log(
                  `✓ Added 1 record for ${companyName} - ${formType} (found ${challans.length} valid challans)`
                )
              } else {
                companyStatus.issues.push(`No valid challans found in ${formType}/Q1/${txtFile}`)
              }
            } catch (error) {
              this.logger.log(`Error reading txt file ${txtFilePath}: ${error.message}`)
              companyStatus.issues.push(`Error reading ${formType}/Q1/${txtFile}: ${error.message}`)
            }
          }
        }

        // Update company status
        if (hasValidReturns) {
          companyStatus.status = "has_returns"
          companyStatus.hasReturns = true
        } else {
          companyStatus.status = "no_valid_returns"
          companyStatus.hasReturns = false
          companiesWithoutReturns.push(companyStatus)
        }

        companiesVerificationList.push(companyStatus)
      }

      this.logger.log(`\n======= SUMMARY =======`)
      this.logger.log(`Total entities processed: ${entities.length}`)
      this.logger.log(`✓ Companies with valid returns: ${results.length}`)
      this.logger.log(`❌ Companies without returns: ${companiesWithoutReturns.length}`)

      // Save results to JSON files
      const outputPath = path.join(
        process.cwd(),
        "public",
        "pdf",
        "return",
        "challan_details_1.json"
      )
      fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), "utf8")
      this.logger.log(`\n✓ Saved ${results.length} valid records to challan_details_1.json`)

      // Save companies without returns
      const noReturnsPath = path.join(
        process.cwd(),
        "public",
        "pdf",
        "return",
        "companies_without_returns.json"
      )
      fs.writeFileSync(noReturnsPath, JSON.stringify(companiesWithoutReturns, null, 2), "utf8")
      this.logger.log(`✓ Saved ${companiesWithoutReturns.length} companies without returns`)

      // Save verification list (all companies with their status)
      const verificationPath = path.join(
        process.cwd(),
        "public",
        "pdf",
        "return",
        "companies_verification_list.json"
      )
      fs.writeFileSync(verificationPath, JSON.stringify(companiesVerificationList, null, 2), "utf8")
      this.logger.log(
        `✓ Saved complete verification list for ${companiesVerificationList.length} companies`
      )

      return {
        validReturns: results,
        companiesWithoutReturns,
        verificationList: companiesVerificationList,
      }
    } catch (error) {
      this.logger.log(`Error in verifyReturnsTxtFiles: ${error.message}`)
      throw error
    }
  }

  async downloadFile() {
    this.logger.log(`Starting Download File for ${this.company.name}`)
    console.log("Company", this.company)

    const result = await this.getTracesFilepuppeteer(this.company)
    console.log("result", result)
    // Extract successful downloads from the result
    if (result && result.success && result.downloadResults) {
      const successfulDownloads = result.downloadResults
        .filter((download: any) => download.success)
        .map((download: any) => ({
          tanReqNo: download.tanReqNo,
          filePath: download.filePath,
          company: result.company,
          formType: download.frmType,
          tan: result.tan,
          finYr: download.finYr,
          qrtr: download.qrtr,
          reqDate: download.reqDate,
        }))

      this.logger.log(`Found ${successfulDownloads.length} successful downloads`)

      if (successfulDownloads.length > 0) {
        // Save to JSON file for reference
        const fs = require("fs")
        const path = require("path")
        const successfulDownloadsPath = path.join(
          process.cwd(),
          "public",
          "pdf",
          "traces",
          result.company || "UNKNOWN",
          "successful_downloads.json"
        )

        // Ensure directory exists
        fs.mkdirSync(path.dirname(successfulDownloadsPath), { recursive: true })
        fs.writeFileSync(
          successfulDownloadsPath,
          JSON.stringify(successfulDownloads, null, 2),
          "utf8"
        )
        this.logger.log(`Saved successful downloads to ${successfulDownloadsPath}`)

        // Pass the successful downloads to extract function and generate PDFs
        await this.extractTdsDataFromTraces(successfulDownloads)
      } else {
        this.logger.log("No successful downloads to process")
      }
    } else {
      this.logger.log("Failed to download files or no files available")
    }
  }

  async process() {
    this.logger.log(`Starting Sync for ${this.company.name} - ${this.Pan}`)

    if (this.jobTypes.includes("SendRequest")) {
      const typeArr = ["F26Q", "F24Q", "F27EQ", "F27Q"]

      const fs = require("fs")
      const path = require("path")

      let isAnyReturnsMissing = [] as string[]
      for (const type of typeArr) {
        const returnsJsonPath = path.join(
          process.cwd(),
          "public",
          "pdf",
          "return",
          type,
          this.company.name,
          "returns.json"
        )
        if (fs.existsSync(returnsJsonPath)) {
          this.logger.log(
            `Returns data already exists for ${this.company.name} (${type}), skipping fetch.`
          )
          continue
        }

        isAnyReturnsMissing.push(type)
      }
      if (isAnyReturnsMissing.length > 0) {
        await this.login()
        await this.getProfileDetails()
        for (const type of isAnyReturnsMissing) {
          await this.getReturnsData(type)
        }
      }

      const companyData = await this.readReturnsTxtFiles()
      console.log("companyData", companyData)

      await this.getTracesDatapuppeteer(companyData)
    }

    if (this.jobTypes.includes("DownloadFile")) {
      await this.downloadFile()
    }

    return
  }
}
