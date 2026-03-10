import React, { useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  message,
  Upload,
  Tag,
  Popconfirm,
  Input,
  Row,
  Col,
  Typography,
  Modal,
  Form,
  InputNumber,
  Switch,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  UploadOutlined,
  FileExcelOutlined,
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getDeducteeMasters from "src/deductee-masters/queries/getDeducteeMasters"
import createDeducteeMaster from "src/deductee-masters/mutations/createDeducteeMaster"
import updateDeducteeMaster from "src/deductee-masters/mutations/updateDeducteeMaster"
import deleteDeducteeMaster from "src/deductee-masters/mutations/deleteDeducteeMaster"
import bulkUploadDeducteeMasters from "src/deductee-masters/mutations/bulkUploadDeducteeMasters"
import * as XLSX from "xlsx"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"

const { Title } = Typography

interface DeducteeMaster {
  id: number
  pan: string
  email: string
  name: string | null
  createdAt: Date
  updatedAt: Date
}

function DeducteeMastersPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [createMutation] = useMutation(createDeducteeMaster)
  const [updateMutation] = useMutation(updateDeducteeMaster)
  const [deleteMutation] = useMutation(deleteDeducteeMaster)
  const [bulkUploadMutation] = useMutation(bulkUploadDeducteeMasters)
  const [deducteeMastersResponse, { refetch }] = useQuery(getDeducteeMasters, {
    where: {},
    orderBy: { createdAt: "desc" },
    skip: 0,
    take: 10000,
  })

  const [loading, setLoading] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])
  const [searchText, setSearchText] = useState("")
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingRecord, setEditingRecord] = useState<DeducteeMaster | null>(null)
  const [form] = Form.useForm()

  const deducteeMasters = deducteeMastersResponse?.deducteeMasters || []

  // Filter deductee masters based on search text
  const filteredDeducteeMasters = deducteeMasters.filter((master) => {
    if (!searchText) return true
    const search = searchText.toLowerCase()
    return (
      master.pan.toLowerCase().includes(search) ||
      master.email.toLowerCase().includes(search) ||
      (master.name && master.name.toLowerCase().includes(search))
    )
  })

  const handleFileUpload = async (file: File) => {
    try {
      const reader = new FileReader()
      reader.onload = (e) => {
        try {
          const data = new Uint8Array(e.target?.result as ArrayBuffer)
          const workbook = XLSX.read(data, { type: "array" })
          const sheetName = workbook.SheetNames[0]
          if (!sheetName) {
            throw new Error("No sheets found in Excel file")
          }
          const worksheet = workbook.Sheets[sheetName]
          const jsonData = XLSX.utils.sheet_to_json(worksheet!) as any[]

          // Validate and transform data
          const masters: Array<{ pan: string; email: string; name?: string }> = jsonData.map(
            (row, index) => {
              if (!row["PAN"] || !row["Email"]) {
                throw new Error(`Missing required fields (PAN, Email) in row ${index + 1}`)
              }

              const rawEmail = String(row["Email"]).trim().toLowerCase()
              const rawName = row["Name"] ? String(row["Name"]).trim() : undefined

              return {
                pan: String(row["PAN"]).trim().toUpperCase(),
                // Strip angle-bracket wrappers e.g. "John Doe <john@x.com>" → "john@x.com"
                email: rawEmail.replace(/^.*<(.+)>.*$/, "$1").trim(),
                // Strip < > characters from names that come from some Excel exports
                name: rawName ? rawName.replace(/[<>]/g, "").trim() || undefined : undefined,
              }
            }
          )
          console.log(masters)
          // Bulk upload
          handleBulkUpload(masters)
        } catch (error: any) {
          messageApi.error(error.message || "Failed to parse Excel file")
          setFileList([])
        }
      }
      reader.readAsArrayBuffer(file)
    } catch (error: any) {
      messageApi.error(error.message || "Failed to read file")
    }
    return false // Prevent automatic upload
  }

  const handleBulkUpload = async (
    masters: Array<{ pan: string; email: string; name?: string }>
  ) => {
    setLoading(true)
    try {
      const result = await bulkUploadMutation({ deducteeMasters: masters })

      messageApi.success(
        `Successfully saved ${result.saved} records, updated ${result.updated} records. ${result.errors} errors.`
      )

      if (result.errors > 0 && result.errorDetails) {
        console.error("Errors:", result.errorDetails)
        messageApi.warning(`${result.errors} records failed to save. Check console for details.`)
      }

      setFileList([])
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to bulk upload")
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (id: number) => {
    try {
      setLoading(true)
      await deleteMutation({ id })
      messageApi.success("Deductee master deleted successfully")
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to delete")
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (record: DeducteeMaster) => {
    setEditingRecord(record)
    form.setFieldsValue({
      pan: record.pan,
      email: record.email,
      name: record.name || "",
    })
    setIsModalVisible(true)
  }

  const handleAdd = () => {
    setEditingRecord(null)
    form.resetFields()
    setIsModalVisible(true)
  }

  const handleModalOk = async () => {
    try {
      const values = await form.validateFields()
      setLoading(true)

      if (editingRecord) {
        await updateMutation({
          id: editingRecord.id,
          ...values,
        })
        messageApi.success("Deductee master updated successfully")
      } else {
        await createMutation(values)
        messageApi.success("Deductee master created successfully")
      }

      setIsModalVisible(false)
      form.resetFields()
      await refetch()
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error
        return
      }
      messageApi.error(error.message || "Failed to save")
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<DeducteeMaster> = [
    {
      title: "PAN",
      dataIndex: "pan",
      key: "pan",
      width: 150,
      sorter: (a, b) => a.pan.localeCompare(b.pan),
    },
    {
      title: "Email",
      dataIndex: "email",
      key: "email",
      width: 250,
    },
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      width: 200,
      render: (name: string | null) => name || "-",
    },
    {
      title: "Created At",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 180,
      render: (date: Date) => new Date(date).toLocaleString(),
      sorter: (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    },
    {
      title: "Actions",
      key: "actions",
      width: 150,
      render: (_, record) => (
        <Space>
          <Button
            type="link"
            icon={<EditOutlined />}
            size="small"
            onClick={() => handleEdit(record)}
          >
            Edit
          </Button>
          <Popconfirm
            title="Are you sure you want to delete this record?"
            onConfirm={() => handleDelete(record.id)}
            okText="Yes"
            cancelText="No"
          >
            <Button type="link" danger icon={<DeleteOutlined />} size="small">
              Delete
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Deductee Masters Management">
        {contextHolder}
        <div style={{ padding: "24px" }}>
          <Title level={2}>Deductee Masters Management</Title>
          <Card style={{ marginBottom: "24px" }}>
            <Space direction="vertical" style={{ width: "100%" }} size="large">
              <Row gutter={16} align="middle">
                <Col flex="auto">
                  <Input
                    placeholder="Search by PAN, email, or name"
                    prefix={<SearchOutlined />}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    allowClear
                    style={{ maxWidth: "400px" }}
                  />
                </Col>
                <Col>
                  <Button
                    type="primary"
                    icon={<PlusOutlined />}
                    onClick={handleAdd}
                    style={{ marginRight: 8 }}
                  >
                    Add New
                  </Button>
                  <Upload
                    accept=".xlsx,.xls"
                    fileList={fileList}
                    beforeUpload={handleFileUpload}
                    maxCount={1}
                  >
                    <Button type="default" icon={<UploadOutlined />} loading={loading}>
                      Upload Excel
                    </Button>
                  </Upload>
                </Col>
              </Row>
              <div style={{ fontSize: "12px", color: "#666" }}>
                <FileExcelOutlined /> Excel file should contain columns: PAN, Email, Name (optional)
              </div>
            </Space>
          </Card>

          <Card>
            <Table
              columns={columns}
              dataSource={filteredDeducteeMasters}
              rowKey="id"
              loading={loading}
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} records`,
              }}
              scroll={{ x: 1000 }}
            />
          </Card>
        </div>

        <Modal
          title={editingRecord ? "Edit Deductee Master" : "Add Deductee Master"}
          open={isModalVisible}
          onOk={handleModalOk}
          onCancel={() => {
            setIsModalVisible(false)
            form.resetFields()
          }}
          confirmLoading={loading}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="pan"
              label="PAN"
              rules={[
                { required: true, message: "Please enter PAN" },
                { len: 10, message: "PAN must be 10 characters" },
              ]}
            >
              <Input
                placeholder="Enter PAN (10 characters)"
                maxLength={10}
                disabled={!!editingRecord}
              />
            </Form.Item>
            <Form.Item
              name="email"
              label="Email"
              rules={[
                { required: true, message: "Please enter email" },
                { type: "email", message: "Please enter a valid email" },
              ]}
            >
              <Input placeholder="Enter email address" />
            </Form.Item>
            <Form.Item name="name" label="Name (Optional)">
              <Input placeholder="Enter name" />
            </Form.Item>
          </Form>
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default DeducteeMastersPage
