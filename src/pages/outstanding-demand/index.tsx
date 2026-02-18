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
  Statistic,
  Row,
  Col,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  DollarOutlined,
  SyncOutlined,
  DownloadOutlined,
  CloudDownloadOutlined,
} from "@ant-design/icons"
import { useQuery, invoke } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import getOutstandingDemand from "src/outstanding-demand/queries/getOutstandingDemand"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"

const { Title } = Typography

interface OutstandingDemandType {
  id: number
  companyId: number
  company: {
    id: number
    name: string
    tan: string
  }
  finYr: string
  fin: string
  aodmnd: string
  cpcdmd: string
  createdAt: Date
  updatedAt: Date
}

interface CompanySummary {
  companyId: number
  companyName: string
  tan: string
  totalAodmnd: number
  totalCpcdmd: number
  totalDemand: number
  demands: OutstandingDemandType[]
}

function OutstandingDemandPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [loading, setLoading] = useState(false)
  const [expandedRowKeys, setExpandedRowKeys] = useState<number[]>([])

  // Fetch companies
  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []

  // Fetch outstanding demand data
  const [{ outstandingDemand }, { refetch }] = useQuery(getOutstandingDemand, {
    where: {},
    orderBy: { finYr: "desc" },
    skip: 0,
    take: 10000,
  })

  // Group demands by company
  const companySummaries: CompanySummary[] = React.useMemo(() => {
    const grouped = new Map<number, CompanySummary>()

    outstandingDemand.forEach((demand: OutstandingDemandType) => {
      if (!grouped.has(demand.companyId)) {
        grouped.set(demand.companyId, {
          companyId: demand.companyId,
          companyName: demand.company.name,
          tan: demand.company.tan,
          totalAodmnd: 0,
          totalCpcdmd: 0,
          totalDemand: 0,
          demands: [],
        })
      }

      const summary = grouped.get(demand.companyId)!
      summary.demands.push(demand)
      summary.totalAodmnd += parseFloat(demand.aodmnd) || 0
      summary.totalCpcdmd += parseFloat(demand.cpcdmd) || 0
      summary.totalDemand += (parseFloat(demand.aodmnd) || 0) + (parseFloat(demand.cpcdmd) || 0)
    })

    return Array.from(grouped.values())
  }, [outstandingDemand])

  const handleFetchDemand = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
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
          content: `Fetching demand for ${company.name}...`,
          key: `fetch-${companyId}`,
          duration: 0,
        })

        const response = await fetch("/api/outstanding-demand/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId: company.id,
            credentials: {
              userId: company.user_id,
              password: company.password,
              tan: company.tan,
            },
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
        messageApi.error(`Error fetching demand: ${error.message}`)
        errorCount++
      }
    }

    setLoading(false)
    await refetch()

    if (successCount > 0) {
      messageApi.success(
        `Completed! Success: ${successCount}, Errors: ${errorCount}`
      )
    }
  }

  const handleDownloadCSV = () => {
    if (companySummaries.length === 0) {
      messageApi.warning("No data to download")
      return
    }

    const headers = [
      "Company Name",
      "TAN",
      "Financial Year",
      "Assessment Order Demand",
      "CPC Demand",
      "Total Demand",
    ]

    const rows: string[][] = []
    companySummaries.forEach((summary) => {
      summary.demands.forEach((demand) => {
        rows.push([
          summary.companyName,
          summary.tan,
          demand.finYr,
          demand.aodmnd,
          demand.cpcdmd,
          (parseFloat(demand.aodmnd) + parseFloat(demand.cpcdmd)).toFixed(2),
        ])
      })
    })

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
      `outstanding-demand-${new Date().toISOString().split("T")[0]}.csv`
    )
    link.style.visibility = "hidden"
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    URL.revokeObjectURL(url)
    messageApi.success("CSV downloaded successfully")
  }

  // Expandable row columns
  const expandedRowColumns: ColumnsType<OutstandingDemandType> = [
    {
      title: "Financial Year",
      dataIndex: "finYr",
      key: "finYr",
      width: 150,
    },
    {
      title: "Assessment Order Demand",
      dataIndex: "aodmnd",
      key: "aodmnd",
      width: 200,
      render: (value: string) => (
        <span style={{ fontWeight: 500 }}>₹ {parseFloat(value).toLocaleString("en-IN")}</span>
      ),
    },
    {
      title: "CPC Demand",
      dataIndex: "cpcdmd",
      key: "cpcdmd",
      width: 200,
      render: (value: string) => (
        <span style={{ fontWeight: 500 }}>₹ {parseFloat(value).toLocaleString("en-IN")}</span>
      ),
    },
    {
      title: "Total",
      key: "total",
      width: 200,
      render: (_, record) => {
        const total = parseFloat(record.aodmnd) + parseFloat(record.cpcdmd)
        return (
          <span style={{ fontWeight: 600, color: total > 0 ? "#ff4d4f" : "#52c41a" }}>
            ₹ {total.toLocaleString("en-IN")}
          </span>
        )
      },
    },
  ]

  // Main table columns
  const columns: ColumnsType<CompanySummary> = [
    {
      title: "Company Name",
      dataIndex: "companyName",
      key: "companyName",
      width: 250,
      sorter: (a, b) => a.companyName.localeCompare(b.companyName),
    },
    {
      title: "TAN",
      dataIndex: "tan",
      key: "tan",
      width: 150,
    },
    {
      title: "Total Assessment Order Demand",
      dataIndex: "totalAodmnd",
      key: "totalAodmnd",
      width: 200,
      render: (value: number) => (
        <Statistic
          value={value}
          precision={2}
          prefix="₹"
          valueStyle={{ fontSize: 14 }}
        />
      ),
      sorter: (a, b) => a.totalAodmnd - b.totalAodmnd,
    },
    {
      title: "Total CPC Demand",
      dataIndex: "totalCpcdmd",
      key: "totalCpcdmd",
      width: 200,
      render: (value: number) => (
        <Statistic
          value={value}
          precision={2}
          prefix="₹"
          valueStyle={{ fontSize: 14 }}
        />
      ),
      sorter: (a, b) => a.totalCpcdmd - b.totalCpcdmd,
    },
    {
      title: "Total Outstanding Demand",
      dataIndex: "totalDemand",
      key: "totalDemand",
      width: 200,
      render: (value: number) => (
        <Statistic
          value={value}
          precision={2}
          prefix="₹"
          valueStyle={{
            fontSize: 14,
            fontWeight: 600,
            color: value > 0 ? "#ff4d4f" : "#52c41a",
          }}
        />
      ),
      sorter: (a, b) => a.totalDemand - b.totalDemand,
    },
    {
      title: "Years",
      key: "years",
      width: 100,
      render: (_, record) => <Tag color="blue">{record.demands.length} Years</Tag>,
    },
  ]

  const expandedRowRender = (record: CompanySummary) => {
    return (
      <Table
        columns={expandedRowColumns}
        dataSource={record.demands}
        pagination={false}
        rowKey="id"
        size="small"
      />
    )
  }

  // Calculate overall totals
  const overallTotals = React.useMemo(() => {
    return companySummaries.reduce(
      (acc, summary) => ({
        totalAodmnd: acc.totalAodmnd + summary.totalAodmnd,
        totalCpcdmd: acc.totalCpcdmd + summary.totalCpcdmd,
        totalDemand: acc.totalDemand + summary.totalDemand,
      }),
      { totalAodmnd: 0, totalCpcdmd: 0, totalDemand: 0 }
    )
  }, [companySummaries])

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Outstanding Demand">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {/* Fetch Demand Card */}
          <Card title="Fetch Outstanding Demand" extra={<DollarOutlined />}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {savedCompanies.length === 0 ? (
                <Alert
                  message="No Companies Available"
                  description="Please add companies first to fetch outstanding demand data."
                  type="warning"
                  showIcon
                />
              ) : (
                <>
                  <Alert
                    message="Select Companies"
                    description="Choose companies to fetch their outstanding demand data from TRACES portal."
                    type="info"
                    showIcon
                  />

                  <div>
                    <div
                      style={{
                        marginBottom: 12,
                        display: "flex",
                        gap: 8,
                        alignItems: "center",
                      }}
                    >
                      <Button
                        type="default"
                        size="small"
                        onClick={() =>
                          setSelectedCompanyIds(savedCompanies.map((c) => c.id))
                        }
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
                    </div>

                    <Select
                      mode="multiple"
                      placeholder="Select companies to fetch outstanding demand"
                      value={selectedCompanyIds}
                      onChange={setSelectedCompanyIds}
                      style={{ width: "100%", marginBottom: 16 }}
                      showSearch
                      maxTagCount="responsive"
                      filterOption={(input, option) => {
                        const company = savedCompanies.find(
                          (c) => c.id === option?.value
                        )
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

                  <Button
                    type="primary"
                    size="large"
                    icon={<CloudDownloadOutlined />}
                    loading={loading}
                    onClick={handleFetchDemand}
                    disabled={selectedCompanyIds.length === 0}
                  >
                    Fetch Outstanding Demand
                  </Button>
                </>
              )}
            </Space>
          </Card>

          {/* Summary Statistics */}
          {companySummaries.length > 0 && (
            <Card>
              <Row gutter={16}>
                <Col span={8}>
                  <Statistic
                    title="Total Assessment Order Demand"
                    value={overallTotals.totalAodmnd}
                    precision={2}
                    prefix="₹"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Total CPC Demand"
                    value={overallTotals.totalCpcdmd}
                    precision={2}
                    prefix="₹"
                  />
                </Col>
                <Col span={8}>
                  <Statistic
                    title="Total Outstanding Demand"
                    value={overallTotals.totalDemand}
                    precision={2}
                    prefix="₹"
                    valueStyle={{
                      color: overallTotals.totalDemand > 0 ? "#ff4d4f" : "#52c41a",
                    }}
                  />
                </Col>
              </Row>
            </Card>
          )}

          {/* Outstanding Demand Table */}
          <Card
            title={
              <Title level={4} style={{ margin: 0 }}>
                Outstanding Demand by Company
              </Title>
            }
            extra={
              <Space>
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
              dataSource={companySummaries}
              rowKey="companyId"
              expandable={{
                expandedRowRender,
                expandedRowKeys,
                onExpandedRowsChange: (keys) => setExpandedRowKeys(keys as number[]),
              }}
              pagination={{
                pageSize: 20,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} companies`,
              }}
              scroll={{ x: 1200 }}
            />
          </Card>
        </Space>
      </Layout>
    </ConfigProvider>
  )
}

OutstandingDemandPage.authenticate = { redirectTo: "/auth/login" }

export default OutstandingDemandPage
