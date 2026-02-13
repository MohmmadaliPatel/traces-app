/**
 * Test script for Form 16A PDF generation
 */

import { generateForm16APdf } from "./src/utils/form16APdfGeneratorExact"
import { parseForm16AFile } from "./src/utils/form16AParserExact"
import fs from "fs"
import path from "path"

// Configuration
const isTest = false // Set to true for single PDF, false for all PDFs
const testPAN = "AAACA4710A" // PAN to use when isTest is true

const filePath = path.join(
  process.cwd(),
  "public",
  "pdf",
  "temp_extract",
  "Clean_Max_Pluto_Solar_Power_LLP",
  "MUMxxxxx0F_FORM16A_2025-26_Q2_185191487.txt"
)

const outputDir = path.join(process.cwd(), "public", "pdf", "form16a-test-output","Clean_Max_Pluto_Solar_Power_LLP","data-1")

async function main() {
  try {
    console.log("📄 Reading Form 16A file...")
    const fileContent = fs.readFileSync(filePath, "utf-8")

    console.log("🔍 Parsing Form 16A file...")
    const data = parseForm16AFile(fileContent)

    // Ensure output directory exists
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }

    if (isTest) {
      // Generate only one PDF for testing
      console.log(`🔎 Finding target PAN: ${testPAN}...`)
      const target = data.find((d) => d.deducteeData.pan === testPAN)

      if (!target) {
        console.error(`❌ PAN ${testPAN} not found in the data`)
        process.exit(1)
      }

      console.log(`✓ Found PAN: ${target.deducteeData.pan}`)
      console.log(`  BIN Details: ${target.deducteeData.binDetails.length}`)
      console.log(`  Tax Deducted Summary: ${target.deducteeData.taxDeductedSummary.length}`)
      console.log(`  CIN Details: ${target.deducteeData.cinDetails.length}`)
      console.log(`  Payment Summary: ${target.deducteeData.paymentSummary.length}`)

      const outputPath = path.join(outputDir, `${testPAN}_Generated.pdf`)
      console.log("📝 Generating PDF...")
      await generateForm16APdf({
        outputPath,
        data: target,
      })

      console.log(`✅ PDF Generated successfully: ${outputPath}`)
    } else {
      // Generate PDFs for all deductees
      console.log(`📝 Generating PDFs for all ${data.length} deductees...`)

      let successCount = 0
      let errorCount = 0

      console.log("data",data);

      for (let i = 0; i < data.length; i++) {
        const deducteeData = data[i]
        if (!deducteeData) continue

        const pan = deducteeData.deducteeData.pan
        const outputPath = path.join(outputDir, `${pan}_Q2_2026-27.pdf`)

        try {
          await generateForm16APdf({
            outputPath,
            data: deducteeData,
          })
          successCount++
          if ((i + 1) % 50 === 0) {
            console.log(`  Progress: ${i + 1}/${data.length} PDFs generated...`)
          }
        } catch (error) {
          errorCount++
          console.error(`  ❌ Error generating PDF for PAN ${pan}:`, error)
        }
      }

      console.log(`\n✅ PDF Generation Complete!`)
      console.log(`  Success: ${successCount}`)
      console.log(`  Errors: ${errorCount}`)
      console.log(`  Output directory: ${outputDir}`)
    }
  } catch (error) {
    console.error("❌ Error:", error)
    process.exit(1)
  }
}

main()
