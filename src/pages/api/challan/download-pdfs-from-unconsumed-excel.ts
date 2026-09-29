import { withApiAuth } from "src/shared/http"
import { NextApiRequest, NextApiResponse } from "next"
import db from "db"
import { fetchPaymentHistory } from "src/scripts/fetchPaymentHistory"
import { downloadMissingPaymentHistoryPdfs } from "src/scripts/downloadChallanPayment"
import {
  incomeTaxActForFinancialYear,
  paymentHistoryPdfExists,
  paymentTimeToFinancialYear,
  type PaymentHistoryRowInput,
} from "src/challan/utils/paymentHistoryFiles"
import {
  depositDateAmountMatchKey,
  filterUnconsumedListRowsByFys,
  loadUnconsumedListExcelRows,
  normalizeDepositDateKey,
  unconsumedListExcelPath,
} from "src/challan/utils/challanStatusExcel"
import fs from "fs"

function paymentMatchKey(p: PaymentHistoryRowInput): string {
  const datePart = (p.paymentTime || "").trim().split(/\s+/)[0] || ""
  return depositDateAmountMatchKey(datePart, p.amount)
}

export default withApiAuth(async (req: NextApiRequest, res: NextApiResponse, _ctx) => {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" })
  }

  try {
    const { companyId, financialYears } = req.body

    if (!companyId) {
      return res.status(400).json({ error: "Missing company ID" })
    }

    const fys: string[] = Array.isArray(financialYears)
      ? financialYears.map(String).filter(Boolean)
      : []

    if (fys.length === 0) {
      return res.status(400).json({
        error: "Select at least one financial year",
      })
    }

    const company = await db.company.findUnique({
      where: { id: parseInt(String(companyId), 10) },
    })

    if (!company) {
      return res.status(404).json({ error: "Company not found" })
    }

    const listPath = unconsumedListExcelPath(company.name)
    if (!fs.existsSync(listPath)) {
      return res.status(400).json({
        error: `Unconsumed list Excel not found for ${company.name}. Run "Fetch Unconsumed List" first.`,
        listExcelPath: listPath,
      })
    }

    const allRows = loadUnconsumedListExcelRows(company.name)
    const excelRows = filterUnconsumedListRowsByFys(allRows, fys)

    if (excelRows.length === 0) {
      return res.status(200).json({
        success: true,
        companyName: company.name,
        message: "No unconsumed-list rows for the selected financial years",
        excelRows: 0,
        matchedPayments: 0,
        downloaded: { old: null, new: null },
      })
    }

    const excelKeysWithAmount = new Set<string>()
    const excelDatesWithoutAmount = new Set<string>()
    for (const row of excelRows) {
      const date = String(row["Date of Deposit"] ?? "")
      const amount = row["Challan Amount"]
      const dateKey = normalizeDepositDateKey(date)
      const amt = String(amount ?? "").replace(/\u00a0/g, " ").trim()
      if (dateKey && amt) {
        excelKeysWithAmount.add(depositDateAmountMatchKey(date, amount as string | number))
      } else if (dateKey) {
        excelDatesWithoutAmount.add(dateKey)
      }
    }

    const history = await fetchPaymentHistory({
      tan: company.tan,
      itPassword: company.it_password,
      companyName: company.name,
      financialYears: fys,
    })

    const matched: PaymentHistoryRowInput[] = []
    const seenCins = new Set<string>()
    for (const p of history.payments || []) {
      if (!p.cin || seenCins.has(p.cin)) continue
      const key = paymentMatchKey(p)
      const dateOnly = normalizeDepositDateKey((p.paymentTime || "").split(/\s+/)[0])
      if (excelKeysWithAmount.has(key) || (dateOnly && excelDatesWithoutAmount.has(dateOnly))) {
        seenCins.add(p.cin)
        matched.push(p)
      }
    }

    const missing = matched.filter((p) => !paymentHistoryPdfExists(company.name, p.cin))

    const oldActMissing: PaymentHistoryRowInput[] = []
    const newActMissing: PaymentHistoryRowInput[] = []
    for (const p of missing) {
      const fy = paymentTimeToFinancialYear(p.paymentTime || "") || fys[0]!
      if (p.actType === "N" || incomeTaxActForFinancialYear(fy) === "new") {
        newActMissing.push(p)
      } else {
        oldActMissing.push(p)
      }
    }

    let oldResult: Awaited<ReturnType<typeof downloadMissingPaymentHistoryPdfs>> | null = null
    let newResult: Awaited<ReturnType<typeof downloadMissingPaymentHistoryPdfs>> | null = null

    if (oldActMissing.length > 0) {
      oldResult = await downloadMissingPaymentHistoryPdfs(
        company.tan,
        company.it_password,
        company.name,
        {
          skipNewActRadio: true,
          skipDateFilter: false,
          missing: oldActMissing.map((p) => ({
            cin: p.cin,
            paymentTime: p.paymentTime,
            assessmentYear: p.assessmentYear,
            paymentType: p.paymentType,
          })),
        }
      )
    }

    if (newActMissing.length > 0) {
      newResult = await downloadMissingPaymentHistoryPdfs(
        company.tan,
        company.it_password,
        company.name,
        {
          skipNewActRadio: false,
          skipDateFilter: true,
          missing: newActMissing.map((p) => ({
            cin: p.cin,
            paymentTime: p.paymentTime,
            assessmentYear: p.assessmentYear,
            paymentType: p.paymentType,
          })),
        }
      )
    }

    return res.status(200).json({
      success: true,
      companyName: company.name,
      financialYears: fys,
      excelRows: excelRows.length,
      matchedPayments: matched.length,
      missingPdfs: missing.length,
      oldActMissing: oldActMissing.length,
      newActMissing: newActMissing.length,
      downloaded: { old: oldResult, new: newResult },
      listExcelPath: listPath,
    })
  } catch (error: any) {
    console.error("Error downloading PDFs from unconsumed excel:", error)
    return res.status(500).json({
      success: false,
      error: error.message || "Failed to download PDFs from unconsumed excel",
    })
  }
})
