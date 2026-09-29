import React, { useEffect, useMemo, useRef, useState } from "react"
import {
  Button,
  Card,
  Space,
  message,
  Select,
  Alert,
  Radio,
  Divider,
} from "antd"
import {
  SendOutlined,
  DownloadOutlined,
  ReloadOutlined,
} from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import Layout from "src/core/layouts/Layout"
import processExcelUpload from "src/conso/mutations/processExcelUploadConso"
import getUploadHistory from "src/companies/queries/getUploadHistory"
import getCompanies from "src/companies/queries/getCompanies"
import retryFailedConsoBatchTasks from "src/tasks/mutations/retryFailedConsoBatchTasks"
import type { ConsoBatchProgress } from "src/tasks/consoBatchProgress"
import dayjs from "dayjs"
import "dayjs/locale/en-gb"
import { ConfigProvider } from "antd"
import enGB from "antd/lib/locale/en_GB"
import { type CompanyCredentials } from "src/shared/ui/readCompanyCredentialsFile"
import { CompanyCredentialsUpload } from "src/shared/ui/CompanyCredentialsUpload"
import { UploadHistoryTable } from "src/shared/ui/UploadHistoryTable"
import { BatchProgressPoller } from "src/shared/ui/BatchProgressPoller"
import { FailedTasksRetryModal } from "src/shared/ui/FailedTasksRetryModal"

// Set dayjs locale to en-gb (starts week on Monday)
dayjs.locale("en-gb")

type CompanyData = CompanyCredentials

function ConsoFilesPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [processExcelUploadMutation] = useMutation(processExcelUpload)
  const [retryFailedMutation] = useMutation(retryFailedConsoBatchTasks)
  const [uploadHistoryResponse, { refetch }] = useQuery(
    getUploadHistory,
    {
      skip: 0,
      take: 100,
      type: "conso",
    },
    { refetchOnWindowFocus: false }
  )

  const [excelData, setExcelData] = useState<CompanyData[]>([])
  const [selectedCompanyIds, setSelectedCompanyIds] = useState<number[]>([])
  const [dataSource, setDataSource] = useState<"excel" | "companies">("companies")
  const [actionType, setActionType] = useState<"send_request" | "download_file">("download_file")
  const [sendToAllPeriods, setSendToAllPeriods] = useState<boolean>(false)
  const [financialYear, setFinancialYear] = useState<string[]>([])
  const [quarter, setQuarter] = useState<string[]>([])
  const [formType, setFormType] = useState<string[]>([])
  const [loading, setLoading] = useState(false)
  const [fileList, setFileList] = useState<any[]>([])
  const [activeBatchId, setActiveBatchId] = useState<number | null>(null)
  const [retrying, setRetrying] = useState(false)
  const [retryModalOpen, setRetryModalOpen] = useState(false)
  const [selectedFailedTaskIds, setSelectedFailedTaskIds] = useState<number[]>([])
  const wasBatchCompleteRef = useRef(false)

  const [companiesResponse] = useQuery(
    getCompanies,
    {
      orderBy: { name: "asc" },
      skip: 0,
      take: 10000,
    },
    { refetchOnWindowFocus: false }
  )

  const savedCompanies: any = companiesResponse?.companies || []
  const [batchProgress, setBatchProgress] = useState<ConsoBatchProgress | null>(null)

  useEffect(() => {
    wasBatchCompleteRef.current = false
    setRetryModalOpen(false)
    setSelectedFailedTaskIds([])
    setBatchProgress(null)
    if (!activeBatchId) return

    const source = new EventSource(`/api/conso/batch-progress?batchId=${activeBatchId}`)
    source.onmessage = (event) => {
      try {
        const next = JSON.parse(event.data) as ConsoBatchProgress
        if (next?.batchId !== activeBatchId) return
        setBatchProgress(next)
      } catch {
        /* ignore malformed frames */
      }
    }
    source.onerror = () => {
      /* EventSource reconnects on its own; do not RPC-poll */
    }

    return () => {
      source.close()
    }
  }, [activeBatchId])

  useEffect(() => {
    if (!activeBatchId || batchProgress?.batchId !== activeBatchId) return
    const complete = Boolean(batchProgress?.isComplete)
    const failedItems = (batchProgress?.items || []).filter((i) => i.status === "Failed")
    if (complete && !wasBatchCompleteRef.current && failedItems.length > 0) {
      setSelectedFailedTaskIds(failedItems.map((i) => i.taskId))
      setRetryModalOpen(true)
      void refetch()
    }
    if (batchProgress?.batchId === activeBatchId) {
      wasBatchCompleteRef.current = complete
    }
  }, [activeBatchId, batchProgress?.batchId, batchProgress?.isComplete, batchProgress?.items, refetch])

  const failedProgressItems = useMemo(
    () => (batchProgress?.items || []).filter((i) => i.status === "Failed"),
    [batchProgress?.items]
  )

  // Generate financial year options
  const generateFinancialYears = (): Array<{ label: string; value: string }> => {
    const currentYear = new Date().getFullYear()
    const years: Array<{ label: string; value: string }> = []
    for (let i = 0; i < 10; i++) {
      const year = currentYear - i
      years.push({
        label: `${year}-${(year + 1).toString().slice(-2)}`,
        value: `${year}-${(year + 1).toString().slice(-2)}`,
      })
    }
    return years
  }

  const quarterOptions = [
    { label: "Q1 (Apr-Jun)", value: "Q1" },
    { label: "Q2 (Jul-Sep)", value: "Q2" },
    { label: "Q3 (Oct-Dec)", value: "Q3" },
    { label: "Q4 (Jan-Mar)", value: "Q4" },
  ]

  const formTypeOptions = [
    { label: "24Q", value: "24Q" },
    { label: "26Q", value: "26Q" },
    { label: "27Q", value: "27Q" },
    { label: "27EQ", value: "27EQ" },
  ]

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
      // Convert selected company IDs to CompanyData format
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

    // Validation for send_request action
    if (actionType === "send_request" && !sendToAllPeriods) {
      if (!financialYear || financialYear.length === 0) {
        messageApi.error("Please select at least one financial year")
        return
      }

      if (!quarter || quarter.length === 0) {
        messageApi.error("Please select at least one quarter")
        return
      }

      if (!formType || formType.length === 0) {
        messageApi.error("Please select at least one form type")
        return
      }
    }

    setLoading(true)
    try {
      const result = await processExcelUploadMutation({
        companies: companiesToProcess,
        financialYear: actionType === "send_request" && !sendToAllPeriods ? financialYear : [],
        quarter: actionType === "send_request" && !sendToAllPeriods ? quarter : [],
        formType: actionType === "send_request" && !sendToAllPeriods ? formType : [],
        actionType,
        sendToAllPeriods: actionType === "send_request" ? sendToAllPeriods : false,
        jobTypes: actionType === "send_request" ? ["SendRequest"] : ["DownloadFile"],
      })

      const actionMessage =
        actionType === "send_request"
          ? sendToAllPeriods
            ? `Send request jobs for all periods queued — Batch #${result.batchId}`
            : `Send request jobs queued — Batch #${result.batchId}`
          : `Download jobs queued — Batch #${result.batchId}`
      messageApi.success(actionMessage)

      setActiveBatchId(result.batchId)
      setExcelData([])
      setFileList([])
      setSelectedCompanyIds([])
      setSendToAllPeriods(false)
      setFinancialYear([])
      setQuarter([])
      setFormType([])
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Failed to process upload")
    } finally {
      setLoading(false)
    }
  }

  const handleRetryFailedTasks = async (taskIds?: number[]) => {
    if (!activeBatchId) return
    const ids = taskIds && taskIds.length > 0 ? taskIds : selectedFailedTaskIds
    if (!ids.length) {
      messageApi.warning("Select at least one failed task to retry")
      return
    }
    setRetrying(true)
    try {
      const result = await retryFailedMutation({
        batchId: activeBatchId,
        taskIds: ids,
      })
      messageApi.success(result.message)
      setRetryModalOpen(false)
      setSelectedFailedTaskIds([])
      wasBatchCompleteRef.current = false
      await refetch()
    } catch (error: any) {
      messageApi.error(error.message || "Retry failed")
    } finally {
      setRetrying(false)
    }
  }



  return (
    <ConfigProvider locale={enGB}>
      <Layout title="Conso Files Upload & Processing">
        {contextHolder}
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          {/* Company Selection Card */}
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
                    description="You don't have any saved companies yet. Please go to the Companies page to add companies, or use 'Upload Excel File' option instead."
                    type="warning"
                    showIcon
                  />
                ) : (
                  <>
                    <Alert
                      message="Select Companies"
                      description="Choose companies from your saved list. You can manage companies in the Companies page."
                      type="info"
                      showIcon
                      style={{ marginBottom: 20 }}
                    />

                    <div>
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
                        <span style={{ fontSize: "12px", color: "#888", marginLeft: "8px" }}>
                          💡 Tip: Type to search by company name or TAN
                        </span>
                      </div>

                      <Select
                        mode="multiple"
                        placeholder="Select companies to process or use 'Select All' button above"
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
                    </div>

                    {selectedCompanyIds.length > 0 && (
                      <Alert
                        message={`${selectedCompanyIds.length} of ${savedCompanies.length} company(ies) selected`}
                        type="success"
                        showIcon
                      />
                    )}
                  </>
                )}
              </Space>
            ) : (
              <Space direction="vertical" size="middle" style={{ width: "100%" }}>
                <Alert
                  message="Excel Format Required"
                  description="Please upload an Excel file (.xlsx or .xls) with the following columns: Company Name, Tan, IT Password, User ID, Password"
                  type="info"
                  showIcon
                />
                <CompanyCredentialsUpload
                  fileList={fileList}
                  onFileListChange={setFileList}
                  onParsed={(companies) => {
                    setExcelData(companies)
                    if (companies.length > 0) {
                      messageApi.success(`Successfully loaded ${companies.length} companies from Excel`)
                    }
                  }}
                  onError={(msg) => {
                    messageApi.error(msg)
                    setFileList([])
                  }}
                  accept=".xlsx,.xls"
                  buttonText="Select Excel File"
                />

                {excelData.length > 0 && (
                  <Alert
                    message={`${excelData.length} companies loaded from Excel`}
                    type="success"
                    showIcon
                  />
                )}
              </Space>
            )}
          </Card>


          {/* Action Configuration Card */}
          <Card title="Action Configuration">
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <div style={{ marginBottom: 20 }}>
                <label
                  style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}
                >
                  Action Type *
                </label>
                <Radio.Group
                  value={actionType}
                  onChange={(e) => setActionType(e.target.value)}
                  style={{ width: "100%" }}
                >
                  <Space direction="vertical" size="middle">
                    <Radio value="download_file">
                      <Space>
                        <DownloadOutlined />
                        <span>
                          <strong>Download File</strong> - Download Conso files from portal
                        </span>
                      </Space>
                    </Radio>
                    <Radio value="send_request">
                      <Space>
                        <SendOutlined />
                        <span>
                          <strong>Send Request</strong> - Send Conso request to portal
                        </span>
                      </Space>
                    </Radio>
                  </Space>
                </Radio.Group>
              </div>

              {actionType === "send_request" && (
                <>
                  <Divider orientation="left">Request Options</Divider>
                  <div style={{ marginBottom: 20 }}>
                    <label
                      style={{ display: "block", marginBottom: 12, fontWeight: 600, fontSize: 16 }}
                    >
                      Period Selection *
                    </label>
                    <Radio.Group
                      value={sendToAllPeriods ? "all_periods" : "specific_period"}
                      onChange={(e) => setSendToAllPeriods(e.target.value === "all_periods")}
                      style={{ width: "100%" }}
                    >
                      <Space direction="vertical" size="middle">
                        <Radio value="specific_period">
                          <Space>
                            <span>
                              <strong>Specific Period</strong> - Select specific financial year,
                              quarter, and form type
                            </span>
                          </Space>
                        </Radio>
                        <Radio value="all_periods">
                          <Space>
                            <span>
                              <strong>All Periods</strong> - Send requests for all possible years,
                              quarters, and form types
                            </span>
                          </Space>
                        </Radio>
                      </Space>
                    </Radio.Group>
                  </div>

                  {!sendToAllPeriods && (
                    <>
                      <Divider orientation="left">Request Details</Divider>
                      <Space
                        direction="vertical"
                        size="middle"
                        style={{ width: "100%", marginTop: 20 }}
                      >
                        <div>
                          <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                            Financial Year
                          </label>
                          <Select
                            mode="multiple"
                            value={financialYear}
                            onChange={setFinancialYear}
                            placeholder="Select Financial Years"
                            style={{ width: 400 }}
                            options={generateFinancialYears()}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                            Quarter
                          </label>
                          <Select
                            mode="multiple"
                            value={quarter}
                            onChange={setQuarter}
                            placeholder="Select Quarters"
                            style={{ width: 400 }}
                            options={quarterOptions}
                          />
                        </div>

                        <div>
                          <label style={{ display: "block", marginBottom: 8, fontWeight: 500 }}>
                            Form Type
                          </label>
                          <Select
                            mode="multiple"
                            value={formType}
                            onChange={setFormType}
                            placeholder="Select Form Types"
                            style={{ width: 400 }}
                            options={formTypeOptions}
                          />
                        </div>
                      </Space>
                    </>
                  )}
                </>
              )}

              <Space style={{ marginTop: 30 }} wrap>
                <Button
                  type="primary"
                  size="large"
                  loading={loading}
                  onClick={handleSubmit}
                  disabled={
                    (dataSource === "excel" && excelData.length === 0) ||
                    (dataSource === "companies" && selectedCompanyIds.length === 0) ||
                    (actionType === "send_request" &&
                      !sendToAllPeriods &&
                      (financialYear.length === 0 || quarter.length === 0 || formType.length === 0))
                  }
                  icon={actionType === "send_request" ? <SendOutlined /> : <DownloadOutlined />}
                >
                  {actionType === "send_request" ? "Send Request" : "Download Conso Files"}
                </Button>
              </Space>
            </Space>
          </Card>

          {activeBatchId && (
            <Card
              title={`Batch #${activeBatchId} progress`}
              extra={
                failedProgressItems.length > 0 && batchProgress?.isComplete ? (
                  <Button
                    danger
                    icon={<ReloadOutlined />}
                    onClick={() => {
                      setSelectedFailedTaskIds(failedProgressItems.map((i) => i.taskId))
                      setRetryModalOpen(true)
                    }}
                  >
                    Review failed ({failedProgressItems.length})
                  </Button>
                ) : null
              }
            >
              <BatchProgressPoller batchId={activeBatchId} progress={batchProgress} />
            </Card>
          )}

          <FailedTasksRetryModal
            open={retryModalOpen}
            batchId={activeBatchId}
            items={failedProgressItems}
            selectedTaskIds={selectedFailedTaskIds}
            retrying={retrying}
            onChangeSelected={setSelectedFailedTaskIds}
            onRetry={handleRetryFailedTasks}
            onClose={() => setRetryModalOpen(false)}
          />

          <UploadHistoryTable
            title="Upload History"
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

ConsoFilesPage.authenticate = { redirectTo: "/auth/login" }
export default ConsoFilesPage
