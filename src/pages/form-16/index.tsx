import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  message,
  Select,
  Upload,
  Tag,
  Alert,
  Radio,
  Divider,
  Checkbox,
  Modal,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  UploadOutlined,
  FileExcelOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  SendOutlined,
  DownloadOutlined,
  MailOutlined,
  LockOutlined,
  DeleteOutlined,
  ReloadOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import processExcelUpload from "src/form16/mutations/processExcelUploadForm16"
import getUploadHistory from "src/companies/queries/getUploadHistory"
import getCompanies from "src/companies/queries/getCompanies"
import sendForm16Emails from "src/companies/mutations/sendForm16Emails"
import deleteUploadHistory from "src/companies/mutations/deleteUploadHistory"
import generateForm16PdfsFromZips from "src/companies/mutations/generateForm16PdfsFromZips"
import getForm16BatchProgress from "src/tasks/queries/getForm16BatchProgress"
import retryFailedForm16BatchTasks from "src/tasks/mutations/retryFailedForm16BatchTasks"
import * as XLSX from "xlsx"
import dayjs from "dayjs"
import "dayjs/locale/en-gb"
import { ConfigProvider, Input } from "antd"
import { readCompanyCredentialsFromFile } from "src/shared/ui/readCompanyCredentialsFile"
import { CompanyCredentialsUpload } from "src/shared/ui/CompanyCredentialsUpload"
import { UploadHistoryTable } from "src/shared/ui/UploadHistoryTable"
import { BatchProgressPoller } from "src/shared/ui/BatchProgressPoller"
import { UploadHistoryStatusTag } from "src/shared/ui/UploadHistoryStatusTag"
import { DscCertificatePicker } from "src/form16/components/DscCertificatePicker"
import enGB from "antd/lib/locale/en_GB"

// Set dayjs locale to en-gb (starts week on Monday)
dayjs.locale("en-gb")

interface CompanyData {
  name: string
  tan: string
  it_password: string
  user_id: string
  password: string
}


function Form16Page() {
  const [messageApi, contextHolder] = message.useMessage()
  const [processExcelUploadMutation] = useMutation(processExcelUpload)
  const [sendForm16EmailsMutation] = useMutation(sendForm16Emails)
  const [deleteUploadHistoryMutation] = useMutation(deleteUploadHistory)
  const [retryFailedForm16Mutation] = useMutation(retryFailedForm16BatchTasks)
  const [form16Type, setForm16Type] = useState<"form16" | "form16a">("form16")
  const [portalMode, setPortalMode] = useState<"new" | "old">("new")
  const [uploadHistoryResponse, { refetch }] = useQuery(
    getUploadHistory,
    {
      skip: 0,
      take: 100,
      type: form16Type,
    },
    {
      refetchOnMount: true,
    }
  )

  const [excelData, setExcelData] = useState<CompanyData[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [dataSource, setDataSource] = useState<"excel" | "companies">("companies")
  const [actionType, setActionType] = useState<"send_request" | "download_file" | "sign_pdf">("download_file")
  const [sendToAllPeriods, setSendToAllPeriods] = useState<boolean>(false)
  const [financialYear, setFinancialYear] = useState<string[]>(["2026-27"])
  const [quarter, setQuarter] = useState<string[]>(["Q1"])
  const [formType, setFormType] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])

  // Email trigger states
  const [emailCompanyId, setEmailCompanyId] = useState<number | undefined>(undefined)
  const [emailFinancialYear, setEmailFinancialYear] = useState<string>("")
  const [emailQuarter, setEmailQuarter] = useState<string>("")
  const [emailFormType, setEmailFormType] = useState<string>("")
  const [emailLoading, setEmailLoading] = useState(false)
  const [emailResults, setEmailResults] = useState<any[]>([])

  const [certificateName, setCertificateName] = useState("")
  const [selectedHistoryRowKeys, setSelectedHistoryRowKeys] = useState<number[]>([])
  const [deleteHistoryLoading, setDeleteHistoryLoading] = useState(false)
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryModalOpen, setRetryModalOpen] = useState(false)
  const [selectedFailedTaskIds, setSelectedFailedTaskIds] = useState<number[]>([])
  const wasBatchCompleteRef = useRef(false)

  // === NEW: Generate PDFs from existing local ZIP folder (separate feature) ===
  const [generateZipMutation] = useMutation(generateForm16PdfsFromZips)
  const [zipSourceFolder, setZipSourceFolder] = useState("")
  const [zipCompanyName, setZipCompanyName] = useState("")
  const [zipTan, setZipTan] = useState("")
  const [zipFinancialYear, setZipFinancialYear] = useState("")
  const [zipQuarter, setZipQuarter] = useState("")
  const [zipFormType, setZipFormType] = useState("")
  const [zipSkipExisting, setZipSkipExisting] = useState(true)
  const [zipGenerateLoading, setZipGenerateLoading] = useState(false)
  const [zipGenerateResult, setZipGenerateResult] = useState<any>(null)

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []
  const uploadHistoryRecords = uploadHistoryResponse?.uploadHistory || []

  const [batchProgress, { refetch: refetchProgress }] = useQuery(
    getForm16BatchProgress,
    { batchId: activeBatchId || 0 },
    {
      enabled: !!activeBatchId,
      refetchInterval: activeBatchId ? 2000 : false,
      suspense: false,
    }
  )

  useEffect(() => {
    wasBatchCompleteRef.current = false
    setRetryModalOpen(false)
    setSelectedFailedTaskIds([])
  }, [activeBatchId])

  useEffect(() => {
    if (!activeBatchId || batchProgress?.batchId !== activeBatchId) return
    const complete = Boolean(batchProgress?.isComplete)
    const failedItems = (batchProgress?.items || []).filter((i) => i.status === "Failed")
    if (complete && !wasBatchCompleteRef.current && failedItems.length > 0) {
      setSelectedFailedTaskIds(failedItems.map((i) => i.taskId))
      setRetryModalOpen(true)
      void refetch()
    }
    if (batchProgress?.batchId === activeBatchId) {
      wasBatchCompleteRef.current = complete
    }
  }, [activeBatchId, batchProgress?.batchId, batchProgress?.isComplete, batchProgress?.items, refetch])

  const failedProgressItems = useMemo(
    () => (batchProgress?.items || []).filter((i) => i.status === "Failed"),
    [batchProgress?.items]
  )

  const handleRetryFailedTasks = async (taskIds?: number[]) => {
    if (!activeBatchId) return
    const ids = taskIds && taskIds.length > 0 ? taskIds : selectedFailedTaskIds
    if (!ids.length) {
      messageApi.warning("Select at least one failed task to retry")
      return
    }
    setRetrying(true)
    try {
      const result = await retryFailedForm16Mutation({
        batchId: activeBatchId,
        taskIds: ids,
      })
      messageApi.success(result.message)
      setRetryModalOpen(false)
      setSelectedFailedTaskIds([])
      await refetchProgress()
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  const retryModalColumns: ColumnsType<any> = [
    { title: "Company", dataIndex: "companyName", key: "companyName", width: 200 },
    { title: "TAN", dataIndex: "tan", key: "tan", width: 120 },
    { title: "FY", dataIndex: "financialYear", key: "financialYear", width: 100 },
    { title: "Quarter", dataIndex: "quarter", key: "quarter", width: 80 },
    { title: "Form", dataIndex: "formType", key: "formType", width: 80 },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 110,
      render: (status: string) => <UploadHistoryStatusTag status={status} />,
    },
    {
      title: "Error",
      dataIndex: "errorMessage",
      key: "errorMessage",
      ellipsis: true,
      render: (msg: string | null) => msg || "-",
    },
  ]

  const handleSelectFailedHistory = () => {
    const failedIds = uploadHistoryRecords.filter((r) => r.status === "Failed").map((r) => r.id)
    setSelectedHistoryRowKeys(failedIds)
    messageApi.info(`Selected ${failedIds.length} failed record(s)`)
  }

  const handleDeleteSelectedHistory = async () => {
    if (selectedHistoryRowKeys.length === 0) {
      messageApi.warning("Select at least one record to delete")
      return
    }
    setDeleteHistoryLoading(true)
    try {
      const result = await deleteUploadHistoryMutation({ ids: selectedHistoryRowKeys })
      messageApi.success(result.message || "Deleted successfully")
      setSelectedHistoryRowKeys([])
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to delete records")
    } finally {
      setDeleteHistoryLoading(false)
    }
  }

  // === NEW FEATURE HANDLER: Generate PDFs directly from a folder of ZIP files ===
  const handleGenerateFromZips = async () => {
    if (!zipSourceFolder || !zipCompanyName || !zipTan || !zipFinancialYear || !zipQuarter || !zipFormType) {
      messageApi.error("Please fill Source Folder, Company Name, TAN, Financial Year, Quarter and Form Type")
      return
    }

    setZipGenerateLoading(true)
    setZipGenerateResult(null)

    try {
      const res = await generateZipMutation({
        sourceFolder: zipSourceFolder.trim(),
        companyName: zipCompanyName.trim(),
        tan: zipTan.trim().toUpperCase(),
        financialYear: zipFinancialYear,
        quarter: zipQuarter,
        formType: zipFormType,
        form16Type,
        skipExisting: zipSkipExisting,
      })

      setZipGenerateResult(res)

      if (res.success) {
        const skipped = res.skippedPdfs ?? 0
        const generated = res.generatedPdfs ?? 0
        messageApi.success(
          skipped > 0
            ? `Generated ${generated} new PDF(s), skipped ${skipped} existing — from ${res.processedZips || 0} ZIP(s)`
            : `Generated ${generated} PDF(s) from ${res.processedZips || 0} ZIP(s)`
        )
      } else {
        messageApi.error(res.message || "Generation completed with errors")
      }
    } catch (error: any) {
      messageApi.error(error.message || "Failed to generate PDFs from ZIPs")
      setZipGenerateResult({ success: false, message: error.message, errors: [error.message] })
    } finally {
      setZipGenerateLoading(false)
    }
  }

  const fillZipFromCompany = (companyId: number) => {
    const c = savedCompanies.find((x) => x.id === companyId)
    if (c) {
      setZipCompanyName(c.name || "")
      // Many teams store TAN in user_id or tan field in Company model
      setZipTan((c as any).tan || (c as any).user_id || "")
    }
  }

  // Generate financial year options
  const useNewPortalForm16a = form16Type === "form16a" && portalMode === "new"

  const generateFinancialYears = (): Array<{ label: string; value: string }> => {
    if (useNewPortalForm16a) {
      return [{ label: "2026-27", value: "2026-27" }]
    }
    const currentYear = new Date().getFullYear()
    const years: Array<{ label: string; value: string }> = []
    for (let i = 0; i < 10; i++) {
      const year = currentYear - i
      years.push({
        label: `${year}-${(year + 1).toString().slice(-2)}`,
        value: `${year}-${(year + 1).toString().slice(-2)}`,
      })
    }
    return years
  }

  const quarterOptions = useNewPortalForm16a
    ? [{ label: "Q1 (Apr-Jun)", value: "Q1" }]
    : [
        { label: "Q1 (Apr-Jun)", value: "Q1" },
        { label: "Q2 (Jul-Sep)", value: "Q2" },
        { label: "Q3 (Oct-Dec)", value: "Q3" },
        { label: "Q4 (Jan-Mar)", value: "Q4" },
      ]

  const formTypeOptions = useNewPortalForm16a
    ? [
        { label: "130", value: "130" },
        { label: "131", value: "131" },
        { label: "133", value: "133" },
      ]
    : [
        { label: "24Q", value: "24Q" },
        { label: "26Q", value: "26Q" },
        { label: "27Q", value: "27Q" },
        { label: "27EQ", value: "27EQ" },
      ]

  /** New portal Form 16A needs FY/Q/form for both send and download. Old portal only for send. */
  const needsPeriodSelection = useNewPortalForm16a
    ? actionType === "send_request" || actionType === "download_file"
    : actionType === "send_request"

  const handleSendEmails = async () => {
    // Get company name if company is selected
    const company = emailCompanyId ? savedCompanies.find((c) => c.id === emailCompanyId) : null

    setEmailLoading(true)
    setEmailResults([])

    try {
      const result = await sendForm16EmailsMutation({
        companyName: company?.name,
        form16Type: form16Type,
        financialYear: emailFinancialYear || undefined,
        quarter: emailQuarter || undefined,
        formType: emailFormType || undefined,
      })

      if (result.success) {
        messageApi.success(result.message || "Emails sent successfully")
        setEmailResults(result.results || [])
      } else {
        messageApi.error(result.error || "Failed to send emails")
        setEmailResults(result.results || [])
      }
    } catch (error: any) {
      messageApi.error(error.message || "Failed to send emails")
    } finally {
      setEmailLoading(false)
    }
  }

  const handleSubmit = async () => {
    // Prepare companies data based on data source
    let companies: CompanyData[] = []

    if (dataSource === "excel") {
      if (excelData.length === 0) {
        messageApi.error("Please upload an Excel file first")
        return
      }
      companies = excelData
    } else {
      if (selectedCompanyIds.length === 0) {
        messageApi.error("Please select at least one company")
        return
      }
      // Convert selected companies to the format expected by the mutation
      companies = savedCompanies
        .filter((c) => selectedCompanyIds.includes(c.id))
        .map((c) => ({
          name: c.name,
          tan: c.tan,
          it_password: c.it_password,
          user_id: c.user_id,
          password: c.password,
        }))
    }

    // Validation when period selection is required
    if (needsPeriodSelection && !sendToAllPeriods) {
      if (!financialYear || financialYear.length === 0) {
        messageApi.error("Please select at least one financial year")
        return
      }

      if (!quarter || quarter.length === 0) {
        messageApi.error("Please select at least one quarter")
        return
      }

      if (!formType || formType.length === 0) {
        messageApi.error("Please select at least one form type")
        return
      }
    }

    if (actionType === "sign_pdf" && !certificateName) {
      messageApi.error("Please select a DSC certificate")
      return
    }

    const passPeriods = needsPeriodSelection && !sendToAllPeriods

    setLoading(true)
    try {
      const result = await processExcelUploadMutation({
        companies: companies,
        financialYear: passPeriods ? financialYear : [],
        quarter: passPeriods ? quarter : [],
        formType: passPeriods ? formType : [],
        actionType,
        sendToAllPeriods: actionType === "send_request" ? sendToAllPeriods : false,
        jobTypes: actionType === "send_request" ? ["SendRequest"] : ["DownloadFile"],
        form16Type,
        portalMode: form16Type === "form16a" ? portalMode : undefined,
        certificateName
      })

      const actionMessage =
        actionType === "send_request"
          ? sendToAllPeriods
            ? "Send request jobs for all periods added to queue successfully"
            : "Send request jobs added to queue successfully"
          : actionType === "sign_pdf"
            ? "Attach DSC completed"
            : "Download jobs added to queue successfully"
      messageApi.success(actionMessage)

      if (
        actionType !== "sign_pdf" &&
        result &&
        typeof result === "object" &&
        "batchId" in result &&
        typeof (result as { batchId?: number }).batchId === "number"
      ) {
        setActiveBatchId((result as { batchId: number }).batchId)
      }

      setExcelData([])
      setFileList([])
      setSelectedCompanyIds([])
      setSendToAllPeriods(false)
      if (form16Type === "form16a" && portalMode === "new") {
        setFinancialYear(["2026-27"])
        setQuarter(["Q1"])
      } else {
        setFinancialYear([])
        setQuarter([])
      }
      setFormType([])
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to process upload")
    } finally {
      setLoading(false)
    }
  }



  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Form 16 Upload & Processing">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {/* Upload Card */}
          <Card
            title="Select Companies"
            extra={
              <Radio.Group
                value={dataSource}
                onChange={(e) => {
                  setDataSource(e.target.value)
                  setExcelData([])
                  setFileList([])
                  setSelectedCompanyIds([])
                }}
              >
                <Radio.Button value="companies">From Saved Companies</Radio.Button>
                <Radio.Button value="excel">Upload Excel File</Radio.Button>
              </Radio.Group>
            }
          >
            {dataSource === "companies" ? (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {savedCompanies.length === 0 ? (
                  <Alert
                    message="No Companies Available"
                    description="You don't have any saved companies yet. Please go to the Companies page to add companies, or use 'Upload Excel File' option instead."
                    type="warning"
                    showIcon
                  />
                ) : (
                  <>
                    <Alert
                      message="Select Companies"
                      description="Choose companies from your saved list. You can manage companies in the Companies page."
                      type="info"
                      showIcon
                      style={{ marginBottom: 20 }}
                    />

                    <div>
                      <div
                        style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}
                      >
                        <Button
                          type="default"
                          size="small"
                          onClick={() => setSelectedCompanyIds(savedCompanies.map((c) => c.id))}
                          disabled={savedCompanies.length === 0}
                        >
                          Select All ({savedCompanies.length})
                        </Button>
                        <Button
                          type="default"
                          size="small"
                          onClick={() => setSelectedCompanyIds([])}
                          disabled={selectedCompanyIds.length === 0}
                        >
                          Clear All
                        </Button>
                        <span style={{ fontSize: "12px", color: "#888", marginLeft: "8px" }}>
                          💡 Tip: Type to search by company name or TAN
                        </span>
                      </div>

                      <Select
                        mode="multiple"
                        placeholder="Select companies to process or use 'Select All' button above"
                        value={selectedCompanyIds}
                        onChange={setSelectedCompanyIds}
                        style={{ width: "100%" }}
                        showSearch
                        maxTagCount="responsive"
                        filterOption={(input, option) => {
                          const company = savedCompanies.find((c) => c.id === option?.value)
                          if (!company) return false
                          return (
                            company.name.toLowerCase().includes(input.toLowerCase()) ||
                            company.tan.toLowerCase().includes(input.toLowerCase())
                          )
                        }}
                        options={savedCompanies.map((c) => ({
                          label: `${c.name} (${c.tan})`,
                          value: c.id,
                        }))}
                      />
                    </div>

                    {selectedCompanyIds.length > 0 && (
                      <Alert
                        message={`${selectedCompanyIds.length} of ${savedCompanies.length} company(ies) selected`}
                        type="success"
                        showIcon
                      />
                    )}
                  </>
                )}
              </Space>
            ) : (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Alert
                  message="Excel Format Required"
                  description="Please upload an Excel file (.xlsx or .xls) with the following columns: Company Name, Tan, IT Password, User ID, Password"
                  type="info"
                  showIcon
                />
                <CompanyCredentialsUpload
                  fileList={fileList}
                  onFileListChange={setFileList}
                  onParsed={(companies) => {
                    setExcelData(companies)
                    if (companies.length > 0) {
                      messageApi.success(`Successfully loaded ${companies.length} companies from Excel`)
                    }
                  }}
                  onError={(msg) => {
                    messageApi.error(msg)
                    setFileList([])
                  }}
                  accept=".xlsx,.xls"
                  buttonText="Select Excel File"
                />

                {excelData.length > 0 && (
                  <Alert
                    message={`${excelData.length} companies loaded from Excel`}
                    type="success"
                    showIcon
                  />
                )}
              </Space>
            )}

            <Divider />

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}>
                Form Type *
              </label>
              <Radio.Group
                value={form16Type}
                onChange={(e) => {
                  const next = e.target.value as "form16" | "form16a"
                  setForm16Type(next)
                  setFormType([])
                  if (next === "form16a" && portalMode === "new") {
                    setFinancialYear(["2026-27"])
                    setQuarter(["Q1"])
                  } else {
                    setFinancialYear([])
                    setQuarter([])
                  }
                }}
                style={{ width: "100%" }}
              >
                <Space direction="horizontal" size="large">
                  <Radio value="form16">
                    <strong>Form 16</strong>
                  </Radio>
                  <Radio value="form16a">
                    <strong>Form 16A</strong>
                  </Radio>
                </Space>
              </Radio.Group>
            </div>

            {form16Type === "form16a" && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}>
                  Portal Method *
                </label>
                <Radio.Group
                  value={portalMode}
                  onChange={(e) => {
                    const next = e.target.value as "new" | "old"
                    setPortalMode(next)
                    setFormType([])
                    if (next === "new") {
                      setFinancialYear(["2026-27"])
                      setQuarter(["Q1"])
                    } else {
                      setFinancialYear([])
                      setQuarter([])
                    }
                  }}
                  style={{ width: "100%" }}
                >
                  <Space direction="vertical" size="middle">
                    <Radio value="new">
                      <span>
                        <strong>New Portal (REST)</strong> — forms 130/131/133, FY 2026-27 Q1 via
                        tdscertificatesservice
                      </span>
                    </Radio>
                    <Radio value="old">
                      <span>
                        <strong>Old Portal (Puppeteer)</strong> — traces61 bulk Form 16A download /
                        send (24Q/26Q/27Q/27EQ)
                      </span>
                    </Radio>
                  </Space>
                </Radio.Group>
              </div>
            )}

            <Divider />

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}>
                Action Type *
              </label>
              <Radio.Group
                value={actionType}
                onChange={(e) => {
                  setActionType(e.target.value)
                  if (e.target.value !== "send_request") {
                    setSendToAllPeriods(false)
                  }
                }}
                style={{ width: "100%" }}
              >
                <Space direction="vertical" size="middle">
                  <Radio value="download_file">
                    <Space>
                      <DownloadOutlined />
                      <span>
                        <strong>Download File</strong> - Download Form 16 files from portal
                      </span>
                    </Space>
                  </Radio>
                  <Radio value="send_request">
                    <Space>
                      <SendOutlined />
                      <span>
                        <strong>Send Request</strong> - Send Form 16 request to portal
                      </span>
                    </Space>
                  </Radio>
                  <Radio value="sign_pdf">
                    <Space>
                      <LockOutlined />
                      <span>
                        <strong>Attach DSC</strong> - Digitally Sign PDF files (manual fallback)
                      </span>
                    </Space>
                  </Radio>
                </Space>
              </Radio.Group>
            </div>

            {form16Type === "form16a" && actionType === "download_file" && (
              <Alert
                type="info"
                showIcon
                style={{ marginTop: 16, marginBottom: 8 }}
                message="Auto-attach DSC after PDF generation"
                description="When Form 16A PDFs are generated, the job signs them automatically if the company has a DSC Certificate Name (Companies page) or an entry in pdf-signer/dsc-map.json (TAN or company name → Windows cert subject). If no DSC is configured, download still succeeds and PDFs stay unsigned — use Attach DSC manually as a fallback."
              />
            )}

            {needsPeriodSelection && (
              <>
                <Divider orientation="left">Request Options</Divider>
                {actionType === "send_request" && (
                  <div style={{ marginBottom: 20 }}>
                    <label
                      style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}
                    >
                      Period Selection *
                    </label>
                    <Radio.Group
                      value={sendToAllPeriods ? "all_periods" : "specific_period"}
                      onChange={(e) => setSendToAllPeriods(e.target.value === "all_periods")}
                      style={{ width: "100%" }}
                    >
                      <Space direction="vertical" size="middle">
                        <Radio value="specific_period">
                          <Space>
                            <span>
                              <strong>Specific Period</strong> - Select specific financial year,
                              quarter, and form type
                            </span>
                          </Space>
                        </Radio>
                        <Radio value="all_periods">
                          <Space>
                            <span>
                              <strong>All Periods</strong> -{" "}
                              {useNewPortalForm16a
                                ? "Send requests for 2026-27 Q1 forms 130, 131, 133"
                                : "Send requests for all possible years, quarters, and form types"}
                            </span>
                          </Space>
                        </Radio>
                      </Space>
                    </Radio.Group>
                  </div>
                )}

                {(!sendToAllPeriods || actionType === "download_file") && (
                  <>
                    <Divider orientation="left">
                      {useNewPortalForm16a ? "Certificate Details (New Portal)" : "Request Details"}
                    </Divider>
                    {useNewPortalForm16a && (
                      <Alert
                        type="info"
                        showIcon
                        style={{ marginBottom: 16 }}
                        message="Form 16A New Portal uses TRACES REST (tdscertificatesservice). Select form type(s) 130, 131, or 133 for FY 2026-27 Q1."
                      />
                    )}
                    <Space
                      direction="vertical"
                      size="middle"
                      style={{ width: "100%", marginTop: 20 }}
                    >
                      <div>
                        <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                          Financial Year
                        </label>
                        <Select
                          mode="multiple"
                          value={financialYear}
                          onChange={setFinancialYear}
                          placeholder="Select Financial Years"
                          style={{ width: 400 }}
                          options={generateFinancialYears()}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                          Quarter
                        </label>
                        <Select
                          mode="multiple"
                          value={quarter}
                          onChange={setQuarter}
                          placeholder="Select Quarters"
                          style={{ width: 400 }}
                          options={quarterOptions}
                        />
                      </div>

                      <div>
                        <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                          Form Type
                        </label>
                        <Select
                          mode="multiple"
                          value={formType}
                          onChange={setFormType}
                          placeholder="Select Form Types"
                          style={{ width: 400 }}
                          options={formTypeOptions}
                        />
                      </div>
                    </Space>
                  </>
                )}
              </>
            )}

            {(actionType === "sign_pdf" || actionType === "download_file") && (
              <DscCertificatePicker
                value={certificateName}
                onChange={setCertificateName}
                hint={
                  actionType === "sign_pdf"
                    ? "Signs the PDFs already generated for the selected companies."
                    : "Signs each certificate as it is generated. Leave empty to use the company's own DSC setting."
                }
              />
            )}
            <Button
              type="primary"
              size="large"
              loading={loading}
              onClick={handleSubmit}
              disabled={
                (dataSource === "excel"
                  ? excelData.length === 0
                  : selectedCompanyIds.length === 0) ||
                (needsPeriodSelection &&
                  !sendToAllPeriods &&
                  (financialYear.length === 0 || quarter.length === 0 || formType.length === 0))
              }
              style={{ marginTop: 30 }}
              icon={actionType === "sign_pdf" ? <LockOutlined /> : actionType === "send_request" ? <SendOutlined /> : <DownloadOutlined />}
            >
              {actionType === "sign_pdf" ? "Attach DSC" : actionType === "send_request" ? "Send Request" : "Download Form 16 Files"}
            </Button>
          </Card>

          {/* ============================================================ */}
          {/* NEW SEPARATE FEATURE: Generate PDFs from already downloaded ZIPs */}
          {/* ============================================================ */}
          <Card
            title={
              <Space>
                <FileExcelOutlined />
                <span>Generate Form 16 / 16A PDFs from Existing ZIP Files</span>
              </Space>
            }
            style={{ border: "2px solid #52c41a" }}
          >
            <Alert
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
              message="This is a separate offline flow. No portal login or download required."
              description={
                <>
                  Point to a folder that already contains the downloaded .zip file(s) from TRACES.
                  Example: <code>/Users/apatel/.../public/pdf/form16zip/form16a/Swiggy 26Q-Q3</code>
                  <br />
                  The tool will extract the ZIPs (using the TAN you provide as password), parse, and generate the final PDFs.
                  <br />
                  <strong>Re-runs are safe:</strong> PDFs already present in the output folder are skipped automatically so you can resume interrupted runs.
                </>
              }
            />

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>
                Source ZIP Folder * <span style={{ fontWeight: 400, color: "#666" }}>(full server path)</span>
              </label>
              <Space.Compact style={{ width: "100%" }}>
                <Input
                  placeholder="/Users/.../public/pdf/form16zip/form16a/CompanyName 26Q-Q3"
                  value={zipSourceFolder}
                  onChange={(e) => setZipSourceFolder(e.target.value)}
                  size="large"
                  style={{ fontFamily: "monospace", flex: 1 }}
                />
                <Button
                  onClick={() =>
                    setZipSourceFolder(
                      "/Users/apatel/projects/projects/Taxteck/traces-app/public/pdf/form16zip/form16a/"
                    )
                  }
                >
                  Example base
                </Button>
              </Space.Compact>
              <div style={{ fontSize: 12, color: "#888", marginTop: 4 }}>
                The folder should contain one or more .zip files for the same company + period.
              </div>
            </div>

            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>Company Name *</label>
                <Space.Compact style={{ width: "100%" }}>
                  <Input
                    placeholder="Company Name (used for output folder)"
                    value={zipCompanyName}
                    onChange={(e) => setZipCompanyName(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <Select
                    placeholder="Fill from saved"
                    style={{ width: 220 }}
                    allowClear
                    onChange={(val) => {
                      if (val) fillZipFromCompany(val)
                    }}
                    options={savedCompanies.map((c) => ({ label: c.name, value: c.id }))}
                  />
                </Space.Compact>
              </div>

              <div>
                <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>
                  TAN (ZIP Password) * <span style={{ color: "#d4380d" }}>Required</span>
                </label>
                <Input.Password
                  placeholder="Company TAN (usually the password for the downloaded ZIP)"
                  value={zipTan}
                  onChange={(e) => setZipTan(e.target.value.toUpperCase())}
                />
              </div>

              <Space wrap size="large">
                <div>
                  <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>Financial Year *</label>
                  <Select
                    value={zipFinancialYear}
                    onChange={setZipFinancialYear}
                    placeholder="Select year"
                    style={{ width: 160 }}
                    options={generateFinancialYears()}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>Quarter *</label>
                  <Select
                    value={zipQuarter}
                    onChange={setZipQuarter}
                    placeholder="Select quarter"
                    style={{ width: 140 }}
                    options={quarterOptions}
                  />
                </div>

                <div>
                  <label style={{ display: "block", fontWeight: 500, marginBottom: 6 }}>Form Type *</label>
                  <Select
                    value={zipFormType}
                    onChange={setZipFormType}
                    placeholder="Select form type"
                    style={{ width: 120 }}
                    options={formTypeOptions}
                  />
                </div>
              </Space>
            </Space>

            <Checkbox
              checked={zipSkipExisting}
              onChange={(e) => setZipSkipExisting(e.target.checked)}
              style={{ marginTop: 12 }}
            >
              Skip PDFs that already exist in the output folder (resume interrupted runs)
            </Checkbox>

            <div style={{ marginTop: 20 }}>
              <Button
                type="primary"
                size="large"
                icon={<DownloadOutlined />}
                loading={zipGenerateLoading}
                onClick={handleGenerateFromZips}
                disabled={
                  !zipSourceFolder ||
                  !zipCompanyName ||
                  !zipTan ||
                  !zipFinancialYear ||
                  !zipQuarter ||
                  !zipFormType
                }
              >
                Generate PDFs from ZIP Folder
              </Button>
              <Button
                style={{ marginLeft: 12 }}
                onClick={() => {
                  setZipSourceFolder("")
                  setZipCompanyName("")
                  setZipTan("")
                  setZipFinancialYear("")
                  setZipQuarter("")
                  setZipFormType("")
                  setZipSkipExisting(true)
                  setZipGenerateResult(null)
                }}
              >
                Clear
              </Button>
            </div>

            {zipGenerateResult && (
              <div style={{ marginTop: 20, padding: 16, background: "#fafafa", borderRadius: 6 }}>
                <div style={{ fontWeight: 600, marginBottom: 8 }}>
                  {zipGenerateResult.success ? "✅ Generation completed" : "⚠️ Completed with issues"}
                </div>
                <div>ZIPs processed: <strong>{zipGenerateResult.processedZips ?? 0}</strong></div>
                <div>PDFs generated: <strong>{zipGenerateResult.generatedPdfs ?? 0}</strong></div>
                {(zipGenerateResult.skippedPdfs ?? 0) > 0 && (
                  <div>PDFs skipped (already exist): <strong>{zipGenerateResult.skippedPdfs}</strong></div>
                )}
                {zipGenerateResult.outputDir && (
                  <div>Output folder: <code>{zipGenerateResult.outputDir}</code></div>
                )}
                {zipGenerateResult.generatedExcel && (
                  <div>Excel report: <code>{zipGenerateResult.generatedExcel}</code></div>
                )}

                {zipGenerateResult.errors && zipGenerateResult.errors.length > 0 && (
                  <div style={{ marginTop: 10, color: "#c00" }}>
                    <div style={{ fontWeight: 500 }}>Errors:</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      {zipGenerateResult.errors.map((e: string, i: number) => (
                        <li key={i}>{e}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {zipGenerateResult.logs && zipGenerateResult.logs.length > 0 && (
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", color: "#1890ff" }}>Show detailed logs</summary>
                    <pre style={{ fontSize: 12, maxHeight: 220, overflow: "auto", background: "#fff", padding: 8, border: "1px solid #eee" }}>
                      {zipGenerateResult.logs.join("\n")}
                    </pre>
                  </details>
                )}
              </div>
            )}
          </Card>

          {/* Manual Email Trigger Card */}
          <Card
            title={
              <Space>
                <MailOutlined />
                <span>Manual Email Trigger</span>
              </Space>
            }
          >
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Alert
                message="Send Form 16 Emails"
                description="Manually trigger emails for Form 16/16A PDFs from the server folders. Leave fields empty to process ALL matching options (e.g., empty company = all companies)."
                type="info"
                showIcon
              />

              <div>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                  Select Company{" "}
                  <span style={{ color: "#888", fontWeight: 400 }}>
                    (Optional - Leave empty for all)
                  </span>
                </label>
                <Select
                  placeholder="Select a company or leave empty for all"
                  value={emailCompanyId}
                  onChange={setEmailCompanyId}
                  style={{ width: "100%" }}
                  showSearch
                  allowClear
                  filterOption={(input, option) => {
                    const company = savedCompanies.find((c) => c.id === option?.value)
                    if (!company) return false
                    return (
                      company.name.toLowerCase().includes(input.toLowerCase()) ||
                      company.tan.toLowerCase().includes(input.toLowerCase())
                    )
                  }}
                  options={savedCompanies.map((c) => ({
                    label: `${c.name} (${c.tan})`,
                    value: c.id,
                  }))}
                />
              </div>

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 16 }}>
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                    Financial Year{" "}
                    <span style={{ color: "#888", fontWeight: 400 }}>(Optional)</span>
                  </label>
                  <Select
                    placeholder="All years"
                    value={emailFinancialYear}
                    onChange={setEmailFinancialYear}
                    style={{ width: "100%" }}
                    allowClear
                    options={generateFinancialYears()}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                    Quarter <span style={{ color: "#888", fontWeight: 400 }}>(Optional)</span>
                  </label>
                  <Select
                    placeholder="All quarters"
                    value={emailQuarter}
                    onChange={setEmailQuarter}
                    style={{ width: "100%" }}
                    allowClear
                    options={quarterOptions}
                  />
                </div>

                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                    Form Type <span style={{ color: "#888", fontWeight: 400 }}>(Optional)</span>
                  </label>
                  <Select
                    placeholder="All form types"
                    value={emailFormType}
                    onChange={setEmailFormType}
                    style={{ width: "100%" }}
                    allowClear
                    options={formTypeOptions}
                  />
                </div>
              </div>

              <Alert
                message={
                  <div>
                    <div style={{ marginBottom: 8 }}>
                      <strong>Processing Scope:</strong>
                    </div>
                    <div style={{ fontSize: "12px" }}>
                      • Company:{" "}
                      {emailCompanyId ? (
                        savedCompanies.find((c) => c.id === emailCompanyId)?.name
                      ) : (
                        <strong style={{ color: "#1890ff" }}>ALL COMPANIES</strong>
                      )}
                    </div>
                    <div style={{ fontSize: "12px" }}>
                      • Financial Year:{" "}
                      {emailFinancialYear || (
                        <strong style={{ color: "#1890ff" }}>ALL YEARS</strong>
                      )}
                    </div>
                    <div style={{ fontSize: "12px" }}>
                      • Quarter:{" "}
                      {emailQuarter || <strong style={{ color: "#1890ff" }}>ALL QUARTERS</strong>}
                    </div>
                    <div style={{ fontSize: "12px" }}>
                      • Form Type:{" "}
                      {emailFormType || (
                        <strong style={{ color: "#1890ff" }}>ALL FORM TYPES</strong>
                      )}
                    </div>
                    {emailCompanyId && (
                      <div style={{ fontSize: "11px", marginTop: 8, color: "#666" }}>
                        Example Path: public/pdf/{form16Type}/
                        {savedCompanies.find((c) => c.id === emailCompanyId)?.name}/
                        {emailFormType || "[FormType]"}_FY{emailFinancialYear || "[Year]"}_
                        {emailQuarter || "[Quarter]"}/
                      </div>
                    )}
                  </div>
                }
                type="warning"
                showIcon
              />

              <Button
                type="primary"
                size="large"
                icon={<MailOutlined />}
                loading={emailLoading}
                onClick={handleSendEmails}
              >
                {!emailCompanyId && !emailFinancialYear && !emailQuarter && !emailFormType
                  ? "Send Emails to ALL Deductees (All Options)"
                  : "Send Emails to Deductees"}
              </Button>

              {emailResults.length > 0 && (
                <>
                  <Divider>Email Results</Divider>
                  <Table
                    size="small"
                    dataSource={emailResults}
                    rowKey={(record) => record.pan + record.pdfPath}
                    pagination={false}
                    scroll={{ y: 400 }}
                    columns={[
                      {
                        title: "PAN",
                        dataIndex: "pan",
                        key: "pan",
                        width: 120,
                      },
                      {
                        title: "PDF File",
                        dataIndex: "pdfPath",
                        key: "pdfPath",
                        render: (path: string) => path.split("\\").pop() || path.split("/").pop(),
                      },
                      {
                        title: "Status",
                        dataIndex: "success",
                        key: "status",
                        width: 100,
                        render: (success: boolean) =>
                          success ? (
                            <Tag icon={<CheckCircleOutlined />} color="success">
                              Sent
                            </Tag>
                          ) : (
                            <Tag icon={<CloseCircleOutlined />} color="error">
                              Failed
                            </Tag>
                          ),
                      },
                      {
                        title: "Error",
                        dataIndex: "error",
                        key: "error",
                        render: (error: string) => error || "-",
                      },
                    ]}
                    summary={(data) => {
                      const successCount = data.filter((d) => d.success).length
                      const failedCount = data.filter((d) => !d.success).length
                      return (
                        <Table.Summary fixed>
                          <Table.Summary.Row>
                            <Table.Summary.Cell index={0}>
                              <strong>Total: {data.length}</strong>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={1}>
                              <Tag color="green">Success: {successCount}</Tag>
                              <Tag color="red">Failed: {failedCount}</Tag>
                            </Table.Summary.Cell>
                            <Table.Summary.Cell index={2} />
                            <Table.Summary.Cell index={3} />
                          </Table.Summary.Row>
                        </Table.Summary>
                      )
                    }}
                  />
                </>
              )}
            </Space>
          </Card>

          {/* History Table */}
          {activeBatchId && (
            <Card
              title={`Batch #${activeBatchId} progress`}
              extra={
                failedProgressItems.length > 0 && batchProgress?.isComplete ? (
                  <Button
                    danger
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      setSelectedFailedTaskIds(failedProgressItems.map((i) => i.taskId))
                      setRetryModalOpen(true)
                    }}
                  >
                    Review failed ({failedProgressItems.length})
                  </Button>
                ) : null
              }
            >
              <BatchProgressPoller batchId={activeBatchId} progress={batchProgress} />
            </Card>
          )}

          <Modal
            title={
              activeBatchId
                ? `Failed tasks — Batch #${activeBatchId}`
                : "Failed tasks"
            }
            open={retryModalOpen}
            onCancel={() => setRetryModalOpen(false)}
            width={960}
            footer={
              <Space>
                <Button onClick={() => setRetryModalOpen(false)}>Close</Button>
                <Button
                  type="primary"
                  icon={<ReloadOutlined />}
                  loading={retrying}
                  disabled={selectedFailedTaskIds.length === 0}
                  onClick={() => handleRetryFailedTasks(selectedFailedTaskIds)}
                >
                  Retry selected ({selectedFailedTaskIds.length})
                </Button>
              </Space>
            }
          >
            <Alert
              type="warning"
              showIcon
              style={{ marginBottom: 16 }}
              message={`${failedProgressItems.length} task(s) failed after captcha retries. Select rows to retry.`}
            />
            <Table
              rowKey="taskId"
              size="small"
              columns={retryModalColumns}
              dataSource={failedProgressItems}
              pagination={false}
              scroll={{ y: 360 }}
              rowSelection={{
                selectedRowKeys: selectedFailedTaskIds,
                onChange: (keys) => setSelectedFailedTaskIds(keys as number[]),
              }}
            />
          </Modal>

          <UploadHistoryTable
            title="Upload History"
            records={uploadHistoryResponse?.uploadHistory || []}
            total={uploadHistoryResponse?.count || 0}
            onRefresh={() => refetch()}
            onSelectBatch={setActiveBatchId}
          />
</Space>
      </Layout>
    </ConfigProvider>
  )
}

Form16Page.authenticate = { redirectTo: "/auth/login" }
export default Form16Page
