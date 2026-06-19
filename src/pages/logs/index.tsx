import React, { useState } from "react"
import { Table, Card, Tag, Button, Space, Typography, Descriptions, Modal, Tooltip, message, Alert } from "antd"
import type { ColumnsType, TablePaginationConfig } from "antd/es/table"
import { useMutation, useQuery } from "@blitzjs/rpc"
import { FilterValue } from "antd/es/table/interface"
import dayjs from "dayjs"
import relativeTime from "dayjs/plugin/relativeTime"
import { Task } from "@prisma/client"
import Layout from "src/core/layouts/Layout"
import getTaskBatch from "src/tasks/queries/getTaskBatch"
import getTaskBatchTaskIds from "src/tasks/mutations/getTaskBatchTaskIds"
import retryFailedForm16BatchTasks from "src/tasks/mutations/retryFailedForm16BatchTasks"
import {
  ClockCircleOutlined,
  SyncOutlined,
  CheckCircleOutlined,
  CloseCircleOutlined,
  InfoCircleOutlined,
  FileTextOutlined,
  ReloadOutlined,
} from "@ant-design/icons"

dayjs.extend(relativeTime)
dayjs.locale("en-gb")

interface TableParams {
  pagination?: TablePaginationConfig
  sortField?: string
  sortOrder?: string
  filters?: Record<string, FilterValue>
}

function StatusTag({ status }: { status: string }) {
  if (status === "Queued") {
    return (
      <Tag icon={<ClockCircleOutlined />} color="default">
        Queued
      </Tag>
    )
  } else if (status === "Started/In-Progress") {
    return (
      <Tag icon={<SyncOutlined spin />} color="processing">
        Started / In-Progress
      </Tag>
    )
  } else if (status === "Retrying") {
    return (
      <Tag icon={<SyncOutlined spin />} color="processing">
        Retrying
      </Tag>
    )
  } else if (status === "Finished") {
    return (
      <Tag icon={<CheckCircleOutlined />} color="success">
        Finished
      </Tag>
    )
  } else if (status === "Failed") {
    return (
      <Tag icon={<CloseCircleOutlined />} color="error">
        Failed
      </Tag>
    )
  } else {
    return <Tag>{status}</Tag>
  }
}

function TasksListPage() {
  const [selectedRow, setSelectedRow] = useState<number>()
  const [selectedStatus, setSelectedStatus] = useState<string[]>([])
  const [filtersModal, setFiltersModal] = useState(false)
  const [selectedFilters, setSelectedFilters] = useState<any>(null)
  const [selectedTaskRowKeys, setSelectedTaskRowKeys] = useState<number[]>([])
  const [retryLoading, setRetryLoading] = useState(false)
  const [selectFailedLoading, setSelectFailedLoading] = useState(false)

  const [getTaskBatchTaskIdsMutation] = useMutation(getTaskBatchTaskIds)
  const [retryFailedForm16BatchTasksMutation] = useMutation(retryFailedForm16BatchTasks)

  const [tableParams, setTableParams] = useState<TableParams>({
    pagination: {
      current: 1,
      pageSize: 10,
    },
    filters: {},
  })
  const [taskTableParams, setTaskTableParams] = useState<TableParams>({
    pagination: {
      current: 1,
      pageSize: 10,
    },
    filters: {},
  })

  const [tasksResponse, { refetch, isLoading }] = useQuery(
    getTaskBatch,
    {
      skip: tableParams.pagination?.pageSize! * (tableParams.pagination?.current! - 1),
      take: tableParams.pagination?.pageSize,
      orderBy: { id: "desc" },
      taskSkip: taskTableParams.pagination?.pageSize! * (taskTableParams.pagination?.current! - 1),
      taskTake: taskTableParams.pagination?.pageSize,
      taskOrderBy: { id: "asc" },
      taskFilters: {
        status: selectedStatus.length > 0 ? selectedStatus : undefined,
        companyName: (taskTableParams.filters?.["company.name"] as string[]) || undefined,
      },
    },
    { refetchInterval: 10000 }
  )

  const showFilters = (task: any) => {
    try {
      const filters = JSON.parse(task.filters || "{}")
      setSelectedFilters(filters)
      setFiltersModal(true)
    } catch (error) {
      console.error("Error parsing filters:", error)
      setSelectedFilters({})
      setFiltersModal(true)
    }
  }

  const renderFilters = (filters: any) => {
    if (!filters || Object.keys(filters).length === 0) {
      return (
        <div style={{ textAlign: "center", color: "#999", fontSize: "16px", padding: "20px" }}>
          <Typography.Text type="secondary">No additional parameters</Typography.Text>
        </div>
      )
    }

    const descriptionItems: Array<{
      key: string
      label: string
      children: React.ReactNode
    }> = []

    // Financial Year
    if (filters.financialYear) {
      descriptionItems.push({
        key: "financialYear",
        label: "Financial Year",
        children: <Tag color="blue">{filters.financialYear}</Tag>,
      })
    }

    // Quarter
    if (filters.quarter) {
      descriptionItems.push({
        key: "quarter",
        label: "Quarter",
        children: <Tag color="green">{filters.quarter}</Tag>,
      })
    }

    // Form Type
    if (filters.formType) {
      descriptionItems.push({
        key: "formType",
        label: "Form Type",
        children: <Tag color="purple">{filters.formType}</Tag>,
      })
    }

    // Action Type
    if (filters.actionType) {
      const actionLabel =
        filters.actionType === "send_request"
          ? "Send Request"
          : filters.actionType === "sign_pdf"
          ? "Attach DSC"
          : "Download File"
      descriptionItems.push({
        key: "actionType",
        label: "Action Type",
        children: <Tag color="orange">{actionLabel}</Tag>,
      })
    }

    // Form 16 Type
    if (filters.form16Type) {
      descriptionItems.push({
        key: "form16Type",
        label: "Form 16 Type",
        children: (
          <Tag color={filters.form16Type === "form16a" ? "magenta" : "geekblue"}>
            {filters.form16Type === "form16a" ? "Form 16A" : "Form 16"}
          </Tag>
        ),
      })
    }

    if (filters.sendToAllPeriods) {
      descriptionItems.push({
        key: "sendToAllPeriods",
        label: "All Periods",
        children: <Tag color="gold">Yes</Tag>,
      })
    }

    return (
      <Descriptions bordered column={2} size="small">
        {descriptionItems.map((item) => (
          <Descriptions.Item key={item.key} label={item.label}>
            {item.children}
          </Descriptions.Item>
        ))}
      </Descriptions>
    )
  }

  const batchColumns: ColumnsType<any> = [
    {
      title: "Batch ID",
      dataIndex: "id",
      sorter: true,
      width: 100,
    },
    {
      title: "Job Types",
      dataIndex: "jobTypes",
      render: (jobTypes) => {
        try {
          const parsed = JSON.parse(jobTypes || "[]")
          return (
            <Space wrap>
              {parsed.map((type: string, idx: number) => (
                <Tag key={idx} color="cyan">
                  {type}
                </Tag>
              ))}
            </Space>
          )
        } catch {
          return "-"
        }
      },
      width: 200,
    },
    {
      title: "Total Tasks",
      dataIndex: ["_count", "Task"],
      width: 120,
      render: (count) => <Tag color="default">{count || 0}</Tag>,
    },
    {
      title: "Status Summary",
      render: (_, record) => {
        const tasks = record.Task || []
        const statusCounts = tasks.reduce((acc: any, task: any) => {
          acc[task.status] = (acc[task.status] || 0) + 1
          return acc
        }, {})

        return (
          <Space wrap size="small">
            {statusCounts["Finished"] > 0 && (
              <Tooltip title="Finished">
                <Tag color="success" icon={<CheckCircleOutlined />}>
                  {statusCounts["Finished"]}
                </Tag>
              </Tooltip>
            )}
            {statusCounts["Failed"] > 0 && (
              <Tooltip title="Failed">
                <Tag color="error" icon={<CloseCircleOutlined />}>
                  {statusCounts["Failed"]}
                </Tag>
              </Tooltip>
            )}
            {statusCounts["Started/In-Progress"] > 0 && (
              <Tooltip title="Started / In-Progress">
                <Tag color="processing" icon={<SyncOutlined spin />}>
                  {statusCounts["Started/In-Progress"]}
                </Tag>
              </Tooltip>
            )}
            {statusCounts["Queued"] > 0 && (
              <Tooltip title="Queued">
                <Tag color="default" icon={<ClockCircleOutlined />}>
                  {statusCounts["Queued"]}
                </Tag>
              </Tooltip>
            )}
          </Space>
        )
      },
      width: 250,
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      render: (value) => dayjs(new Date(value)).fromNow(),
      width: 150,
    },
    {
      title: "Actions",
      render: (_, record) => (
        <Space>
          <Button size="small" icon={<InfoCircleOutlined />} onClick={() => showFilters(record)}>
            Details
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<FileTextOutlined />}
            onClick={() => {
              setSelectedRow(record.id)
              setSelectedTaskRowKeys([])
              setTaskTableParams({
                ...taskTableParams,
                pagination: { current: 1, pageSize: 10 },
              })
            }}
          >
            View Tasks
          </Button>
        </Space>
      ),
      width: 180,
    },
  ]

  const taskColumns: ColumnsType<Task> = [
    {
      title: "Task ID",
      dataIndex: "id",
      width: 100,
    },
    {
      title: "Company Name",
      dataIndex: ["company", "name"],
      filterSearch: true,
      filters:
        tasksResponse.tasksBatch
          .find((t) => t.id === selectedRow)
          ?.Task.map((t) => ({ text: t.company.name, value: t.company.name })) || [],
      filteredValue: (taskTableParams.filters?.["company.name"] as string[]) || null,
      width: 250,
    },
    {
      title: "TAN",
      dataIndex: ["company", "tan"],
      width: 150,
    },
    {
      title: "Created",
      dataIndex: "createdAt",
      render: (value) => dayjs(new Date(value)).fromNow(),
      width: 150,
    },
    {
      title: "Status",
      dataIndex: "status",
      filters: [
        { text: "Queued", value: "Queued" },
        { text: "Started/In-Progress", value: "Started/In-Progress" },
        { text: "Retrying", value: "Retrying" },
        { text: "Finished", value: "Finished" },
        { text: "Failed", value: "Failed" },
      ],
      filteredValue: selectedStatus,
      render: (value) => <StatusTag status={value} />,
      width: 150,
    },
    {
      title: "Message",
      dataIndex: "message",
      render: (value) => (
        <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", maxWidth: 400 }}>
          {value?.split("\n").slice(0, 3).join("\n")}
          {value?.split("\n").length > 3 && "..."}
        </div>
      ),
    },
  ]

  const Taskrender = () => {
    const batch: any = tasksResponse.tasksBatch.find((t) => t.id === selectedRow)
    const totalTasks = batch?._count?.Task || 0

    let batchFilters: Record<string, unknown> = {}
    try {
      batchFilters = JSON.parse(batch?.filters || "{}")
    } catch {
      batchFilters = {}
    }
    const isForm16Batch = Boolean(batchFilters.form16Type)

    const handleSelectFailedTasks = async () => {
      if (!selectedRow) return
      setSelectFailedLoading(true)
      try {
        const result = await getTaskBatchTaskIdsMutation({
          batchId: selectedRow,
          statusFilter: ["Failed"],
        })
        setSelectedTaskRowKeys(result.taskIds)
        message.info(`Selected ${result.taskIds.length} failed task(s)`)
      } catch (error: any) {
        message.error(error.message || "Failed to load failed tasks")
      } finally {
        setSelectFailedLoading(false)
      }
    }

    const handleRetrySelectedTasks = async () => {
      if (!selectedRow || selectedTaskRowKeys.length === 0) {
        message.warning("Select at least one failed task to retry")
        return
      }
      setRetryLoading(true)
      try {
        const result = await retryFailedForm16BatchTasksMutation({
          batchId: selectedRow,
          taskIds: selectedTaskRowKeys,
        })
        message.success(result.message || `Queued ${result.retriedCount} task(s) for retry`)
        setSelectedTaskRowKeys([])
        refetch()
      } catch (error: any) {
        message.error(error.message || "Failed to retry tasks")
      } finally {
        setRetryLoading(false)
      }
    }

    if (!batch) {
      return (
        <Card title="Tasks" style={{ margin: "20px 0" }}>
          <Typography.Text type="secondary">Select a batch to view tasks</Typography.Text>
        </Card>
      )
    }

    return (
      <Card
        title={`Tasks for Batch #${selectedRow}`}
        style={{ margin: "20px 0" }}
        extra={
          <Space wrap>
            {isForm16Batch && (
              <>
                <Button
                  size="small"
                  loading={selectFailedLoading}
                  onClick={handleSelectFailedTasks}
                >
                  Select failed
                </Button>
                <Button size="small" onClick={() => setSelectedTaskRowKeys([])}>
                  Clear selection
                </Button>
                <Button
                  size="small"
                  type="primary"
                  icon={<ReloadOutlined />}
                  loading={retryLoading}
                  disabled={selectedTaskRowKeys.length === 0}
                  onClick={handleRetrySelectedTasks}
                >
                  Retry selected ({selectedTaskRowKeys.length})
                </Button>
              </>
            )}
            <Button
              onClick={() => {
                setSelectedRow(undefined)
                setSelectedTaskRowKeys([])
              }}
            >
              Close
            </Button>
          </Space>
        }
      >
        {isForm16Batch && (
          <Alert
            message={`Form 16${batchFilters.form16Type === "form16a" ? "A" : ""} batch — retry re-queues failed tasks with the same configuration (action, periods, job types).`}
            type="info"
            showIcon
            style={{ marginBottom: 16 }}
          />
        )}
        <Table
          rowKey="id"
          columns={taskColumns}
          dataSource={batch?.Task}
          rowSelection={
            isForm16Batch
              ? {
                  selectedRowKeys: selectedTaskRowKeys,
                  onChange: (keys) => setSelectedTaskRowKeys(keys as number[]),
                  getCheckboxProps: (record) => ({
                    disabled: record.status !== "Failed",
                  }),
                }
              : undefined
          }
          pagination={{
            current: taskTableParams.pagination?.current,
            pageSize: taskTableParams.pagination?.pageSize,
            total: totalTasks,
            showTotal: (total) => `Total ${total} tasks`,
          }}
          onChange={(pagination, filters) => {
            if (filters?.status) {
              setSelectedStatus(filters.status as string[])
            } else {
              setSelectedStatus([])
            }

            setTaskTableParams({
              ...taskTableParams,
              pagination: { current: pagination.current!, pageSize: pagination.pageSize! },
              filters: filters as any,
            })
          }}
          scroll={{ x: 1200 }}
          size="small"
        />
      </Card>
    )
  }

  return (
    <Layout title="Task Logs">
      <Card
        title="Batch History"
      >
        <Table
          rowKey="id"
          columns={batchColumns}
          dataSource={tasksResponse.tasksBatch}
          pagination={{
            current: tableParams.pagination?.current,
            pageSize: tableParams.pagination?.pageSize,
            total: tasksResponse.count,
            showTotal: (total) => `Total ${total} batches`,
          }}
          loading={isLoading}
          onChange={(pagination) => {
            setTableParams({
              ...tableParams,
              pagination: { current: pagination.current!, pageSize: pagination.pageSize! },
            })
          }}
          expandable={{
            expandedRowRender: (record) => (
              <div style={{ padding: "10px 20px" }}>
                <Typography.Title level={5}>Batch Details</Typography.Title>
                {renderFilters(JSON.parse(record.filters || "{}"))}
              </div>
            ),
          }}
          scroll={{ x: 1400 }}
        />
      </Card>

      {selectedRow && Taskrender()}

      <Modal
        title="Batch Parameters"
        open={filtersModal}
        onCancel={() => setFiltersModal(false)}
        footer={[
          <Button key="close" type="primary" onClick={() => setFiltersModal(false)}>
            Close
          </Button>,
        ]}
        width={700}
      >
        {renderFilters(selectedFilters)}
      </Modal>
    </Layout>
  )
}

TasksListPage.authenticate = { redirectTo: "/auth/login" }
export default TasksListPage
