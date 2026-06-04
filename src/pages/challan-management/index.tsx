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
import { runWithConcurrency } from "src/challan/utils/runWithConcurrency"
import dayjs from "dayjs"

const { Option } = Select
const { Title, Text } = Typography

type EpayDownloadFlow = "payment" | "generated"

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
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [downloadPaymentLoading, setDownloadPaymentLoading] = useState(false)
  const [downloadGeneratedChallansLoading, setDownloadGeneratedChallansLoading] = useState(false)
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

  const [epayConcurrency, setEpayConcurrency] = useState(1)
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

  const epayDownloadBusy = downloadPaymentLoading || downloadGeneratedChallansLoading
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

  const handleDownloadChallans = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    setDownloadLoading(true)
    try {
      for (const companyId of selectedCompanyIds) {
        const response = await fetch("/api/challan/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        })

        const data = await response.json()
        if (data.success) {
          messageApi.success(`Challans downloaded for company ${companyId}`)
        } else {
          messageApi.error(`Failed to download challans for company ${companyId}`)
        }
      }
    } catch (error: any) {
      messageApi.error(error.message || "Failed to download challans")
    } finally {
      setDownloadLoading(false)
    }
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

    const limit = 1
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
              skipDownload: false,
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

  const runEpayDownloadBatch = async (flow: EpayDownloadFlow, companyIds: number[]) => {
    if (companyIds.length === 0) return

    const limit = Math.min(7, Math.max(1, epayConcurrency), companyIds.length)
    const setLoading =
      flow === "payment" ? setDownloadPaymentLoading : setDownloadGeneratedChallansLoading

    let completed = 0
    const bumpProgress = () => {
      completed += 1
      setEpayDownloadProgress({ current: completed, total: companyIds.length })
    }

    setEpayDownloadProgress({ current: 0, total: companyIds.length })
    setLoading(true)

    const flowLabel = flow === "payment" ? "Payment History" : "Generated Challans"

    try {
      const results = await runWithConcurrency(companyIds, limit, async (companyId) => {
        const endpoint =
          flow === "payment"
            ? "/api/challan/download-payment"
            : "/api/challan/download-generated-challans"
        const meta = resolveCompanyMeta(companyId)
        const body = {
          companyId,
          fromDate: paymentDateRange?.[0],
          toDate: paymentDateRange?.[1],
          assessmentYear: paymentAssessmentYear || undefined,
          paymentType: paymentType || undefined,
          incomeTaxAct: paymentIncomeTaxAct,
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
            companyId,
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
            companyId,
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
      setLoading(false)
      setEpayDownloadProgress(null)
    }
  }

  const handleDownloadPayments = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }
    await runEpayDownloadBatch("payment", selectedCompanyIds)
  }

  const handleDownloadGeneratedChallans = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }
    await runEpayDownloadBatch("generated", selectedCompanyIds)
  }

  const handleEpayRetrySelected = async () => {
    if (!lastEpayDownloadRun) return
    if (epayRetryRowKeys.length === 0) {
      messageApi.warning("Select at least one company to retry")
      return
    }
    setEpayResultsModalOpen(false)
    await runEpayDownloadBatch(lastEpayDownloadRun.flow, epayRetryRowKeys)
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
        const text = e.target?.result as string
        const lines = text.split("\n").filter((line) => line.trim())
        if (lines.length < 2) {
          reject(new Error("CSV file is empty or invalid"))
          return
        }

        const headerLine = lines[0]
        if (!headerLine) {
          reject(new Error("CSV file has no headers"))
          return
        }

        const headers = headerLine.split(",").map((h) => h.trim())
        const data = lines.slice(1).map((line) => {
          const values = line.split(",").map((v) => v.trim())
          const row: any = {}
          headers.forEach((header, index) => {
            row[header] = values[index] || ""
          })
          return row
        })

        resolve(data.filter((row) => row["Company Name"])) // Filter out empty rows
      }
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.readAsText(file)
    })
  }

  /** Same CSV as batch create: match each row by TAN (`Username`). Replaces current company selection. */
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
        const tan = String(row["Username"] ?? "").trim()
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
        messageApi.error("No companies matched. Check that Username (TAN) matches your saved companies.")
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

        if (rowAct === "new") {
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
            ? `e-Pay results — ${
                lastEpayDownloadRun.flow === "payment"
                  ? "Payment History"
                  : "Generated Challans"
              }`
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
            disabled={
              epayRetryRowKeys.length === 0 ||
              downloadPaymentLoading ||
              downloadGeneratedChallansLoading
            }
            loading={downloadPaymentLoading || downloadGeneratedChallansLoading}
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
              description="Upload a CSV file with company data to create challans for multiple companies concurrently. Use Download Payment History afterward to fetch payment PDFs."
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
              description="Use the same CSV template as batch create (Company Name and Username/TAN columns required per row). Other columns are ignored. Upload replaces the current selection."
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
              message="Create and download challan PDFs"
              description="Each company is processed one at a time. After a challan is created on the portal, its Generated Challan PDF is downloaded automatically."
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
              message="Payment History & Generated Challans"
              description="Use the same optional filters below, then download either the Payment History tab or the Generated Challans tab from TRACES e-Pay."
              type="info"
              showIcon
            />

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
                disabled={selectedCompanyIds.length === 0 || downloadGeneratedChallansLoading}
              >
                Download Payment History
              </Button>
              <Button
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadGeneratedChallans}
                loading={downloadGeneratedChallansLoading}
                disabled={selectedCompanyIds.length === 0 || downloadPaymentLoading}
              >
                Download Generated Challans
              </Button>
            </Space>
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
