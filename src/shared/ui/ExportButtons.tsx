import React, { useState } from "react"
import { Button, Dropdown, Space, message } from "antd"
import type { MenuProps } from "antd"
import {
  DownloadOutlined,
  FileExcelOutlined,
  FilePdfOutlined,
  FileTextOutlined,
} from "@ant-design/icons"
import type { ExportFeature, ExportFormat } from "src/shared/export/types"

export type ExportButtonsProps = {
  feature: ExportFeature
  /** Query/body filters forwarded to POST /api/export/{feature} */
  filters?: {
    companyId?: number
    fy?: string
    search?: string
    formTypeCd?: "T140" | "F26Q"
  }
  /** Disable when parent knows there is no data */
  disabled?: boolean
  size?: "small" | "middle" | "large"
}

async function downloadExport(
  feature: ExportFeature,
  format: ExportFormat,
  filters: ExportButtonsProps["filters"] = {}
): Promise<void> {
  const response = await fetch(`/api/export/${feature}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ format, ...filters }),
  })

  const contentType = response.headers.get("content-type") || ""
  if (!response.ok) {
    let errorMessage = `Export failed (${response.status})`
    if (contentType.includes("application/json")) {
      const json = await response.json()
      errorMessage = json.error || json.message || errorMessage
    }
    throw new Error(errorMessage)
  }

  const blob = await response.blob()
  const disposition = response.headers.get("content-disposition") || ""
  const match = /filename="?([^"]+)"?/i.exec(disposition)
  const filename = match?.[1] || `${feature}-${new Date().toISOString().split("T")[0]}.${format}`

  const url = URL.createObjectURL(blob)
  const link = document.createElement("a")
  link.href = url
  link.download = filename
  link.style.visibility = "hidden"
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export function ExportButtons({
  feature,
  filters,
  disabled,
  size = "middle",
}: ExportButtonsProps) {
  const [loadingFormat, setLoadingFormat] = useState<ExportFormat | null>(null)
  const [messageApi, contextHolder] = message.useMessage()

  const run = async (format: ExportFormat) => {
    setLoadingFormat(format)
    try {
      await downloadExport(feature, format, filters)
      messageApi.success(
        format === "xlsx" ? "Excel downloaded" : format === "pdf" ? "PDF downloaded" : "CSV downloaded"
      )
    } catch (error: any) {
      messageApi.error(error?.message || "Export failed")
    } finally {
      setLoadingFormat(null)
    }
  }

  const menuItems: MenuProps["items"] = [
    {
      key: "xlsx",
      icon: <FileExcelOutlined />,
      label: "Download Excel",
      onClick: () => run("xlsx"),
    },
    {
      key: "pdf",
      icon: <FilePdfOutlined />,
      label: "Download PDF",
      onClick: () => run("pdf"),
    },
    {
      key: "csv",
      icon: <FileTextOutlined />,
      label: "Download CSV",
      onClick: () => run("csv"),
    },
  ]

  return (
    <>
      {contextHolder}
      <Space>
        <Button
          icon={<FileExcelOutlined />}
          size={size}
          disabled={disabled}
          loading={loadingFormat === "xlsx"}
          onClick={() => run("xlsx")}
        >
          Excel
        </Button>
        <Button
          icon={<FilePdfOutlined />}
          size={size}
          disabled={disabled}
          loading={loadingFormat === "pdf"}
          onClick={() => run("pdf")}
        >
          PDF
        </Button>
        <Dropdown menu={{ items: menuItems }} disabled={disabled}>
          <Button icon={<DownloadOutlined />} size={size} loading={loadingFormat === "csv"}>
            More
          </Button>
        </Dropdown>
      </Space>
    </>
  )
}
