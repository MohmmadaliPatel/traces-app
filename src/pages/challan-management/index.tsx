import { Suspense, useState } from "react"
import { BlitzPage, Routes } from "@blitzjs/next"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import {
  Card,
  Space,
  Select,
  Button,
  message,
  Table,
  Tag,
  Alert,
  Form,
  Input,
  DatePicker,
  Row,
  Col,
  Modal,
  Typography,
  Upload,
  Tooltip,
} from "antd"
import {
  CloudDownloadOutlined,
  PlusOutlined,
  FileAddOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  UploadOutlined,
  FileExcelOutlined,
} from "@ant-design/icons"
import getCompanies from "src/companies/queries/getCompanies"
import getChallanData from "src/challan/queries/getChallanData"
import upsertChallanData from "src/challan/mutations/upsertChallanData"
import deleteChallanData from "src/challan/mutations/deleteChallanData"
import { secCodes as oldSecCodes } from "src/challan/utils/secCodes"
import { secCodes as newSecCodes } from "src/challan/utils/newSecCodes"
import {
  parseIncomeTaxActCsv,
  type IncomeTaxActKind,
} from "src/challan/utils/incomeTaxAct"
import {
  challanModeCsvColumnName,
  parseChallanModeCsv,
  type NewRegimeChallanMode,
} from "src/challan/utils/challanMode"
import {
  buildEpayDownloadBatchItems,
  parseCsvFileText,
  type EpayCsvDownloadBatchItem,
} from "src/challan/utils/parseChallanCsv"
import { runWithConcurrency } from "src/challan/utils/runWithConcurrency"
import { parsePaymentUnconsumedRows } from "src/shared/excel/paymentUnconsumed"
import dayjs from "dayjs"
import * as XLSX from "xlsx"

const { Option } = Select
const { Title, Text } = Typography

type EpayDownloadFlow = "payment" | "generated" | "csi"

type EpayDownloadBatchItem = {
  companyId: number
  companyName?: string
  incomeTaxAct?: IncomeTaxActKind
  rowDownloadTargets?: EpayCsvDownloadBatchItem["rowDownloadTargets"]
}

type EpayDownloadResultRow = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  errorMessage?: string
}

type CreateBatchItem = {
  companyId: number
  companyName: string
  assessmentYear: string
  sections: Array<{ sectionCode: string; amount: string; actType?: IncomeTaxActKind }>
  newRegimeChallanMode?: NewRegimeChallanMode
}

type CreateResultRow = {
  companyId: number
  companyName: string
  tan: string
  success: boolean
  errorMessage?: string
  sectionsCreated?: number
}
const { RangePicker } = DatePicker

function findDuplicateSectionCode(
  sections: Array<{ sectionCode: string }>
): string | null {
  const seen = new Set<string>()
  for (const { sectionCode } of sections) {
    const code = sectionCode.trim()
    if (!code) continue
    if (seen.has(code)) return code
    seen.add(code)
  }
  return null
}

interface ChallanDataType {
  id: number
  companyId: number
  assessmentYear: string
  sectionCode: string
  sectionDesc: string
  amount: string
  pymntRefNum?: string
  status: string
  filePath?: string
  createdAt: Date
  updatedAt: Date
  company: {
    id: number
    name: string
    tan: string
    user_id: string
  }
}

const ChallanManagementPage: BlitzPage = () => {
  const [messageApi, contextHolder] = message.useMessage()
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [assessmentYear, setAssessmentYear] = useState<string>("")
  const [challanActType, setChallanActType] = useState<IncomeTaxActKind>("old")
  const [selectedSections, setSelectedSections] = useState<
    Array<{ sectionCode: string; amount: string }>
  >([])
  const [createLoading, setCreateLoading] = useState(false)
  const [downloadPaymentLoading, setDownloadPaymentLoading] = useState(false)
  const [downloadGeneratedChallansLoading, setDownloadGeneratedChallansLoading] = useState(false)
  const [downloadCsiLoading, setDownloadCsiLoading] = useState(false)
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ChallanDataType | null>(null)
  const [form] = Form.useForm()
  const [paymentDateRange, setPaymentDateRange] = useState<[string, string] | null>(null)
  const [paymentAssessmentYear, setPaymentAssessmentYear] = useState<string>("")
  const [paymentType, setPaymentType] = useState<string>("")
  const [paymentIncomeTaxAct, setPaymentIncomeTaxAct] = useState<IncomeTaxActKind>("old")
  const [csvProcessing, setCsvProcessing] = useState(false)
  const [csvProgress, setCsvProgress] = useState<{
    current: number
    total: number
    currentCompany: string
    status: string
  } | null>(null)
  const [csvFileList, setCsvFileList] = useState<any[]>([])
  const [companyPickerCsvFileList, setCompanyPickerCsvFileList] = useState<any[]>([])
  const [companyPickerCsvLoading, setCompanyPickerCsvLoading] = useState(false)

  const [epayCsvFileList, setEpayCsvFileList] = useState<any[]>([])
  const [epayCsvProcessing, setEpayCsvProcessing] = useState(false)
  const [epayCsvFlow, setEpayCsvFlow] = useState<EpayDownloadFlow | null>(null)

  const [unconsumedExcelFileList, setUnconsumedExcelFileList] = useState<any[]>([])
  const [unconsumedExcelDownloading, setUnconsumedExcelDownloading] = useState(false)
  const [unconsumedExcelSummary, setUnconsumedExcelSummary] = useState<string | null>(null)

  const [epayConcurrency, setEpayConcurrency] = useState(1)
  const [createConcurrency, setCreateConcurrency] = useState(1)
  const [epayDownloadProgress, setEpayDownloadProgress] = useState<{
    current: number
    total: number
  } | null>(null)
  const [epayResultsModalOpen, setEpayResultsModalOpen] = useState(false)
  const [lastEpayDownloadRun, setLastEpayDownloadRun] = useState<{
    flow: EpayDownloadFlow
    startedAt: string
    results: EpayDownloadResultRow[]
  } | null>(null)
  const [epayRetryRowKeys, setEpayRetryRowKeys] = useState<number[]>([])

  const [createProgress, setCreateProgress] = useState<{ current: number; total: number } | null>(
    null
  )
  const [createResultsModalOpen, setCreateResultsModalOpen] = useState(false)
  const [lastCreateRun, setLastCreateRun] = useState<{
    startedAt: string
    items: CreateBatchItem[]
    results: CreateResultRow[]
  } | null>(null)
  const [createRetryRowKeys, setCreateRetryRowKeys] = useState<number[]>([])

  const epayDownloadBusy =
    downloadPaymentLoading ||
    downloadGeneratedChallansLoading ||
    downloadCsiLoading ||
    epayCsvProcessing
  const createBusy = createLoading || csvProcessing

  // Fetch companies
  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })
  const savedCompanies: any = companiesResponse?.companies || []

  // Fetch challan data
  const buildWhereClause = () => {
    const where: any = {}
    if (selectedCompanyIds.length > 0) {
      where.companyId = { in: selectedCompanyIds }
    }
    return where
  }

  const [{ challanData, count }, { refetch }] = useQuery(
    getChallanData,
    {
      where: buildWhereClause(),
      orderBy: { updatedAt: "desc" },
      skip: 0,
      take: 1000,
    },
    {
      refetchOnWindowFocus: false,
    }
  )

  const [upsertChallanDataMutation] = useMutation(upsertChallanData)
  const [deleteChallanDataMutation] = useMutation(deleteChallanData)

  const handleSelectAll = () => {
    setSelectedCompanyIds(savedCompanies.map((c) => c.id))
  }

  const handleClearAll = () => {
    setSelectedCompanyIds([])
  }

  const handleAddSection = () => {
    setSelectedSections([...selectedSections, { sectionCode: "", amount: "" }])
  }

  const handleRemoveSection = (index: number) => {
    setSelectedSections(selectedSections.filter((_, i) => i !== index))
  }

  const handleSectionChange = (index: number, field: "sectionCode" | "amount", value: string) => {
    if (
      field === "sectionCode" &&
      challanActType === "new" &&
      selectedSections.some((s, i) => i !== index && s.sectionCode.trim() === value.trim())
    ) {
      messageApi.error("Each section can only be added once for the new regime")
      return
    }

    const newSections = [...selectedSections]
    const section = newSections[index]
    if (section) {
      section[field] = value
      setSelectedSections(newSections)
    }
  }

  const handleCreateChallans = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    if (!assessmentYear) {
      messageApi.error("Please enter assessment year")
      return
    }

    if (selectedSections.length === 0) {
      messageApi.error("Please add at least one section")
      return
    }

    const validSections = selectedSections.filter((s) => s.sectionCode && s.amount)
    if (validSections.length === 0) {
      messageApi.error("Please fill in all section details")
      return
    }

    if (challanActType === "new") {
      const duplicateCode = findDuplicateSectionCode(validSections)
      if (duplicateCode) {
        messageApi.error(
          `Section ${duplicateCode} is listed more than once. New regime allows only one line per section in a combined challan.`
        )
        return
      }
    }

    const sectionsWithAct = validSections.map((s) => ({
      ...s,
      actType: challanActType,
    }))

    const items: CreateBatchItem[] = selectedCompanyIds.map((companyId) => {
      const meta = resolveCompanyMeta(companyId)
      return {
        companyId,
        companyName: meta.companyName,
        assessmentYear,
        sections: sectionsWithAct,
      }
    })

    await runCreateBatch(items)
    setSelectedSections([])
  }

  const resolveCompanyMeta = (companyId: number) => {
    const c = savedCompanies.find((x: any) => x.id === companyId)
    return {
      companyName: c?.name ?? `Company ${companyId}`,
      tan: c?.tan ?? "—",
    }
  }

  const evaluateCreateApiResponse = (
    response: Response,
    data: {
      success?: boolean
      error?: string
      results?: Array<{ success?: boolean }>
    },
    meta: { companyId: number; companyName: string; tan: string }
  ): CreateResultRow => {
    const sectionResults = data.results ?? []
    const successCount = sectionResults.filter((r) => r.success).length
    const totalSections = sectionResults.length
    const success = response.ok && data.success === true && successCount > 0

    let errorMessage: string | undefined
    if (!success) {
      errorMessage =
        data.error ||
        (totalSections > 0
          ? `0/${totalSections} sections created`
          : `Request failed (HTTP ${response.status})`)
    } else if (successCount < totalSections) {
      errorMessage = `${totalSections - successCount}/${totalSections} sections failed`
    }

    return {
      companyId: meta.companyId,
      companyName: meta.companyName,
      tan: meta.tan,
      success,
      errorMessage,
      sectionsCreated: successCount,
    }
  }

  const runCreateBatch = async (items: CreateBatchItem[]) => {
    if (items.length === 0) return

    const limit = Math.min(7, Math.max(1, createConcurrency), items.length)
    let completed = 0
    const bumpProgress = () => {
      completed += 1
      setCreateProgress({ current: completed, total: items.length })
    }

    setCreateProgress({ current: 0, total: items.length })
    setCreateLoading(true)

    try {
      const results = await runWithConcurrency(items, limit, async (item) => {
        const meta = {
          companyId: item.companyId,
          companyName: item.companyName || resolveCompanyMeta(item.companyId).companyName,
          tan: resolveCompanyMeta(item.companyId).tan,
        }

        try {
          const response = await fetch("/api/challan/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: item.companyId,
              assessmentYear: item.assessmentYear,
              sections: item.sections,
              newRegimeChallanMode: item.newRegimeChallanMode,
              skipDownload: true,
            }),
          })

          let data: {
            success?: boolean
            error?: string
            results?: Array<{ success?: boolean }>
          } = {}
          try {
            data = await response.json()
          } catch {
            /* non-JSON body */
          }

          return evaluateCreateApiResponse(response, data, meta)
        } catch (e: any) {
          return {
            companyId: meta.companyId,
            companyName: meta.companyName,
            tan: meta.tan,
            success: false,
            errorMessage: e?.message || "Network error",
          }
        } finally {
          bumpProgress()
        }
      })

      setLastCreateRun({
        startedAt: new Date().toISOString(),
        items,
        results,
      })
      setCreateRetryRowKeys(results.filter((r) => !r.success).map((r) => r.companyId))
      setCreateResultsModalOpen(true)

      const ok = results.filter((r) => r.success).length
      const bad = results.length - ok
      messageApi.open({
        type: ok === results.length ? "success" : bad === results.length ? "error" : "warning",
        content: `Challan create: ${ok} succeeded, ${bad} failed`,
        duration: 5,
      })

      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to create challans")
    } finally {
      setCreateLoading(false)
      setCreateProgress(null)
    }
  }

  const handleCreateRetrySelected = async () => {
    if (!lastCreateRun) return
    if (createRetryRowKeys.length === 0) {
      messageApi.warning("Select at least one company to retry")
      return
    }
    setCreateResultsModalOpen(false)
    const items = lastCreateRun.items.filter((item) => createRetryRowKeys.includes(item.companyId))
    await runCreateBatch(items)
  }

  const epayFlowLabel = (flow: EpayDownloadFlow) =>
    flow === "payment"
      ? "Payment History"
      : flow === "generated"
      ? "Generated Challans"
      : "CSI File"

  const epayFlowEndpoint = (flow: EpayDownloadFlow) =>
    flow === "payment"
      ? "/api/challan/download-payment"
      : flow === "generated"
      ? "/api/challan/download-generated-challans"
      : "/api/challan/download-csi"

  const setEpayFlowLoading = (flow: EpayDownloadFlow, loading: boolean) => {
    if (flow === "payment") setDownloadPaymentLoading(loading)
    else if (flow === "generated") setDownloadGeneratedChallansLoading(loading)
    else setDownloadCsiLoading(loading)
  }

  const runEpayDownloadBatch = async (flow: EpayDownloadFlow, items: EpayDownloadBatchItem[]) => {
    if (items.length === 0) return

    const limit = Math.min(7, Math.max(1, epayConcurrency), items.length)

    let completed = 0
    const bumpProgress = () => {
      completed += 1
      setEpayDownloadProgress({ current: completed, total: items.length })
    }

    setEpayDownloadProgress({ current: 0, total: items.length })
    setEpayFlowLoading(flow, true)

    const flowLabel = epayFlowLabel(flow)
    const endpoint = epayFlowEndpoint(flow)

    try {
      const results = await runWithConcurrency(items, limit, async (item) => {
        const meta = {
          companyId: item.companyId,
          companyName: item.companyName || resolveCompanyMeta(item.companyId).companyName,
          tan: resolveCompanyMeta(item.companyId).tan,
        }
        const incomeTaxAct = item.incomeTaxAct ?? paymentIncomeTaxAct
        const body =
          flow === "csi"
            ? {
                companyId: item.companyId,
                fromDate: paymentDateRange?.[0],
                toDate: paymentDateRange?.[1],
                incomeTaxAct,
              }
            : {
                companyId: item.companyId,
                fromDate: item.rowDownloadTargets?.length ? undefined : paymentDateRange?.[0],
                toDate: item.rowDownloadTargets?.length ? undefined : paymentDateRange?.[1],
                assessmentYear: item.rowDownloadTargets?.length
                  ? undefined
                  : paymentAssessmentYear || undefined,
                paymentType: paymentType || undefined,
                incomeTaxAct,
                rowDownloadTargets: item.rowDownloadTargets,
              }

        try {
          const response = await fetch(endpoint, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })

          let data: { success?: boolean; error?: string } = {}
          try {
            data = await response.json()
          } catch {
            /* non-JSON body */
          }

          const row: EpayDownloadResultRow = {
            companyId: meta.companyId,
            companyName: meta.companyName,
            tan: meta.tan,
            success: response.ok && data.success === true,
            errorMessage:
              response.ok && data.success === true
                ? undefined
                : data.error || `Request failed (HTTP ${response.status})`,
          }
          return row
        } catch (e: any) {
          return {
            companyId: meta.companyId,
            companyName: meta.companyName,
            tan: meta.tan,
            success: false,
            errorMessage: e?.message || "Network error",
          }
        } finally {
          bumpProgress()
        }
      })

      setLastEpayDownloadRun({
        flow,
        startedAt: new Date().toISOString(),
        results,
      })
      setEpayRetryRowKeys(results.filter((r) => !r.success).map((r) => r.companyId))
      setEpayResultsModalOpen(true)

      const ok = results.filter((r) => r.success).length
      const bad = results.length - ok
      messageApi.open({
        type: ok === results.length ? "success" : bad === results.length ? "error" : "warning",
        content: `e-Pay ${flowLabel}: ${ok} succeeded, ${bad} failed`,
        duration: 5,
      })
    } catch (error: any) {
      messageApi.error(error.message || `Failed to run ${flowLabel} downloads`)
    } finally {
      setEpayFlowLoading(flow, false)
      setEpayDownloadProgress(null)
    }
  }

  const handleDownloadPayments = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }
    await runEpayDownloadBatch(
      "payment",
      selectedCompanyIds.map((companyId) => ({ companyId }))
    )
  }

  const handleDownloadGeneratedChallans = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }
    await runEpayDownloadBatch(
      "generated",
      selectedCompanyIds.map((companyId) => ({ companyId }))
    )
  }

  const handleDownloadCsiFiles = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }
    if (!paymentDateRange?.[0] || !paymentDateRange?.[1]) {
      messageApi.error("Please select a Payment Date Range for CSI download")
      return
    }
    await runEpayDownloadBatch(
      "csi",
      selectedCompanyIds.map((companyId) => ({ companyId }))
    )
  }

  const resolveSelectedCsvFile = (fileList: any[]): File | undefined => {
    const entry = fileList[0]
    if (!entry) return undefined
    if (entry instanceof File) return entry
    return (entry.originFileObj as File | undefined) ?? entry
  }

  const handleEpayCsvDownload = (flow: EpayDownloadFlow) => {
    const file = resolveSelectedCsvFile(epayCsvFileList)
    if (!file) {
      messageApi.error("Please select a CSV file first")
      return
    }
    void handleEpayCsvUpload(file, flow)
  }

  const handleEpayCsvUpload = async (file: File, flow: EpayDownloadFlow) => {
    if (!file.name.endsWith(".csv")) {
      messageApi.error("Please upload a CSV file")
      setEpayCsvFileList([])
      return false
    }

    try {
      setEpayCsvProcessing(true)
      setEpayCsvFlow(flow)
      const text = await file.text()
      const csvData = parseCsvFileText(text).filter((row) => row["Company Name"]?.trim())

      if (csvData.length === 0) {
        messageApi.error("No valid data found in CSV")
        return false
      }

      const batchItems = buildEpayDownloadBatchItems(csvData, savedCompanies)
      if (batchItems.length === 0) {
        messageApi.error("No matching companies or download targets found in CSV")
        return false
      }

      const flowLabel = epayFlowLabel(flow)
      messageApi.info(
        `Starting CSV-based ${flowLabel} download for ${batchItems.length} company batch(es)...`
      )

      await runEpayDownloadBatch(
        flow,
        batchItems.map((item) => ({
          companyId: item.companyId,
          companyName: item.companyName,
          incomeTaxAct: item.incomeTaxAct,
          rowDownloadTargets: item.rowDownloadTargets,
        }))
      )
      setEpayCsvFileList([])
    } catch (error: any) {
      messageApi.error(error.message || "Failed to process CSV for download")
      setEpayCsvFileList([])
    } finally {
      setEpayCsvProcessing(false)
      setEpayCsvFlow(null)
    }
    return false
  }

  const handleEpayRetrySelected = async () => {
    if (!lastEpayDownloadRun) return
    if (epayRetryRowKeys.length === 0) {
      messageApi.warning("Select at least one company to retry")
      return
    }
    setEpayResultsModalOpen(false)
    await runEpayDownloadBatch(
      lastEpayDownloadRun.flow,
      epayRetryRowKeys.map((companyId) => ({ companyId }))
    )
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteChallanDataMutation({ id })
      messageApi.success("Challan data deleted successfully")
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to delete challan data")
    }
  }

  const parseCsvFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const text = e.target?.result as string
          const data = parseCsvFileText(text)
          resolve(data.filter((row) => row["Company Name"]))
        } catch (err: any) {
          reject(err)
        }
      }
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.readAsText(file)
    })
  }

  const parseUnconsumedExcelFiles = async (files: File[]) => {
    const allRows: Array<{
      tan: string
      dateOfDeposit: string
      challanAmount?: string | number
      companyName?: string
      sourceFile: string
    }> = []

    for (const file of files) {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) continue
      const json = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!) as Record<
        string,
        unknown
      >[]
      const parsed = parsePaymentUnconsumedRows(json, file.name)
      for (const row of parsed) {
        allRows.push({
          tan: row.tan,
          dateOfDeposit: row.dateOfDeposit,
          challanAmount: row.challanAmount,
          companyName: row.companyName,
          sourceFile: row.sourceFile || file.name,
        })
      }
    }

    return allRows
  }

  const handleDownloadPdfsFromUploadedExcels = async () => {
    const files = unconsumedExcelFileList
      .map((f) => f.originFileObj as File | undefined)
      .filter((f): f is File => !!f)

    if (files.length === 0) {
      messageApi.error("Please upload at least one Excel file")
      return
    }

    setUnconsumedExcelDownloading(true)
    setUnconsumedExcelSummary(null)
    try {
      const rows = await parseUnconsumedExcelFiles(files)
      if (rows.length === 0) {
        messageApi.error("No rows with TAN and Date of Deposit found in the uploaded Excel(s)")
        return
      }

      const uniqueTans = new Set(rows.map((r) => r.tan))
      messageApi.loading({
        content: `Downloading payment PDFs for ${uniqueTans.size} TAN(s) / ${rows.length} row(s)...`,
        key: "unconsumed-excel-pdfs",
        duration: 0,
      })

      const response = await fetch("/api/challan/download-pdfs-from-uploaded-excels", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rows }),
      })
      const data = await response.json()
      if (!response.ok || data.success === false) {
        throw new Error(data.error || "Download failed")
      }

      const lines = (data.results || []).map((r: any) => {
        if (r.success) {
          return `✓ ${r.companyName || r.tan}: ${r.rowCount} row(s), ${r.fromDate} → ${r.toDate}`
        }
        return `✗ ${r.companyName || r.tan}: ${r.error}`
      })
      setUnconsumedExcelSummary(
        `Success ${data.successCount}/${data.companies}\n` + lines.join("\n")
      )
      messageApi.success({
        content: `Done — ${data.successCount} company(ies) succeeded, ${data.failedCount} failed`,
        key: "unconsumed-excel-pdfs",
      })
    } catch (e: any) {
      messageApi.error({
        content: e.message || "Failed to download PDFs from Excel",
        key: "unconsumed-excel-pdfs",
      })
    } finally {
      setUnconsumedExcelDownloading(false)
    }
  }

  /** Match each row by TAN (`Username` / `Tan` / `TAN` / `User ID`). Replaces current company selection. */
  const resolveCsvTan = (row: Record<string, unknown>): string =>
    String(row["Username"] ?? row["Tan"] ?? row["TAN"] ?? row["User ID"] ?? "").trim()

  const handleCompanySelectCsvUpload = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      messageApi.error("Please upload a CSV file")
      setCompanyPickerCsvFileList([])
      return false
    }

    setCompanyPickerCsvLoading(true)
    try {
      const csvData = await parseCsvFile(file)
      if (csvData.length === 0) {
        messageApi.error("No rows with Company Name found in CSV")
        setCompanyPickerCsvFileList([])
        return false
      }

      const seen = new Set<number>()
      const ids: number[] = []
      const notFound: string[] = []

      for (const row of csvData) {
        const companyName = String(row["Company Name"] ?? "").trim()
        const tan = resolveCsvTan(row)
        if (!companyName && !tan) continue

        const company = tan
          ? savedCompanies.find((c: { tan: string }) => c.tan === tan)
          : undefined

        if (!company) {
          notFound.push(companyName || tan || "Unknown row")
          continue
        }
        if (!seen.has(company.id)) {
          seen.add(company.id)
          ids.push(company.id)
        }
      }

      setSelectedCompanyIds(ids)

      if (ids.length === 0) {
        messageApi.error(
          "No companies matched. Check that Tan / Username matches your saved companies."
        )
      } else {
        messageApi.success(`Selected ${ids.length} compan${ids.length === 1 ? "y" : "ies"} from CSV`)
      }
      if (notFound.length > 0) {
        messageApi.warning(
          `${notFound.length} row(s) had no matching company (by TAN). First: ${notFound[0]}`
        )
      }

      setCompanyPickerCsvFileList([])
    } catch (error: any) {
      messageApi.error(error.message || "Failed to read CSV")
      setCompanyPickerCsvFileList([])
    } finally {
      setCompanyPickerCsvLoading(false)
    }
    return false
  }

  const handleCsvUpload = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      messageApi.error("Please upload a CSV file")
      setCsvFileList([])
      return false
    }

    try {
      setCsvProcessing(true)
      const csvData = await parseCsvFile(file)

      if (csvData.length === 0) {
        messageApi.error("No valid data found in CSV")
        return
      }

      const workItems: CreateBatchItem[] = []

      for (const row of csvData) {
        const companyName = row["Company Name"]
        const company = savedCompanies.find((c) => c.tan === row["Username"])
        if (!company) {
          messageApi.warning(`Company ${companyName} not found in system, skipping...`)
          continue
        }

        const rowAct = parseIncomeTaxActCsv(row["Act"])
        const newRegimeChallanMode = parseChallanModeCsv(row[challanModeCsvColumnName()])
        const sections: Array<{ sectionCode: string; amount: string; actType: IncomeTaxActKind }> =
          []
        const sectionHeaders = Object.keys(row).filter(
          (key) =>
            ![
              "Company Code",
              "Company Name",
              "Username",
              "Password",
              "Assessment Year",
              "Act",
              challanModeCsvColumnName(),
            ].includes(key) &&
            key.trim() !== "" &&
            row[key]
        )

        sectionHeaders.forEach((header) => {
          const amount = row[header]
          const trimmedHeader = header.trim()
          if (amount && amount.trim() !== "" && trimmedHeader !== "") {
            sections.push({
              sectionCode: trimmedHeader,
              amount: amount.trim(),
              actType: rowAct,
            })
          }
        })

        if (sections.length === 0) {
          messageApi.warning(`No sections found for ${companyName}, skipping...`)
          continue
        }

        if (rowAct === "new" && newRegimeChallanMode === "combined") {
          const duplicateCode = findDuplicateSectionCode(sections)
          if (duplicateCode) {
            messageApi.warning(
              `Duplicate section ${duplicateCode} for ${companyName} (new regime). Skipping row...`
            )
            continue
          }
        }

        workItems.push({
          companyId: company.id,
          companyName: company.name,
          assessmentYear: row["Assessment Year"],
          sections,
          ...(rowAct === "new" ? { newRegimeChallanMode } : {}),
        })
      }

      if (workItems.length === 0) {
        messageApi.error("No valid companies to process in CSV")
        return
      }

      setCsvProgress({
        current: 0,
        total: workItems.length,
        currentCompany: "",
        status: "Creating challans...",
      })

      await runCreateBatch(workItems)

      setCsvProgress(null)
      setCsvFileList([])
    } catch (error: any) {
      messageApi.error(error.message || "Failed to process CSV")
      setCsvFileList([])
    } finally {
      setCsvProcessing(false)
    }
    return false // Prevent automatic upload
  }

  const columns = [
    {
      title: "Company",
      dataIndex: ["company", "name"],
      key: "company",
      width: 200,
      fixed: "left" as const,
    },
    {
      title: "Assessment Year",
      dataIndex: "assessmentYear",
      key: "assessmentYear",
      width: 150,
    },
    {
      title: "Section Code",
      dataIndex: "sectionCode",
      key: "sectionCode",
      width: 120,
    },
    {
      title: "Section Description",
      dataIndex: "sectionDesc",
      key: "sectionDesc",
      width: 250,
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: 120,
      render: (amount: string) => `₹${amount}`,
    },
    {
      title: "Payment Ref No",
      dataIndex: "pymntRefNum",
      key: "pymntRefNum",
      width: 150,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: string) => {
        const color =
          status === "created"
            ? "green"
            : status === "paid"
            ? "blue"
            : status === "downloaded"
            ? "purple"
            : "default"
        return <Tag color={color}>{status.toUpperCase()}</Tag>
      },
    },
    {
      title: "Created At",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (date: Date) => new Date(date).toLocaleString(),
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      fixed: "right" as const,
      render: (_: any, record: ChallanDataType) => (
        <Space>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
        </Space>
      ),
    },
  ]

  return (
    <Layout title="Challan Management">
      {contextHolder}
      <Modal
        title={
          lastEpayDownloadRun
            ? `e-Pay results — ${epayFlowLabel(lastEpayDownloadRun.flow)}`
            : "e-Pay results"
        }
        open={epayResultsModalOpen}
        onCancel={() => setEpayResultsModalOpen(false)}
        width={840}
        destroyOnClose={false}
        footer={[
          <Button key="close" onClick={() => setEpayResultsModalOpen(false)}>
            Close
          </Button>,
          <Button
            key="retry"
            type="primary"
            onClick={handleEpayRetrySelected}
            disabled={epayRetryRowKeys.length === 0 || epayDownloadBusy}
            loading={
              downloadPaymentLoading || downloadGeneratedChallansLoading || downloadCsiLoading
            }
          >
            Retry selected
          </Button>,
        ]}
      >
        {lastEpayDownloadRun && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <Text>
                <strong>{lastEpayDownloadRun.results.filter((r) => r.success).length}</strong>{" "}
                succeeded,{" "}
                <strong>{lastEpayDownloadRun.results.filter((r) => !r.success).length}</strong>{" "}
                failed
              </Text>
              <Text type="secondary"> · {dayjs(lastEpayDownloadRun.startedAt).format("YYYY-MM-DD HH:mm:ss")}</Text>
            </div>
            <Space wrap>
              <Button
                size="small"
                onClick={() =>
                  setEpayRetryRowKeys(
                    lastEpayDownloadRun.results.filter((r) => !r.success).map((r) => r.companyId)
                  )
                }
              >
                Select failed only
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setEpayRetryRowKeys(lastEpayDownloadRun.results.map((r) => r.companyId))
                }
              >
                Select all
              </Button>
              <Button size="small" onClick={() => setEpayRetryRowKeys([])}>
                Clear
              </Button>
            </Space>
            <Table<EpayDownloadResultRow>
              size="small"
              rowKey="companyId"
              pagination={false}
              scroll={{ y: 360 }}
              dataSource={lastEpayDownloadRun.results}
              rowSelection={{
                selectedRowKeys: epayRetryRowKeys,
                onChange: (keys) => setEpayRetryRowKeys(keys as number[]),
              }}
              columns={[
                { title: "Company", dataIndex: "companyName", key: "companyName", ellipsis: true },
                { title: "TAN", dataIndex: "tan", key: "tan", width: 130 },
                {
                  title: "Status",
                  key: "status",
                  width: 100,
                  render: (_, row) =>
                    row.success ? (
                      <Tag color="success">Success</Tag>
                    ) : (
                      <Tag color="error">Failed</Tag>
                    ),
                },
                {
                  title: "Error / detail",
                  dataIndex: "errorMessage",
                  key: "errorMessage",
                  ellipsis: { showTitle: false },
                  render: (msg: string | undefined) =>
                    msg ? (
                      <Tooltip title={msg}>
                        <span>{msg}</span>
                      </Tooltip>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Space>
        )}
      </Modal>
      <Modal
        title="Challan create results"
        open={createResultsModalOpen}
        onCancel={() => setCreateResultsModalOpen(false)}
        width={840}
        destroyOnClose={false}
        footer={[
          <Button key="close" onClick={() => setCreateResultsModalOpen(false)}>
            Close
          </Button>,
          <Button
            key="retry"
            type="primary"
            onClick={handleCreateRetrySelected}
            disabled={createRetryRowKeys.length === 0 || createLoading}
            loading={createLoading}
          >
            Retry selected
          </Button>,
        ]}
      >
        {lastCreateRun && (
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <div>
              <Text>
                <strong>{lastCreateRun.results.filter((r) => r.success).length}</strong> succeeded,{" "}
                <strong>{lastCreateRun.results.filter((r) => !r.success).length}</strong> failed
              </Text>
              <Text type="secondary">
                {" "}
                · {dayjs(lastCreateRun.startedAt).format("YYYY-MM-DD HH:mm:ss")}
              </Text>
            </div>
            <Space wrap>
              <Button
                size="small"
                onClick={() =>
                  setCreateRetryRowKeys(
                    lastCreateRun.results.filter((r) => !r.success).map((r) => r.companyId)
                  )
                }
              >
                Select failed only
              </Button>
              <Button
                size="small"
                onClick={() =>
                  setCreateRetryRowKeys(lastCreateRun.results.map((r) => r.companyId))
                }
              >
                Select all
              </Button>
              <Button size="small" onClick={() => setCreateRetryRowKeys([])}>
                Clear
              </Button>
            </Space>
            <Table<CreateResultRow>
              size="small"
              rowKey="companyId"
              pagination={false}
              scroll={{ y: 360 }}
              dataSource={lastCreateRun.results}
              rowSelection={{
                selectedRowKeys: createRetryRowKeys,
                onChange: (keys) => setCreateRetryRowKeys(keys as number[]),
              }}
              columns={[
                { title: "Company", dataIndex: "companyName", key: "companyName", ellipsis: true },
                { title: "TAN", dataIndex: "tan", key: "tan", width: 130 },
                {
                  title: "Sections",
                  dataIndex: "sectionsCreated",
                  key: "sectionsCreated",
                  width: 90,
                  render: (n: number | undefined) => (n != null ? n : "—"),
                },
                {
                  title: "Status",
                  key: "status",
                  width: 100,
                  render: (_, row) =>
                    row.success ? (
                      <Tag color="success">Success</Tag>
                    ) : (
                      <Tag color="error">Failed</Tag>
                    ),
                },
                {
                  title: "Error / detail",
                  dataIndex: "errorMessage",
                  key: "errorMessage",
                  ellipsis: { showTitle: false },
                  render: (msg: string | undefined) =>
                    msg ? (
                      <Tooltip title={msg}>
                        <span>{msg}</span>
                      </Tooltip>
                    ) : (
                      "—"
                    ),
                },
              ]}
            />
          </Space>
        )}
      </Modal>
      <Space direction="vertical" size="large" style={{ width: "100%", padding: "24px" }}>
        <Title level={2}>Challan Management</Title>

        {/* CSV Upload Card */}
        <Card
          title={
            <Space>
              <UploadOutlined />
              <span>Batch Process from CSV</span>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              message="Upload CSV File"
              description={`Upload a CSV file with company data to create challans for multiple companies concurrently (subject to the Concurrent creates setting above; creation is API-only and does not download PDFs). For new-regime rows, an optional "${challanModeCsvColumnName()}" column controls whether section amounts on that row are merged into one challan (combined, default) or created as separate challans (separate). After the batch, use the 'Download Payment History' (or 'Download Generated Challans') section below — which supports its own concurrency — to fetch the receipt PDFs.`}
              type="info"
              showIcon
            />

            <Upload
              accept=".csv"
              fileList={csvFileList}
              beforeUpload={handleCsvUpload}
              maxCount={1}
              disabled={csvProcessing}
            >
              <Button icon={<UploadOutlined />} loading={csvProcessing} disabled={csvProcessing}>
                Upload CSV File
              </Button>
            </Upload>

            {(csvProgress || createProgress) && (
              <Alert
                message={`Creating ${createProgress?.current ?? csvProgress?.current ?? 0} of ${
                  createProgress?.total ?? csvProgress?.total ?? 0
                }`}
                description={
                  csvProgress?.status ? (
                    <div>
                      <strong>Status:</strong> {csvProgress.status}
                    </div>
                  ) : undefined
                }
                type="info"
                showIcon
              />
            )}
          </Space>
        </Card>

        {/* Company Selection Card */}
        <Card title="Select Companies">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              message="Select manually or load from CSV"
              description="Company Name plus Tan / TAN / Username / User ID required per row. Other columns are ignored. Upload replaces the current selection."
              type="info"
              showIcon
            />

            <Select
              mode="multiple"
              style={{ width: "100%" }}
              placeholder="Select companies"
              value={selectedCompanyIds}
              onChange={setSelectedCompanyIds}
              showSearch
              filterOption={(input, option) => {
                const label = String(option?.children || "")
                return label.toLowerCase().includes(input.toLowerCase())
              }}
              maxTagCount="responsive"
            >
              {savedCompanies.map((company) => (
                <Option key={company.id} value={company.id}>
                  {company.name}
                </Option>
              ))}
            </Select>

            <Space wrap align="center">
              <Upload
                accept=".csv"
                fileList={companyPickerCsvFileList}
                beforeUpload={handleCompanySelectCsvUpload}
                onChange={({ fileList }) => setCompanyPickerCsvFileList(fileList)}
                maxCount={1}
                disabled={companyPickerCsvLoading || savedCompanies.length === 0}
              >
                <Button
                  icon={<UploadOutlined />}
                  loading={companyPickerCsvLoading}
                  disabled={companyPickerCsvLoading || savedCompanies.length === 0}
                >
                  Select companies from CSV
                </Button>
              </Upload>
              <Button onClick={handleSelectAll} disabled={savedCompanies.length === 0}>
                Select All
              </Button>
              <Button onClick={handleClearAll} disabled={selectedCompanyIds.length === 0}>
                Clear All
              </Button>
            </Space>

            {savedCompanies.length === 0 ? (
              <Alert
                message="No companies available"
                description="Please add companies first to proceed."
                type="warning"
                showIcon
              />
            ) : (
              <Alert
                message={`${selectedCompanyIds.length} ${
                  selectedCompanyIds.length === 1 ? "company" : "companies"
                } selected`}
                type="info"
                showIcon
              />
            )}
          </Space>
        </Card>

        {/* Create Challan Card */}
        <Card
          title={
            <Space>
              <FileAddOutlined />
              <span>Create Challans</span>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              message="Create Challans (API, concurrent)"
              description="Creates challans on the portal using the e-Pay APIs (no browser). Use the concurrency setting below to process multiple companies at once. No PDFs are downloaded as part of creation. After the batch finishes, go to the 'e-Pay downloads' section below and use 'Download Payment History' (or 'Download Generated Challans') to fetch the receipt PDFs concurrently."
              type="info"
              showIcon
            />

            <Space wrap>
              <Input
                placeholder="Assessment Year (e.g., 2026-27)"
                value={assessmentYear}
                onChange={(e) => setAssessmentYear(e.target.value)}
                style={{ maxWidth: 300 }}
              />
              <Select
                style={{ minWidth: 280 }}
                value={challanActType}
                onChange={(v) => setChallanActType(v)}
                placeholder="Income-tax Act (section list)"
              >
                <Option value="old">Old Act — pre-2025 regime (actType O)</Option>
                <Option value="new">New Act — Income-tax Act, 2025 (actType N)</Option>
              </Select>
            </Space>

            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              <div><strong>Concurrent creates:</strong></div>
              <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                How many companies to create challans for in parallel (portal API calls only — lightweight, no Chrome).
                Max 7. Default 1 for safety. After creation, use the separate "Download Payment History" button (with its own concurrency) to fetch receipts.
              </Text>
              <Select
                style={{ width: 120 }}
                value={createConcurrency}
                onChange={(v) => setCreateConcurrency(v)}
                disabled={createBusy}
              >
                {[1,2,3,4,5,6,7].map(n => <Option key={n} value={n}>{n}</Option>)}
              </Select>
            </Space>

            {selectedSections.map((section, index) => (
              <Row key={index} gutter={16} align="middle">
                <Col span={10}>
                  <Select
                    style={{ width: "100%" }}
                    placeholder="Select section code"
                    value={section.sectionCode}
                    onChange={(value) => handleSectionChange(index, "sectionCode", value)}
                    showSearch
                    filterOption={(input, option) => {
                      const label = String(option?.children || "")
                      return label.toLowerCase().includes(input.toLowerCase())
                    }}
                  >
                    {(challanActType === "new" ? newSecCodes : oldSecCodes).map((code) => {
                      const alreadySelected =
                        challanActType === "new" &&
                        selectedSections.some(
                          (s, i) => i !== index && s.sectionCode.trim() === code.sec_cd.trim()
                        )
                      return (
                        <Option key={code.sec_cd} value={code.sec_cd} disabled={alreadySelected}>
                          {code.sec_cd} - {code.natr_pymnt_desc}
                        </Option>
                      )
                    })}
                  </Select>
                </Col>
                <Col span={10}>
                  <Input
                    placeholder="Amount"
                    value={section.amount}
                    onChange={(e) => handleSectionChange(index, "amount", e.target.value)}
                    type="number"
                  />
                </Col>
                <Col span={4}>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemoveSection(index)}
                  >
                    Remove
                  </Button>
                </Col>
              </Row>
            ))}

            <Space>
              <Button icon={<PlusOutlined />} onClick={handleAddSection} disabled={createBusy}>
                Add Section
              </Button>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleCreateChallans}
                loading={createLoading}
                disabled={
                  createBusy ||
                  selectedCompanyIds.length === 0 ||
                  !assessmentYear ||
                  selectedSections.length === 0
                }
              >
                Create Challans
              </Button>
            </Space>

            {createProgress && (
              <Alert
                message={`Creating ${createProgress.current} of ${createProgress.total}`}
                type="info"
                showIcon
              />
            )}
          </Space>
        </Card>

        {/* e-Pay: Payment History & Generated Challans (shared filters) */}
        <Card
          title={
            <Space>
              <CloudDownloadOutlined />
              <span>e-Pay downloads (filtered)</span>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              message="Payment History, Generated Challans & CSI File"
              description={`Download manually for selected companies (optional filters above), or upload the same challan CSV used for creation to download only rows matching each line's assessment year and section amount(s). Combined new-regime rows match the summed amount; separate rows match each section amount. If the portal has multiple matching challans, only the most recent one is downloaded. CSI File download uses the Challan Status Inquiry (CSI) File tab with the Payment Date Range (required) and saves under each company's CSI folder.`}
              type="info"
              showIcon
            />

            <Alert
              message="CSV-based download"
              description="Upload your challan CSV (same template as batch create). Each row's Username/TAN, Assessment Year, Act, section amounts, and optional Challan Mode column determine which PDFs are fetched."
              type="info"
              showIcon
            />

            <Upload
              accept=".csv"
              fileList={epayCsvFileList}
              beforeUpload={() => false}
              onChange={({ fileList }) => setEpayCsvFileList(fileList)}
              maxCount={1}
              disabled={epayDownloadBusy}
              onRemove={() => setEpayCsvFileList([])}
            >
              <Button icon={<UploadOutlined />} disabled={epayDownloadBusy}>
                Select CSV for download
              </Button>
            </Upload>

            <Space wrap>
              <Button
                icon={<CloudDownloadOutlined />}
                loading={epayCsvProcessing && epayCsvFlow === "payment"}
                disabled={
                  epayCsvFileList.length === 0 ||
                  epayDownloadBusy ||
                  downloadGeneratedChallansLoading
                }
                onClick={() => handleEpayCsvDownload("payment")}
              >
                Download Payment History from CSV
              </Button>
              <Button
                icon={<CloudDownloadOutlined />}
                loading={epayCsvProcessing && epayCsvFlow === "generated"}
                disabled={
                  epayCsvFileList.length === 0 || epayDownloadBusy || downloadPaymentLoading
                }
                onClick={() => handleEpayCsvDownload("generated")}
              >
                Download Generated Challans from CSV
              </Button>
            </Space>

            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <div>
                    <strong>Assessment Year:</strong>
                  </div>
                  <Input
                    placeholder="e.g., 2026-27 (optional)"
                    value={paymentAssessmentYear}
                    onChange={(e) => setPaymentAssessmentYear(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </Space>
              </Col>

              <Col span={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <div>
                    <strong>Income-tax Act:</strong>
                  </div>
                  <Select
                    style={{ width: "100%" }}
                    value={paymentIncomeTaxAct}
                    onChange={(v) => setPaymentIncomeTaxAct(v)}
                  >
                    <Option value="old">Income-tax Act, 1961</Option>
                    <Option value="new">Income-tax Act, 2025</Option>
                  </Select>
                </Space>
              </Col>

              <Col span={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <div>
                    <strong>Type of Payment:</strong>
                  </div>
                  <Select
                    placeholder="Select payment type (optional)"
                    value={paymentType || undefined}
                    onChange={setPaymentType}
                    style={{ width: "100%" }}
                    allowClear
                  >
                    <Option value="TDS/TCS Payable by Taxpayer(200)">
                      TDS/TCS Payable by Taxpayer(200)
                    </Option>
                    <Option value="200">200</Option>
                  </Select>
                </Space>
              </Col>

              <Col span={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <div>
                    <strong>Concurrent Chrome sessions:</strong>
                  </div>
                  <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                    Each value runs that many companies at once (max 7). Each job opens its own
                    Chrome window.
                  </Text>
                  <Select
                    style={{ width: "100%" }}
                    value={epayConcurrency}
                    onChange={(v) => setEpayConcurrency(v)}
                    disabled={epayDownloadBusy}
                  >
                    {[1, 2, 3, 4, 5, 6, 7].map((n) => (
                      <Option key={n} value={n}>
                        {n}
                      </Option>
                    ))}
                  </Select>
                </Space>
              </Col>
            </Row>

            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              <div>
                <strong>Payment Date Range:</strong>
              </div>
              <Text type="secondary" style={{ fontSize: 12, display: "block" }}>
                Optional for Payment History / Generated Challans. Required for CSI File download.
              </Text>
              <DatePicker.RangePicker
                format="DD-MMM-YYYY"
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    // Set from date to start of day and to date to end of day
                    const fromDate = dates[0].startOf("day").format("DD-MMM-YYYY HH:mm:ss")
                    const toDate = dates[1].endOf("day").format("DD-MMM-YYYY HH:mm:ss")
                    setPaymentDateRange([fromDate, toDate])
                  } else {
                    setPaymentDateRange(null)
                  }
                }}
                style={{ width: "100%" }}
              />
            </Space>

            {epayDownloadBusy && epayDownloadProgress && (
              <Text type="secondary">
                Progress: {epayDownloadProgress.current} / {epayDownloadProgress.total} companies
              </Text>
            )}

            <Space wrap>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadPayments}
                loading={downloadPaymentLoading}
                disabled={
                  selectedCompanyIds.length === 0 ||
                  downloadGeneratedChallansLoading ||
                  downloadCsiLoading
                }
              >
                Download Payment History
              </Button>
              <Button
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadGeneratedChallans}
                loading={downloadGeneratedChallansLoading}
                disabled={
                  selectedCompanyIds.length === 0 || downloadPaymentLoading || downloadCsiLoading
                }
              >
                Download Generated Challans
              </Button>
              <Button
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadCsiFiles}
                loading={downloadCsiLoading}
                disabled={
                  selectedCompanyIds.length === 0 ||
                  downloadPaymentLoading ||
                  downloadGeneratedChallansLoading ||
                  !paymentDateRange
                }
              >
                Download CSI File
              </Button>
            </Space>
          </Space>
        </Card>

        {/* Upload unconsumed / challan Excels → download payment PDFs by deposit date */}
        <Card
          title={
            <Space>
              <FileExcelOutlined />
              <span>Download Payment PDFs from Excel</span>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="Upload one or more Excel files"
              description="Required columns: TAN (or Tan / Username) and Date of Deposit. Optional: Company Name, Challan Amount. Company is resolved by TAN from saved companies. Portal date filter uses one day before the earliest deposit date (From) and one day after the latest (To). Act: deposit on/before 30-Apr-2026 → Old Act; after 30-Apr-2026 → New Act."
            />

            <Upload
              accept=".xlsx,.xls"
              multiple
              fileList={unconsumedExcelFileList}
              beforeUpload={() => false}
              onChange={({ fileList }) => setUnconsumedExcelFileList(fileList)}
              onRemove={(file) => {
                setUnconsumedExcelFileList((prev) => prev.filter((f) => f.uid !== file.uid))
              }}
              disabled={unconsumedExcelDownloading}
            >
              <Button icon={<UploadOutlined />} disabled={unconsumedExcelDownloading}>
                Select Excel file(s)
              </Button>
            </Upload>

            <Button
              type="primary"
              icon={<CloudDownloadOutlined />}
              loading={unconsumedExcelDownloading}
              disabled={unconsumedExcelFileList.length === 0}
              onClick={handleDownloadPdfsFromUploadedExcels}
            >
              Download Payment History PDFs
            </Button>

            {unconsumedExcelSummary && (
              <Alert
                type="success"
                showIcon
                message="Download summary"
                description={
                  <pre style={{ margin: 0, whiteSpace: "pre-wrap", fontSize: 12 }}>
                    {unconsumedExcelSummary}
                  </pre>
                }
              />
            )}
          </Space>
        </Card>

        {/* Challan Data Table */}
        <Card
          title={
            <Space>
              <span>Challan Records ({count})</span>
              <Button icon={<ReloadOutlined />} onClick={() => refetch()} size="small">
                Refresh
              </Button>
            </Space>
          }
        >
          <Table
            columns={columns}
            dataSource={(challanData as ChallanDataType[]) || []}
            rowKey="id"
            scroll={{ x: 1800 }}
            pagination={{ pageSize: 50 }}
          />
        </Card>
      </Space>
    </Layout>
  )
}

ChallanManagementPage.authenticate = true

export default ChallanManagementPage
