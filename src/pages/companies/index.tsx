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
} from "antd"
import type { ColumnsType } from "antd/es/table"
import {
  UploadOutlined,
  FileExcelOutlined,
  DeleteOutlined,
  SearchOutlined,
  EditOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getCompanies from "src/companies/queries/getCompanies"
import saveCompaniesFromExcel from "src/companies/mutations/saveCompaniesFromExcel"
import deleteCompany from "src/companies/mutations/deleteCompany"
import updateCompany from "src/companies/mutations/updateCompany"
import * as XLSX from "xlsx"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"

const { Title } = Typography

interface CompanyData {
  name: string
  tan: string
  it_password: string
  user_id: string
  password: string
}

interface Company {
  id: number
  name: string
  tan: string
  it_password: string
  user_id: string
  password: string
  createdAt: Date
  updatedAt: Date
  isTemporary: boolean
}

function CompaniesPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [saveCompaniesMutation] = useMutation(saveCompaniesFromExcel)
  const [deleteCompanyMutation] = useMutation(deleteCompany)
  const [updateCompanyMutation] = useMutation(updateCompany)
  const [companiesResponse, { refetch }] = useQuery(getCompanies, {
    where: {},
    orderBy: { createdAt: "desc" },
    skip: 0,
    take: 10000,
  })

  const [loading, setLoading] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])
  const [searchText, setSearchText] = useState("")
  const [isEditModalVisible, setIsEditModalVisible] = useState(false)
  const [editingCompany, setEditingCompany] = useState<Company | null>(null)
  const [form] = Form.useForm()

  const companies: any = companiesResponse?.companies || []

  // Filter companies based on search text
  const filteredCompanies = companies.filter((company) => {
    if (!searchText) return true
    const search = searchText.toLowerCase()
    return (
      company.name.toLowerCase().includes(search) ||
      company.tan.toLowerCase().includes(search) ||
      company.user_id.toLowerCase().includes(search)
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
          const companies: CompanyData[] = jsonData.map((row, index) => {
            if (
              !row["Company Name"] ||
              !row["Tan"] ||
              !row["IT Password"] ||
              !row["User ID"] ||
              !row["Password"]
            ) {
              throw new Error(`Missing required fields in row ${index + 1}`)
            }

            return {
              name: String(row["Company Name"]).trim(),
              tan: String(row["Tan"]).trim().toUpperCase(),
              it_password: String(row["IT Password"]).trim(),
              user_id: String(row["User ID"]).trim(),
              password: String(row["Password"]).trim(),
            }
          })

          // Save companies to database
          handleSaveCompanies(companies)
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

  const handleSaveCompanies = async (companies: CompanyData[]) => {
    setLoading(true)
    try {
      const result = await saveCompaniesMutation({
        companies,
        isTemporary: false,
      })

      messageApi.success(
        `Successfully saved ${result.saved} companies, updated ${result.updated} companies. ${result.errors} errors.`
      )

      if (result.errors > 0 && result.errorDetails) {
        console.error("Errors:", result.errorDetails)
        messageApi.warning(`${result.errors} companies failed to save. Check console for details.`)
      }

      setFileList([])
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to save companies")
    } finally {
      setLoading(false)
    }
  }

  const handleDelete = async (companyId: number) => {
    try {
      setLoading(true)
      await deleteCompanyMutation({ id: companyId })
      messageApi.success("Company deleted successfully")
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to delete company")
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (company: Company) => {
    setEditingCompany(company)
    form.setFieldsValue({
      name: company.name,
      tan: company.tan,
      it_password: company.it_password,
      user_id: company.user_id,
      password: company.password,
    })
    setIsEditModalVisible(true)
  }

  const handleEditSubmit = async () => {
    try {
      const values = await form.validateFields()
      if (!editingCompany) return

      setLoading(true)
      await updateCompanyMutation({
        id: editingCompany.id,
        data: {
          name: values.name.trim(),
          tan: values.tan.trim().toUpperCase(),
          it_password: values.it_password.trim(),
          user_id: values.user_id.trim(),
          password: values.password.trim(),
        },
      })

      messageApi.success("Company updated successfully")
      setIsEditModalVisible(false)
      setEditingCompany(null)
      form.resetFields()
      await refetch()
    } catch (error: any) {
      if (error.errorFields) {
        // Form validation error
        return
      }
      messageApi.error(error.message || "Failed to update company")
    } finally {
      setLoading(false)
    }
  }

  const handleEditCancel = () => {
    setIsEditModalVisible(false)
    setEditingCompany(null)
    form.resetFields()
  }

  const columns: ColumnsType<Company> = [
    {
      title: "Company Name",
      dataIndex: "name",
      key: "name",
      width: 200,
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "TAN",
      dataIndex: "tan",
      key: "tan",
      width: 120,
      sorter: (a, b) => a.tan.localeCompare(b.tan),
    },
    {
      title: "User ID",
      dataIndex: "user_id",
      key: "user_id",
      width: 150,
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
            title="Are you sure you want to delete this company?"
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
      <Layout title="Companies Management">
        {contextHolder}
        <div style={{ padding: "24px" }}>
          <Title level={2}>Companies Management</Title>
          <Card style={{ marginBottom: "24px" }}>
            <Space direction="vertical" style={{ width: "100%" }} size="large">
              <Row gutter={16} align="middle">
                <Col flex="auto">
                  <Input
                    placeholder="Search by company name, TAN, or User ID"
                    prefix={<SearchOutlined />}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    allowClear
                    style={{ maxWidth: "400px" }}
                  />
                </Col>
                <Col>
                  <Upload
                    accept=".xlsx,.xls"
                    fileList={fileList}
                    beforeUpload={handleFileUpload}
                    maxCount={1}
                  >
                    <Button type="primary" icon={<UploadOutlined />} loading={loading}>
                      Upload Excel File
                    </Button>
                  </Upload>
                </Col>
              </Row>
              <div style={{ fontSize: "12px", color: "#666" }}>
                <FileExcelOutlined /> Excel file should contain columns: Company Name, Tan, IT
                Password, User ID, Password
              </div>
            </Space>
          </Card>

          <Card>
            <Table
              columns={columns}
              dataSource={filteredCompanies}
              rowKey="id"
              loading={loading}
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} companies`,
              }}
              scroll={{ x: 1000 }}
            />
          </Card>
        </div>

        {/* Edit Company Modal */}
        <Modal
          title="Edit Company"
          open={isEditModalVisible}
          onOk={handleEditSubmit}
          onCancel={handleEditCancel}
          confirmLoading={loading}
          width={600}
        >
          <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
            <Form.Item
              name="name"
              label="Company Name"
              rules={[{ required: true, message: "Please enter company name" }]}
            >
              <Input placeholder="Enter company name" />
            </Form.Item>

            <Form.Item
              name="tan"
              label="TAN"
              rules={[
                { required: true, message: "Please enter TAN" },
                { len: 10, message: "TAN must be 10 characters" },
              ]}
            >
              <Input
                placeholder="Enter TAN"
                maxLength={10}
                style={{ textTransform: "uppercase" }}
              />
            </Form.Item>

            <Form.Item
              name="it_password"
              label="IT Portal Password"
              rules={[{ required: true, message: "Please enter IT portal password" }]}
            >
              <Input.Password placeholder="Enter IT portal password" />
            </Form.Item>

            <Form.Item
              name="user_id"
              label="User ID"
              rules={[{ required: true, message: "Please enter user ID" }]}
            >
              <Input placeholder="Enter user ID" />
            </Form.Item>

            <Form.Item
              name="password"
              label="TRACES Password"
              rules={[{ required: true, message: "Please enter TRACES password" }]}
            >
              <Input.Password placeholder="Enter TRACES password" />
            </Form.Item>
          </Form>
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default CompaniesPage
