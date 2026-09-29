import React from "react"
import { Alert, Button, Modal, Space, Table } from "antd"
import { ReloadOutlined } from "@ant-design/icons"
import type { ColumnsType } from "antd/es/table"
import { UploadHistoryStatusTag } from "./UploadHistoryStatusTag"

export type FailedTaskRow = {
  taskId: number
  companyName: string
  tan: string
  financialYear?: string
  quarter?: string
  formType?: string
  status: string
  errorMessage?: string | null
}

type Props = {
  open: boolean
  batchId: number | null
  items: FailedTaskRow[]
  selectedTaskIds: number[]
  retrying?: boolean
  onChangeSelected: (taskIds: number[]) => void
  onRetry: (taskIds: number[]) => void
  onClose: () => void
}

const columns: ColumnsType<FailedTaskRow> = [
  { title: "Company", dataIndex: "companyName", key: "companyName", width: 200 },
  { title: "TAN", dataIndex: "tan", key: "tan", width: 120 },
  { title: "FY", dataIndex: "financialYear", key: "financialYear", width: 100 },
  { title: "Quarter", dataIndex: "quarter", key: "quarter", width: 80 },
  { title: "Form", dataIndex: "formType", key: "formType", width: 80 },
  {
    title: "Status",
    dataIndex: "status",
    key: "status",
    width: 110,
    render: (status: string) => <UploadHistoryStatusTag status={status} />,
  },
  {
    title: "Error",
    dataIndex: "errorMessage",
    key: "errorMessage",
    ellipsis: true,
    render: (msg: string | null | undefined) => msg || "-",
  },
]

export function FailedTasksRetryModal({
  open,
  batchId,
  items,
  selectedTaskIds,
  retrying,
  onChangeSelected,
  onRetry,
  onClose,
}: Props) {
  return (
    <Modal
      title={batchId ? `Failed tasks — Batch #${batchId}` : "Failed tasks"}
      open={open}
      onCancel={onClose}
      width={960}
      footer={
        <Space>
          <Button onClick={onClose}>Close</Button>
          <Button
            type="primary"
            icon={<ReloadOutlined />}
            loading={retrying}
            disabled={selectedTaskIds.length === 0}
            onClick={() => onRetry(selectedTaskIds)}
          >
            Retry selected ({selectedTaskIds.length})
          </Button>
        </Space>
      }
    >
      <Alert
        type="warning"
        showIcon
        style={{ marginBottom: 16 }}
        message={`${items.length} task(s) failed after captcha retries. Select rows to retry.`}
      />
      <Table
        rowKey="taskId"
        size="small"
        columns={columns}
        dataSource={items}
        pagination={false}
        scroll={{ y: 360 }}
        rowSelection={{
          selectedRowKeys: selectedTaskIds,
          onChange: (keys) => onChangeSelected(keys as number[]),
        }}
      />
    </Modal>
  )
}
