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
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import processExcelUpload from "src/companies/mutations/processExcelUploadConso"
import getUploadHistory from "src/companies/queries/getUploadHistory"
import getCompanies from "src/companies/queries/getCompanies"
import * as XLSX from "xlsx"
import dayjs from "dayjs"
import "dayjs/locale/en-gb"
import { ConfigProvider } from "antd"
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

function ConsoFilesPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [processExcelUploadMutation] = useMutation(processExcelUpload)
  const [uploadHistoryResponse, { refetch }] = useQuery(getUploadHistory, {
    skip: 0,
    take: 100,
    type: "conso",
  })

  const [excelData, setExcelData] = useState<CompanyData[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [dataSource, setDataSource] = useState<"excel" | "companies">("companies")
  const [actionType, setActionType] = useState<"send_request" | "download_file">("download_file")
  const [sendToAllPeriods, setSendToAllPeriods] = useState<boolean>(false)
  const [financialYear, setFinancialYear] = useState<string[]>([])
  const [quarter, setQuarter] = useState<string[]>([])
  const [formType, setFormType] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies:any = companiesResponse?.companies || []

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

  const handleSubmit = async () => {
    let companiesToProcess: CompanyData[] = []

    if (dataSource === "excel") {
      if (excelData.length === 0) {
        messageApi.error("Please upload an Excel file first")
        return
      }
      companiesToProcess = excelData
    } else {
      if (selectedCompanyIds.length === 0) {
        messageApi.error("Please select at least one company")
        return
      }
      // Convert selected company IDs to CompanyData format
      companiesToProcess = savedCompanies
        .filter((c) => selectedCompanyIds.includes(c.id))
        .map((c) => ({
          name: c.name,
          tan: c.tan,
          it_password: c.it_password,
          user_id: c.user_id,
          password: c.password,
        }))
    }

    if (companiesToProcess.length === 0) {
      messageApi.error("No companies selected")
      return
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

    setLoading(true)
    try {
      await processExcelUploadMutation({
        companies: companiesToProcess,
        financialYear: actionType === "send_request" && !sendToAllPeriods ? financialYear : [],
        quarter: actionType === "send_request" && !sendToAllPeriods ? quarter : [],
        formType: actionType === "send_request" && !sendToAllPeriods ? formType : [],
        actionType,
        sendToAllPeriods: actionType === "send_request" ? sendToAllPeriods : false,
        jobTypes: actionType === "send_request" ? ["SendRequest"] : ["DownloadFile"], // Default job type, can be made configurable
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
      <Layout title="Conso Files Upload & Processing">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {/* Company Selection Card */}
          <Card
            title="Select Companies"
            extra={
              <Radio.Group
                value={dataSource}
                onChange={(e) => {
                  setDataSource(e.target.value)
                  setExcelData([])
                  setSelectedCompanyIds([])
                  setFileList([])
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
          </Card>


          {/* Action Configuration Card */}
          <Card title="Action Configuration">
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <div style={{ marginBottom: 20 }}>
                <label
                  style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}
                >
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
                          <strong>Download File</strong> - Download Conso files from portal
                        </span>
                      </Space>
                    </Radio>
                    <Radio value="send_request">
                      <Space>
                        <SendOutlined />
                        <span>
                          <strong>Send Request</strong> - Send Conso request to portal
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

              <Button
                type="primary"
                size="large"
                loading={loading}
                onClick={handleSubmit}
                disabled={
                  (dataSource === "excel" && excelData.length === 0) ||
                  (dataSource === "companies" && selectedCompanyIds.length === 0) ||
                  (actionType === "send_request" &&
                    !sendToAllPeriods &&
                    (financialYear.length === 0 || quarter.length === 0 || formType.length === 0))
                }
                style={{ marginTop: 30 }}
                icon={actionType === "send_request" ? <SendOutlined /> : <DownloadOutlined />}
              >
                {actionType === "send_request" ? "Send Request" : "Download Conso Files"}
              </Button>
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

ConsoFilesPage.authenticate = { redirectTo: "/auth/login" }
export default ConsoFilesPage
