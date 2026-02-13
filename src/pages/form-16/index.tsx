import React, { useState } from "react"
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
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import processExcelUpload from "src/companies/mutations/processExcelUploadForm16"
import getUploadHistory from "src/companies/queries/getUploadHistory"
import getCompanies from "src/companies/queries/getCompanies"
import sendForm16Emails from "src/companies/mutations/sendForm16Emails"
import * as XLSX from "xlsx"
import dayjs from "dayjs"
import "dayjs/locale/en-gb"
import { ConfigProvider, Input } from "antd"
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

interface UploadHistoryRecord {
  id: number
  companyName: string
  tan: string
  status: string
  filePath: string | null
  financialYear: string
  quarter: string
  errorMessage: string | null
  createdAt: Date
  updatedAt: Date
  batchId: number | null
}

function Form16Page() {
  const [messageApi, contextHolder] = message.useMessage()
  const [processExcelUploadMutation] = useMutation(processExcelUpload)
  const [sendForm16EmailsMutation] = useMutation(sendForm16Emails)
  const [form16Type, setForm16Type] = useState<"form16" | "form16a">("form16")
  const [uploadHistoryResponse, { refetch }] = useQuery(
    getUploadHistory,
    {
      skip: 0,
      take: 100,
      type: form16Type,
      batchId: 3,
    },
    {
      // Refetch when form16Type changes
      refetchOnMount: true,
    }
  )

  const [excelData, setExcelData] = useState<CompanyData[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [dataSource, setDataSource] = useState<"excel" | "companies">("companies")
  const [actionType, setActionType] = useState<"send_request" | "download_file" | "sign_pdf">("download_file")
  const [sendToAllPeriods, setSendToAllPeriods] = useState<boolean>(false)
  const [financialYear, setFinancialYear] = useState<string[]>([])
  const [quarter, setQuarter] = useState<string[]>([])
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

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []

  // Generate financial year options
  const generateFinancialYears = (): Array<{ label: string; value: string }> => {
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

  const quarterOptions = [
    { label: "Q1 (Apr-Jun)", value: "Q1" },
    { label: "Q2 (Jul-Sep)", value: "Q2" },
    { label: "Q3 (Oct-Dec)", value: "Q3" },
    { label: "Q4 (Jan-Mar)", value: "Q4" },
  ]

  const formTypeOptions = [
    { label: "24Q", value: "24Q" },
    { label: "26Q", value: "26Q" },
    { label: "27Q", value: "27Q" },
    { label: "27EQ", value: "27EQ" },
  ]

  const handleFileUpload = async (file: File) => {
    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: "array" })
          const sheetName = workbook.SheetNames[0]
          if (!sheetName) {
            throw new Error("No sheets found in Excel file")
          }
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet!) as any[]

          console.log(jsonData)

          // Validate and transform data
          const companies: CompanyData[] = jsonData.map((row, index) => {
            if (
              !row["Company Name"] ||
              !row["Tan"] ||
              !row["IT Password"] ||
              !row["User ID"] ||
              !row["Password"]
            ) {
              throw new Error(`Missing required fields in row ${index + 1}`)
            }

            return {
              name: String(row["Company Name"]).trim(),
              tan: String(row["Tan"]).trim().toUpperCase(),
              it_password: String(row["IT Password"]).trim(),
              user_id: String(row["User ID"]).trim(),
              password: String(row["Password"]).trim(),
            }
          })

          setExcelData(companies)
          setFileList([file])
          messageApi.success(`Successfully loaded ${companies.length} companies from Excel`)
        } catch (error: any) {
          messageApi.error(error.message || "Failed to parse Excel file")
          setFileList([])
        }
      }
      reader.readAsArrayBuffer(file)
    } catch (error: any) {
      messageApi.error(error.message || "Failed to read file")
    }
    return false // Prevent automatic upload
  }

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

    // Validation for send_request action
    if (actionType === "send_request" && !sendToAllPeriods) {
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
      messageApi.error("Please enter Certificate Name")
    }

    setLoading(true)
    try {
      await processExcelUploadMutation({
        companies: companies,
        financialYear: actionType === "send_request" && !sendToAllPeriods ? financialYear : [],
        quarter: actionType === "send_request" && !sendToAllPeriods ? quarter : [],
        formType: actionType === "send_request" && !sendToAllPeriods ? formType : [],
        actionType,
        sendToAllPeriods: actionType === "send_request" ? sendToAllPeriods : false,
        jobTypes: actionType === "send_request" ? ["SendRequest"] : ["DownloadFile"], // Default job type, can be made configurable
        form16Type, // Pass the form 16 type (form16 or form16a)
        certificateName
      })

      const actionMessage =
        actionType === "send_request"
          ? sendToAllPeriods
            ? "Send request jobs for all periods added to queue successfully"
            : "Send request jobs added to queue successfully"
          : "Download jobs added to queue successfully"
      messageApi.success(actionMessage)

      setExcelData([])
      setFileList([])
      setSelectedCompanyIds([])
      setSendToAllPeriods(false)
      setFinancialYear([])
      setQuarter([])
      setFormType([])
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to process upload")
    } finally {
      setLoading(false)
    }
  }

  const getStatusTag = (status: string) => {
    switch (status) {
      case "Success":
        return (
          <Tag icon={<CheckCircleOutlined />} color="success">
            Success
          </Tag>
        )
      case "Failed":
        return (
          <Tag icon={<CloseCircleOutlined />} color="error">
            Failed
          </Tag>
        )
      case "Processing":
        return (
          <Tag icon={<SyncOutlined spin />} color="processing">
            Processing
          </Tag>
        )
      default:
        return <Tag>{status}</Tag>
    }
  }

  const columns: ColumnsType<UploadHistoryRecord> = [
    {
      title: "Company Name",
      dataIndex: "companyName",
      key: "companyName",
      width: 150,
    },
    {
      title: "TAN",
      dataIndex: "tan",
      key: "tan",
      width: 120,
    },
    {
      title: "Financial Year",
      dataIndex: "financialYear",
      key: "financialYear",
      width: 120,
    },
    {
      title: "Quarter",
      dataIndex: "quarter",
      key: "quarter",
      width: 100,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      render: (status: string) => getStatusTag(status),
      width: 120,
    },
    {
      title: "Details",
      dataIndex: "errorMessage",
      key: "details",
      render: (error: string | null) => {
        if (!error) return "-"

        // Try to parse as JSON first (new format)
        try {
          const data = JSON.parse(error)

          if (data.combinations && Array.isArray(data.combinations)) {
            // New format with combinations
            return (
              <Space direction="vertical" size="small" style={{ maxWidth: 300 }}>
                <Tag color="blue">{data.action}</Tag>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                  {data.combinations.map((combo: any, index: number) => {
                    const statusColor =
                      combo.status === "Success"
                        ? "green"
                        : combo.status === "Failed"
                        ? "red"
                        : "orange"

                    const label =
                      combo.formType !== "N/A"
                        ? `${combo.financialYear} ${combo.quarter} ${combo.formType}`
                        : `${combo.financialYear} ${combo.quarter}`

                    return combo.formType !== "N/A" ? (
                      <Tag
                        key={index}
                        color={statusColor}
                        icon={
                          combo.status === "Success" ? (
                            <CheckCircleOutlined />
                          ) : combo.status === "Failed" ? (
                            <CloseCircleOutlined />
                          ) : (
                            <SyncOutlined spin />
                          )
                        }
                        title={combo.errorMessage || combo.status}
                        style={{ marginBottom: 2 }}
                      >
                        {label}
                      </Tag>
                    ) : null
                  })}
                </div>
              </Space>
            )
          } else if (data.error) {
            // Error format
            return (
              <Space direction="vertical" size="small">
                <Tag color="blue">{data.action}</Tag>
                <Tag color="red">Error: {data.error}</Tag>
              </Space>
            )
          }
        } catch (e) {
          // Not JSON, try old format
          if (error.includes("Form Type:")) {
            const formTypeMatch = error.match(/Form Type: (\w+)/)
            const actionMatch = error.match(/Action: ([^,]+)/)

            return (
              <Space direction="vertical" size="small">
                <Tag color="blue">{actionMatch?.[1] || "N/A"}</Tag>
                {formTypeMatch && <Tag color="purple">{formTypeMatch[1]}</Tag>}
              </Space>
            )
          } else if (error.includes("Action:")) {
            const actionMatch = error.match(/Action: ([^,]+)/)
            return <Tag color="green">{actionMatch?.[1] || "Download"}</Tag>
          }
        }

        return error
      },
      width: 320,
    },
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      render: (date: Date) => dayjs(date).format("DD/MM/YYYY HH:mm"),
      width: 150,
    },
  ]

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
                <Upload
                  beforeUpload={handleFileUpload}
                  fileList={fileList}
                  onRemove={() => {
                    setFileList([])
                    setExcelData([])
                  }}
                  accept=".xlsx,.xls"
                  maxCount={1}
                >
                  <Button icon={<UploadOutlined />} size="large">
                    Select Excel File
                  </Button>
                </Upload>

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
                onChange={(e) => setForm16Type(e.target.value)}
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

            <Divider />

            <div style={{ marginBottom: 20 }}>
              <label style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}>
                Action Type *
              </label>
              <Radio.Group
                value={actionType}
                onChange={(e) => setActionType(e.target.value)}
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
                        <strong>Attach DSC</strong> - Digitally Sign PDF files
                      </span>
                    </Space>
                  </Radio>
                </Space>
              </Radio.Group>
            </div>

            {actionType === "send_request" && (
              <>
                <Divider orientation="left">Request Options</Divider>
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
                            <strong>All Periods</strong> - Send requests for all possible years,
                            quarters, and form types
                          </span>
                        </Space>
                      </Radio>
                    </Space>
                  </Radio.Group>
                </div>

                {!sendToAllPeriods && (
                  <>
                    <Divider orientation="left">Request Details</Divider>
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

            {actionType === "sign_pdf" && (
              <Input placeholder="Certificate Name..." value={certificateName} onChange={e => setCertificateName(e.target.value)} />
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
                (actionType === "send_request" &&
                  !sendToAllPeriods &&
                  (financialYear.length === 0 || quarter.length === 0 || formType.length === 0))
              }
              style={{ marginTop: 30 }}
              icon={actionType === "sign_pdf" ? <LockOutlined /> : actionType === "send_request" ? <SendOutlined /> : <DownloadOutlined />}
            >
              {actionType === "sign_pdf" ? "Attach DSC" : actionType === "send_request" ? "Send Request" : "Download Form 16 Files"}
            </Button>
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
          <Card
            title="Upload History"
            extra={
              <Button onClick={() => refetch()} icon={<SyncOutlined />}>
                Refresh
              </Button>
            }
          >
            <Table
              rowKey="id"
              columns={columns}
              dataSource={uploadHistoryResponse?.uploadHistory || []}
              pagination={{
                total: uploadHistoryResponse?.count || 0,
                pageSize: 100,
                showTotal: (total) => `Total ${total} records`,
              }}
              scroll={{ x: 1200 }}
            />
          </Card>
        </Space>
      </Layout>
    </ConfigProvider>
  )
}

Form16Page.authenticate = { redirectTo: "/auth/login" }
export default Form16Page
