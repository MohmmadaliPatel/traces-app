import React from "react"
import { Upload, Button } from "antd"
import { UploadOutlined } from "@ant-design/icons"
import type { UploadFile } from "antd/es/upload/interface"
import {
  readCompanyCredentialsFromFile,
  type CompanyCredentials,
} from "src/shared/ui/readCompanyCredentialsFile"

type Props = {
  fileList: UploadFile[]
  onFileListChange: (files: UploadFile[]) => void
  onParsed: (companies: CompanyCredentials[]) => void
  onError?: (message: string) => void
  accept?: string
  buttonText?: string
}

/**
 * Shared Ant Design Upload for the canonical 5-column company credentials file.
 * Prevents auto-upload; parses client-side via SheetJS.
 */
export function CompanyCredentialsUpload({
  fileList,
  onFileListChange,
  onParsed,
  onError,
  accept = ".xlsx,.xls,.csv",
  buttonText = "Upload Excel / CSV",
}: Props) {
  return (
    <Upload
      accept={accept}
      fileList={fileList}
      beforeUpload={async (file) => {
        try {
          const companies = await readCompanyCredentialsFromFile(file as unknown as File)
          onParsed(companies)
          onFileListChange([file as unknown as UploadFile])
        } catch (e: any) {
          onError?.(e?.message || "Failed to parse file")
          onFileListChange([])
        }
        return false
      }}
      onRemove={() => {
        onFileListChange([])
        onParsed([])
      }}
      maxCount={1}
    >
      <Button icon={<UploadOutlined />}>{buttonText}</Button>
    </Upload>
  )
}
