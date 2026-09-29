import React from "react"
import { Alert, Progress, Space, Typography } from "antd"

const { Text } = Typography

type BatchProgress = {
  total?: number
  finished?: number
  failed?: number
  queued?: number
  inProgress?: number
  isComplete?: boolean
  percent?: number
  counts?: {
    total?: number
    finished?: number
    failed?: number
    queued?: number
    inProgress?: number
  }
}

type Props = {
  batchId: number | null
  progress: BatchProgress | null | undefined
}

/** Compact progress panel matching Justification Report polling UX. */
export function BatchProgressPoller({ batchId, progress }: Props) {
  if (!batchId || !progress) return null

  const total = progress.total ?? progress.counts?.total ?? 0
  const finished = progress.finished ?? progress.counts?.finished ?? 0
  const failed = progress.failed ?? progress.counts?.failed ?? 0
  const inProgress = progress.inProgress ?? progress.counts?.inProgress ?? 0
  const remaining = progress.queued ?? progress.counts?.queued ?? Math.max(0, total - finished - failed - inProgress)
  const done = finished + failed
  const percent =
    typeof progress.percent === "number"
      ? progress.percent
      : total > 0
        ? Math.round((done / total) * 100)
        : 0

  return (
    <Alert
      type={progress.isComplete ? (failed > 0 ? "warning" : "success") : "info"}
      showIcon
      message={`Batch #${batchId}`}
      description={
        <Space direction="vertical" style={{ width: "100%" }}>
          <Progress percent={percent} status={progress.isComplete ? undefined : "active"} />
          <Text type="secondary">
            {finished} success · {failed} failed · {inProgress} in progress · {remaining} remaining
            (of {total})
          </Text>
        </Space>
      }
    />
  )
}
