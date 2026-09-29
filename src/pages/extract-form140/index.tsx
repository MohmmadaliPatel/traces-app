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
  Upload,
  Radio,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import type { UploadFile } from "antd/es/upload/interface"
import {
  FileTextOutlined,
  DownloadOutlined,
  CloudDownloadOutlined,
  UploadOutlined,
} from "@ant-design/icons"
import { useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import { ExportButtons } from "src/shared/ui"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"
import * as XLSX from "xlsx"
import type {
  AckFormTypeCd,
  Form140ExtractRow,
} from "src/scripts/fetchForm140Receipts"
import { parseFlexibleCompanyRows } from "src/shared/excel/companyCredentials"

const { Title, Text } = Typography

type CsvCompany = {
  name: string
  tan: string
  it_password: string
}

function ExtractForm140Page() {
  const [messageApi, contextHolder] = message.useMessage()
  const [dataSource, setDataSource] = useState<"csv" | "saved">("csv")
  const [csvCompanies, setCsvCompanies] = useState<CsvCompany[]>([])
  const [csvFileList, setCsvFileList] = useState<UploadFile[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [formTypeCd, setFormTypeCd] = useState<AckFormTypeCd>("T140")
  const [loading, setLoading] = useState(false)
  const [results, setResults] = useState<Form140ExtractRow[]>([])
  const [savedPaths, setSavedPaths] = useState<{ json?: string; xlsx?: string }>({})
  const yearLabelPrefix = formTypeCd === "T140" ? "T.Y." : "F.Y."
  const formTypeLabel = formTypeCd === "T140" ? "New (T140)" : "Old (F26Q)"

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []

  const handleCompaniesFileUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) throw new Error("No sheets found in file")
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!) as Record<
        string,
        unknown
      >[]
      const parsed = parseFlexibleCompanyRows(rows)
      const companies: CsvCompany[] = parsed.companies.map((c) => ({
        name: c.name,
        tan: c.tan,
        it_password: c.it_password,
      }))
      if (companies.length === 0) {
        throw new Error(
          "No valid rows found. Need columns: company_name, username, password (or Company Name / Tan / IT Password)"
        )
      }

      setCsvCompanies(companies)
      setCsvFileList([
        {
          uid: "-1",
          name: file.name,
          status: "done",
        },
      ])
      setDataSource("csv")
      messageApi.success(`Loaded ${companies.length} compan(y/ies) from ${file.name}`)
    } catch (e: any) {
      messageApi.error(e.message || "Failed to read companies file")
      setCsvCompanies([])
      setCsvFileList([])
    }
    return false
  }

  const companyCount =
    dataSource === "csv" ? csvCompanies.length : selectedCompanyIds.length

  const handleExtract = async () => {
    if (dataSource === "csv" && csvCompanies.length === 0) {
      messageApi.error("Please upload a companies CSV/Excel first")
      return
    }
    if (dataSource === "saved" && selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    setLoading(true)
    setResults([])
    setSavedPaths({})

    messageApi.loading({
      content: `Extracting ${formTypeLabel} acknowledgements for ${companyCount} compan(y/ies)...`,
      key: "extract-form140-batch",
      duration: 0,
    })

    try {
      const body =
        dataSource === "csv"
          ? {
              companies: csvCompanies,
              formTypeCd,
            }
          : {
              companyIds: selectedCompanyIds,
              formTypeCd,
            }

      const response = await fetch("/api/form140/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })

      const data = await response.json()
      messageApi.destroy("extract-form140-batch")

      const rows: Form140ExtractRow[] = data.rows || []
      setResults(rows)
      setSavedPaths({
        json: data.jsonPath,
        xlsx: data.xlsxPath,
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
      messageApi.destroy("extract-form140-batch")
      messageApi.error(`Error extracting acknowledgements: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<Form140ExtractRow> = [
    {
      title: "Company Name",
      dataIndex: "Company Name",
      key: "company",
      width: 220,
      sorter: (a, b) =>
        String(a["Company Name"] || "").localeCompare(String(b["Company Name"] || "")),
    },
    {
      title: "TAN",
      dataIndex: "TAN",
      key: "tan",
      width: 130,
    },
    {
      title: "Form Type",
      dataIndex: "Form Type",
      key: "formType",
      width: 100,
      render: (v: string) => <Tag>{v || formTypeCd}</Tag>,
    },
    {
      title: "Status",
      dataIndex: "Status",
      key: "status",
      width: 180,
      render: (s: string) => <Tag color="green">{s || "-"}</Tag>,
    },
    {
      title: "Acknowledgement No",
      dataIndex: "Acknowledgement No",
      key: "ack",
      width: 180,
    },
    {
      title: "RRR Number",
      dataIndex: "RRR Number",
      key: "rrr",
      width: 170,
    },
    {
      title: "PDF",
      dataIndex: "PDF",
      key: "pdf",
      width: 120,
      render: (p: string) =>
        p ? (
          <a href={p} target="_blank" rel="noreferrer">
            Download
          </a>
        ) : (
          <Text type="secondary">—</Text>
        ),
    },
    {
      title: yearLabelPrefix,
      dataIndex: "Financial Year",
      key: "fy",
      width: 90,
    },
    {
      title: "Quarter",
      dataIndex: "Quarter",
      key: "quarter",
      width: 90,
      render: (q: string) => (q ? <Tag>{q}</Tag> : null),
    },
    {
      title: "Filing Date",
      dataIndex: "Filing Date",
      key: "filingDate",
      width: 130,
    },
  ]

  const csvPreviewColumns: ColumnsType<CsvCompany> = [
    { title: "company_name", dataIndex: "name", key: "name" },
    { title: "username", dataIndex: "tan", key: "tan", width: 140 },
    {
      title: "password",
      dataIndex: "it_password",
      key: "it_password",
      width: 120,
      render: (p: string) => (p ? "••••••••" : "—"),
    },
  ]

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Extract Acknowledgements">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Card title="Extract Acknowledgement Receipts" extra={<FileTextOutlined />}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Alert
                message={`${formTypeLabel} — e-Verified acknowledgement download`}
                description={
                  formTypeCd === "T140"
                    ? "Upload companies CSV/Excel (company_name, username, password) or pick saved companies. Downloads all filings. Output: public/pdf/Acknowledgement/form140/{Company}/{FY}/{Quarter}/{ack}_receipt.pdf."
                    : "Upload companies CSV/Excel (company_name, username, password) or pick saved companies. Downloads all filings. Output: public/pdf/Acknowledgement/form26q/{Company}/{FY}/{Quarter}/{ack}_receipt.pdf."
                }
                type="info"
                showIcon
              />

              <div>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                  Form type *
                </label>
                <Radio.Group
                  value={formTypeCd}
                  onChange={(e) => {
                    setFormTypeCd(e.target.value)
                    setResults([])
                    setSavedPaths({})
                  }}
                  optionType="button"
                  buttonStyle="solid"
                >
                  <Radio.Button value="T140">New (T140)</Radio.Button>
                  <Radio.Button value="F26Q">Old (F26Q)</Radio.Button>
                </Radio.Group>
              </div>

              <div>
                <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                  Company source
                </label>
                <Radio.Group
                  value={dataSource}
                  onChange={(e) => setDataSource(e.target.value)}
                  optionType="button"
                  buttonStyle="solid"
                >
                  <Radio.Button value="csv">Upload CSV / Excel</Radio.Button>
                  <Radio.Button value="saved">Saved companies</Radio.Button>
                </Radio.Group>
              </div>

              {dataSource === "csv" ? (
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                    Companies file *
                  </label>
                  <Space wrap>
                    <Upload
                      accept=".csv,.xlsx,.xls"
                      maxCount={1}
                      fileList={csvFileList}
                      beforeUpload={handleCompaniesFileUpload}
                      onRemove={() => {
                        setCsvCompanies([])
                        setCsvFileList([])
                      }}
                    >
                      <Button icon={<UploadOutlined />}>
                        Upload companies CSV / Excel
                      </Button>
                    </Upload>
                    <Button
                      icon={<DownloadOutlined />}
                      href="/templates/acknowledgement_companies_template.csv"
                      download="acknowledgement_companies_template.csv"
                    >
                      Download CSV template
                    </Button>
                  </Space>
                  <Text type="secondary" style={{ display: "block", marginTop: 8 }}>
                    Expected: company_name, username, password
                  </Text>
                  {csvCompanies.length > 0 && (
                    <Alert
                      style={{ marginTop: 12 }}
                      type="success"
                      showIcon
                      message={`Loaded ${csvCompanies.length} compan(y/ies) from file`}
                    />
                  )}
                  {csvCompanies.length > 0 && (
                    <Table
                      style={{ marginTop: 12 }}
                      size="small"
                      columns={csvPreviewColumns}
                      dataSource={csvCompanies}
                      rowKey={(r) => r.tan}
                      pagination={{ pageSize: 10, showSizeChanger: true }}
                      scroll={{ y: 280 }}
                    />
                  )}
                </div>
              ) : (
                <div>
                  <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                    Companies *
                  </label>
                  {savedCompanies.length === 0 ? (
                    <Alert
                      message="No saved companies"
                      description="Add companies in Companies page, or switch to Upload CSV / Excel."
                      type="warning"
                      showIcon
                    />
                  ) : (
                    <>
                      <div style={{ marginBottom: 12, display: "flex", gap: 8 }}>
                        <Button
                          type="default"
                          size="small"
                          onClick={() =>
                            setSelectedCompanyIds(savedCompanies.map((c) => c.id))
                          }
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
                    </>
                  )}
                </div>
              )}

              {savedPaths.xlsx && (
                <Alert
                  message="Saved on disk"
                  description={`Excel: ${savedPaths.xlsx} · JSON: ${savedPaths.json}`}
                  type="success"
                  showIcon
                />
              )}

              <Button
                type="primary"
                size="large"
                icon={<CloudDownloadOutlined />}
                loading={loading}
                onClick={handleExtract}
                disabled={companyCount === 0}
              >
                Extract {formTypeLabel} ({companyCount})
              </Button>
            </Space>
          </Card>

          <Card
            title={
              <Title level={4} style={{ margin: 0 }}>
                Acknowledgement Records ({results.length})
              </Title>
            }
            extra={
              <Space>
                {savedPaths.xlsx && (
                  <Button icon={<DownloadOutlined />} href={savedPaths.xlsx} target="_blank">
                    Open Excel
                  </Button>
                )}
                <ExportButtons
                  feature="form140"
                  filters={{ formTypeCd }}
                  disabled={results.length === 0}
                />
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
              scroll={{ x: 1500 }}
              locale={{
                emptyText: "No acknowledgement records yet. Run Extract above.",
              }}
            />
          </Card>
        </Space>
      </Layout>
    </ConfigProvider>
  )
}

ExtractForm140Page.authenticate = { redirectTo: "/auth/login" }

export default ExtractForm140Page
