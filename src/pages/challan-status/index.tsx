import React, { useState } from "react"
import { Button, Table, Card, Space, message, Upload, Tag, Alert, Radio, Select } from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  UploadOutlined,
  FileExcelOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  DownloadOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import processExcelUpload from "src/companies/mutations/processExcelUploadChallanStatus"
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

function ChallanStatusPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [processExcelUploadMutation] = useMutation(processExcelUpload)
  const [uploadHistoryResponse, { refetch }] = useQuery(getUploadHistory, {
    skip: 0,
    take: 100,
    type: "challan_status",
  })

  const [excelData, setExcelData] = useState<CompanyData[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [dataSource, setDataSource] = useState<"excel" | "companies">("companies")
  const [loading, setLoading] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies:any = companiesResponse?.companies || []

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

    setLoading(true)
    try {
      await processExcelUploadMutation({
        companies: companies,
        financialYear: [],
        quarter: [],
        formType: [],
        actionType: "download_file",
        sendToAllPeriods: false,
        jobTypes: ["DownloadChallanStatus"],
      })

      messageApi.success("Challan status download jobs added to queue successfully")

      setExcelData([])
      setFileList([])
      setSelectedCompanyIds([])
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
          // If it has action and challanDetailsCount, display both
          if (
            data.action &&
            typeof data.challanDetailsCount === "number" &&
            !data.error &&
            !data.combinations
          ) {
            return (
              <Space size="small">
                <Tag color="blue">{data.action}</Tag>
                {/* <Tag color="green">{data.challanDetailsCount} Challans</Tag> */}
              </Space>
            )
          }

          // If it's exactly { action: ... } without combinations or error, display action info cleanly
          if (Object.keys(data).length === 1 && typeof data.action === "string") {
            return <Tag color="blue">{data.action}</Tag>
          }

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

                    return (
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
                    )
                  })}
                </div>
              </Space>
            )
          } else if (typeof data.error === "string") {
            // Error format - show error with challan count if available
            return (
              <Space direction="vertical" size="small">
                <Tag color="blue">{data.action}</Tag>
                {typeof data.challanDetailsCount === "number" && (
                  <Tag color="orange">{data.challanDetailsCount} Challans Found</Tag>
                )}
                <Tag color="red">Error</Tag>
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
      <Layout title="Challan Status Download">
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

                <Button
                  type="primary"
                  size="large"
                  loading={loading}
                  onClick={handleSubmit}
                  disabled={selectedCompanyIds.length === 0}
                  style={{ marginTop: 20 }}
                  icon={<DownloadOutlined />}
                >
                  Download Challan Status
                </Button>
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

                <Button
                  type="primary"
                  size="large"
                  loading={loading}
                  onClick={handleSubmit}
                  disabled={excelData.length === 0}
                  style={{ marginTop: 20 }}
                  icon={<DownloadOutlined />}
                >
                  Download Challan Status
                </Button>
              </Space>
            )}
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

ChallanStatusPage.authenticate = { redirectTo: "/auth/login" }
export default ChallanStatusPage
