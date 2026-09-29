import React, { useEffect, useMemo, useState } from "react"
import {
  Button,
  Table,
  Card,
  Space,
  message,
  Select,
  Tag,
  Alert,
  Radio,
  Progress,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import { SyncOutlined, ReloadOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import processExcelUpload from "src/justification/mutations/processExcelUploadJustification"
import getUploadHistory from "src/companies/queries/getUploadHistory"
import getCompanies from "src/companies/queries/getCompanies"
import getJustificationBatchProgress from "src/tasks/queries/getJustificationBatchProgress"
import retryFailedJustificationBatchTasks from "src/tasks/mutations/retryFailedJustificationBatchTasks"
import dayjs from "dayjs"
import "dayjs/locale/en-gb"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"
import { type CompanyCredentials } from "src/shared/ui/readCompanyCredentialsFile"
import { UploadHistoryStatusTag } from "src/shared/ui/UploadHistoryStatusTag"
import { BatchProgressPoller } from "src/shared/ui/BatchProgressPoller"
import { BatchJobControls } from "src/shared/ui/BatchJobControls"
import { CompanyCredentialsUpload } from "src/shared/ui/CompanyCredentialsUpload"
import { UploadHistoryTable } from "src/shared/ui/UploadHistoryTable"

dayjs.locale("en-gb")

const DEFAULT_FINANCIAL_YEAR = "2026-27"
const DEFAULT_QUARTER = "Q1"
const DEFAULT_FORM_TYPE = "140"

type CompanyData = CompanyCredentials

function JustificationReportPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [processExcelUploadMutation] = useMutation(processExcelUpload)
  const [retryFailedMutation] = useMutation(retryFailedJustificationBatchTasks)
  const [uploadHistoryResponse, { refetch }] = useQuery(getUploadHistory, {
    skip: 0,
    take: 100,
    type: "justification",
  })

  const [excelData, setExcelData] = useState<CompanyData[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [dataSource, setDataSource] = useState<"excel" | "companies">("companies")
  const [actionType, setActionType] = useState<"send_request" | "download_file">("download_file")
  const [loading, setLoading] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null)

  const [companiesResponse] = useQuery(getCompanies, {
    orderBy: { name: "asc" },
    skip: 0,
    take: 10000,
  })

  const savedCompanies: any = companiesResponse?.companies || []

  const [batchProgress, { refetch: refetchProgress }] = useQuery(
    getJustificationBatchProgress,
    { batchId: activeBatchId || 0 },
    {
      enabled: !!activeBatchId,
      refetchInterval: activeBatchId ? 2000 : false,
      suspense: false,
    }
  )

  useEffect(() => {
    if (batchProgress?.isComplete) {
      void refetch()
    }
  }, [batchProgress?.isComplete, refetch])

  const handleSubmit = async () => {
    let companiesToProcess: CompanyData[] = []

    if (dataSource === "excel") {
      if (excelData.length === 0) {
        messageApi.error("Please upload an Excel file first")
        return
      }
      companiesToProcess = excelData
    } else {
      if (selectedCompanyIds.length === 0) {
        messageApi.error("Please select at least one company")
        return
      }
      companiesToProcess = savedCompanies
        .filter((c) => selectedCompanyIds.includes(c.id))
        .map((c) => ({
          name: c.name,
          tan: c.tan,
          it_password: c.it_password,
          user_id: c.user_id,
          password: c.password,
        }))
    }

    if (companiesToProcess.length === 0) {
      messageApi.error("No companies selected")
      return
    }

    setLoading(true)
    try {
      const result = await processExcelUploadMutation({
        companies: companiesToProcess,
        financialYear: [DEFAULT_FINANCIAL_YEAR],
        quarter: [DEFAULT_QUARTER],
        formType: [DEFAULT_FORM_TYPE],
        actionType,
        sendToAllPeriods: false,
        jobTypes: actionType === "send_request" ? ["SendRequest"] : ["DownloadFile"],
      })

      messageApi.success(`Queued ${companiesToProcess.length} companies — Batch #${result.batchId}`)

      setActiveBatchId(result.batchId)
      setExcelData([])
      setFileList([])
      setSelectedCompanyIds([])
      await refetch()
      await refetchProgress()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to process upload")
    } finally {
      setLoading(false)
    }
  }

  const handleRetryFailed = async (taskIds?: number[]) => {
    if (!activeBatchId) return
    setRetrying(true)
    try {
      const result = await retryFailedMutation({
        batchId: activeBatchId,
        taskIds,
      })
      messageApi.success(result.message)
      await refetchProgress()
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Retry failed")
    } finally {
      setRetrying(false)
    }
  }

  const getStatusTag = (status: string) => <UploadHistoryStatusTag status={status} />

  const progressColumns: ColumnsType<any> = useMemo(
    () => [
      {
        title: "#",
        width: 60,
        render: (_: any, __: any, index: number) => index + 1,
      },
      { title: "Company", dataIndex: "companyName", key: "companyName", width: 220 },
      { title: "TAN", dataIndex: "tan", key: "tan", width: 120 },
      { title: "FY", dataIndex: "financialYear", key: "financialYear", width: 100 },
      { title: "Quarter", dataIndex: "quarter", key: "quarter", width: 80 },
      { title: "Form", dataIndex: "formType", key: "formType", width: 80 },
      {
        title: "Status",
        dataIndex: "status",
        key: "status",
        width: 140,
        render: (status: string) => getStatusTag(status),
      },
      {
        title: "Error",
        dataIndex: "errorMessage",
        key: "errorMessage",
        ellipsis: true,
        render: (msg: string | null) => msg || "-",
      },
      {
        title: "Retry",
        key: "retry",
        width: 100,
        render: (_: any, row: any) =>
          row.status === "Failed" ? (
            <Button
              size="small"
              icon={<ReloadOutlined />}
              loading={retrying}
              onClick={() => handleRetryFailed([row.taskId])}
            >
              Retry
            </Button>
          ) : null,
      },
    ],
    [retrying]
  )

  const counts = batchProgress?.counts

  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Justification Report">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Card
            title="Select Companies"
            extra={
              <Radio.Group
                value={dataSource}
                onChange={(e) => {
                  setDataSource(e.target.value)
                  setExcelData([])
                  setSelectedCompanyIds([])
                  setFileList([])
                }}
              >
                <Radio.Button value="companies">From Saved Companies</Radio.Button>
                <Radio.Button value="excel">Upload Excel File</Radio.Button>
              </Radio.Group>
            }
          >
            {dataSource === "companies" ? (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                {savedCompanies.length === 0 ? (
                  <Alert
                    message="No Companies Available"
                    description="Add companies on the Companies page, or upload Excel."
                    type="warning"
                    showIcon
                  />
                ) : (
                  <>
                    <div
                      style={{ marginBottom: 12, display: "flex", gap: 8, alignItems: "center" }}
                    >
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedCompanyIds(savedCompanies.map((c) => c.id))}
                        disabled={savedCompanies.length === 0}
                      >
                        Select All ({savedCompanies.length})
                      </Button>
                      <Button
                        type="default"
                        size="small"
                        onClick={() => setSelectedCompanyIds([])}
                        disabled={selectedCompanyIds.length === 0}
                      >
                        Clear All
                      </Button>
                    </div>

                    <Select
                      mode="multiple"
                      placeholder="Select companies"
                      value={selectedCompanyIds}
                      onChange={setSelectedCompanyIds}
                      style={{ width: "100%" }}
                      showSearch
                      maxTagCount="responsive"
                      filterOption={(input, option) => {
                        const company = savedCompanies.find((c) => c.id === option?.value)
                        if (!company) return false
                        return (
                          company.name.toLowerCase().includes(input.toLowerCase()) ||
                          company.tan.toLowerCase().includes(input.toLowerCase())
                        )
                      }}
                      options={savedCompanies.map((c) => ({
                        label: `${c.name} (${c.tan})`,
                        value: c.id,
                      }))}
                    />
                  </>
                )}
              </Space>
            ) : (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <CompanyCredentialsUpload
                  fileList={fileList}
                  onFileListChange={setFileList}
                  onParsed={(companies) => {
                    setExcelData(companies)
                    if (companies.length > 0) {
                      messageApi.success(`Loaded ${companies.length} companies`)
                    }
                  }}
                  onError={(msg) => messageApi.error(msg)}
                  accept=".xlsx,.xls"
                  buttonText="Select Excel File"
                />

                {excelData.length > 0 && (
                  <Alert message={`${excelData.length} companies loaded`} type="success" showIcon />
                )}
              </Space>
            )}
          </Card>

          <Card title="Action Configuration">
            <BatchJobControls
              actionType={actionType}
              onActionTypeChange={setActionType}
              onSubmit={handleSubmit}
              loading={loading}
              disabled={
                (dataSource === "excel" && excelData.length === 0) ||
                (dataSource === "companies" && selectedCompanyIds.length === 0)
              }
              downloadLabel="Download / Initiate"
              submitLabel={
                actionType === "send_request" ? "Send Request" : "Download / Initiate"
              }
            />
          </Card>

          {activeBatchId && (
            <>
              <BatchProgressPoller batchId={activeBatchId} progress={batchProgress} />
              <Card
                title={`Progress — Batch #${activeBatchId}`}
                extra={
                  <Space>
                    {(counts?.failed || 0) > 0 && (
                      <Button
                        danger
                        icon={<ReloadOutlined />}
                        loading={retrying}
                        onClick={() => handleRetryFailed()}
                      >
                        Retry failed ({counts?.failed})
                      </Button>
                    )}
                    <Button icon={<SyncOutlined />} onClick={() => refetchProgress()}>
                      Refresh
                    </Button>
                  </Space>
                }
              >
                <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                  <Progress
                    percent={batchProgress?.percent || 0}
                    status={
                      batchProgress?.isComplete
                        ? (counts?.failed || 0) > 0
                          ? "exception"
                          : "success"
                        : "active"
                    }
                  />
                  <Space wrap>
                    <Tag>Total: {counts?.total ?? 0}</Tag>
                    <Tag color="default">Queued: {counts?.queued ?? 0}</Tag>
                    <Tag color="processing">In progress: {counts?.inProgress ?? 0}</Tag>
                    <Tag color="success">Finished: {counts?.finished ?? 0}</Tag>
                    <Tag color="error">Failed: {counts?.failed ?? 0}</Tag>
                  </Space>
                  <Table
                    rowKey="taskId"
                    size="small"
                    columns={progressColumns}
                    dataSource={batchProgress?.items || []}
                    pagination={{ pageSize: 50, showTotal: (t) => `${t} tasks` }}
                    scroll={{ x: 1100, y: 420 }}
                  />
                </Space>
              </Card>
            </>
          )}

          <UploadHistoryTable
            records={uploadHistoryResponse?.uploadHistory || []}
            total={uploadHistoryResponse?.count || 0}
            onRefresh={() => refetch()}
            onSelectBatch={setActiveBatchId}
          />
        </Space>
      </Layout>
    </ConfigProvider>
  )
}

JustificationReportPage.authenticate = { redirectTo: "/auth/login" }
export default JustificationReportPage
