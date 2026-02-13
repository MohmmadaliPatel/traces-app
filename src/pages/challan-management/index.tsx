import { Suspense, useState } from "react"
import { BlitzPage, Routes } from "@blitzjs/next"
import { useMutation, useQuery } from "@blitzjs/rpc"
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
  Form,
  Input,
  DatePicker,
  Row,
  Col,
  Modal,
  Typography,
  Upload,
} from "antd"
import {
  CloudDownloadOutlined,
  PlusOutlined,
  FileAddOutlined,
  DeleteOutlined,
  ReloadOutlined,
  CheckCircleOutlined,
  UploadOutlined,
} from "@ant-design/icons"
import getCompanies from "src/companies/queries/getCompanies"
import getChallanData from "src/challan/queries/getChallanData"
import upsertChallanData from "src/challan/mutations/upsertChallanData"
import deleteChallanData from "src/challan/mutations/deleteChallanData"
import { secCodes } from "src/challan/utils/secCodes"
import dayjs from "dayjs"

const { Option } = Select
const { Title } = Typography
const { RangePicker } = DatePicker

interface ChallanDataType {
  id: number
  companyId: number
  assessmentYear: string
  sectionCode: string
  sectionDesc: string
  amount: string
  pymntRefNum?: string
  status: string
  filePath?: string
  createdAt: Date
  updatedAt: Date
  company: {
    id: number
    name: string
    tan: string
    user_id: string
  }
}

const ChallanManagementPage: BlitzPage = () => {
  const [messageApi, contextHolder] = message.useMessage()
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [assessmentYear, setAssessmentYear] = useState<string>("")
  const [selectedSections, setSelectedSections] = useState<
    Array<{ sectionCode: string; amount: string }>
  >([])
  const [createLoading, setCreateLoading] = useState(false)
  const [downloadLoading, setDownloadLoading] = useState(false)
  const [downloadPaymentLoading, setDownloadPaymentLoading] = useState(false)
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingRecord, setEditingRecord] = useState<ChallanDataType | null>(null)
  const [form] = Form.useForm()
  const [paymentDateRange, setPaymentDateRange] = useState<[string, string] | null>(null)
  const [paymentAssessmentYear, setPaymentAssessmentYear] = useState<string>("")
  const [paymentType, setPaymentType] = useState<string>("")
  const [csvProcessing, setCsvProcessing] = useState(false)
  const [csvProgress, setCsvProgress] = useState<{
    current: number
    total: number
    currentCompany: string
    status: string
  } | null>(null)
  const [csvFileList, setCsvFileList] = useState<any[]>([])

  // Fetch companies
  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })
  const savedCompanies: any = companiesResponse?.companies || []

  // Fetch challan data
  const buildWhereClause = () => {
    const where: any = {}
    if (selectedCompanyIds.length > 0) {
      where.companyId = { in: selectedCompanyIds }
    }
    return where
  }

  const [{ challanData, count }, { refetch }] = useQuery(
    getChallanData,
    {
      where: buildWhereClause(),
      orderBy: { updatedAt: "desc" },
      skip: 0,
      take: 1000,
    },
    {
      refetchOnWindowFocus: false,
    }
  )

  const [upsertChallanDataMutation] = useMutation(upsertChallanData)
  const [deleteChallanDataMutation] = useMutation(deleteChallanData)

  const handleSelectAll = () => {
    setSelectedCompanyIds(savedCompanies.map((c) => c.id))
  }

  const handleClearAll = () => {
    setSelectedCompanyIds([])
  }

  const handleAddSection = () => {
    setSelectedSections([...selectedSections, { sectionCode: "", amount: "" }])
  }

  const handleRemoveSection = (index: number) => {
    setSelectedSections(selectedSections.filter((_, i) => i !== index))
  }

  const handleSectionChange = (index: number, field: "sectionCode" | "amount", value: string) => {
    const newSections = [...selectedSections]
    const section = newSections[index]
    if (section) {
      section[field] = value
      setSelectedSections(newSections)
    }
  }

  const handleCreateChallans = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    if (!assessmentYear) {
      messageApi.error("Please enter assessment year")
      return
    }

    if (selectedSections.length === 0) {
      messageApi.error("Please add at least one section")
      return
    }

    const validSections = selectedSections.filter((s) => s.sectionCode && s.amount)
    if (validSections.length === 0) {
      messageApi.error("Please fill in all section details")
      return
    }

    setCreateLoading(true)
    try {
      for (const companyId of selectedCompanyIds) {
        const response = await fetch("/api/challan/create", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            assessmentYear,
            sections: validSections,
          }),
        })

        const data = await response.json()
        if (data.success) {
          messageApi.success(`Challans created for company ${companyId}`)
        } else {
          messageApi.error(`Failed to create challans for company ${companyId}`)
        }
      }

      await refetch()
      setSelectedSections([])
    } catch (error: any) {
      messageApi.error(error.message || "Failed to create challans")
    } finally {
      setCreateLoading(false)
    }
  }

  const handleDownloadChallans = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    setDownloadLoading(true)
    try {
      for (const companyId of selectedCompanyIds) {
        const response = await fetch("/api/challan/download", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ companyId }),
        })

        const data = await response.json()
        if (data.success) {
          messageApi.success(`Challans downloaded for company ${companyId}`)
        } else {
          messageApi.error(`Failed to download challans for company ${companyId}`)
        }
      }
    } catch (error: any) {
      messageApi.error(error.message || "Failed to download challans")
    } finally {
      setDownloadLoading(false)
    }
  }

  const handleDownloadPayments = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    setDownloadPaymentLoading(true)
    try {
      for (const companyId of selectedCompanyIds) {
        const response = await fetch("/api/challan/download-payment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            companyId,
            fromDate: paymentDateRange?.[0],
            toDate: paymentDateRange?.[1],
            assessmentYear: paymentAssessmentYear || undefined,
            paymentType: paymentType || undefined,
          }),
        })

        const data = await response.json()
        if (data.success) {
          messageApi.success(`Challan payments downloaded for company ${companyId}`)
        } else {
          messageApi.error(`Failed to download challan payments for company ${companyId}`)
        }
      }
    } catch (error: any) {
      messageApi.error(error.message || "Failed to download challan payments")
    } finally {
      setDownloadPaymentLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteChallanDataMutation({ id })
      messageApi.success("Challan data deleted successfully")
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to delete challan data")
    }
  }

  const parseCsvFile = (file: File): Promise<any[]> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = (e) => {
        const text = e.target?.result as string
        const lines = text.split("\n").filter((line) => line.trim())
        if (lines.length < 2) {
          reject(new Error("CSV file is empty or invalid"))
          return
        }

        const headerLine = lines[0]
        if (!headerLine) {
          reject(new Error("CSV file has no headers"))
          return
        }

        const headers = headerLine.split(",").map((h) => h.trim())
        const data = lines.slice(1).map((line) => {
          const values = line.split(",").map((v) => v.trim())
          const row: any = {}
          headers.forEach((header, index) => {
            row[header] = values[index] || ""
          })
          return row
        })

        resolve(data.filter((row) => row["Company Name"])) // Filter out empty rows
      }
      reader.onerror = () => reject(new Error("Failed to read file"))
      reader.readAsText(file)
    })
  }

  const handleCsvUpload = async (file: File) => {
    if (!file.name.endsWith(".csv")) {
      messageApi.error("Please upload a CSV file")
      setCsvFileList([])
      return false
    }

    try {
      setCsvProcessing(true)
      const csvData = await parseCsvFile(file)

      if (csvData.length === 0) {
        messageApi.error("No valid data found in CSV")
        return
      }

      // Process companies sequentially
      for (let i = 0; i < csvData.length; i++) {
        const row = csvData[i]
        const companyName = row["Company Name"]

        setCsvProgress({
          current: i + 1,
          total: csvData.length,
          currentCompany: companyName,
          status: "Processing...",
        })

        try {
          // Find company by TAN
          const company = savedCompanies.find((c) => c.tan === row["Username"])
          if (!company) {
            messageApi.warning(`Company ${companyName} not found in system, skipping...`)
            continue
          }

          // Extract sections with amounts
          const sections: Array<{ sectionCode: string; amount: string }> = []
          const sectionHeaders = Object.keys(row).filter(
            (key) =>
              !["Company Code", "Company Name", "Username", "Password", "Assessment Year"].includes(
                key
              ) &&
              key.trim() !== "" && // Exclude empty headers
              row[key]
          )

          sectionHeaders.forEach((header) => {
            const amount = row[header]
            const trimmedHeader = header.trim()
            if (amount && amount.trim() !== "" && trimmedHeader !== "") {
              sections.push({
                sectionCode: trimmedHeader,
                amount: amount.trim(),
              })
            }
          })

          console.log(`Extracted sections for ${companyName}:`, sections)

          if (sections.length === 0) {
            messageApi.warning(`No sections found for ${companyName}, skipping...`)
            continue
          }

          // Create challans
          setCsvProgress({
            current: i + 1,
            total: csvData.length,
            currentCompany: companyName,
            status: "Creating challans...",
          })

          const createResponse = await fetch("/api/challan/create", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId: company.id,
              assessmentYear: row["Assessment Year"],
              sections,
            }),
          })

          const createData = await createResponse.json()
          console.log(`Create response for ${companyName}:`, createData)

          if (!createData.success) {
            const errorMsg = createData.error || "Unknown error"
            messageApi.error(`Failed to create challans for ${companyName}: ${errorMsg}`)
            console.error(`Failed to create challans for ${companyName}:`, errorMsg)
            continue
          }

          messageApi.success(
            `Challans created for ${companyName} - ${createData.results?.length || 0} challans`
          )

          // Wait a bit before moving to next company
          await new Promise((resolve) => setTimeout(resolve, 2000))
        } catch (error: any) {
          messageApi.error(`Error processing ${companyName}: ${error.message}`)
        }
      }

      setCsvProgress(null)
      messageApi.success("CSV processing completed!")
      setCsvFileList([])
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to process CSV")
      setCsvFileList([])
    } finally {
      setCsvProcessing(false)
    }
    return false // Prevent automatic upload
  }

  const columns = [
    {
      title: "Company",
      dataIndex: ["company", "name"],
      key: "company",
      width: 200,
      fixed: "left" as const,
    },
    {
      title: "Assessment Year",
      dataIndex: "assessmentYear",
      key: "assessmentYear",
      width: 150,
    },
    {
      title: "Section Code",
      dataIndex: "sectionCode",
      key: "sectionCode",
      width: 120,
    },
    {
      title: "Section Description",
      dataIndex: "sectionDesc",
      key: "sectionDesc",
      width: 250,
    },
    {
      title: "Amount",
      dataIndex: "amount",
      key: "amount",
      width: 120,
      render: (amount: string) => `₹${amount}`,
    },
    {
      title: "Payment Ref No",
      dataIndex: "pymntRefNum",
      key: "pymntRefNum",
      width: 150,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: string) => {
        const color =
          status === "created"
            ? "green"
            : status === "paid"
            ? "blue"
            : status === "downloaded"
            ? "purple"
            : "default"
        return <Tag color={color}>{status.toUpperCase()}</Tag>
      },
    },
    {
      title: "Created At",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (date: Date) => new Date(date).toLocaleString(),
    },
    {
      title: "Actions",
      key: "actions",
      width: 100,
      fixed: "right" as const,
      render: (_: any, record: ChallanDataType) => (
        <Space>
          <Button
            type="link"
            danger
            icon={<DeleteOutlined />}
            onClick={() => handleDelete(record.id)}
          />
        </Space>
      ),
    },
  ]

  return (
    <Layout title="Challan Management">
      {contextHolder}
      <Space direction="vertical" size="large" style={{ width: "100%", padding: "24px" }}>
        <Title level={2}>Challan Management</Title>

        {/* CSV Upload Card */}
        <Card
          title={
            <Space>
              <UploadOutlined />
              <span>Batch Process from CSV</span>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              message="Upload CSV File"
              description="Upload a CSV file with company data to automatically create and download challans for multiple companies. The system will process one company at a time."
              type="info"
              showIcon
            />

            <Upload
              accept=".csv"
              fileList={csvFileList}
              beforeUpload={handleCsvUpload}
              maxCount={1}
              disabled={csvProcessing}
            >
              <Button icon={<UploadOutlined />} loading={csvProcessing} disabled={csvProcessing}>
                Upload CSV File
              </Button>
            </Upload>

            {csvProgress && (
              <Alert
                message={`Processing ${csvProgress.current} of ${csvProgress.total}`}
                description={
                  <div>
                    <div>
                      <strong>Current Company:</strong> {csvProgress.currentCompany}
                    </div>
                    <div>
                      <strong>Status:</strong> {csvProgress.status}
                    </div>
                  </div>
                }
                type="info"
                showIcon
              />
            )}
          </Space>
        </Card>

        {/* Company Selection Card */}
        <Card title="Select Companies">
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Select
              mode="multiple"
              style={{ width: "100%" }}
              placeholder="Select companies"
              value={selectedCompanyIds}
              onChange={setSelectedCompanyIds}
              showSearch
              filterOption={(input, option) => {
                const label = String(option?.children || "")
                return label.toLowerCase().includes(input.toLowerCase())
              }}
              maxTagCount="responsive"
            >
              {savedCompanies.map((company) => (
                <Option key={company.id} value={company.id}>
                  {company.name}
                </Option>
              ))}
            </Select>

            <Space>
              <Button onClick={handleSelectAll} disabled={savedCompanies.length === 0}>
                Select All
              </Button>
              <Button onClick={handleClearAll} disabled={selectedCompanyIds.length === 0}>
                Clear All
              </Button>
            </Space>

            {savedCompanies.length === 0 ? (
              <Alert
                message="No companies available"
                description="Please add companies first to proceed."
                type="warning"
                showIcon
              />
            ) : (
              <Alert
                message={`${selectedCompanyIds.length} ${
                  selectedCompanyIds.length === 1 ? "company" : "companies"
                } selected`}
                type="info"
                showIcon
              />
            )}
          </Space>
        </Card>

        {/* Create Challan Card */}
        <Card
          title={
            <Space>
              <FileAddOutlined />
              <span>Create Challans</span>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Input
              placeholder="Assessment Year (e.g., 2026-27)"
              value={assessmentYear}
              onChange={(e) => setAssessmentYear(e.target.value)}
              style={{ maxWidth: 300 }}
            />

            {selectedSections.map((section, index) => (
              <Row key={index} gutter={16} align="middle">
                <Col span={10}>
                  <Select
                    style={{ width: "100%" }}
                    placeholder="Select section code"
                    value={section.sectionCode}
                    onChange={(value) => handleSectionChange(index, "sectionCode", value)}
                    showSearch
                    filterOption={(input, option) => {
                      const label = String(option?.children || "")
                      return label.toLowerCase().includes(input.toLowerCase())
                    }}
                  >
                    {secCodes.map((code) => (
                      <Option key={code.sec_cd} value={code.sec_cd}>
                        {code.sec_cd} - {code.natr_pymnt_desc}
                      </Option>
                    ))}
                  </Select>
                </Col>
                <Col span={10}>
                  <Input
                    placeholder="Amount"
                    value={section.amount}
                    onChange={(e) => handleSectionChange(index, "amount", e.target.value)}
                    type="number"
                  />
                </Col>
                <Col span={4}>
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    onClick={() => handleRemoveSection(index)}
                  >
                    Remove
                  </Button>
                </Col>
              </Row>
            ))}

            <Space>
              <Button icon={<PlusOutlined />} onClick={handleAddSection}>
                Add Section
              </Button>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                onClick={handleCreateChallans}
                loading={createLoading}
                disabled={
                  selectedCompanyIds.length === 0 ||
                  !assessmentYear ||
                  selectedSections.length === 0
                }
              >
                Create Challans
              </Button>
            </Space>
          </Space>
        </Card>

        {/* Download Payment History Card */}
        <Card
          title={
            <Space>
              <CloudDownloadOutlined />
              <span>Download Payment History</span>
            </Space>
          }
        >
          <Space direction="vertical" size="middle" style={{ width: "100%" }}>
            <Alert
              message="Download Payment History"
              description="Download challan payment history for selected companies with optional filters."
              type="info"
              showIcon
            />

            <Row gutter={[16, 16]}>
              <Col span={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <div>
                    <strong>Assessment Year:</strong>
                  </div>
                  <Input
                    placeholder="e.g., 2026-27 (optional)"
                    value={paymentAssessmentYear}
                    onChange={(e) => setPaymentAssessmentYear(e.target.value)}
                    style={{ width: "100%" }}
                  />
                </Space>
              </Col>

              <Col span={12}>
                <Space direction="vertical" size="small" style={{ width: "100%" }}>
                  <div>
                    <strong>Type of Payment:</strong>
                  </div>
                  <Select
                    placeholder="Select payment type (optional)"
                    value={paymentType || undefined}
                    onChange={setPaymentType}
                    style={{ width: "100%" }}
                    allowClear
                  >
                    <Option value="TDS/TCS Payable by Taxpayer(200)">
                      TDS/TCS Payable by Taxpayer(200)
                    </Option>
                    <Option value="200">200</Option>
                  </Select>
                </Space>
              </Col>
            </Row>

            <Space direction="vertical" size="small" style={{ width: "100%" }}>
              <div>
                <strong>Payment Date Range:</strong>
              </div>
              <DatePicker.RangePicker
                format="DD-MMM-YYYY"
                onChange={(dates) => {
                  if (dates && dates[0] && dates[1]) {
                    // Set from date to start of day and to date to end of day
                    const fromDate = dates[0].startOf("day").format("DD-MMM-YYYY HH:mm:ss")
                    const toDate = dates[1].endOf("day").format("DD-MMM-YYYY HH:mm:ss")
                    setPaymentDateRange([fromDate, toDate])
                  } else {
                    setPaymentDateRange(null)
                  }
                }}
                style={{ width: "100%" }}
              />
            </Space>

            <Space>
              <Button
                type="primary"
                icon={<CloudDownloadOutlined />}
                onClick={handleDownloadPayments}
                loading={downloadPaymentLoading}
                disabled={selectedCompanyIds.length === 0}
              >
                Download Payment History
              </Button>
            </Space>
          </Space>
        </Card>

        {/* Challan Data Table */}
        <Card
          title={
            <Space>
              <span>Challan Records ({count})</span>
              <Button icon={<ReloadOutlined />} onClick={() => refetch()} size="small">
                Refresh
              </Button>
            </Space>
          }
        >
          <Table
            columns={columns}
            dataSource={(challanData as ChallanDataType[]) || []}
            rowKey="id"
            scroll={{ x: 1800 }}
            pagination={{ pageSize: 50 }}
          />
        </Card>
      </Space>
    </Layout>
  )
}

ChallanManagementPage.authenticate = true

export default ChallanManagementPage
