import { BlitzPage } from "@blitzjs/next"
import { Layout, Card, Button } from "antd"
import Link from "next/link"

const { Content } = Layout
const LicenseExpired: BlitzPage = () => {
  return (
    <Layout>
      <Content style={{ margin: "24px 16px 0" }}>
        <Card title="License Expired">
          It seems your license has expired, Kindly contact support. Go to{" "}
          <Link href="/configure">
            <Button type="link">Configure</Button>{" "}
          </Link>{" "}
          Page to add License Key
        </Card>
      </Content>
    </Layout>
  )
}

export default LicenseExpired
