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
  Radio,
  Modal,
  Form,
  Input,
  DatePicker,
  Switch,
  Row,
  Col,
  Popconfirm,
  Typography,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  FileExcelOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
  DownloadOutlined,
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CloudDownloadOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery, invoke } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import getTldcData from "src/tldc/queries/getTldcData"
import upsertTldcData from "src/tldc/mutations/upsertTldcData"
import createQuickTldcData from "src/tldc/mutations/createQuickTldcData"
import deleteTldcData from "src/tldc/mutations/deleteTldcData"
import { TldcService } from "src/tldc/services/tldcService"
import dayjs from "dayjs"
import "dayjs/locale/en-gb"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"

// Set dayjs locale to en-gb (starts week on Monday)
dayjs.locale("en-gb")

const { Title } = Typography

interface TldcDataType {
  id: number
  companyId: number
  company: {
    id: number
    name: string
    tan: string
  }
  certNumber: string
  din: string
  fy: string
  pan: string
  panName: string
  section: string
  NatureOfPayment: string
  tdsAmountLimit: string
  tdsAmountConsumed: string
  tdsRate: string
  validFrom: Date
  validTo: Date
  cancelDate: Date | null
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function TldcPage() {
  const [messageApi, contextHolder] = message.useMessage()

  // Company selection states
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [selectedFy, setSelectedFy] = useState<string>("")
  const [loading, setLoading] = useState(false)

  // Table and modal states
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [isQuickAddMode, setIsQuickAddMode] = useState(false)
  const [currentTldcData, setCurrentTldcData] = useState<any>(null)
  const [searchText, setSearchText] = useState("")
  const [filterCompanyId, setFilterCompanyId] = useState<number | undefined>(undefined)
  const [updatingRecordId, setUpdatingRecordId] = useState<number | null>(null)

  // Pagination state
  const [current, setCurrent] = useState(1)
  const [pageSize, setPageSize] = useState(10)

  // Fetch companies for dropdown
  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies = companiesResponse?.companies || []

  // Build where clause based on filters
  const buildWhereClause = () => {
    const where: any = {}

    if (filterCompanyId) {
      where.companyId = filterCompanyId
    }

    if (searchText) {
      where.OR = [
        { certNumber: { contains: searchText, mode: "insensitive" } },
        { pan: { contains: searchText, mode: "insensitive" } },
        { panName: { contains: searchText, mode: "insensitive" } },
      ]
    }

    return where
  }

  const [{ tldcData, count }, { refetch }] = useQuery(getTldcData, {
    where: buildWhereClause(),
    orderBy: { updatedAt: "desc" },
    skip: (current - 1) * pageSize,
    take: pageSize,
  })

  const [upsertTldcDataMutation] = useMutation(upsertTldcData)
  const [createQuickTldcDataMutation] = useMutation(createQuickTldcData)
  const [deleteTldcDataMutation] = useMutation(deleteTldcData)

  const [form] = Form.useForm()

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

  const handleFetchTldcData = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    if (!selectedFy) {
      messageApi.error("Please select a financial year")
      return
    }

    setLoading(true)
    try {
      const result = await TldcService.fetchTldcData({
        companyId: selectedCompanyIds[0] || 0,
        companyName: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.name || "",
        tan: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.tan || "",
        fy: selectedFy,
        userId: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.user_id || "",
        password: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.password || "",
      })

      if (result.success) {
        messageApi.success(result.message || "TLDC data fetched successfully")
        await refetch()
      } else {
        messageApi.error(result.message || "Failed to fetch TLDC data")
      }
    } catch (error: any) {
      messageApi.error(error.message || "Failed to fetch TLDC data")
    } finally {
      setLoading(false)
    }
  }

  const handleUpdateTldcData = async () => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    if (!selectedFy) {
      messageApi.error("Please select a financial year")
      return
    }

    setLoading(true)
    try {
      const result = await TldcService.updateTldcData({
        companyId: selectedCompanyIds[0] || 0,
        companyName: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.name || "",
        tan: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.tan || "",
        fy: selectedFy,
        userId: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.user_id || "",
        password: savedCompanies.find((company) => company.id === selectedCompanyIds[0])?.password || "",
      })

      if (result.success) {
        messageApi.success(result.message || "TLDC data updated successfully")
        await refetch()
      } else {
        messageApi.error(result.message || "Failed to update TLDC data")
      }
    } catch (error: any) {
      messageApi.error(error.message || "Failed to update TLDC data")
    } finally {
      setLoading(false)
    }
  }

  const handleAddTldcData = (quickMode = false) => {
    setCurrentTldcData(null)
    setIsQuickAddMode(quickMode)
    form.resetFields()
    setIsModalVisible(true)
  }

  const handleEditTldcData = (tldcData: TldcDataType) => {
    setCurrentTldcData(tldcData)
    setIsQuickAddMode(false)

    // Format dates for form
    const formData = {
      ...tldcData,
      validFrom: dayjs(tldcData.validFrom),
      validTo: dayjs(tldcData.validTo),
      cancelDate: tldcData.cancelDate ? dayjs(tldcData.cancelDate) : null,
    }

    form.setFieldsValue(formData)
    setIsModalVisible(true)
  }

  const handleModalCancel = () => {
    setIsModalVisible(false)
    setIsQuickAddMode(false)
    form.resetFields()
    setCurrentTldcData(null)
  }

  const handleModalOk = async () => {
    try {
      await form.validateFields()
      const values = form.getFieldsValue()

      if (isQuickAddMode && !currentTldcData) {
        // Quick add mode - only need minimal fields
        await createQuickTldcDataMutation({
          companyId: values.companyId,
          certNumber: values.certNumber,
          pan: values.pan,
          fy: values.fy,
        })
        messageApi.success("TLDC data created successfully. Use 'Update from Portal' to fetch details.")
      } else {
        // Full add/edit mode
        const formattedValues = {
          ...values,
          validFrom: values.validFrom.toDate(),
          validTo: values.validTo.toDate(),
          cancelDate: values.cancelDate ? values.cancelDate.toDate() : null,
        }

        await upsertTldcDataMutation({
          id: currentTldcData?.id,
          ...formattedValues,
        })
        messageApi.success("TLDC data saved successfully")
      }

      setIsModalVisible(false)
      setIsQuickAddMode(false)
      form.resetFields()
      setCurrentTldcData(null)
      void refetch()
    } catch (error: any) {
      console.error("Form validation failed:", error)
      messageApi.error(error.message || "Failed to save TLDC data")
    }
  }

  const handleDelete = async (id: number) => {
    try {
      await deleteTldcDataMutation({ id })
      messageApi.success("TLDC data deleted successfully")
      void refetch()
    } catch (error) {
      console.error("Delete failed:", error)
      messageApi.error("Failed to delete TLDC data")
    }
  }

  const handleUpdateFromPortal = async (record: TldcDataType) => {
    setUpdatingRecordId(record.id)
    try {
      const company = savedCompanies.find((c) => c.id === record.companyId)
      if (!company) {
        messageApi.error("Company not found")
        return
      }

      messageApi.loading({ content: "Updating from portal...", key: "updating", duration: 0 })

      const result = await fetch("/api/tldc/update-data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tan: company.tan,
          year: record.fy,
          credentials: {
            userId: company.user_id,
            password: company.password,
            tan: company.tan,
          },
          companyId: company.id,
          recordId: record.id,
        }),
      })

      const data = await result.json()
      messageApi.destroy("updating")

      if (data.success) {
        messageApi.success("TLDC data updated from portal successfully")
        await refetch()
      } else {
        messageApi.error(data.message || "Failed to update from portal")
      }
    } catch (error: any) {
      messageApi.destroy("updating")
      console.error("Update from portal failed:", error)
      messageApi.error(error.message || "Failed to update from portal")
    } finally {
      setUpdatingRecordId(null)
    }
  }

  // Download CSV file
  const handleDownloadCSV = async () => {
    try {
      // Fetch all data matching current filters (without pagination)
      const allDataResult = await invoke(getTldcData, {
        where: buildWhereClause(),
        orderBy: { updatedAt: "desc" },
        skip: 0,
        take: 100000,
      })

      const allData: any = allDataResult.tldcData || []

      if (allData.length === 0) {
        messageApi.warning("No data to download")
        return
      }

      // Convert to CSV
      const csvContent = convertToCSV(allData)

      // Create blob and download
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" })
      const link = document.createElement("a")
      const url = URL.createObjectURL(blob)

      link.setAttribute("href", url)
      link.setAttribute("download", `tldc-data-${new Date().toISOString().split("T")[0]}.csv`)
      link.style.visibility = "hidden"
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)

      URL.revokeObjectURL(url)
      messageApi.success("CSV downloaded successfully")
    } catch (error) {
      console.error("Error downloading CSV:", error)
      messageApi.error("Failed to download CSV")
    }
  }

  // Convert data to CSV format
  const convertToCSV = (data: any[]): string => {
    if (!data || data.length === 0) {
      return ""
    }

    const headers = [
      "ID",
      "Company",
      "Certificate Number",
      "DIN",
      "Financial Year",
      "PAN",
      "PAN Name",
      "Section",
      "Nature of Payment",
      "TDS Rate",
      "TDS Amount Limit",
      "TDS Amount Consumed",
      "Valid From",
      "Valid To",
      "Cancel Date",
      "Status",
    ]

    const rows = data.map((item) => {
      return [
        item.id?.toString() || "",
        item.company?.name || "",
        item.certNumber || "",
        item.din || "",
        item.fy || "",
        item.pan || "",
        item.panName || "",
        item.section || "",
        item.NatureOfPayment || "",
        item.tdsRate || "",
        item.tdsAmountLimit || "",
        item.tdsAmountConsumed || "",
        item.validFrom ? new Date(item.validFrom).toLocaleDateString() : "",
        item.validTo ? new Date(item.validTo).toLocaleDateString() : "",
        item.cancelDate ? new Date(item.cancelDate).toLocaleDateString() : "",
        item.isActive ? "Active" : "Inactive",
      ]
    })

    const escapeCSV = (value: string): string => {
      if (value === null || value === undefined) return ""
      const stringValue = String(value)
      if (stringValue.includes(",") || stringValue.includes('"') || stringValue.includes("\n")) {
        return `"${stringValue.replace(/"/g, '""')}"`
      }
      return stringValue
    }

    const csvContent = [
      headers.map(escapeCSV).join(","),
      ...rows.map((row) => row.map(escapeCSV).join(",")),
    ].join("\n")

    return csvContent
  }

  const columns: ColumnsType<TldcDataType> = [
    {
      title: "ID",
      dataIndex: "id",
      key: "id",
      width: 60,
      sorter: (a, b) => a.id - b.id,
    },
    {
      title: "Company",
      dataIndex: ["company", "name"],
      key: "company",
      width: 200,
    },
    {
      title: "Certificate Number",
      dataIndex: "certNumber",
      key: "certNumber",
      width: 150,
    },
    {
      title: "DIN",
      dataIndex: "din",
      key: "din",
      width: 120,
    },
    {
      title: "FY",
      dataIndex: "fy",
      key: "fy",
      width: 80,
    },
    {
      title: "PAN",
      dataIndex: "pan",
      key: "pan",
      width: 120,
    },
    {
      title: "PAN Name",
      dataIndex: "panName",
      key: "panName",
      width: 150,
    },
    {
      title: "Section",
      dataIndex: "section",
      key: "section",
      width: 100,
    },
    {
      title: "Nature of Payment",
      dataIndex: "NatureOfPayment",
      key: "NatureOfPayment",
      width: 150,
    },
    {
      title: "TDS Rate",
      dataIndex: "tdsRate",
      key: "tdsRate",
      width: 100,
      render: (rate: string) => `${rate}%`,
    },
    {
      title: "Valid From",
      dataIndex: "validFrom",
      key: "validFrom",
      width: 120,
      render: (date: Date) => new Date(date).toLocaleDateString(),
    },
    {
      title: "Valid To",
      dataIndex: "validTo",
      key: "validTo",
      width: 120,
      render: (date: Date) => new Date(date).toLocaleDateString(),
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      width: 100,
      render: (isActive: boolean) => (
        <Tag color={isActive ? "green" : "red"}>{isActive ? "Active" : "Inactive"}</Tag>
      ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 250,
      fixed: "right",
      render: (_, record: TldcDataType) => (
        <Space direction="vertical" size="small">
          <Space>
            <Button
              type="primary"
              icon={<EditOutlined />}
              size="small"
              onClick={() => handleEditTldcData(record)}
            >
              Edit
            </Button>
            <Popconfirm
              title="Are you sure you want to delete this record?"
              onConfirm={() => handleDelete(record.id)}
              okText="Yes"
              cancelText="No"
            >
              <Button danger icon={<DeleteOutlined />} size="small">
                Delete
              </Button>
            </Popconfirm>
          </Space>
          <Button
            type="default"
            icon={<SyncOutlined />}
            size="small"
            loading={updatingRecordId === record.id}
            onClick={() => handleUpdateFromPortal(record)}
            style={{ width: "100%" }}
          >
            Update from Portal
          </Button>
        </Space>
      ),
    },
  ]

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="TLDC Data">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {/* Company Selection Card */}
          <Card title="Fetch TLDC Data" extra={<FileExcelOutlined />}>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              {savedCompanies.length === 0 ? (
                <Alert
                  message="No Companies Available"
                  description="You don't have any saved companies yet. Please go to the Companies page to add companies."
                  type="warning"
                  showIcon
                />
              ) : (
                <>
                  <Alert
                    message="Select Companies & Financial Year"
                    description="Choose companies and financial year to fetch or update TLDC data from TRACES portal."
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
                      placeholder="Select companies to fetch TLDC data"
                      value={selectedCompanyIds}
                      onChange={setSelectedCompanyIds}
                      style={{ width: "100%", marginBottom: 16 }}
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

                  <div>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                      Financial Year *
                    </label>
                    <Select
                      placeholder="Select Financial Year"
                      value={selectedFy}
                      onChange={setSelectedFy}
                      style={{ width: "100%" }}
                      options={generateFinancialYears()}
                    />
                  </div>

                  <Space style={{ marginTop: 20 }}>
                    <Button
                      type="primary"
                      size="large"
                      icon={<CloudDownloadOutlined />}
                      loading={loading}
                      onClick={handleFetchTldcData}
                      disabled={selectedCompanyIds.length === 0 || !selectedFy}
                    >
                      Fetch TLDC Data
                    </Button>
                    <Button
                      type="default"
                      size="large"
                      icon={<SyncOutlined />}
                      loading={loading}
                      onClick={handleUpdateTldcData}
                      disabled={selectedCompanyIds.length === 0 || !selectedFy}
                    >
                      Update Existing Data
                    </Button>
                  </Space>
                </>
              )}
            </Space>
          </Card>

          {/* TLDC Data Table */}
          <Card
            title={
              <Title level={4} style={{ margin: 0 }}>
                TLDC Data
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
                <Button type="primary" icon={<PlusOutlined />} onClick={() => handleAddTldcData(true)}>
                  Quick Add
                </Button>
                <Button icon={<PlusOutlined />} onClick={() => handleAddTldcData(false)}>
                  Add Full Details
                </Button>
                <Button onClick={() => refetch()} icon={<SyncOutlined />}>
                  Refresh
                </Button>
              </Space>
            }
          >
            <Table
              columns={columns}
              dataSource={(tldcData as TldcDataType[]) || []}
              rowKey="id"
              scroll={{ x: 1800 }}
              pagination={{
                current,
                pageSize,
                total: count,
                onChange: (page, pageSize) => {
                  setCurrent(page)
                  setPageSize(pageSize || 10)
                },
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} TLDC records`,
              }}
            />
          </Card>
        </Space>

        {/* Add/Edit Modal */}
        <Modal
          title={
            currentTldcData
              ? "Edit TLDC Data"
              : isQuickAddMode
              ? "Quick Add TLDC Data"
              : "Add New TLDC Data"
          }
          open={isModalVisible}
          onOk={handleModalOk}
          onCancel={handleModalCancel}
          width={800}
        >
          {isQuickAddMode && !currentTldcData && (
            <Alert
              message="Quick Add Mode"
              description="Enter minimal details (Company, Certificate Number, PAN, Financial Year). Use 'Update from Portal' button after creation to fetch complete details automatically."
              type="info"
              showIcon
              style={{ marginBottom: 16 }}
            />
          )}
          <Form form={form} layout="vertical">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Item
                  name="companyId"
                  label="Company"
                  rules={[{ required: true, message: "Please select a company" }]}
                >
                  <Select placeholder="Select Company" showSearch optionFilterProp="children">
                    {savedCompanies.map((company) => (
                      <Select.Option key={company.id} value={company.id}>
                        {company.name}
                      </Select.Option>
                    ))}
                  </Select>
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item
                  name="certNumber"
                  label="Certificate Number"
                  rules={[{ required: true, message: "Please enter certificate number" }]}
                >
                  <Input />
                </Form.Item>
              </Col>
            </Row>

            <Row gutter={16}>
              <Col span={12}>
                <Form.Item name="fy" label="Financial Year" rules={[{ required: true }]}>
                  <Select placeholder="Select Financial Year" options={generateFinancialYears()} />
                </Form.Item>
              </Col>
              <Col span={12}>
                <Form.Item name="pan" label="PAN" rules={[{ required: true }]}>
                  <Input placeholder="Enter PAN" />
                </Form.Item>
              </Col>
            </Row>

            {!isQuickAddMode && (
              <>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="din" label="DIN" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item name="panName" label="PAN Name" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Item name="section" label="Section" rules={[{ required: true }]}>
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={12}>
                    <Form.Item
                      name="NatureOfPayment"
                      label="Nature of Payment"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item name="tdsRate" label="TDS Rate" rules={[{ required: true }]}>
                      <Input suffix="%" />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      name="tdsAmountLimit"
                      label="TDS Amount Limit"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item
                      name="tdsAmountConsumed"
                      label="TDS Amount Consumed"
                      rules={[{ required: true }]}
                    >
                      <Input />
                    </Form.Item>
                  </Col>
                </Row>

                <Row gutter={16}>
                  <Col span={8}>
                    <Form.Item name="validFrom" label="Valid From" rules={[{ required: true }]}>
                      <DatePicker style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="validTo" label="Valid To" rules={[{ required: true }]}>
                      <DatePicker style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                  <Col span={8}>
                    <Form.Item name="cancelDate" label="Cancel Date">
                      <DatePicker style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                </Row>

                <Form.Item
                  name="isActive"
                  label="Status"
                  valuePropName="checked"
                  initialValue={true}
                >
                  <Switch checkedChildren="Active" unCheckedChildren="Inactive" />
                </Form.Item>
              </>
            )}
          </Form>
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

TldcPage.authenticate = { redirectTo: "/auth/login" }

export default TldcPage
