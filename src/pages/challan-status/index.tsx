import React, { useMemo, useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  message,
  Upload,
  Tag,
  Alert,
  Radio,
  Select,
  Switch,
  Typography,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  UploadOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  DownloadOutlined,
  UnorderedListOutlined,
  FilePdfOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import processExcelUpload from "src/challan/mutations/processExcelUploadChallanStatus"
import getUploadHistory from "src/companies/queries/getUploadHistory"
import getCompanies from "src/companies/queries/getCompanies"
import * as XLSX from "xlsx"
import dayjs from "dayjs"
import "dayjs/locale/en-gb"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"
import { readCompanyCredentialsFromFile } from "src/shared/ui/readCompanyCredentialsFile"
import { CompanyCredentialsUpload } from "src/shared/ui/CompanyCredentialsUpload"
import { UploadHistoryTable } from "src/shared/ui/UploadHistoryTable"

// Set dayjs locale to en-gb (starts week on Monday)
dayjs.locale("en-gb")

/** Indian FY labels newest-first, e.g. ["2026-27","2025-26"] — client-safe (no fs). */
function getLastNIndianFinancialYears(n = 2, asOf: Date = new Date()): string[] {
  const years: string[] = []
  let cursor = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate())
  for (let i = 0; i < n; i++) {
    const year = cursor.getFullYear()
    const month = cursor.getMonth()
    const fy =
      month >= 3
        ? `${year}-${String((year + 1) % 100).padStart(2, "0")}`
        : `${year - 1}-${String(year % 100).padStart(2, "0")}`
    years.push(fy)
    const startYear = parseInt(fy.slice(0, 4), 10)
    cursor = new Date(startYear, 2, 31)
  }
  return years
}

interface CompanyData {
  name: string
  tan: string
  it_password: string
  user_id: string
  password: string
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
  const [pdfLoading, setPdfLoading] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])
  const [onlyPaymentPdfNotInExcel, setOnlyPaymentPdfNotInExcel] = useState(false)
  const [selectedFinancialYears, setSelectedFinancialYears] = useState<string[]>(
    () => getLastNIndianFinancialYears(2)
  )

  // Pick companies from any Excel (column name flexible; match by name or TAN)
  const [companyPickerFileList, setCompanyPickerFileList] = useState<any[]>([])
  const [companyPickerRows, setCompanyPickerRows] = useState<Record<string, unknown>[]>([])
  const [companyPickerColumns, setCompanyPickerColumns] = useState<string[]>([])
  const [companyPickerColumn, setCompanyPickerColumn] = useState<string | undefined>()
  const [companyPickerMatchBy, setCompanyPickerMatchBy] = useState<"name" | "tan">("name")
  const [companyPickerNotFound, setCompanyPickerNotFound] = useState<string[]>([])

  const financialYearOptions = useMemo(
    () =>
      getLastNIndianFinancialYears(10).map((fy) => ({
        label: fy,
        value: fy,
      })),
    []
  )

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies: any = companiesResponse?.companies || []

  const normalizeCompanyName = (name: string) =>
    (name || "")
      .toLowerCase()
      .replace(/private limited/gi, "pvt ltd")
      .replace(/pvt\./gi, "pvt")
      .replace(/ltd\./gi, "ltd")
      .replace(/\s+/g, " ")
      .trim()

  const findSavedCompanyByName = (raw: string) => {
    const target = normalizeCompanyName(raw)
    if (!target) return null
    const exact = savedCompanies.find((c) => normalizeCompanyName(c.name) === target)
    if (exact) return exact
    return (
      savedCompanies.find((c) => {
        const n = normalizeCompanyName(c.name)
        return n.includes(target) || target.includes(n)
      }) || null
    )
  }

  const findSavedCompanyByTan = (raw: string) => {
    const tan = String(raw || "")
      .trim()
      .toUpperCase()
    if (!tan) return null
    return savedCompanies.find((c) => String(c.tan || "").toUpperCase() === tan) || null
  }

  const resetCompanyPicker = () => {
    setCompanyPickerFileList([])
    setCompanyPickerRows([])
    setCompanyPickerColumns([])
    setCompanyPickerColumn(undefined)
    setCompanyPickerMatchBy("name")
    setCompanyPickerNotFound([])
  }

  const handleCompanyPickerExcelUpload = async (file: File) => {
    try {
      const buffer = await file.arrayBuffer()
      const workbook = XLSX.read(new Uint8Array(buffer), { type: "array" })
      const sheetName = workbook.SheetNames[0]
      if (!sheetName) throw new Error("No sheets found in Excel file")
      const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName]!) as Record<
        string,
        unknown
      >[]
      if (rows.length === 0) throw new Error("Excel has no data rows")

      const cols = Object.keys(rows[0] || {})
      if (cols.length === 0) throw new Error("Excel has no columns")

      // Prefer Company Name / TAN-like columns when present
      const lower = cols.map((c) => ({ c, l: c.toLowerCase() }))
      const preferredName = lower.find(
        (x) => x.l === "company name" || x.l === "company" || x.l.includes("company name")
      )?.c
      const preferredTan = lower.find(
        (x) => x.l === "tan" || x.l === "username" || x.l === "company tan"
      )?.c

      setCompanyPickerRows(rows)
      setCompanyPickerColumns(cols)
      setCompanyPickerColumn(preferredName || preferredTan || cols[0])
      setCompanyPickerMatchBy(preferredTan && !preferredName ? "tan" : "name")
      setCompanyPickerFileList([
        {
          uid: "-1",
          name: file.name,
          status: "done",
          originFileObj: file as any,
        },
      ])
      setCompanyPickerNotFound([])
      messageApi.success(`Loaded ${rows.length} row(s), ${cols.length} column(s) from Excel`)
    } catch (e: any) {
      messageApi.error(e.message || "Failed to read Excel")
      resetCompanyPicker()
    }
    return false
  }

  const applyCompanyPickerSelection = () => {
    if (!companyPickerColumn) {
      messageApi.error("Select which Excel column to use")
      return
    }
    if (companyPickerRows.length === 0) {
      messageApi.error("Upload an Excel file first")
      return
    }

    const ids: number[] = []
    const seen = new Set<number>()
    const notFound: string[] = []

    for (const row of companyPickerRows) {
      const raw = String(row[companyPickerColumn] ?? "").trim()
      if (!raw) continue
      const company =
        companyPickerMatchBy === "tan"
          ? findSavedCompanyByTan(raw)
          : findSavedCompanyByName(raw)
      if (!company) {
        notFound.push(raw)
        continue
      }
      if (!seen.has(company.id)) {
        seen.add(company.id)
        ids.push(company.id)
      }
    }

    setSelectedCompanyIds(ids)
    setCompanyPickerNotFound(notFound)
    if (ids.length === 0) {
      messageApi.error("No matching saved companies found for the selected column")
    } else {
      messageApi.success(
        `Selected ${ids.length} company(ies)` +
          (notFound.length > 0 ? ` (${notFound.length} value(s) not matched)` : "")
      )
    }
  }

  const resolveCompanies = (): CompanyData[] | null => {
    if (dataSource === "excel") {
      if (excelData.length === 0) {
        messageApi.error("Please upload an Excel file first")
        return null
      }
      return excelData
    }
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return null
    }
    return savedCompanies
      .filter((c) => selectedCompanyIds.includes(c.id))
      .map((c) => ({
        name: c.name,
        tan: c.tan,
        it_password: c.it_password,
        user_id: c.user_id,
        password: c.password,
      }))
  }

  const queueChallanStatusJobs = async (mode: "list" | "full") => {
    const companies = resolveCompanies()
    if (!companies) return

    if (selectedFinancialYears.length === 0) {
      messageApi.error("Please select at least one financial year")
      return
    }

    setLoading(true)
    try {
      await processExcelUploadMutation({
        companies,
        financialYear: selectedFinancialYears,
        quarter: [],
        formType: [],
        actionType: "download_file",
        sendToAllPeriods: false,
        jobTypes: ["DownloadChallanStatus"],
        onlyPaymentPdfNotInExcel: mode === "full" ? onlyPaymentPdfNotInExcel : false,
        mode,
      })

      messageApi.success(
        mode === "list"
          ? "Unconsumed list jobs added to queue"
          : "Challan status download jobs added to queue successfully"
      )

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

  const handleSubmit = async () => queueChallanStatusJobs("full")
  const handleFetchUnconsumedList = async () => queueChallanStatusJobs("list")

  const handleDownloadPdfsFromUnconsumedExcel = async () => {
    if (dataSource !== "companies") {
      messageApi.error("Select companies from saved list to download PDFs from unconsumed Excel")
      return
    }
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }
    if (selectedFinancialYears.length === 0) {
      messageApi.error("Please select at least one financial year")
      return
    }

    setPdfLoading(true)
    let ok = 0
    let fail = 0
    try {
      for (const companyId of selectedCompanyIds) {
        const company = savedCompanies.find((c) => c.id === companyId)
        try {
          messageApi.loading({
            content: `Downloading PDFs from unconsumed Excel for ${company?.name || companyId}...`,
            key: `pdf-${companyId}`,
            duration: 0,
          })
          const response = await fetch("/api/challan/download-pdfs-from-unconsumed-excel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              financialYears: selectedFinancialYears,
            }),
          })
          const data = await response.json()
          if (!response.ok || data.success === false) {
            throw new Error(data.error || "Download failed")
          }
          messageApi.success({
            content: `${company?.name}: matched ${data.matchedPayments}/${data.excelRows}, missing ${data.missingPdfs}`,
            key: `pdf-${companyId}`,
          })
          ok++
        } catch (e: any) {
          fail++
          messageApi.error({
            content: `${company?.name || companyId}: ${e.message || "Failed"}`,
            key: `pdf-${companyId}`,
          })
        }
      }
      messageApi.info(`PDF download finished — success ${ok}, failed ${fail}`)
    } finally {
      setPdfLoading(false)
    }
  }



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
                  resetCompanyPicker()
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
                      description="Choose companies from your saved list, or upload any Excel (e.g. Unconsumed Challan List), pick a column, and match by Company Name or TAN."
                      type="info"
                      showIcon
                      style={{ marginBottom: 20 }}
                    />

                    <Card size="small" title="Select from Excel (any column)" style={{ marginBottom: 16 }}>
                      <Space direction="vertical" style={{ width: "100%" }} size="middle">
                        <Upload
                          accept=".xlsx,.xls"
                          maxCount={1}
                          fileList={companyPickerFileList}
                          beforeUpload={handleCompanyPickerExcelUpload}
                          onRemove={() => resetCompanyPicker()}
                        >
                          <Button icon={<UploadOutlined />}>Upload Excel</Button>
                        </Upload>

                        {companyPickerColumns.length > 0 && (
                          <>
                            <Space wrap style={{ width: "100%" }}>
                              <div style={{ minWidth: 220, flex: 1 }}>
                                <Typography.Text strong>Column to use</Typography.Text>
                                <Select
                                  style={{ width: "100%", marginTop: 4 }}
                                  value={companyPickerColumn}
                                  onChange={setCompanyPickerColumn}
                                  options={companyPickerColumns.map((c) => ({
                                    label: c,
                                    value: c,
                                  }))}
                                  placeholder="Select column"
                                />
                              </div>
                              <div style={{ minWidth: 200 }}>
                                <Typography.Text strong>Values are</Typography.Text>
                                <Radio.Group
                                  style={{ display: "block", marginTop: 8 }}
                                  value={companyPickerMatchBy}
                                  onChange={(e) => setCompanyPickerMatchBy(e.target.value)}
                                  optionType="button"
                                  buttonStyle="solid"
                                  options={[
                                    { label: "Company Name", value: "name" },
                                    { label: "TAN", value: "tan" },
                                  ]}
                                />
                              </div>
                            </Space>

                            <Button type="primary" onClick={applyCompanyPickerSelection}>
                              Apply selection from Excel ({companyPickerRows.length} rows)
                            </Button>

                            {companyPickerNotFound.length > 0 && (
                              <Alert
                                type="warning"
                                showIcon
                                message={`${companyPickerNotFound.length} value(s) not found in saved companies`}
                                description={companyPickerNotFound.slice(0, 15).join(", ") +
                                  (companyPickerNotFound.length > 15 ? "…" : "")}
                              />
                            )}
                          </>
                        )}
                      </Space>
                    </Card>

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
                          Tip: search above to add; remove from the list below
                        </span>
                      </div>

                      <Select
                        mode="multiple"
                        placeholder="Select companies to process or use 'Select All' button above"
                        value={selectedCompanyIds}
                        onChange={setSelectedCompanyIds}
                        style={{ width: "100%" }}
                        showSearch
                        maxTagCount={0}
                        maxTagPlaceholder={(omitted) => `${omitted.length} selected — edit below`}
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

                      {selectedCompanyIds.length > 0 && (
                        <div
                          style={{
                            marginTop: 12,
                            border: "1px solid #f0f0f0",
                            borderRadius: 6,
                            padding: 10,
                            background: "#fafafa",
                          }}
                        >
                          <div
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              marginBottom: 8,
                            }}
                          >
                            <Typography.Text strong>
                              {selectedCompanyIds.length} of {savedCompanies.length} selected
                            </Typography.Text>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              Click × to remove
                            </Typography.Text>
                          </div>
                          <div style={{ maxHeight: 220, overflowY: "auto" }}>
                            <Space size={[6, 6]} wrap>
                              {selectedCompanyIds.map((id) => {
                                const company = savedCompanies.find((c) => c.id === id)
                                if (!company) return null
                                return (
                                  <Tag
                                    key={id}
                                    closable
                                    onClose={(e) => {
                                      e.preventDefault()
                                      setSelectedCompanyIds((prev) =>
                                        prev.filter((companyId) => companyId !== id)
                                      )
                                    }}
                                  >
                                    {company.name} ({company.tan})
                                  </Tag>
                                )
                              })}
                            </Space>
                          </div>
                        </div>
                      )}
                    </div>
                  </>
                )}

                <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
                  <Typography.Text strong>Financial Years</Typography.Text>
                  <Select
                    mode="multiple"
                    placeholder="Select financial years"
                    value={selectedFinancialYears}
                    onChange={setSelectedFinancialYears}
                    options={financialYearOptions}
                    style={{ width: "100%" }}
                    maxTagCount="responsive"
                  />
                  <Space>
                    <Button
                      size="small"
                      onClick={() =>
                        setSelectedFinancialYears(financialYearOptions.map((y) => y.value))
                      }
                    >
                      Select All FYs
                    </Button>
                    <Button size="small" onClick={() => setSelectedFinancialYears([])}>
                      Clear FYs
                    </Button>
                  </Space>
                </Space>

                <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
                  <Space>
                    <Switch
                      checked={onlyPaymentPdfNotInExcel}
                      onChange={setOnlyPaymentPdfNotInExcel}
                    />
                    <Typography.Text>
                      Only payment PDFs not in challan status Excel (full status mode)
                    </Typography.Text>
                  </Space>
                  {onlyPaymentPdfNotInExcel && (
                    <Alert
                      type="info"
                      showIcon
                      message="Restricted mode"
                      description="Uses payment receipt PDFs only (no TDS return txt fallback). TRACES is queried only for challans not already in the status Excel file."
                    />
                  )}
                </Space>

                <Space wrap style={{ marginTop: 20 }}>
                  <Button
                    type="default"
                    size="large"
                    loading={loading}
                    onClick={handleFetchUnconsumedList}
                    disabled={selectedCompanyIds.length === 0}
                    icon={<UnorderedListOutlined />}
                  >
                    Fetch Unconsumed List
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    loading={loading}
                    onClick={handleSubmit}
                    disabled={selectedCompanyIds.length === 0}
                    icon={<DownloadOutlined />}
                  >
                    Download Challan Status
                  </Button>
                  <Button
                    size="large"
                    loading={pdfLoading}
                    onClick={handleDownloadPdfsFromUnconsumedExcel}
                    disabled={selectedCompanyIds.length === 0}
                    icon={<FilePdfOutlined />}
                  >
                    Download PDFs from Unconsumed Excel
                  </Button>
                </Space>
                <Alert
                  style={{ marginTop: 12 }}
                  type="info"
                  showIcon
                  message="Workflow"
                  description="1) Fetch Unconsumed List → writes public/pdf/unconsumed_challan_results/{Company}_unconsumed_list.xlsx for selected FYs. 2) Download PDFs from that Excel (matched by deposit date + amount). 3) Download Challan Status to reveal unconsumed amounts via View Amount."
                />
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

                <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
                  <Typography.Text strong>Financial Years</Typography.Text>
                  <Select
                    mode="multiple"
                    placeholder="Select financial years"
                    value={selectedFinancialYears}
                    onChange={setSelectedFinancialYears}
                    options={financialYearOptions}
                    style={{ width: "100%" }}
                    maxTagCount="responsive"
                  />
                </Space>

                <Space direction="vertical" style={{ width: "100%", marginTop: 16 }}>
                  <Space>
                    <Switch
                      checked={onlyPaymentPdfNotInExcel}
                      onChange={setOnlyPaymentPdfNotInExcel}
                    />
                    <Typography.Text>
                      Only payment PDFs not in challan status Excel (full status mode)
                    </Typography.Text>
                  </Space>
                  {onlyPaymentPdfNotInExcel && (
                    <Alert
                      type="info"
                      showIcon
                      message="Restricted mode"
                      description="Uses payment receipt PDFs only (no TDS return txt fallback). TRACES is queried only for challans not already in the status Excel file."
                    />
                  )}
                </Space>

                <Space wrap style={{ marginTop: 20 }}>
                  <Button
                    type="default"
                    size="large"
                    loading={loading}
                    onClick={handleFetchUnconsumedList}
                    disabled={excelData.length === 0}
                    icon={<UnorderedListOutlined />}
                  >
                    Fetch Unconsumed List
                  </Button>
                  <Button
                    type="primary"
                    size="large"
                    loading={loading}
                    onClick={handleSubmit}
                    disabled={excelData.length === 0}
                    icon={<DownloadOutlined />}
                  >
                    Download Challan Status
                  </Button>
                </Space>
              </Space>
            )}
          </Card>

          {/* History Table */}
          <UploadHistoryTable
            title="Upload History"
            records={uploadHistoryResponse?.uploadHistory || []}
            total={uploadHistoryResponse?.count || 0}
            onRefresh={() => refetch()}
          />
</Space>
      </Layout>
    </ConfigProvider>
  )
}

ChallanStatusPage.authenticate = { redirectTo: "/auth/login" }
export default ChallanStatusPage
