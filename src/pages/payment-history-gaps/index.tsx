import React, { useState, useMemo } from "react"
import { BlitzPage } from "@blitzjs/next"
import { useMutation, useQuery } from "@blitzjs/rpc"
import processExcelUploadChallanStatus from "src/companies/mutations/processExcelUploadChallanStatus"
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
  Row,
  Col,
  Statistic,
  Switch,
  Typography,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  CloudDownloadOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
} from "@ant-design/icons"
import getCompanies from "src/companies/queries/getCompanies"
import dayjs from "dayjs"

const { Title, Text } = Typography

type PaymentRow = {
  cin: string
  brnNum?: string
  assessmentYear?: string
  paymentType?: string
  amount?: number
  paymentTime?: string
  crn?: string
  pdfExists?: boolean
  expectedPdfPath?: string
  /** true/false when PDF exists and coverage audit ran; null if no PDF or unknown */
  challanStatusInExcel?: boolean | null
}

type ChallanStatusCoverage = {
  excelExists: boolean
  excelRowCount: number
  totalPdfsParsed: number
  inExcel: number
  notInExcel: number
  checkedAt?: string
}

type GapsSummary = {
  totalPayments: number
  pdfsPresent: number
  pdfsMissing: number
  companyName: string
  paymentHistoryDir: string
}

function PaymentHistoryGapsPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [selectedCompanyId, setSelectedCompanyId] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [showMissingOnly, setShowMissingOnly] = useState(true)
  const [fetchedAt, setFetchedAt] = useState<string | null>(null)
  const [summary, setSummary] = useState<GapsSummary | null>(null)
  const [rows, setRows] = useState<PaymentRow[]>([])
  const [cached, setCached] = useState(false)
  const [downloadMissingLoading, setDownloadMissingLoading] = useState(false)
  const [coverageLoading, setCoverageLoading] = useState(false)
  const [challanStatusRunLoading, setChallanStatusRunLoading] = useState(false)
  const [challanStatusCoverage, setChallanStatusCoverage] = useState<ChallanStatusCoverage | null>(
    null
  )
  const [processChallanStatusMutation] = useMutation(processExcelUploadChallanStatus)

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []

  const loadCached = async (companyId: number) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/challan/payment-history-gaps?companyId=${companyId}`)
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to load cached data")
      }
      setCached(data.cached)
      setFetchedAt(data.fetchedAt ?? null)
      setSummary(data.gaps?.summary ?? null)
      setRows(data.gaps?.all ?? data.payments ?? [])
      setChallanStatusCoverage(data.challanStatusCoverage ?? null)
      if (!data.cached) {
        messageApi.info(data.message || "No cached data yet")
      }
    } catch (e: any) {
      messageApi.error(e.message || "Failed to load data")
    } finally {
      setLoading(false)
    }
  }

  const handleFetchFromPortal = async () => {
    if (!selectedCompanyId) {
      messageApi.error("Please select a company")
      return
    }
    setLoading(true)
    try {
      const res = await fetch("/api/challan/fetch-payment-history", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to fetch from portal")
      }
      setCached(true)
      setFetchedAt(new Date().toISOString())
      setSummary(data.gaps?.summary ?? null)
      setRows(data.gaps?.all ?? data.payments ?? [])
      messageApi.success(
        `Fetched ${data.payments?.length ?? 0} payments — ${data.gaps?.summary?.pdfsMissing ?? 0} missing PDFs`
      )
    } catch (e: any) {
      messageApi.error(e.message || "Fetch failed")
    } finally {
      setLoading(false)
    }
  }

  const missingCount = useMemo(
    () => rows.filter((r) => !r.pdfExists).length,
    [rows]
  )

  const handleDownloadMissingPdfs = async () => {
    if (!selectedCompanyId) {
      messageApi.error("Please select a company")
      return
    }
    if (missingCount === 0) {
      messageApi.info("No missing PDFs to download")
      return
    }
    setDownloadMissingLoading(true)
    try {
      const res = await fetch("/api/challan/download-missing-payment-pdfs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: selectedCompanyId, incomeTaxAct: "old" }),
      })
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to download missing PDFs")
      }
      messageApi.success(
        `Downloaded ${data.result?.downloaded ?? 0} PDF(s) across ${data.result?.dateRangesProcessed ?? 0} payment date(s). Still missing: ${data.result?.stillMissing ?? 0}`
      )
      await loadCached(selectedCompanyId)
    } catch (e: any) {
      messageApi.error(e.message || "Download missing PDFs failed")
    } finally {
      setDownloadMissingLoading(false)
    }
  }

  const refreshChallanStatusCoverage = async (companyId: number) => {
    setCoverageLoading(true)
    try {
      const res = await fetch(
        `/api/challan/payment-history-gaps?companyId=${companyId}&refreshCoverage=true`
      )
      const data = await res.json()
      if (!res.ok || !data.success) {
        throw new Error(data.error || "Failed to check challan status Excel")
      }
      setChallanStatusCoverage(data.challanStatusCoverage ?? null)
      setRows(data.gaps?.all ?? data.payments ?? [])
      if (data.challanStatusCoverage) {
        const { inExcel, notInExcel, totalPdfsParsed } = data.challanStatusCoverage
        messageApi.success(
          `Challan status Excel: ${inExcel}/${totalPdfsParsed} PDFs covered${notInExcel > 0 ? `, ${notInExcel} still missing` : ""}`
        )
      }
    } catch (e: any) {
      messageApi.error(e.message || "Coverage check failed")
    } finally {
      setCoverageLoading(false)
    }
  }

  const handleCompanyChange = (id: number) => {
    setSelectedCompanyId(id)
    setSummary(null)
    setRows([])
    setFetchedAt(null)
    setCached(false)
    setChallanStatusCoverage(null)
    void loadCached(id)
  }

  const pdfsWithStatusMissing = useMemo(
    () =>
      rows.filter((r) => r.pdfExists && r.challanStatusInExcel === false).length,
    [rows]
  )

  const pdfsNotInExcelCount =
    challanStatusCoverage?.notInExcel ?? pdfsWithStatusMissing

  const handleRunChallanStatusMissingOnly = async () => {
    if (!selectedCompanyId) {
      messageApi.error("Please select a company")
      return
    }
    const company = savedCompanies.find((c) => c.id === selectedCompanyId)
    if (!company) {
      messageApi.error("Company not found")
      return
    }
    if (pdfsNotInExcelCount === 0) {
      messageApi.info("All payment PDFs are already in the challan status Excel")
      return
    }
    setChallanStatusRunLoading(true)
    try {
      await processChallanStatusMutation({
        companies: [
          {
            name: company.name,
            tan: company.tan,
            it_password: company.it_password,
            user_id: company.user_id,
            password: company.password,
          },
        ],
        financialYear: [],
        quarter: [],
        formType: [],
        actionType: "download_file",
        sendToAllPeriods: false,
        jobTypes: ["DownloadChallanStatus"],
        onlyPaymentPdfNotInExcel: true,
      })
      messageApi.success(
        `Challan status job queued for ${pdfsNotInExcelCount} payment PDF(s) not in status Excel`
      )
    } catch (e: any) {
      messageApi.error(e.message || "Failed to queue challan status job")
    } finally {
      setChallanStatusRunLoading(false)
    }
  }

  const displayRows = useMemo(() => {
    if (showMissingOnly) {
      return rows.filter((r) => !r.pdfExists)
    }
    return rows
  }, [rows, showMissingOnly])

  const columns: ColumnsType<PaymentRow> = [
    {
      title: "CIN",
      dataIndex: "cin",
      key: "cin",
      width: 180,
      fixed: "left",
    },
    {
      title: "Assessment Year",
      dataIndex: "assessmentYear",
      key: "assessmentYear",
      width: 120,
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: 120,
      render: (v: number) => (v != null ? v.toLocaleString("en-IN") : "—"),
    },
    {
      title: "Payment Time",
      dataIndex: "paymentTime",
      key: "paymentTime",
      width: 170,
    },
    {
      title: "Payment Type",
      dataIndex: "paymentType",
      key: "paymentType",
      width: 220,
      ellipsis: true,
    },
    {
      title: "Receipt PDF",
      key: "pdfExists",
      width: 110,
      render: (_: unknown, record: PaymentRow) =>
        record.pdfExists ? (
          <Tag icon={<CheckCircleOutlined />} color="success">
            Present
          </Tag>
        ) : (
          <Tag icon={<CloseCircleOutlined />} color="error">
            Missing
          </Tag>
        ),
    },
    {
      title: "In status Excel",
      key: "challanStatusInExcel",
      width: 120,
      render: (_: unknown, record: PaymentRow) => {
        if (!record.pdfExists) {
          return <Tag color="default">N/A</Tag>
        }
        if (record.challanStatusInExcel === true) {
          return (
            <Tag icon={<CheckCircleOutlined />} color="success">
              Yes
            </Tag>
          )
        }
        if (record.challanStatusInExcel === false) {
          return (
            <Tag icon={<CloseCircleOutlined />} color="warning">
              No
            </Tag>
          )
        }
        return <Tag color="default">Check</Tag>
      },
    },
    {
      title: "Expected PDF Path",
      dataIndex: "expectedPdfPath",
      key: "expectedPdfPath",
      ellipsis: true,
      render: (p: string) => <Text type="secondary" style={{ fontSize: 12 }}>{p || "—"}</Text>,
    },
  ]

  return (
    <Layout title="Payment PDF Gaps">
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Card>
          <Title level={4} style={{ marginTop: 0 }}>
            Missing Payment PDFs
          </Title>
          <Text type="secondary">
            Fetch payment history from the Income Tax portal via API, then compare CINs against
            challan receipt PDFs in PaymentHistory folders. To download missing receipts, the portal
            is filtered by payment date from each row&apos;s paymentTime field (no CIN search on
            the website).
          </Text>
        </Card>

        <Card title="Company">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Select
              placeholder="Select company"
              style={{ width: "100%", maxWidth: 480 }}
              showSearch
              value={selectedCompanyId}
              onChange={handleCompanyChange}
              filterOption={(input, option) => {
                const c = savedCompanies.find((x) => x.id === option?.value)
                if (!c) return false
                return (
                  c.name.toLowerCase().includes(input.toLowerCase()) ||
                  c.tan.toLowerCase().includes(input.toLowerCase())
                )
              }}
              options={savedCompanies.map((c) => ({
                label: `${c.name} (${c.tan})`,
                value: c.id,
              }))}
            />

            <Space wrap>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                loading={loading}
                disabled={!selectedCompanyId}
                onClick={handleFetchFromPortal}
              >
                Fetch from portal
              </Button>
              <Button
                icon={<ReloadOutlined />}
                loading={loading}
                disabled={!selectedCompanyId || downloadMissingLoading}
                onClick={() => selectedCompanyId && loadCached(selectedCompanyId)}
              >
                Reload cached
              </Button>
              <Button
                type="default"
                icon={<CloudDownloadOutlined />}
                loading={downloadMissingLoading}
                disabled={!selectedCompanyId || !cached || missingCount === 0 || loading}
                onClick={handleDownloadMissingPdfs}
              >
                Download missing PDFs ({missingCount})
              </Button>
              <Button
                loading={coverageLoading}
                disabled={!selectedCompanyId || loading || downloadMissingLoading}
                onClick={() =>
                  selectedCompanyId && refreshChallanStatusCoverage(selectedCompanyId)
                }
              >
                Check challan status Excel
              </Button>
              <Button
                type="primary"
                ghost
                loading={challanStatusRunLoading}
                disabled={
                  !selectedCompanyId ||
                  loading ||
                  downloadMissingLoading ||
                  coverageLoading ||
                  pdfsNotInExcelCount === 0
                }
                onClick={handleRunChallanStatusMissingOnly}
              >
                Run challan status ({pdfsNotInExcelCount} not in Excel)
              </Button>
              <Space>
                <Switch checked={showMissingOnly} onChange={setShowMissingOnly} />
                <Text>Show missing PDFs only</Text>
              </Space>
            </Space>

            {!cached && selectedCompanyId && (
              <Alert
                message="No cached data"
                description="Click Fetch from portal to pull payment history and detect missing PDFs."
                type="info"
                showIcon
              />
            )}
          </Space>
        </Card>

        {summary && (
          <Card title="Summary">
            <Row gutter={24}>
              <Col xs={24} sm={6}>
                <Statistic title="Total payments" value={summary.totalPayments} />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic
                  title="Receipt PDFs on disk"
                  value={summary.pdfsPresent}
                  valueStyle={{ color: "#3f8600" }}
                />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic
                  title="Missing receipt PDFs"
                  value={summary.pdfsMissing}
                  valueStyle={{ color: summary.pdfsMissing > 0 ? "#cf1322" : undefined }}
                />
              </Col>
              <Col xs={24} sm={6}>
                <Statistic
                  title="PDF not in status Excel"
                  value={
                    challanStatusCoverage != null
                      ? challanStatusCoverage.notInExcel
                      : pdfsWithStatusMissing
                  }
                  valueStyle={{
                    color:
                      (challanStatusCoverage?.notInExcel ?? pdfsWithStatusMissing) > 0
                        ? "#d48806"
                        : undefined,
                  }}
                />
              </Col>
            </Row>
            {challanStatusCoverage && (
              <Text type="secondary" style={{ display: "block", marginTop: 8, fontSize: 12 }}>
                Challan status file: {challanStatusCoverage.excelRowCount} rows —{" "}
                {challanStatusCoverage.inExcel}/{challanStatusCoverage.totalPdfsParsed} payment
                PDFs matched in Excel
                {challanStatusCoverage.checkedAt &&
                  ` (checked ${dayjs(challanStatusCoverage.checkedAt).format("DD/MM/YYYY HH:mm")})`}
              </Text>
            )}
            {challanStatusCoverage && challanStatusCoverage.notInExcel > 0 && (
              <Alert
                style={{ marginTop: 12 }}
                type="warning"
                showIcon
                message={`${challanStatusCoverage.notInExcel} payment PDF(s) are not in the challan status Excel yet`}
                description='Use "Run challan status (not in Excel)" above to queue TRACES only for payment PDFs missing from the status Excel. Challans already in Excel are skipped.'
              />
            )}
            {fetchedAt && (
              <Text type="secondary" style={{ display: "block", marginTop: 12 }}>
                Last fetched: {dayjs(fetchedAt).format("DD/MM/YYYY HH:mm")}
              </Text>
            )}
            <Text type="secondary" style={{ display: "block", marginTop: 4, fontSize: 12 }}>
              Folder: {summary.paymentHistoryDir}
            </Text>
          </Card>
        )}

        <Card
          title={`Payments (${displayRows.length}${showMissingOnly ? " missing" : " total"})`}
        >
          <Table
            columns={columns}
            dataSource={displayRows}
            rowKey="cin"
            loading={loading}
            scroll={{ x: 1100 }}
            pagination={{ pageSize: 20, showSizeChanger: true }}
            size="small"
          />
        </Card>
      </Space>
    </Layout>
  )
}

PaymentHistoryGapsPage.authenticate = { redirectTo: "/auth/login" }
export default PaymentHistoryGapsPage
