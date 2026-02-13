import React, { useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  message,
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
  DeleteOutlined,
  EditOutlined,
  PlusOutlined,
  SearchOutlined,
  CheckCircleOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import getSmtpConfigs from "src/smtp-configs/queries/getSmtpConfigs"
import createSmtpConfig from "src/smtp-configs/mutations/createSmtpConfig"
import updateSmtpConfig from "src/smtp-configs/mutations/updateSmtpConfig"
import deleteSmtpConfig from "src/smtp-configs/mutations/deleteSmtpConfig"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"

const { Title } = Typography

interface SmtpConfig {
  id: number
  name: string
  host: string
  port: number
  secure: boolean
  user: string
  password: string
  fromEmail: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

function SmtpConfigsPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [createMutation] = useMutation(createSmtpConfig)
  const [updateMutation] = useMutation(updateSmtpConfig)
  const [deleteMutation] = useMutation(deleteSmtpConfig)
  const [smtpConfigsResponse, { refetch }] = useQuery(getSmtpConfigs, {})

  const [loading, setLoading] = useState(false)
  const [searchText, setSearchText] = useState("")
  const [isModalVisible, setIsModalVisible] = useState(false)
  const [editingRecord, setEditingRecord] = useState<SmtpConfig | null>(null)
  const [form] = Form.useForm()

  const smtpConfigs = smtpConfigsResponse?.smtpConfigs || []
  const activeConfig = smtpConfigsResponse?.activeConfig

  // Filter configs based on search text
  const filteredConfigs = smtpConfigs.filter((config) => {
    if (!searchText) return true
    const search = searchText.toLowerCase()
    return (
      config.name.toLowerCase().includes(search) ||
      config.host.toLowerCase().includes(search) ||
      config.fromEmail.toLowerCase().includes(search)
    )
  })

  const handleDelete = async (id: number) => {
    try {
      setLoading(true)
      await deleteMutation({ id })
      messageApi.success("SMTP configuration deleted successfully")
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to delete")
    } finally {
      setLoading(false)
    }
  }

  const handleEdit = (record: SmtpConfig) => {
    setEditingRecord(record)
    form.setFieldsValue({
      name: record.name,
      host: record.host,
      port: record.port,
      secure: record.secure,
      user: record.user,
      password: record.password,
      fromEmail: record.fromEmail,
      isActive: record.isActive,
    })
    setIsModalVisible(true)
  }

  const handleAdd = () => {
    setEditingRecord(null)
    form.resetFields()
    form.setFieldsValue({
      secure: true,
      isActive: false,
      port: 587,
    })
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
        messageApi.success("SMTP configuration updated successfully")
      } else {
        await createMutation(values)
        messageApi.success("SMTP configuration created successfully")
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

  const handleTestConnection = async (config: SmtpConfig) => {
    try {
      setLoading(true)
      // Call API endpoint to test SMTP connection
      const response = await fetch("/api/smtp-test", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          host: config.host,
          port: config.port,
          secure: config.secure,
          user: config.user,
          password: config.password,
        }),
      })

      const result = await response.json()

      if (result.success) {
        messageApi.success(result.message || "SMTP connection test successful!")
      } else {
        messageApi.error(result.message || "SMTP connection test failed")
      }
    } catch (error: any) {
      messageApi.error(`SMTP connection test failed: ${error.message}`)
    } finally {
      setLoading(false)
    }
  }

  const columns: ColumnsType<SmtpConfig> = [
    {
      title: "Name",
      dataIndex: "name",
      key: "name",
      width: 150,
      sorter: (a, b) => a.name.localeCompare(b.name),
    },
    {
      title: "Host",
      dataIndex: "host",
      key: "host",
      width: 200,
    },
    {
      title: "Port",
      dataIndex: "port",
      key: "port",
      width: 80,
    },
    {
      title: "Secure",
      dataIndex: "secure",
      key: "secure",
      width: 80,
      render: (secure: boolean) => (
        <Tag color={secure ? "green" : "orange"}>{secure ? "Yes" : "No"}</Tag>
      ),
    },
    {
      title: "From Email",
      dataIndex: "fromEmail",
      key: "fromEmail",
      width: 200,
    },
    {
      title: "Status",
      dataIndex: "isActive",
      key: "isActive",
      width: 100,
      render: (isActive: boolean) =>
        isActive ? (
          <Tag color="green" icon={<CheckCircleOutlined />}>
            Active
          </Tag>
        ) : (
          <Tag>Inactive</Tag>
        ),
    },
    {
      title: "Actions",
      key: "actions",
      width: 250,
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
          <Button
            type="link"
            size="small"
            onClick={() => handleTestConnection(record)}
            loading={loading}
          >
            Test
          </Button>
          <Popconfirm
            title="Are you sure you want to delete this configuration?"
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
      <Layout title="SMTP Configuration">
        {contextHolder}
        <div style={{ padding: "24px" }}>
          <Title level={2}>SMTP Configuration</Title>
          {activeConfig && (
            <Card style={{ marginBottom: "24px", backgroundColor: "#f0f9ff" }}>
              <Space>
                <CheckCircleOutlined style={{ color: "#52c41a" }} />
                <strong>Active Configuration:</strong> {activeConfig.name} ({activeConfig.host}:
                {activeConfig.port})
              </Space>
            </Card>
          )}
          <Card style={{ marginBottom: "24px" }}>
            <Space direction="vertical" style={{ width: "100%" }} size="large">
              <Row gutter={16} align="middle">
                <Col flex="auto">
                  <Input
                    placeholder="Search by name, host, or email"
                    prefix={<SearchOutlined />}
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    allowClear
                    style={{ maxWidth: "400px" }}
                  />
                </Col>
                <Col>
                  <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
                    Add New Configuration
                  </Button>
                </Col>
              </Row>
            </Space>
          </Card>

          <Card>
            <Table
              columns={columns}
              dataSource={filteredConfigs}
              rowKey="id"
              loading={loading}
              pagination={{
                pageSize: 50,
                showSizeChanger: true,
                showTotal: (total) => `Total ${total} configurations`,
              }}
              scroll={{ x: 1200 }}
            />
          </Card>
        </div>

        <Modal
          title={editingRecord ? "Edit SMTP Configuration" : "Add SMTP Configuration"}
          open={isModalVisible}
          onOk={handleModalOk}
          onCancel={() => {
            setIsModalVisible(false)
            form.resetFields()
          }}
          confirmLoading={loading}
          width={600}
        >
          <Form form={form} layout="vertical">
            <Form.Item
              name="name"
              label="Configuration Name"
              rules={[{ required: true, message: "Please enter configuration name" }]}
            >
              <Input placeholder="e.g., Gmail SMTP, Outlook SMTP" />
            </Form.Item>
            <Row gutter={16}>
              <Col span={16}>
                <Form.Item
                  name="host"
                  label="SMTP Host"
                  rules={[{ required: true, message: "Please enter SMTP host" }]}
                >
                  <Input placeholder="e.g., smtp.gmail.com" />
                </Form.Item>
              </Col>
              <Col span={8}>
                <Form.Item
                  name="port"
                  label="Port"
                  rules={[{ required: true, message: "Please enter port" }]}
                >
                  <InputNumber min={1} max={65535} style={{ width: "100%" }} placeholder="587" />
                </Form.Item>
              </Col>
            </Row>
            <Form.Item name="secure" label="Use SSL/TLS" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item
              name="user"
              label="Username/Email"
              rules={[{ required: true, message: "Please enter username" }]}
            >
              <Input placeholder="SMTP username or email" />
            </Form.Item>
            <Form.Item
              name="password"
              label="Password"
              rules={[{ required: true, message: "Please enter password" }]}
            >
              <Input.Password placeholder="SMTP password" />
            </Form.Item>
            <Form.Item
              name="fromEmail"
              label="From Email Address"
              rules={[
                { required: true, message: "Please enter from email" },
                { type: "email", message: "Please enter a valid email" },
              ]}
            >
              <Input placeholder="Email address to send from" />
            </Form.Item>
            <Form.Item
              name="isActive"
              label="Set as Active Configuration"
              valuePropName="checked"
              extra="Only one configuration can be active at a time"
            >
              <Switch />
            </Form.Item>
          </Form>
        </Modal>
      </Layout>
    </ConfigProvider>
  )
}

export default SmtpConfigsPage
