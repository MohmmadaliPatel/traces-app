import React from "react"
import { Radio, Space, Button } from "antd"
import { SendOutlined, DownloadOutlined } from "@ant-design/icons"

export type BatchActionType = "send_request" | "download_file"

type Props = {
  actionType: BatchActionType
  onActionTypeChange: (value: BatchActionType) => void
  onSubmit: () => void
  loading?: boolean
  disabled?: boolean
  sendLabel?: string
  downloadLabel?: string
  submitLabel?: string
  /** Hide send_request option (e.g. challan status download-only). */
  hideSendRequest?: boolean
}

/**
 * Shared action-type radio + primary submit used by Conso / Form16 / Justification batch pages.
 */
export function BatchJobControls({
  actionType,
  onActionTypeChange,
  onSubmit,
  loading,
  disabled,
  sendLabel = "Send Request",
  downloadLabel = "Download File",
  submitLabel,
  hideSendRequest = false,
}: Props) {
  const label =
    submitLabel ??
    (actionType === "send_request" ? sendLabel : downloadLabel)

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Radio.Group
        value={actionType}
        onChange={(e) => onActionTypeChange(e.target.value)}
        style={{ width: "100%" }}
      >
        <Space direction="vertical" size="middle">
          <Radio value="download_file">
            <Space>
              <DownloadOutlined />
              <span>
                <strong>{downloadLabel}</strong>
              </span>
            </Space>
          </Radio>
          {!hideSendRequest && (
            <Radio value="send_request">
              <Space>
                <SendOutlined />
                <span>
                  <strong>{sendLabel}</strong>
                </span>
              </Space>
            </Radio>
          )}
        </Space>
      </Radio.Group>

      <Button
        type="primary"
        size="large"
        loading={loading}
        onClick={onSubmit}
        disabled={disabled}
        style={{ marginTop: 16 }}
        icon={actionType === "send_request" ? <SendOutlined /> : <DownloadOutlined />}
      >
        {label}
      </Button>
    </Space>
  )
}
