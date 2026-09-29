import React, { useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  message,
  Select,
  Alert,
  Typography,
  Tag,
  InputNumber,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  FileTextOutlined,
  CloudDownloadOutlined,
} from "@ant-design/icons"
import { useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import { ExportButtons } from "src/shared/ui"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"
import type { RrrExtractRow } from "src/scripts/fetchRrrNumbers"

const { Title, Text } = Typography

function ExtractRrrPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [selectedFinancialYears, setSelectedFinancialYears] = useState<string[]>([])
  const [selectedQuarters, setSelectedQuarters] = useState<string[]>([])
  const [selectedFormTypes, setSelectedFormTypes] = useState<string[]>([])
  const [concurrency, setConcurrency] = useState(2)
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<RrrExtractRow[]>([])
  const [savedPaths, setSavedPaths] = useState<{ json?: string; csv?: string }>({})

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []

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
    { label: "Q1 (Apr-Jun)", value: "Q1" },
    { label: "Q2 (Jul-Sep)", value: "Q2" },
    { label: "Q3 (Oct-Dec)", value: "Q3" },
    { label: "Q4 (Jan-Mar)", value: "Q4" },
  ]

  const formTypeOptions = [
    { label: "Form 24Q", value: "24Q" },
    { label: "Form 26Q", value: "26Q" },
    { label: "Form 27Q", value: "27Q" },
    { label: "Form 27EQ", value: "27EQ" },
  ]

  const handleExtractRrr = async () => {
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
    setResults([])
    setSavedPaths({})

    messageApi.loading({
      content: `Extracting RRR for ${selectedCompanyIds.length} compan(y/ies) (concurrency ${concurrency})...`,
      key: "extract-rrr-batch",
      duration: 0,
    })

    try {
      const response = await fetch("/api/rrr/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyIds: selectedCompanyIds,
          formTypes: selectedFormTypes,
          financialYears: selectedFinancialYears,
          quarters: selectedQuarters,
          concurrency,
        }),
      })

      const data = await response.json()
      messageApi.destroy("extract-rrr-batch")

      const rows: RrrExtractRow[] = data.rows || []
      setResults(rows)
      setSavedPaths({
        json: data.jsonPath,
        csv: data.csvPath,
      })

      const failed = (data.results || []).filter((r: any) => !r.success)
      if (failed.length > 0) {
        for (const f of failed.slice(0, 5)) {
          messageApi.error(`${f.companyName}: ${f.error || "Failed"}`)
        }
        if (failed.length > 5) {
          messageApi.warning(`${failed.length - 5} more companies failed — check server logs`)
        }
      }

      if (rows.length > 0 || data.success) {
        messageApi.success(data.message || `Extracted ${rows.length} row(s)`)
      } else {
        messageApi.error(data.error || data.message || "Extract failed")
      }
    } catch (error: any) {
      messageApi.destroy("extract-rrr-batch")
      messageApi.error(`Error extracting RRR: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<RrrExtractRow> = [
    {
      title: "Company",
      dataIndex: "Company Name",
      key: "company",
      width: 220,
      sorter: (a, b) =>
        String(a["Company Name"] || "").localeCompare(String(b["Company Name"] || "")),
    },
    {
      title: "Financial Year",
      dataIndex: "Financial year",
      key: "fy",
      width: 120,
    },
    {
      title: "Quarter",
      dataIndex: "Quarter",
      key: "quarter",
      width: 100,
      render: (q: string) => <Tag>{q}</Tag>,
    },
    {
      title: "Form Type",
      dataIndex: "returnType",
      key: "returnType",
      width: 110,
      render: (t: string) => <Tag color="blue">{t}</Tag>,
    },
    {
      title: "Filing Type",
      dataIndex: "Filing Type",
      key: "filingType",
      width: 120,
    },
    {
      title: "Date of TDS Return",
      dataIndex: "Date of Tds return",
      key: "ackDt",
      width: 150,
    },
    {
      title: "RRR Number",
      dataIndex: "RRR number",
      key: "rrr",
      width: 180,
    },
    {
      title: "Acknowledgement Number",
      dataIndex: "Acknowledgement number",
      key: "ackNum",
      width: 180,
    },
  ]

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Extract RRR">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Card title="Extract RRR Numbers" extra={<FileTextOutlined />}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {savedCompanies.length === 0 ? (
                <Alert
                  message="No Companies Available"
                  description="Please add companies first (with IT portal password) to extract RRR numbers."
                  type="warning"
                  showIcon
                />
              ) : (
                <>
                  <Alert
                    message="Fast batch extract"
                    description="Stops paging as soon as the selected FY + quarter are found. Saves/updates public/pdf/return/rrr-extract/rrr_extract.json and rrr_extract.csv after each company. Use concurrency for 200+ companies."
                    type="info"
                    showIcon
                  />

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

                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                      Concurrency
                    </label>
                    <InputNumber
                      min={1}
                      max={4}
                      value={concurrency}
                      onChange={(v) => setConcurrency(typeof v === "number" ? v : 2)}
                      style={{ width: 120 }}
                    />
                    <Text type="secondary" style={{ marginLeft: 12 }}>
                      Max 4 (portal rate-limits). Default 2 — raise to 3–4 for large batches.
                    </Text>
                  </div>

                  {(selectedCompanyIds.length > 0 ||
                    selectedFinancialYears.length > 0 ||
                    selectedQuarters.length > 0 ||
                    selectedFormTypes.length > 0) && (
                    <Alert
                      message="Selection Summary"
                      description={`Companies: ${selectedCompanyIds.length}, Financial Years: ${selectedFinancialYears.length}, Quarters: ${selectedQuarters.length}, Form Types: ${selectedFormTypes.length}, Concurrency: ${concurrency}`}
                      type="success"
                      showIcon
                    />
                  )}

                  {savedPaths.json && (
                    <Alert
                      message="Saved on disk"
                      description={`JSON: ${savedPaths.json} · CSV: ${savedPaths.csv} (updated each run)`}
                      type="success"
                      showIcon
                    />
                  )}

                  <Button
                    type="primary"
                    size="large"
                    icon={<CloudDownloadOutlined />}
                    loading={loading}
                    onClick={handleExtractRrr}
                    disabled={
                      selectedCompanyIds.length === 0 ||
                      selectedFinancialYears.length === 0 ||
                      selectedQuarters.length === 0 ||
                      selectedFormTypes.length === 0
                    }
                  >
                    Extract RRR
                  </Button>
                </>
              )}
            </Space>
          </Card>

          <Card
            title={
              <Title level={4} style={{ margin: 0 }}>
                Extracted RRR Records ({results.length})
              </Title>
            }
            extra={
              <Space>
                {savedPaths.csv && (
                  <Button href={savedPaths.csv} target="_blank">
                    Open saved CSV
                  </Button>
                )}
                <ExportButtons feature="rrr" disabled={results.length === 0} />
              </Space>
            }
          >
            <Table
              columns={columns}
              dataSource={results}
              rowKey={(_, index) => String(index)}
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} records`,
              }}
              scroll={{ x: 1400 }}
              locale={{ emptyText: "No RRR records yet. Run Extract RRR above." }}
            />
          </Card>
        </Space>
      </Layout>
    </ConfigProvider>
  )
}

ExtractRrrPage.authenticate = { redirectTo: "/auth/login" }

export default ExtractRrrPage
