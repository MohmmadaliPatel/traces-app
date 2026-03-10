import React, { useState } from "react"
import {
  AuditOutlined,
  FileDoneOutlined,
  NotificationOutlined,
  SaveOutlined,
  TeamOutlined,
  LogoutOutlined,
  CalendarOutlined,
  SettingOutlined,
  ShopOutlined,
  FileTextOutlined,
  BankOutlined,
  ProfileOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  FundOutlined,
  DollarOutlined,
} from "@ant-design/icons"
import { BlitzLayout } from "@blitzjs/next"
import { useMutation, useQuery } from "@blitzjs/rpc"
import { Alert, Button, MenuProps, Badge, Tooltip } from "antd"
import { Breadcrumb, Layout as AntdLayout, Menu, theme } from "antd"
import dayjs from "dayjs"
import Head from "next/head"
import { useRouter } from "next/router"
import logout from "src/auth/mutations/logout"
import getTrialExpiryDate from "src/auth/queries/getTrialExpiryDate"
import { isTrial } from "src/utils/isTrial"
import { useNotification } from "src/utils/NotificationContext"

const { Header, Content, Footer, Sider } = AntdLayout

type MenuItem = Required<MenuProps>["items"][number]

function getItem(
  label: React.ReactNode,
  key: React.Key,
  icon?: React.ReactNode,
  children?: MenuItem[],
  badgeCount?: number
): MenuItem {
  return {
    key,
    icon,
    children,
    label: badgeCount ? (
      <Badge count={badgeCount} offset={[10, 0]}>
        {label}
      </Badge>
    ) : (
      label
    ),
    path: key,
  } as MenuItem
}

const Layout: BlitzLayout<{ title?: string; children?: React.ReactNode }> = ({
  title,
  children,
}) => {
  const { notificationCounts } = useNotification()
  const router = useRouter()
  const [expData] = useQuery(getTrialExpiryDate, {})
  const [logOutMutation] = useMutation(logout)
  const [collapsed, setCollapsed] = useState(false)
  const {
    token: { colorBgContainer },
  } = theme.useToken()

  const onMenuClick = ({ key }) => {
    void router.push(`/${key}`)
  }

  const onLogoutClick = async () => {
    await logOutMutation()
    await router.push("/auth/login")
  }

  const getITItems = (): MenuItem[] => [
    getItem(
      "Companies",
      "companies",
      <HomeOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "Deductee Masters",
      "deductee-masters",
      <TeamOutlined />,
      undefined,
      notificationCounts.assessee
    ),

    getItem(
      "Conso Files",
      "conso-files",
      <TeamOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "Justification Report",
      "justification-report",
      <FileTextOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "form-16",
      "form-16",
      <TeamOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "Challan Status",
      "challan-status",
      <TeamOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "TLDC",
      "tldc",
      <TeamOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "Challan Management",
      "challan-management",
      <TeamOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "Outstanding Demand",
      "outstanding-demand",
      <DollarOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem(
      "Return Status",
      "return-status",
      <FileTextOutlined />,
      undefined,
      notificationCounts.assessee
    ),
    getItem("Logs", "logs", <SaveOutlined />, undefined, notificationCounts.logs),
    getItem("Documents", "document", <FolderOpenOutlined />, undefined),
    getItem("SMTP Configs", "smtp-configs", <SettingOutlined />, undefined, notificationCounts.assessee),
  ]

  return (
    <>
      {isTrial ? (
        <Alert
          message={`You're using a trial version. It will expire on ${dayjs(
            expData?.trialExpDate
          ).format("DD/MM/YYYY")}. For a licensed version, contact at 9769107820.`}
          type="error"
          closable
        ></Alert>
      ) : null}
      <Head>
        <title>{title || "Traces Conso"}</title>
        <link rel="icon" href="/favicon.ico" />
      </Head>

      <AntdLayout style={{ minHeight: "100vh" }}>
        <Sider collapsible={false} width={250} theme="light">
          <div
            style={{
              height: 100,
              backgroundImage: `url('/logo.png')`,
              backgroundSize: "contain",
              backgroundRepeat: "no-repeat",
              marginLeft: 10,
            }}
          ></div>
          <Menu
            onClick={onMenuClick}
            theme="light"
            defaultSelectedKeys={["1"]}
            mode="inline"
            items={getITItems()}
            selectedKeys={[router.pathname.replace("/", "")]}
          />
        </Sider>
        <AntdLayout className="site-layout">
          <Header
            style={{
              padding: 0,
              background: colorBgContainer,
              display: "flex",
              justifyContent: "end",
              alignItems: "center",
            }}
          >
            <Button
              onClick={onLogoutClick}
              size="large"
              icon={<LogoutOutlined />}
              style={{ marginRight: "2em" }}
            >
              Log out
            </Button>
          </Header>
          <Content style={{ margin: "0 16px" }}>
            <Breadcrumb style={{ margin: "16px 0" }}>
              <Breadcrumb.Item>{title}</Breadcrumb.Item>
            </Breadcrumb>
            {children}
          </Content>
          <Footer style={{ textAlign: "center" }}>Traces Conso ©2025 Created by TaxTeck</Footer>
        </AntdLayout>
      </AntdLayout>
    </>
  )
}
Layout.authenticate = { redirectTo: "/auth/login" }
export default Layout
