import React, { useState, useMemo } from "react"
import {
  Button,
  List,
  Breadcrumb,
  Card,
  Tooltip,
  Input,
  Space,
  Row,
  Col,
  Select,
  Typography,
  Avatar,
  Tag,
  Empty,
  Spin,
  Modal,
  Table,
  message,
  Tabs,
} from "antd"
import {
  DownloadOutlined,
  FolderOpenOutlined,
  FileOutlined,
  SearchOutlined,
  FilePdfOutlined,
  FileImageOutlined,
  FileWordOutlined,
  FileExcelOutlined,
  FilePptOutlined,
  FileZipOutlined,
  FileTextOutlined,
  EyeOutlined,
  HomeOutlined,
  SortAscendingOutlined,
  SortDescendingOutlined,
  FolderOutlined,
} from "@ant-design/icons"
import Layout from "src/core/layouts/Layout"
import { useRouter } from "next/router"
import * as XLSX from "xlsx"

const { Search } = Input
const { Title, Text } = Typography
const { TabPane } = Tabs

// File type icons mapping
const getFileIcon = (fileName: string) => {
  const ext = fileName.substring(fileName.lastIndexOf(".")).toLowerCase()
  const iconProps = { style: { fontSize: "24px" } }

  switch (ext) {
    case ".pdf":
      return <FilePdfOutlined {...iconProps} style={{ ...iconProps.style, color: "#ff4d4f" }} />
    case ".jpg":
    case ".jpeg":
    case ".png":
    case ".gif":
    case ".bmp":
      return <FileImageOutlined {...iconProps} style={{ ...iconProps.style, color: "#52c41a" }} />
    case ".doc":
    case ".docx":
      return <FileWordOutlined {...iconProps} style={{ ...iconProps.style, color: "#1890ff" }} />
    case ".xls":
    case ".xlsx":
      return <FileExcelOutlined {...iconProps} style={{ ...iconProps.style, color: "#52c41a" }} />
    case ".ppt":
    case ".pptx":
      return <FilePptOutlined {...iconProps} style={{ ...iconProps.style, color: "#fa8c16" }} />
    case ".zip":
    case ".rar":
    case ".7z":
      return <FileZipOutlined {...iconProps} style={{ ...iconProps.style, color: "#722ed1" }} />
    case ".txt":
      return <FileTextOutlined {...iconProps} style={{ ...iconProps.style, color: "#8c8c8c" }} />
    default:
      return <FileOutlined {...iconProps} style={{ ...iconProps.style, color: "#8c8c8c" }} />
  }
}

// Check if file is Excel
const isExcelFile = (fileName: string) => {
  const ext = fileName.substring(fileName.lastIndexOf(".")).toLowerCase()
  return ext === ".xlsx" || ext === ".xls"
}

export default function ItDocumentPage({ structure, virtualStructure }) {
  const router = useRouter()
  const [currentPath, setCurrentPath] = useState<string[]>([])
  const [searchTerm, setSearchTerm] = useState("")
  const [sortBy, setSortBy] = useState("name")
  const [sortOrder, setSortOrder] = useState("asc")
  const [loading, setLoading] = useState(false)
  const [excelData, setExcelData] = useState<any>(null)
  const [excelModalVisible, setExcelModalVisible] = useState(false)
  const [previewFileName, setPreviewFileName] = useState("")

  const navigateToFolder = async (path: string[]) => {
    setLoading(true)
    setTimeout(() => {
      setCurrentPath(path)
      setLoading(false)
    }, 200)
  }

  const previewExcelFile = async (filePath: string, fileName: string) => {
    try {
      setLoading(true)
      const response = await fetch(filePath)
      const arrayBuffer = await response.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer)

      const sheetsData = {}
      workbook.SheetNames.forEach((sheetName) => {
        const worksheet = workbook.Sheets[sheetName]
        if (worksheet) {
          try {
            // Get raw data first
            const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: "" })

            // Handle edge cases for data processing
            let processedData = jsonData as any[][]

            // Remove completely empty rows from the beginning and end
            while (
              processedData.length > 0 &&
              processedData[0] &&
              processedData[0].every((cell) => !cell && cell !== 0)
            ) {
              processedData.shift()
            }
            while (
              processedData.length > 0 &&
              processedData[processedData.length - 1] &&
              processedData[processedData.length - 1]!.every((cell) => !cell && cell !== 0)
            ) {
              processedData.pop()
            }

            // If there's no data at all, create a placeholder
            if (processedData.length === 0) {
              processedData = [["No data found in this sheet"]]
            } else {
              // Ensure all rows have the same number of columns
              const maxColumns = Math.max(...processedData.map((row) => (row ? row.length : 0)))
              processedData = processedData.map((row) => {
                if (!row) return []
                const paddedRow = [...row]
                while (paddedRow.length < maxColumns) {
                  paddedRow.push("")
                }
                return paddedRow
              })

              // If there's only one row, treat it as data without headers
              if (processedData.length === 1 && processedData[0]) {
                const dataRow = processedData[0]
                const headers = dataRow.map((_, index) => `Column ${index + 1}`)
                processedData = [headers, dataRow]
              }

              // Check if first row looks like headers (contains strings) vs data (mostly numbers)
              const firstRow = processedData[0]
              const hasHeaders =
                firstRow &&
                firstRow.some(
                  (cell) => typeof cell === "string" && cell.trim() !== "" && isNaN(Number(cell))
                )

              // If no clear headers detected, generate them
              if (!hasHeaders && processedData.length > 0 && firstRow) {
                const headers = firstRow.map((_, index) => `Column ${index + 1}`)
                processedData = [headers, ...processedData]
              }
            }

            sheetsData[sheetName] = processedData
          } catch (sheetError) {
            console.error(`Error processing sheet ${sheetName}:`, sheetError)
            sheetsData[sheetName] = [["Error reading this sheet"]]
          }
        } else {
          sheetsData[sheetName] = [["Sheet not found"]]
        }
      })

      setExcelData(sheetsData)
      setPreviewFileName(fileName)
      setExcelModalVisible(true)
      setLoading(false)
    } catch (error) {
      console.error("Error reading Excel file:", error)
      message.error("Failed to preview Excel file")
      setLoading(false)
    }
  }

  const renderExcelTable = (data: any[][]) => {
    if (!data || data.length === 0) {
      return <Empty description="No data in this sheet" />
    }

    // Handle case where there's only one row (error message or single data row)
    if (data.length === 1 && data[0]) {
      const singleRow = data[0]
      if (
        singleRow &&
        singleRow.length === 1 &&
        (singleRow[0]?.includes?.("Error") || singleRow[0]?.includes?.("No data"))
      ) {
        return <Empty description={singleRow[0]} />
      }
    }

    const [headers, ...rows] = data

    // Create columns with better handling
    const columns =
      headers?.map((header, index) => ({
        title: header || `Column ${index + 1}`,
        dataIndex: index,
        key: index,
        width: 150,
        ellipsis: true,
        render: (value: any) => {
          // Handle different data types
          if (value === null || value === undefined) return ""
          if (typeof value === "number") return value.toString()
          if (typeof value === "boolean") return value ? "TRUE" : "FALSE"
          return String(value)
        },
      })) || []

    // Create data source with proper key handling
    const dataSource = rows.map((row, rowIndex) => {
      const rowData = { key: rowIndex }
      if (row) {
        row.forEach((cell, cellIndex) => {
          rowData[cellIndex] = cell
        })
      }
      return rowData
    })

    return (
      <div>
        <div style={{ marginBottom: "16px", fontSize: "12px", color: "#666" }}>
          Showing {dataSource.length} rows × {columns.length} columns
        </div>
        <Table
          columns={columns}
          dataSource={dataSource}
          scroll={{ x: "max-content", y: 400 }}
          size="small"
          pagination={{
            pageSize: 50,
            showSizeChanger: true,
            showQuickJumper: true,
            showTotal: (total, range) => `${range[0]}-${range[1]} of ${total} rows`,
          }}
        />
      </div>
    )
  }

  const getCurrentItems = (path: string[], items) => {
    if (path.length === 0) return items
    const [currentFolder, ...restPath] = path
    const folder = items.find((item) => item.name === currentFolder && item.type === "folder")
    return folder ? getCurrentItems(restPath, folder.children) : []
  }

  // Use virtual structure at root, otherwise use regular structure
  const rootItems = currentPath.length === 0 ? virtualStructure : virtualStructure
  const currentItems = getCurrentItems(currentPath, rootItems)

  // Filter and sort items
  const filteredAndSortedItems = useMemo(() => {
    let filtered = currentItems.filter((item) =>
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    )

    // Sort items
    filtered.sort((a, b) => {
      // Always show folders first
      if (a.type === "folder" && b.type === "file") return -1
      if (a.type === "file" && b.type === "folder") return 1

      let comparison = 0
      if (sortBy === "name") {
        comparison = a.name.localeCompare(b.name)
      } else if (sortBy === "size" && a.type === "file" && b.type === "file") {
        // Simple size comparison (would need more sophisticated parsing for proper sorting)
        comparison = a.name.localeCompare(b.name)
      }

      return sortOrder === "asc" ? comparison : -comparison
    })

    return filtered
  }, [currentItems, searchTerm, sortBy, sortOrder])

  const handlePreview = (item: any) => {
    if (isExcelFile(item.name)) {
      previewExcelFile(item.downloadPath, item.name)
    } else {
      window.open(item.downloadPath, "_blank")
    }
  }

  const renderGridView = () => {
    if (filteredAndSortedItems.length === 0) {
      return <Empty description="No files or folders found" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    }

    return (
      <Row gutter={[16, 16]}>
        {filteredAndSortedItems.map((item: any, index) => (
          <Col xs={24} sm={12} md={8} lg={6} xl={4} key={index}>
            <Card
              hoverable
              size="small"
              style={{
                height: "160px",
                borderRadius: "8px",
                border: "1px solid #f0f0f0",
              }}
              bodyStyle={{
                padding: "12px",
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
                height: "100%",
              }}
              onClick={() => {
                if (item.type === "folder") {
                  navigateToFolder([...currentPath, item.name])
                } else {
                  handlePreview(item)
                }
              }}
            >
              <div
                style={{
                  textAlign: "center",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              >
                {item.type === "folder" ? (
                  <div style={{ marginBottom: "8px" }}>
                    <FolderOpenOutlined style={{ fontSize: "32px", color: "#faad14" }} />
                  </div>
                ) : (
                  <div style={{ marginBottom: "8px" }}>{getFileIcon(item.name)}</div>
                )}
                <Tooltip title={item.name}>
                  <Text
                    strong={item.type === "folder"}
                    style={{
                      fontSize: "12px",
                      display: "block",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                      lineHeight: "1.2",
                    }}
                  >
                    {item.name}
                  </Text>
                </Tooltip>
              </div>

              <div style={{ marginTop: "8px", textAlign: "center" }}>
                {item.type === "folder" ? (
                  <Tag color="blue" style={{ fontSize: "10px" }}>
                    {item.itemCount} items
                  </Tag>
                ) : (
                  <div>
                    <Text type="secondary" style={{ fontSize: "10px" }}>
                      {item.size}
                    </Text>
                  </div>
                )}

                <div style={{ marginTop: "6px" }}>
                  <Space size={2}>
                    {item.type === "file" && (
                      <>
                        <Tooltip title={isExcelFile(item.name) ? "Preview Excel" : "Preview"}>
                          <Button
                            type="text"
                            size="small"
                            icon={<EyeOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              handlePreview(item)
                            }}
                          />
                        </Tooltip>
                        <Tooltip title="Download">
                          <Button
                            type="text"
                            size="small"
                            icon={<DownloadOutlined />}
                            onClick={(e) => {
                              e.stopPropagation()
                              const link = document.createElement("a")
                              link.href = item.downloadPath
                              link.download = item.name
                              link.click()
                            }}
                          />
                        </Tooltip>
                      </>
                    )}

                    {item.type === "folder" && (
                      <Tooltip title="Open folder">
                        <Button
                          type="text"
                          size="small"
                          icon={<FolderOutlined />}
                          onClick={(e) => {
                            e.stopPropagation()
                            navigateToFolder([...currentPath, item.name])
                          }}
                        />
                      </Tooltip>
                    )}
                  </Space>
                </div>
              </div>
            </Card>
          </Col>
        ))}
      </Row>
    )
  }

  return (
    <Layout title="IT Documents">
      <div style={{ padding: "24px" }}>
        <Card
          style={{ borderRadius: "8px", boxShadow: "0 2px 8px rgba(0,0,0,0.1)" }}
          bodyStyle={{ padding: "24px" }}
        >
          {/* Breadcrumb */}
          <Breadcrumb style={{ marginBottom: "20px", padding: "8px 0" }}>
            <Breadcrumb.Item>
              <Button
                type="link"
                icon={<HomeOutlined />}
                onClick={() => navigateToFolder([])}
                style={{ padding: 0 }}
              >
                Home
              </Button>
            </Breadcrumb.Item>
            {currentPath.map((folder, index) => (
              <Breadcrumb.Item key={index}>
                <Button
                  type="link"
                  onClick={() => navigateToFolder(currentPath.slice(0, index + 1))}
                  style={{ padding: 0 }}
                >
                  {folder}
                </Button>
              </Breadcrumb.Item>
            ))}
          </Breadcrumb>

          {/* Search and Controls */}
          <Row gutter={16} style={{ marginBottom: "20px" }}>
            <Col xs={24} sm={12} md={8}>
              <Search
                placeholder="Search files and folders..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                prefix={<SearchOutlined />}
                allowClear
              />
            </Col>
            <Col xs={12} sm={6} md={4}>
              <Select
                style={{ width: "100%" }}
                value={sortBy}
                onChange={setSortBy}
                options={[
                  { label: "Name", value: "name" },
                  { label: "Size", value: "size" },
                ]}
              />
            </Col>
            <Col xs={12} sm={6} md={4}>
              <Button
                icon={sortOrder === "asc" ? <SortAscendingOutlined /> : <SortDescendingOutlined />}
                onClick={() => setSortOrder(sortOrder === "asc" ? "desc" : "asc")}
                style={{ width: "100%" }}
              >
                {sortOrder === "asc" ? "A-Z" : "Z-A"}
              </Button>
            </Col>
          </Row>

          {/* Stats */}
          <div style={{ marginBottom: "20px" }}>
            <Space>
              <Tag color="blue">
                📁 {filteredAndSortedItems.filter((item) => item.type === "folder").length} folders
              </Tag>
              <Tag color="green">
                📄 {filteredAndSortedItems.filter((item) => item.type === "file").length} files
              </Tag>
              {searchTerm && (
                <Tag color="orange">🔍 Filtered: {filteredAndSortedItems.length} results</Tag>
              )}
            </Space>
          </div>

          {/* Content */}
          <Spin spinning={loading} tip="Loading...">
            <div style={{ minHeight: "300px" }}>{renderGridView()}</div>
          </Spin>
        </Card>
      </div>

      {/* Excel Preview Modal */}
      <Modal
        title={`Excel Preview: ${previewFileName}`}
        open={excelModalVisible}
        onCancel={() => setExcelModalVisible(false)}
        width="90%"
        style={{ top: 20 }}
        footer={[
          <Button key="close" onClick={() => setExcelModalVisible(false)}>
            Close
          </Button>,
        ]}
      >
        {excelData && (
          <Tabs defaultActiveKey="0">
            {Object.entries(excelData).map(([sheetName, data], index) => (
              <TabPane tab={sheetName} key={index}>
                {renderExcelTable(data as any[][])}
              </TabPane>
            ))}
          </Tabs>
        )}
      </Modal>
    </Layout>
  )
}

export async function getServerSideProps() {
  const fs = require("fs")
  const path = require("path")

  // Define virtual folders and their mappings to actual directories
  const VIRTUAL_FOLDERS = {
    "Conso excel": path.join(process.cwd(), "public", "pdf", "traces_excel"),
    "form 16": path.join(process.cwd(), "public", "pdf", "form16-download"),
    "form 16a": path.join(process.cwd(), "public", "pdf", "form16a-download"),
    "challan details": path.join(process.cwd(), "public", "pdf", "challan_status_results"),
  }

  // Ensure all virtual folders exist
  Object.values(VIRTUAL_FOLDERS).forEach((dirPath) => {
    if (!fs.existsSync(dirPath)) {
      fs.mkdirSync(dirPath, { recursive: true })
    }
  })

  // Get file size
  const formatFileSize = (filePath: string) => {
    try {
      const stats = fs.statSync(filePath)
      const bytes = stats.size
      if (bytes === 0) return "0 Bytes"
      const k = 1024
      const sizes = ["Bytes", "KB", "MB", "GB"]
      const i = Math.floor(Math.log(bytes) / Math.log(k))
      return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i]
    } catch {
      return "Unknown"
    }
  }

  function readDirectoryRecursive(dirPath: string) {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    return entries.map((entry) => {
      const fullPath = path.join(dirPath, entry.name)
      const relativePath = fullPath.replace(`${process.cwd()}\\public\\`, "").replace(/\\/g, "/")
      if (entry.isDirectory()) {
        const children = readDirectoryRecursive(fullPath)
        return {
          name: entry.name,
          type: "folder",
          path: relativePath,
          fullPath: fullPath,
          children,
          itemCount: children.length,
        }
      } else {
        return {
          name: entry.name,
          type: "file",
          downloadPath: `/${relativePath}`,
          fullPath: fullPath,
          size: formatFileSize(fullPath),
          extension: path.extname(entry.name).toLowerCase(),
        }
      }
    })
  }

  function getVirtualRootStructure() {
    return Object.entries(VIRTUAL_FOLDERS).map(([virtualName, actualPath]) => {
      const children = fs.existsSync(actualPath) ? readDirectoryRecursive(actualPath) : []
      return {
        name: virtualName,
        type: "folder",
        path: virtualName,
        fullPath: actualPath,
        children,
        itemCount: children.length,
        isVirtual: true,
      }
    })
  }

  const virtualStructure = getVirtualRootStructure()

  return {
    props: {
      structure: virtualStructure, // Keep for backward compatibility
      virtualStructure,
    },
  }
}
