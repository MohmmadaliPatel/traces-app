import React from "react"
import { Tag } from "antd"
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  SyncOutlined,
} from "@ant-design/icons"

/** Consistent status Tag for UploadHistory / TaskBatch rows. */
export function UploadHistoryStatusTag({ status }: { status: string }) {
  const s = (status || "").toLowerCase()
  if (s === "success" || s === "finished" || s === "completed") {
    return (
      <Tag icon={<CheckCircleOutlined />} color="success">
        {status}
      </Tag>
    )
  }
  if (s === "failed" || s === "error") {
    return (
      <Tag icon={<CloseCircleOutlined />} color="error">
        {status}
      </Tag>
    )
  }
  if (s === "processing" || s === "queued" || s.includes("progress") || s === "started/in-progress") {
    return (
      <Tag icon={<SyncOutlined spin />} color="processing">
        {status}
      </Tag>
    )
  }
  return <Tag>{status}</Tag>
}
