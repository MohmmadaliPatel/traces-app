import React from "react"
import { Table, Button, Space, Tag, Card } from "antd"
import { SyncOutlined } from "@ant-design/icons"
import type { ColumnsType } from "antd/es/table"
import dayjs from "dayjs"
import { UploadHistoryStatusTag } from "src/shared/ui/UploadHistoryStatusTag"

export type UploadHistoryRecord = {
  id: number
  companyName: string
  tan: string
  status: string
  financialYear: string
  quarter: string
  errorMessage: string | null
  createdAt: Date | string
  batchId: number | null
}

type Props = {
  title?: string
  records: UploadHistoryRecord[]
  total?: number
  pageSize?: number
  onRefresh?: () => void
  onSelectBatch?: (batchId: number) => void
  extraColumns?: ColumnsType<UploadHistoryRecord>
  /** When true, render Details column that parses combination JSON in errorMessage. */
  showCombinationDetails?: boolean
}

function renderCombinationDetails(error: string | null) {
  if (!error) return "-"
  try {
    const data = JSON.parse(error)
    if (data.combinations && Array.isArray(data.combinations)) {
      return (
        <Space direction="vertical" size="small" style={{ maxWidth: 300 }}>
          {data.action ? <Tag color="blue">{data.action}</Tag> : null}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
            {data.combinations.map((combo: any, index: number) => {
              const statusColor =
                combo.status === "Success"
                  ? "green"
                  : combo.status === "Failed"
                    ? "red"
                    : "orange"
              const label =
                combo.formType && combo.formType !== "N/A"
                  ? `${combo.financialYear} ${combo.quarter} ${combo.formType}`
                  : `${combo.financialYear} ${combo.quarter}`
              return (
                <Tag key={index} color={statusColor}>
                  {label}
                </Tag>
              )
            })}
          </div>
        </Space>
      )
    }
  } catch {
    /* fall through */
  }
  return error
}

/**
 * Shared upload / download history table for batch portal features.
 */
export function UploadHistoryTable({
  title = "Download History",
  records,
  total,
  pageSize = 100,
  onRefresh,
  onSelectBatch,
  extraColumns = [],
  showCombinationDetails = true,
}: Props) {
  const columns: ColumnsType<UploadHistoryRecord> = [
    {
      title: "Company Name",
      dataIndex: "companyName",
      key: "companyName",
      width: 150,
    },
    {
      title: "TAN",
      dataIndex: "tan",
      key: "tan",
      width: 120,
    },
    {
      title: "Financial Year",
      dataIndex: "financialYear",
      key: "financialYear",
      width: 120,
    },
    {
      title: "Quarter",
      dataIndex: "quarter",
      key: "quarter",
      width: 100,
    },
    {
      title: "Status",
      dataIndex: "status",
      key: "status",
      width: 120,
      render: (status: string) => <UploadHistoryStatusTag status={status} />,
    },
    ...(showCombinationDetails
      ? [
          {
            title: "Details",
            dataIndex: "errorMessage",
            key: "details",
            width: 320,
            render: (error: string | null) => renderCombinationDetails(error),
          } as ColumnsType<UploadHistoryRecord>[number],
        ]
      : []),
    {
      title: "Date",
      dataIndex: "createdAt",
      key: "createdAt",
      width: 150,
      render: (date: Date | string) => dayjs(date).format("DD/MM/YYYY HH:mm"),
    },
    {
      title: "Batch",
      dataIndex: "batchId",
      key: "batchId",
      width: 100,
      render: (batchId: number | null) =>
        batchId && onSelectBatch ? (
          <Button type="link" size="small" onClick={() => onSelectBatch(batchId)}>
            #{batchId}
          </Button>
        ) : batchId ? (
          `#${batchId}`
        ) : (
          "-"
        ),
    },
    ...extraColumns,
  ]

  return (
    <Card
      title={title}
      extra={
        onRefresh ? (
          <Button onClick={onRefresh} icon={<SyncOutlined />}>
            Refresh
          </Button>
        ) : null
      }
    >
      <Table
        rowKey="id"
        columns={columns}
        dataSource={records}
        pagination={{
          total: total ?? records.length,
          pageSize,
          showTotal: (t) => `Total ${t} records`,
        }}
        scroll={{ x: 1200 }}
      />
    </Card>
  )
}
