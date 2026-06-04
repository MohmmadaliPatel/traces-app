/**
 * Fetches full payment history from the Income Tax e-portal via API (no Puppeteer).
 * Invoked from POST /api/challan/fetch-payment-history or the Payment PDF Gaps page.
 */
import fs from "fs"
import type { AxiosInstance } from "axios"
import {
  analyzePaymentHistoryGaps,
  paymentHistoryContentJsonPath,
  paymentHistoryGapsJsonPath,
  resolveCompanyChallanFolder,
  type PaymentHistoryGapsResult,
  type PaymentHistoryRowInput,
  type PaymentHistoryRowWithPdf,
} from "src/challan/utils/paymentHistoryFiles"
import {
  buildPaymentHistoryRequestBody,
  createIncomeTaxAxiosClient,
  loginIncomeTaxPortal,
  saveIncomeTaxUserProfile,
} from "src/utils/incomeTaxPortalAuth"

const PAYMENT_HISTORY_URL =
  "https://eportal.incometax.gov.in/iec/paymentapi/auth/challan/paymenthistory"

export type PaymentHistoryItem = PaymentHistoryRowInput

type PaymentHistoryApiResponse = {
  successFlag?: boolean
  messages?: Array<{ code?: string; desc?: string }>
  paymentList?: {
    content?: PaymentHistoryItem[]
    last?: boolean
    totalPages?: number
    totalElements?: number
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function fetchPaymentHistoryPage(
  client: AxiosInstance,
  tan: string,
  pageNum: number,
  pageSize: number,
  actType: "O" | "N" = "O"
): Promise<PaymentHistoryApiResponse> {
  const res = await client.post(
    PAYMENT_HISTORY_URL,
    buildPaymentHistoryRequestBody(tan, actType),
    {
      params: { pageNum, size: pageSize },
    }
  )
  return res.data as PaymentHistoryApiResponse
}

export async function fetchPaymentHistory(params: {
  tan: string
  itPassword: string
  companyName: string
  pageSize?: number
  /** Income-tax Act: O = 1961 (old), N = 2025 (new). Default O. */
  actType?: "O" | "N"
}): Promise<{
  payments: PaymentHistoryItem[]
  gaps: PaymentHistoryGapsResult
  contentJsonPath: string
  gapsJsonPath: string
}> {
  const { tan, itPassword, companyName, pageSize = 50, actType = "O" } = params
  const client = createIncomeTaxAxiosClient()

  console.log(`[fetchPaymentHistory] Logging in for ${companyName} (${tan})...`)
  await loginIncomeTaxPortal(client, tan, itPassword)
  await saveIncomeTaxUserProfile(client, tan.toUpperCase())

  const allPayments: PaymentHistoryItem[] = []
  const seenCins = new Set<string>()
  let pageNum = 0
  let totalPages = 1

  while (pageNum < totalPages) {
    console.log(`[fetchPaymentHistory] Fetching page ${pageNum + 1}/${totalPages}...`)
    const data = await fetchPaymentHistoryPage(client, tan, pageNum, pageSize, actType)

    if (data.successFlag === false) {
      const msg =
        data.messages?.map((m) => m.desc || m.code).join("; ") || "Payment history API failed"
      throw new Error(msg)
    }

    const content = data.paymentList?.content ?? []
    for (const item of content) {
      if (item.cin && !seenCins.has(item.cin)) {
        seenCins.add(item.cin)
        allPayments.push(item)
      }
    }

    totalPages = data.paymentList?.totalPages ?? pageNum + 1
    const isLast = data.paymentList?.last === true

    console.log(
      `[fetchPaymentHistory] Page ${pageNum + 1}: ${content.length} rows, total collected: ${allPayments.length}`
    )

    pageNum++
    if (isLast) break
    await delay(400)
  }

  const companyFolder = resolveCompanyChallanFolder(companyName)
  if (!fs.existsSync(companyFolder)) {
    fs.mkdirSync(companyFolder, { recursive: true })
  }

  const gaps = analyzePaymentHistoryGaps(companyName, allPayments)
  const fetchedAt = new Date().toISOString()

  const contentJsonPath = paymentHistoryContentJsonPath(companyName)
  const gapsJsonPath = paymentHistoryGapsJsonPath(companyName)

  fs.writeFileSync(
    contentJsonPath,
    JSON.stringify(
      {
        fetchedAt,
        companyName,
        tan: tan.toUpperCase(),
        totalElements: allPayments.length,
        payments: allPayments,
      },
      null,
      2
    ),
    "utf8"
  )

  fs.writeFileSync(
    gapsJsonPath,
    JSON.stringify(
      {
        fetchedAt,
        companyName,
        summary: gaps.summary,
        missing: gaps.missing,
        present: gaps.present,
      },
      null,
      2
    ),
    "utf8"
  )

  console.log(
    `[fetchPaymentHistory] Done: ${allPayments.length} payments, ${gaps.summary.pdfsMissing} missing PDFs`
  )
  console.log(`[fetchPaymentHistory] Wrote ${contentJsonPath}`)
  console.log(`[fetchPaymentHistory] Wrote ${gapsJsonPath}`)

  return {
    payments: allPayments,
    gaps,
    contentJsonPath,
    gapsJsonPath,
  }
}

export function readCachedPaymentHistoryGaps(companyName: string): {
  content: { fetchedAt?: string; payments?: PaymentHistoryItem[] } | null
  gaps: {
    fetchedAt?: string
    summary?: PaymentHistoryGapsResult["summary"]
    missing?: PaymentHistoryGapsResult["missing"]
    present?: PaymentHistoryGapsResult["present"]
    all?: PaymentHistoryRowWithPdf[]
  } | null
} {
  const contentPath = paymentHistoryContentJsonPath(companyName)
  const gapsPath = paymentHistoryGapsJsonPath(companyName)

  let content: { fetchedAt?: string; payments?: PaymentHistoryItem[] } | null = null
  let gaps: {
    fetchedAt?: string
    summary?: PaymentHistoryGapsResult["summary"]
    missing?: PaymentHistoryGapsResult["missing"]
    present?: PaymentHistoryGapsResult["present"]
    all?: PaymentHistoryGapsResult["all"]
  } | null = null

  if (fs.existsSync(contentPath)) {
    content = JSON.parse(fs.readFileSync(contentPath, "utf8"))
  }

  if (fs.existsSync(gapsPath)) {
    gaps = JSON.parse(fs.readFileSync(gapsPath, "utf8"))
    if (gaps && !gaps.all && content?.payments) {
      const analyzed = analyzePaymentHistoryGaps(companyName, content.payments)
      gaps.all = analyzed.all
      gaps.summary = gaps.summary ?? analyzed.summary
    }
  } else if (content?.payments) {
    const analyzed = analyzePaymentHistoryGaps(companyName, content.payments)
    gaps = {
      fetchedAt: content.fetchedAt,
      summary: analyzed.summary,
      missing: analyzed.missing,
      present: analyzed.present,
      all: analyzed.all,
    }
  }

  return { content, gaps }
}
