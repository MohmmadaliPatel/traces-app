import React, { useMemo, useState } from "react"
import {
  Alert,
  Button,
  Card,
  ConfigProvider,
  Progress,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from "antd"
import type { ColumnsType } from "antd/es/table"
import { CloudDownloadOutlined, FileExcelOutlined, SyncOutlined } from "@ant-design/icons"
import enGB from "antd/lib/locale/en_GB"
import Layout from "src/core/layouts/Layout"
import { CONTINUUM_GROUP } from "src/clause34/continuumGroup"

const { Title, Text, Paragraph } = Typography

type BuiltRow = {
  entity: string
  sheet: string
  tan: string
  formType: string
  quarter: string
  dueDate: string
  dateOfFurnishing: string
  workbookDate: string
  basis: string
  comparison: string
  correctionCount: number
  status: string
  timeliness: string
  remarks: string
}

type Counts = Record<string, number>

type Clause34cEntity = {
  tan: string
  sheet: string
  liable: boolean
  payable: number
  paid: number
  computed: number
  difference: number
  challans: number
  excluded: number
  unverified: number
}

type Clause34c = {
  totals: {
    payable: number
    paid: number
    computed: number
    liableCount: number
    verifiedRows: number
    carriedForwardRows: number
  }
  mismatches: string[]
  entities: Clause34cEntity[]
}

const inr = (n: number) => n.toLocaleString("en-IN")

const COMPARISON_COLOUR: Record<string, string> = {
  match: "green",
  changed: "orange",
  "new-on-portal": "blue",
  "missing-on-portal": "red",
  "not-filed": "default",
}

function financialYearOptions() {
  const now = new Date()
  // Indian FY starts in April: before April we are still in the previous FY.
  const currentStart = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1
  return Array.from({ length: 8 }, (_, i) => {
    const year = currentStart - i
    return { label: `${year}-${String((year + 1) % 100).padStart(2, "0")}`, value: String(year) }
  })
}

function Clause34bPage() {
  const [messageApi, contextHolder] = message.useMessage()
  const [financialYear, setFinancialYear] = useState<string>(String(new Date().getFullYear() - 1))
  const [selectedTans, setSelectedTans] = useState<string[]>(CONTINUUM_GROUP.map((e) => e.tan))
  const [dateSource, setDateSource] = useState<"stmtstatus" | "conso">("stmtstatus")

  const [fetching, setFetching] = useState(false)
  const [building, setBuilding] = useState(false)
  const [progress, setProgress] = useState<{ done: number; total: number; current: string }>({
    done: 0,
    total: 0,
    current: "",
  })
  const [fetchLog, setFetchLog] = useState<string[]>([])
  const [rows, setRows] = useState<BuiltRow[]>([])
  const [counts, setCounts] = useState<Counts | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string>("")
  const [clause34c, setClause34c] = useState<Clause34c | null>(null)

  const appendLog = (line: string) => setFetchLog((prev) => [...prev, line])

  const handleFetch = async () => {
    if (!selectedTans.length) {
      messageApi.error("Select at least one entity")
      return
    }
    setFetching(true)
    setFetchLog([])
    setProgress({ done: 0, total: selectedTans.length, current: "" })

    let failures = 0
    for (const [index, tan] of selectedTans.entries()) {
      setProgress({ done: index, total: selectedTans.length, current: tan })
      try {
        const res = await fetch("/api/clause-34b/fetch", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ tan, financialYear }),
        })
        const data = await res.json()
        if (data.success) {
          appendLog(`${tan} — ${data.rows} statement(s), ${data.originals} original(s)`)
        } else {
          failures++
          const detail =
            data.error ||
            (data.failedCombinations || [])
              .map((f: any) => `${f.combination}: ${f.error}`)
              .join("; ")
          appendLog(`${tan} — FAILED: ${detail}`)
        }
      } catch (error: any) {
        failures++
        appendLog(`${tan} — FAILED: ${String(error?.message || error)}`)
      }
    }

    setProgress({ done: selectedTans.length, total: selectedTans.length, current: "" })
    setFetching(false)
    if (failures)
      messageApi.warning(`${failures} of ${selectedTans.length} entities failed — see the log`)
    else messageApi.success(`Fetched ${selectedTans.length} entities`)
  }

  const handleBuild = async () => {
    setBuilding(true)
    try {
      const res = await fetch("/api/clause-34b/build", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ financialYear, dateSource }),
      })
      const data = await res.json()
      if (!data.success) {
        messageApi.error(data.error || "Build failed")
        return
      }
      setRows(data.rows)
      setCounts(data.counts)
      setClause34c(data.clause34c ?? null)
      setDownloadUrl(data.downloadUrl)
      messageApi.success(`Built ${data.rows.length} rows`)
    } catch (error: any) {
      messageApi.error(String(error?.message || error))
    } finally {
      setBuilding(false)
    }
  }

  const columns: ColumnsType<BuiltRow> = useMemo(
    () => [
      { title: "Entity", dataIndex: "sheet", key: "sheet", width: 170, fixed: "left" },
      { title: "Form", dataIndex: "formType", key: "formType", width: 70 },
      { title: "Qtr", dataIndex: "quarter", key: "quarter", width: 60 },
      { title: "Due date", dataIndex: "dueDate", key: "dueDate", width: 105 },
      {
        title: "Date of furnishing (d)",
        dataIndex: "dateOfFurnishing",
        key: "dateOfFurnishing",
        width: 140,
        render: (value: string) => value || <Tag color="red">not found</Tag>,
      },
      { title: "Previous workbook", dataIndex: "workbookDate", key: "workbookDate", width: 140 },
      {
        title: "Timeliness",
        dataIndex: "timeliness",
        key: "timeliness",
        width: 140,
        render: (value: string) => (
          <Tag
            color={
              value === "Within due date" ? "green" : value.startsWith("Late") ? "red" : "default"
            }
          >
            {value}
          </Tag>
        ),
      },
      {
        title: "vs workbook",
        dataIndex: "comparison",
        key: "comparison",
        width: 140,
        render: (value: string) => <Tag color={COMPARISON_COLOUR[value] || "default"}>{value}</Tag>,
      },
      { title: "Corr.", dataIndex: "correctionCount", key: "correctionCount", width: 60 },
      { title: "Portal status", dataIndex: "status", key: "status", width: 190 },
      { title: "Remarks", dataIndex: "remarks", key: "remarks", width: 420 },
    ],
    []
  )

  const lateCount = rows.filter((r) => r.timeliness.startsWith("Late")).length

  return (
    <ConfigProvider locale={enGB}>
      {contextHolder}
      <div style={{ padding: 24 }}>
        <Title level={3}>Clause 34(b) — TDS statements furnished</Title>
        <Paragraph type="secondary" style={{ maxWidth: 900 }}>
          Builds the Form 3CD clause 34(b) working paper from TRACES <em>Statement Filed Status</em>
          . Column (d) is taken from the <strong>Regular</strong> (original) statement, which is
          what the clause asks for — a conso file header only carries the latest correction&apos;s
          date.
        </Paragraph>

        <Card size="small" style={{ marginBottom: 16 }}>
          <Space wrap size="middle">
            <Space direction="vertical" size={2}>
              <Text strong>Financial year</Text>
              <Select
                style={{ width: 140 }}
                value={financialYear}
                onChange={setFinancialYear}
                options={financialYearOptions()}
              />
            </Space>
            <Space direction="vertical" size={2}>
              <Text strong>Entities</Text>
              <Select
                mode="multiple"
                style={{ width: 460 }}
                maxTagCount={2}
                value={selectedTans}
                onChange={setSelectedTans}
                options={CONTINUUM_GROUP.map((e) => ({
                  label: `${e.sheet} (${e.tan})`,
                  value: e.tan,
                }))}
              />
            </Space>
            <Space direction="vertical" size={2}>
              <Text strong>Column (d) source</Text>
              <Select
                style={{ width: 230 }}
                value={dateSource}
                onChange={setDateSource}
                options={[
                  { label: "TRACES statement status", value: "stmtstatus" },
                  { label: "Keep conso dates where present", value: "conso" },
                ]}
              />
            </Space>
          </Space>

          <div style={{ marginTop: 16 }}>
            <Space>
              <Button
                type="primary"
                icon={<SyncOutlined />}
                loading={fetching}
                onClick={handleFetch}
              >
                Fetch from TRACES ({selectedTans.length})
              </Button>
              <Button icon={<FileExcelOutlined />} loading={building} onClick={handleBuild}>
                Build workbook
              </Button>
              {downloadUrl && (
                <Button type="link" icon={<CloudDownloadOutlined />} href={downloadUrl}>
                  Download workbook
                </Button>
              )}
            </Space>
          </div>

          {fetching && (
            <div style={{ marginTop: 12 }}>
              <Progress
                percent={progress.total ? Math.round((progress.done / progress.total) * 100) : 0}
                status="active"
              />
              <Text type="secondary">
                {progress.done}/{progress.total} · {progress.current}
              </Text>
            </div>
          )}
        </Card>

        {fetchLog.length > 0 && (
          <Card size="small" title="Fetch log" style={{ marginBottom: 16 }}>
            <pre style={{ margin: 0, maxHeight: 200, overflow: "auto", fontSize: 12 }}>
              {fetchLog.join("\n")}
            </pre>
          </Card>
        )}

        {counts && (
          <Alert
            style={{ marginBottom: 16 }}
            type={counts["missing-on-portal"] ? "warning" : "info"}
            showIcon
            message={`${rows.length} statement rows · ${lateCount} late filing(s)`}
            description={
              <Space wrap>
                <Tag color="green">matches workbook: {counts.match}</Tag>
                <Tag color="orange">differs: {counts.changed}</Tag>
                <Tag color="blue">new on portal: {counts["new-on-portal"]}</Tag>
                <Tag color="red">missing on portal: {counts["missing-on-portal"]}</Tag>
              </Space>
            }
          />
        )}

        {clause34c && (
          <Card
            size="small"
            title="Clause 34(c) — interest under s.201(1A) / 206C(7)"
            style={{ marginBottom: 16 }}
          >
            <Space wrap size="middle" style={{ marginBottom: 12 }}>
              <Tag color="blue">{clause34c.totals.liableCount} entities liable</Tag>
              <Tag color="green">payable ₹{inr(clause34c.totals.payable)}</Tag>
              <Tag color="green">paid ₹{inr(clause34c.totals.paid)}</Tag>
              <Tag color="orange">computed (ref) ₹{inr(clause34c.totals.computed)}</Tag>
              <Tag>{clause34c.totals.verifiedRows} rows re-verified</Tag>
              <Tag color={clause34c.totals.carriedForwardRows ? "warning" : "default"}>
                {clause34c.totals.carriedForwardRows} carried forward
              </Tag>
            </Space>
            {clause34c.mismatches.length > 0 && (
              <Alert
                type="error"
                showIcon
                style={{ marginBottom: 12 }}
                message={`${clause34c.mismatches.length} mismatch(es) against the source workbook`}
                description={
                  <pre style={{ margin: 0, fontSize: 12 }}>{clause34c.mismatches.join("\n")}</pre>
                }
              />
            )}
            <Table<Clause34cEntity>
              size="small"
              rowKey="tan"
              pagination={false}
              dataSource={clause34c.entities.filter((e) => e.liable || e.computed !== 0)}
              columns={[
                { title: "Entity", dataIndex: "sheet", key: "sheet", width: 200 },
                {
                  title: "Liable",
                  dataIndex: "liable",
                  key: "liable",
                  width: 80,
                  render: (v: boolean) => (
                    <Tag color={v ? "green" : "default"}>{v ? "Yes" : "No"}</Tag>
                  ),
                },
                { title: "Challans", dataIndex: "challans", key: "challans", width: 90 },
                {
                  title: "Payable (2)",
                  dataIndex: "payable",
                  key: "payable",
                  width: 120,
                  align: "right",
                  render: (v: number) => inr(v),
                },
                {
                  title: "Paid (3)",
                  dataIndex: "paid",
                  key: "paid",
                  width: 120,
                  align: "right",
                  render: (v: number) => inr(v),
                },
                {
                  title: "Computed (ref)",
                  dataIndex: "computed",
                  key: "computed",
                  width: 130,
                  align: "right",
                  render: (v: number) => inr(v),
                },
                {
                  title: "Computed less returns",
                  dataIndex: "difference",
                  key: "difference",
                  width: 170,
                  align: "right",
                  render: (v: number) =>
                    v > 0 ? (
                      <Tag color="red">+{inr(v)} — may be demanded</Tag>
                    ) : v < 0 ? (
                      <Tag color="default">({inr(Math.abs(v))})</Tag>
                    ) : (
                      "—"
                    ),
                },
                {
                  title: "Unverified rows",
                  dataIndex: "unverified",
                  key: "unverified",
                  width: 130,
                  render: (v: number) =>
                    v ? (
                      <Tag color="warning">{v} carried forward</Tag>
                    ) : (
                      <Tag color="green">all verified</Tag>
                    ),
                },
              ]}
            />
          </Card>
        )}

        <Table<BuiltRow>
          size="small"
          rowKey={(r) => `${r.tan}|${r.formType}|${r.quarter}`}
          columns={columns}
          dataSource={rows}
          scroll={{ x: 1800 }}
          pagination={{ pageSize: 50, showSizeChanger: true }}
        />
      </div>
    </ConfigProvider>
  )
}

Clause34bPage.authenticate = { redirectTo: "/auth/login" }
Clause34bPage.getLayout = (page: React.ReactNode) => <Layout title="Clause 34(b)">{page}</Layout>

export default Clause34bPage
