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
  PlusOutlined,
  EditOutlined,
  DeleteOutlined,
  CloudDownloadOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import getTldcData from "src/tldc/queries/getTldcData"
import upsertTldcData from "src/tldc/mutations/upsertTldcData"
import createQuickTldcData from "src/tldc/mutations/createQuickTldcData"
import deleteTldcData from "src/tldc/mutations/deleteTldcData"
import { TldcService } from "src/tldc/services/tldcService"
import { ExportButtons } from "src/shared/ui"
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
  const [actType, setActType] = useState<"old" | "new">("old")
  const [initiateIfNoRequest, setInitiateIfNoRequest] = useState(true)
  const [forceInitiate, setForceInitiate] = useState(false)
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

  const COMPANY_FETCH_RETRIES = 3

  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  const runForCompanies = async (
    action: "fetch" | "update"
  ) => {
    if (selectedCompanyIds.length === 0) {
      messageApi.error("Please select at least one company")
      return
    }

    if (!selectedFy) {
      messageApi.error("Please select a financial year")
      return
    }

    const companies = selectedCompanyIds
      .map((id) => savedCompanies.find((c) => c.id === id))
      .filter((c): c is NonNullable<typeof c> => !!c)

    if (companies.length === 0) {
      messageApi.error("No matching companies found")
      return
    }

    setLoading(true)
    let successCount = 0
    let failCount = 0
    const failures: string[] = []

    try {
      for (let i = 0; i < companies.length; i++) {
        const company = companies[i]!
        messageApi.loading({
          content: `${action === "fetch" ? "Fetching" : "Updating"} ${i + 1}/${
            companies.length
          }: ${company.name}...`,
          key: "tldc-batch",
          duration: 0,
        })

        let lastError = ""
        let ok = false

        for (let attempt = 1; attempt <= COMPANY_FETCH_RETRIES; attempt++) {
          try {
            const result =
              action === "fetch"
                ? actType === "new"
                  ? await TldcService.fetchTldcDataNewAct({
                      companyId: company.id,
                      companyName: company.name,
                      tan: company.tan,
                      fy: selectedFy,
                      userId: company.user_id,
                      password: company.password,
                      initiateIfNoRequest,
                      forceInitiate,
                    })
                  : await TldcService.fetchTldcData({
                      companyId: company.id,
                      companyName: company.name,
                      tan: company.tan,
                      fy: selectedFy,
                      userId: company.user_id,
                      password: company.password,
                    })
                : actType === "new"
                  ? await TldcService.updateTldcDataNewAct({
                      companyId: company.id,
                      companyName: company.name,
                      tan: company.tan,
                      fy: selectedFy,
                      userId: company.user_id,
                      password: company.password,
                    })
                  : await TldcService.updateTldcData({
                      companyId: company.id,
                      companyName: company.name,
                      tan: company.tan,
                      fy: selectedFy,
                      userId: company.user_id,
                      password: company.password,
                    })

            if (result.success) {
              ok = true
              break
            }
            lastError = result.message || "Failed"
            if (attempt < COMPANY_FETCH_RETRIES) {
              messageApi.warning({
                content: `${company.name} failed (attempt ${attempt}/${COMPANY_FETCH_RETRIES}), retrying...`,
                key: "tldc-batch-retry",
                duration: 2,
              })
              await sleep(1500 * attempt)
            }
          } catch (error: any) {
            lastError = error?.message || "Failed"
            if (attempt < COMPANY_FETCH_RETRIES) {
              await sleep(1500 * attempt)
            }
          }
        }

        if (ok) {
          successCount++
        } else {
          failCount++
          failures.push(`${company.name}: ${lastError}`)
        }
      }

      messageApi.destroy("tldc-batch")
      await refetch()

      if (failCount === 0) {
        messageApi.success(
          `${action === "fetch" ? "Fetched" : "Updated"} TLDC for all ${successCount} compan(y/ies)`
        )
      } else {
        messageApi.warning(
          `Done: ${successCount} ok, ${failCount} failed of ${companies.length}`
        )
        for (const f of failures.slice(0, 5)) {
          messageApi.error(f)
        }
        if (failures.length > 5) {
          messageApi.warning(`${failures.length - 5} more failures — check server logs`)
        }
      }
    } finally {
      messageApi.destroy("tldc-batch")
      setLoading(false)
    }
  }

  const handleFetchTldcData = async () => {
    await runForCompanies("fetch")
  }

  const handleUpdateTldcData = async () => {
    await runForCompanies("update")
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

      // FY 2026-27+ → New Act child-certificate API; earlier → Old Act Puppeteer
      const fyStart = parseInt(String(record.fy).split("-")[0] || "0", 10)
      const useNewAct = fyStart >= 2026

      const result = useNewAct
        ? await TldcService.updateTldcDataNewAct({
            companyId: company.id,
            companyName: company.name,
            tan: company.tan,
            fy: record.fy,
            userId: company.user_id,
            password: company.password,
            recordId: record.id,
          })
        : await (
            await fetch("/api/tldc/update-data", {
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
          ).json()

      messageApi.destroy("updating")

      if (result.success) {
        messageApi.success("TLDC data updated from portal successfully")
        await refetch()
      } else {
        messageApi.error(result.message || "Failed to update from portal")
      }
    } catch (error: any) {
      messageApi.destroy("updating")
      console.error("Update from portal failed:", error)
      messageApi.error(error.message || "Failed to update from portal")
    } finally {
      setUpdatingRecordId(null)
    }
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
                    description={
                      actType === "new"
                        ? "New Act: searchDeductor → download all ready PDFs → initiate only if no request exists (default) or force-initiate all → download again → child-certificate details + panName from PDF."
                        : "Old Act: fetch certificates from TRACES inbox (Puppeteer) and enrich via Section 197 verification."
                    }
                    type="info"
                    showIcon
                    style={{ marginBottom: 20 }}
                  />

                  <div style={{ marginBottom: 16 }}>
                    <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                      Income Tax Act *
                    </label>
                    <Radio.Group
                      value={actType}
                      onChange={(e) => setActType(e.target.value)}
                      optionType="button"
                      buttonStyle="solid"
                    >
                      <Radio.Button value="old">Old Act</Radio.Button>
                      <Radio.Button value="new">New Act</Radio.Button>
                    </Radio.Group>
                  </div>

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

                  {actType === "new" && (
                    <Space direction="vertical" size="small" style={{ marginTop: 12, width: "100%" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Switch
                          checked={initiateIfNoRequest}
                          onChange={setInitiateIfNoRequest}
                          disabled={forceInitiate}
                        />
                        <span>
                          Initiate if no download request exists (default) — skip if requests
                          already exist
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                        <Switch
                          checked={forceInitiate}
                          onChange={(v) => {
                            setForceInitiate(v)
                            if (v) setInitiateIfNoRequest(true)
                          }}
                        />
                        <span>
                          Force initiate all certificates + download all available PDFs
                        </span>
                      </div>
                    </Space>
                  )}

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
                <ExportButtons
                  feature="tldc"
                  filters={{
                    companyId: filterCompanyId,
                    search: searchText || undefined,
                  }}
                  disabled={!tldcData || (tldcData as TldcDataType[]).length === 0}
                />
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
