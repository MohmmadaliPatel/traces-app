import React, { useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  Select,
  Tag,
  Alert,
  Input,
  Typography,
  Progress,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import { SyncOutlined, SearchOutlined } from "@ant-design/icons"
import { useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import getLdcUtilisation from "src/tldc/queries/getLdcUtilisation"
import { ExportButtons } from "src/shared/ui"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"

const { Title, Text } = Typography

type LdcUtilisationRow = {
  id: number
  companyId: number
  company: { id: number; name: string; tan: string }
  certNumber: string
  din: string
  fy: string
  pan: string
  panName: string
  section: string
  NatureOfPayment: string
  tdsRate: string
  amountLimit: number
  amountConsumed: number
  amountRemaining: number
  utilisationPct: number
  validFrom: Date
  validTo: Date
  cancelDate: Date | null
  isActive: boolean
  updatedAt: Date
}

function LdcUtilisationPage() {
  const [filterCompanyId, setFilterCompanyId] = useState<number | undefined>(undefined)
  const [filterFy, setFilterFy] = useState<string | undefined>(undefined)
  const [searchText, setSearchText] = useState("")
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(50)

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })
  const savedCompanies = companiesResponse?.companies || []

  const where: Record<string, unknown> = {}
  if (filterCompanyId) where.companyId = filterCompanyId
  if (filterFy) where.fy = filterFy

  const [{ rows, count }, { refetch, isLoading }] = useQuery(getLdcUtilisation, {
    where,
    orderBy: { updatedAt: "desc" },
    skip: (current - 1) * pageSize,
    take: pageSize,
    search: searchText || undefined,
  })

  const fyOptions = Array.from(
    new Set(
      (rows || [])
        .map((r) => r.fy)
        .concat(
          // keep selected FY visible even if page has no rows for it
          filterFy ? [filterFy] : []
        )
        .filter(Boolean)
    )
  )
    .sort()
    .reverse()
    .map((fy) => ({ label: fy, value: fy }))

  // Broader FY list from companies' common years if empty
  const defaultFyOptions =
    fyOptions.length > 0
      ? fyOptions
      : [
          "2026-27",
          "2025-26",
          "2024-25",
          "2023-24",
          "2022-23",
          "2021-22",
        ].map((fy) => ({ label: fy, value: fy }))

  const columns: ColumnsType<LdcUtilisationRow> = [
    {
      title: "Company",
      key: "company",
      width: 200,
      fixed: "left",
      render: (_, record) => (
        <div>
          <div>{record.company.name}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.company.tan}
          </Text>
        </div>
      ),
    },
    {
      title: "Certificate",
      dataIndex: "certNumber",
      key: "certNumber",
      width: 140,
    },
    {
      title: "FY",
      dataIndex: "fy",
      key: "fy",
      width: 100,
    },
    {
      title: "PAN",
      key: "pan",
      width: 180,
      render: (_, record) => (
        <div>
          <div>{record.pan}</div>
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.panName}
          </Text>
        </div>
      ),
    },
    {
      title: "Section",
      dataIndex: "section",
      key: "section",
      width: 90,
    },
    {
      title: "Rate",
      dataIndex: "tdsRate",
      key: "tdsRate",
      width: 70,
      render: (v: string) => (v ? `${v}%` : "-"),
    },
    {
      title: "Limit",
      dataIndex: "amountLimit",
      key: "amountLimit",
      width: 120,
      align: "right",
      render: (v: number) => `₹ ${v.toLocaleString("en-IN")}`,
    },
    {
      title: "Consumed",
      dataIndex: "amountConsumed",
      key: "amountConsumed",
      width: 120,
      align: "right",
      render: (v: number) => `₹ ${v.toLocaleString("en-IN")}`,
    },
    {
      title: "Remaining",
      dataIndex: "amountRemaining",
      key: "amountRemaining",
      width: 120,
      align: "right",
      render: (v: number) => (
        <span style={{ color: v <= 0 ? "#ff4d4f" : undefined }}>
          ₹ {v.toLocaleString("en-IN")}
        </span>
      ),
    },
    {
      title: "Utilisation",
      dataIndex: "utilisationPct",
      key: "utilisationPct",
      width: 160,
      render: (pct: number) => {
        const status = pct >= 100 ? "exception" : pct >= 80 ? "active" : "normal"
        return (
          <Progress
            percent={Math.min(100, Math.round(pct))}
            size="small"
            status={status}
            format={() => `${pct.toFixed(1)}%`}
          />
        )
      },
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      width: 90,
      render: (active: boolean) => (
        <Tag color={active ? "green" : "default"}>{active ? "Active" : "Inactive"}</Tag>
      ),
    },
  ]

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="LDC Utilisation">
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Title level={2} style={{ margin: 0 }}>
            LDC Utilisation
          </Title>

          <Alert
            type="info"
            showIcon
            message="Lower Deduction Certificate utilisation"
            description="Amounts are derived from TLDC certificate data (limit vs consumed). Refresh TLDC from the portal on the TLDC page to update utilisation figures."
          />

          <Card
            title={
              <Title level={4} style={{ margin: 0 }}>
                Certificate Utilisation
              </Title>
            }
            extra={
              <Space wrap>
                <Input
                  placeholder="Search cert / PAN / name"
                  prefix={<SearchOutlined />}
                  value={searchText}
                  onChange={(e) => {
                    setSearchText(e.target.value)
                    setCurrent(1)
                  }}
                  allowClear
                  style={{ width: 220 }}
                />
                <Select
                  placeholder="Company"
                  value={filterCompanyId}
                  onChange={(v) => {
                    setFilterCompanyId(v)
                    setCurrent(1)
                  }}
                  style={{ width: 220 }}
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
                <Select
                  placeholder="Financial Year"
                  value={filterFy}
                  onChange={(v) => {
                    setFilterFy(v)
                    setCurrent(1)
                  }}
                  style={{ width: 140 }}
                  allowClear
                  options={defaultFyOptions}
                />
                <ExportButtons
                  feature="ldc-utilisation"
                  filters={{
                    companyId: filterCompanyId,
                    fy: filterFy,
                    search: searchText || undefined,
                  }}
                  disabled={!rows || rows.length === 0}
                />
                <Button icon={<SyncOutlined />} onClick={() => refetch()}>
                  Refresh
                </Button>
              </Space>
            }
          >
            <Table
              columns={columns}
              dataSource={(rows as LdcUtilisationRow[]) || []}
              rowKey="id"
              loading={isLoading}
              pagination={{
                current,
                pageSize,
                total: count,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} certificates`,
                onChange: (page, size) => {
                  setCurrent(page)
                  setPageSize(size)
                },
              }}
              scroll={{ x: 1400 }}
              locale={{
                emptyText:
                  "No TLDC records found. Fetch certificates from the TLDC page first.",
              }}
            />
          </Card>
        </Space>
      </Layout>
    </ConfigProvider>
  )
}

LdcUtilisationPage.authenticate = { redirectTo: "/auth/login" }

export default LdcUtilisationPage
