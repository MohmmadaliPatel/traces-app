import React, { useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  message,
  Select,
  Tag,
  Alert,
  Typography,
  Row,
  Col,
  Checkbox,
  Tooltip,
  Modal,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  FileTextOutlined,
  SyncOutlined,
  DownloadOutlined,
  CloudDownloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  ClockCircleOutlined,
  ExclamationCircleOutlined,
  InfoCircleOutlined,
} from "@ant-design/icons"
import { useQuery, invoke } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import getReturnStatus from "src/return-status/queries/getReturnStatus"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"

const { Title } = Typography

interface ReturnStatusType {
  id: number
  companyId: number
  company: {
    id: number
    name: string
    tan: string
  }
  finyear: string
  quarter: string
  formtype: string
  tokenno: string
  dtoffiling: string
  status: string
  dtofprcng: string
  stmnttype: string
  remarks: string | null
  reason: string | null
  rejectionMsg: string
  createdAt: Date
  updatedAt: Date
}

function ReturnStatusPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [selectedFinancialYears, setSelectedFinancialYears] = useState<string[]>([])
  const [selectedQuarters, setSelectedQuarters] = useState<string[]>([])
  const [selectedFormTypes, setSelectedFormTypes] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [filterCompanyId, setFilterCompanyId] = useState<number | undefined>(undefined)
  const [rejectionModalVisible, setRejectionModalVisible] = useState(false)
  const [selectedRejectionMsg, setSelectedRejectionMsg] = useState("")

  // Fetch companies
  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []

  // Fetch return status data
  const [{ returnStatus, count }, { refetch }] = useQuery(getReturnStatus, {
    where: filterCompanyId ? { companyId: filterCompanyId } : {},
    orderBy: { updatedAt: "desc" },
    skip: 0,
    take: 10000,
  })

  // Generate financial year options
  const generateFinancialYears = (): Array<{ label: string; value: string }> => {
    const currentYear = new Date().getFullYear()
    const years: Array<{ label: string; value: string }> = []
    for (let i = 0; i < 10; i++) {
      const year = currentYear - i
      const fy = `${year}-${(year + 1).toString().slice(-2)}`
      years.push({
        label: fy,
        value: String(year),
      })
    }
    return years
  }

  const quarterOptions = [
    { label: "Q1 (Apr-Jun)", value: "3" },
    { label: "Q2 (Jul-Sep)", value: "4" },
    { label: "Q3 (Oct-Dec)", value: "5" },
    { label: "Q4 (Jan-Mar)", value: "6" },
  ]

  const formTypeOptions = [
    { label: "Form 24Q", value: "24Q" },
    { label: "Form 26Q", value: "26Q" },
    { label: "Form 27Q", value: "27Q" },
    { label: "Form 27EQ", value: "27EQ" },
  ]

  const handleFetchReturnStatus = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    if (selectedFinancialYears.length === 0) {
      messageApi.error("Please select at least one financial year")
      return
    }

    if (selectedQuarters.length === 0) {
      messageApi.error("Please select at least one quarter")
      return
    }

    if (selectedFormTypes.length === 0) {
      messageApi.error("Please select at least one form type")
      return
    }

    setLoading(true)
    let successCount = 0
    let errorCount = 0

    for (const companyId of selectedCompanyIds) {
      try {
        const company = savedCompanies.find((c) => c.id === companyId)
        if (!company) continue

        messageApi.loading({
          content: `Fetching return status for ${company.name}...`,
          key: `fetch-${companyId}`,
          duration: 0,
        })

        const response = await fetch("/api/return-status/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: company.id,
            credentials: {
              userId: company.user_id,
              password: company.password,
              tan: company.tan,
            },
            financialYears: selectedFinancialYears,
            quarters: selectedQuarters,
            formTypes: selectedFormTypes,
          }),
        })

        const data = await response.json()
        messageApi.destroy(`fetch-${companyId}`)

        if (data.success) {
          messageApi.success(`${company.name}: ${data.message}`)
          successCount++
        } else {
          messageApi.error(`${company.name}: ${data.message}`)
          errorCount++
        }
      } catch (error: any) {
        messageApi.destroy(`fetch-${companyId}`)
        messageApi.error(`Error fetching return status: ${error.message}`)
        errorCount++
      }
    }

    setLoading(false)
    await refetch()

    if (successCount > 0) {
      messageApi.success(`Completed! Success: ${successCount}, Errors: ${errorCount}`)
    }
  }

  const handleDownloadCSV = () => {
    if (returnStatus.length === 0) {
      messageApi.warning("No data to download")
      return
    }

    const headers = [
      "Company Name",
      "TAN",
      "Financial Year",
      "Quarter",
      "Form Type",
      "Token Number",
      "Date of Filing",
      "Status",
      "Date of Processing",
      "Statement Type",
    ]

    const rows: string[][] = returnStatus.map((item: ReturnStatusType) => [
      item.company.name,
      item.company.tan,
      item.finyear,
      item.quarter,
      item.formtype,
      item.tokenno,
      item.dtoffiling,
      item.status,
      item.dtofprcng,
      item.stmnttype,
    ])

    const escapeCSV = (value: string): string => {
      if (value === null || value === undefined) return ""
      const stringValue = String(value)
      if (
        stringValue.includes(",") ||
        stringValue.includes('"') ||
        stringValue.includes("\n")
      ) {
        return `"${stringValue.replace(/"/g, '""')}"`
      }
      return stringValue
    }

    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n")

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
    const link = document.createElement("a")
    const url = URL.createObjectURL(blob)

    link.setAttribute("href", url)
    link.setAttribute(
      "download",
      `return-status-${new Date().toISOString().split("T")[0]}.csv`
    )
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    URL.revokeObjectURL(url)
    messageApi.success("CSV downloaded successfully")
  }

  const showRejectionReason = (rejectionMsg: string) => {
    setSelectedRejectionMsg(rejectionMsg)
    setRejectionModalVisible(true)
  }

  const getStatusStyle = (status: string) => {
    const statusLower = status.toLowerCase()
    
    // Rejected: white background, red font
    if (statusLower.includes("reject")) {
      return {
        color: "#ff4d4f",
        padding: "4px 12px",
        borderRadius: "4px",
        fontWeight: 500,
      }
    }
    // Processed With Defaults: red background, black font
    else if (statusLower.includes("processed with defaults")) {
      return {
        backgroundColor: "rgb(255, 155, 156)",
        color: "#000000",
        border: "1px solid rgb(255, 155, 156)",
        padding: "4px 12px",
        borderRadius: "4px",
        fontWeight: 500,
      }
    }
    // Processed Without Defaults: green background, black font
    else if (statusLower.includes("processed without defaults")) {
      return {
        backgroundColor: "#b3ff8e",
        color: "#000000",
        border: "1px solid #b3ff8e",
        padding: "4px 12px",
        borderRadius: "4px",
        fontWeight: 500,
      }
    }
    // Pending/Queue: orange background
    else if (statusLower.includes("pending") || statusLower.includes("queue")) {
      return {
        backgroundColor: "#faad14",
        color: "#000000",
        border: "1px solid #faad14",
        padding: "4px 12px",
        borderRadius: "4px",
        fontWeight: 500,
      }
    }
    // Default
    return {
      backgroundColor: "#f0f0f0",
      color: "#000000",
      border: "1px solid #d9d9d9",
      padding: "4px 12px",
      borderRadius: "4px",
      fontWeight: 500,
    }
  }

  const columns: ColumnsType<ReturnStatusType> = [
    {
      title: "Company",
      dataIndex: ["company", "name"],
      key: "company",
      width: 200,
      sorter: (a, b) => a.company.name.localeCompare(b.company.name),
    },
    {
      title: "TAN",
      dataIndex: ["company", "tan"],
      key: "tan",
      width: 120,
    },
    {
      title: "Financial Year",
      dataIndex: "finyear",
      key: "finyear",
      width: 120,
      sorter: (a, b) => a.finyear.localeCompare(b.finyear),
    },
    {
      title: "Quarter",
      dataIndex: "quarter",
      key: "quarter",
      width: 100,
      sorter: (a, b) => a.quarter.localeCompare(b.quarter),
    },
    {
      title: "Form Type",
      dataIndex: "formtype",
      key: "formtype",
      width: 100,
      render: (formtype: string) => <Tag color="blue">{formtype}</Tag>,
    },
    {
      title: "Token Number",
      dataIndex: "tokenno",
      key: "tokenno",
      width: 180,
    },
    {
      title: "Date of Filing",
      dataIndex: "dtoffiling",
      key: "dtoffiling",
      width: 120,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 250,
      render: (status: string, record: ReturnStatusType) => (
        <Space direction="vertical" size="small" style={{ width: "100%" ,alignItems: "center"}}>
          <div style={getStatusStyle(status)}>
            {status}
          </div>
          {record.rejectionMsg && (
            <Button
              type="link"
              size="small"
              icon={<InfoCircleOutlined />}
              onClick={() => showRejectionReason(record.rejectionMsg)}
              style={{ padding: 0 }}
            >
              View Rejection Reason
            </Button>
          )}
        </Space>
      ),
    },
    {
      title: "Status As On Date",
      dataIndex: "dtofprcng",
      key: "dtofprcng",
      width: 140,
    },
    {
      title: "Statement Type",
      dataIndex: "stmnttype",
      key: "stmnttype",
      width: 120,
      render: (type: string) => <Tag>{type}</Tag>,
    },
  ]

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Return Status">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {/* Fetch Return Status Card */}
          <Card title="Fetch Return Status" extra={<FileTextOutlined />}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {savedCompanies.length === 0 ? (
                <Alert
                  message="No Companies Available"
                  description="Please add companies first to fetch return status data."
                  type="warning"
                  showIcon
                />
              ) : (
                <>
                  <Alert
                    message="Select Parameters"
                    description="Choose companies, financial years, quarters, and form types to fetch return status from TRACES portal."
                    type="info"
                    showIcon
                  />

                  {/* Company Selection */}
                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                      Companies *
                    </label>
                    <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedCompanyIds(savedCompanies.map((c) => c.id))}
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
                    </div>
                    <Select
                      mode="multiple"
                      placeholder="Select companies"
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

                  {/* Financial Year Selection */}
                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                      Financial Years *
                    </label>
                    <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                      <Button
                        type="default"
                        size="small"
                        onClick={() =>
                          setSelectedFinancialYears(generateFinancialYears().map((y) => y.value))
                        }
                      >
                        Select All
                      </Button>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedFinancialYears([])}
                        disabled={selectedFinancialYears.length === 0}
                      >
                        Clear All
                      </Button>
                    </div>
                    <Select
                      mode="multiple"
                      placeholder="Select financial years"
                      value={selectedFinancialYears}
                      onChange={setSelectedFinancialYears}
                      style={{ width: "100%" }}
                      maxTagCount="responsive"
                      options={generateFinancialYears()}
                    />
                  </div>

                  {/* Quarter Selection */}
                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                      Quarters *
                    </label>
                    <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedQuarters(quarterOptions.map((q) => q.value))}
                      >
                        Select All
                      </Button>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedQuarters([])}
                        disabled={selectedQuarters.length === 0}
                      >
                        Clear All
                      </Button>
                    </div>
                    <Select
                      mode="multiple"
                      placeholder="Select quarters"
                      value={selectedQuarters}
                      onChange={setSelectedQuarters}
                      style={{ width: "100%" }}
                      maxTagCount="responsive"
                      options={quarterOptions}
                    />
                  </div>

                  {/* Form Type Selection */}
                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                      Form Types *
                    </label>
                    <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedFormTypes(formTypeOptions.map((f) => f.value))}
                      >
                        Select All
                      </Button>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedFormTypes([])}
                        disabled={selectedFormTypes.length === 0}
                      >
                        Clear All
                      </Button>
                    </div>
                    <Select
                      mode="multiple"
                      placeholder="Select form types"
                      value={selectedFormTypes}
                      onChange={setSelectedFormTypes}
                      style={{ width: "100%" }}
                      maxTagCount="responsive"
                      options={formTypeOptions}
                    />
                  </div>

                  {/* Selection Summary */}
                  {(selectedCompanyIds.length > 0 ||
                    selectedFinancialYears.length > 0 ||
                    selectedQuarters.length > 0 ||
                    selectedFormTypes.length > 0) && (
                    <Alert
                      message="Selection Summary"
                      description={`Companies: ${selectedCompanyIds.length}, Financial Years: ${selectedFinancialYears.length}, Quarters: ${selectedQuarters.length}, Form Types: ${selectedFormTypes.length} | Total combinations: ${selectedCompanyIds.length * selectedFinancialYears.length * selectedQuarters.length * selectedFormTypes.length}`}
                      type="success"
                      showIcon
                    />
                  )}

                  <Button
                    type="primary"
                    size="large"
                    icon={<CloudDownloadOutlined />}
                    loading={loading}
                    onClick={handleFetchReturnStatus}
                    disabled={
                      selectedCompanyIds.length === 0 ||
                      selectedFinancialYears.length === 0 ||
                      selectedQuarters.length === 0 ||
                      selectedFormTypes.length === 0
                    }
                  >
                    Fetch Return Status
                  </Button>
                </>
              )}
            </Space>
          </Card>

          {/* Return Status Table */}
          <Card
            title={
              <Title level={4} style={{ margin: 0 }}>
                Return Status Records
              </Title>
            }
            extra={
              <Space>
                <Select
                  placeholder="Filter by Company"
                  value={filterCompanyId}
                  onChange={setFilterCompanyId}
                  style={{ width: 200 }}
                  allowClear
                  showSearch
                  filterOption={(input, option) => {
                    const company = savedCompanies.find((c) => c.id === option?.value)
                    if (!company) return false
                    return company.name.toLowerCase().includes(input.toLowerCase())
                  }}
                  options={savedCompanies.map((c) => ({
                    label: c.name,
                    value: c.id,
                  }))}
                />
                <Button icon={<DownloadOutlined />} onClick={handleDownloadCSV}>
                  Download CSV
                </Button>
                <Button onClick={() => refetch()} icon={<SyncOutlined />}>
                  Refresh
                </Button>
              </Space>
            }
          >
            <Table
              columns={columns}
              dataSource={returnStatus}
              rowKey="id"
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} records`,
              }}
              scroll={{ x: 1600 }}
            />
          </Card>
        </Space>

        {/* Rejection Reason Modal */}
        <Modal
          title={
            <Space>
              <ExclamationCircleOutlined style={{ color: "#ff4d4f" }} />
              Rejection Reason
            </Space>
          }
          open={rejectionModalVisible}
          onOk={() => setRejectionModalVisible(false)}
          onCancel={() => setRejectionModalVisible(false)}
          width={600}
          footer={[
            <Button key="close" type="primary" onClick={() => setRejectionModalVisible(false)}>
              Close
            </Button>,
          ]}
        >
          <div
            style={{
              padding: "16px",
              backgroundColor: "#fff2f0",
              border: "1px solid #ffccc7",
              borderRadius: "4px",
            }}
            dangerouslySetInnerHTML={{ __html: selectedRejectionMsg }}
          />
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

ReturnStatusPage.authenticate = { redirectTo: "/auth/login" }

export default ReturnStatusPage
