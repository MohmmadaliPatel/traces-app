import { Layout, Card, Form, Input, Button, Typography, message } from "antd"
import { BlitzPage } from "@blitzjs/next"
import { InferGetServerSidePropsType } from "next"
import dotenv from "dotenv"
import jwt_decode from "jwt-decode"
import { useMemo, useState } from "react"
import fs from "fs/promises"
import dayjs from "dayjs"
import { useMutation } from "@blitzjs/rpc"
import saveConfig from "src/auth/mutations/saveConfig"
import { formatDate } from "src/utils/formatter"
import { getMachineIdWithFallack } from "src/utils/machineid"

const { Text } = Typography

type Data = {
  machineId: string | undefined
  LICENSE: string
}
export const getServerSideProps = async () => {
  const config = dotenv.parse(await fs.readFile(".env.production"))

  const data: Data = {
    machineId: await getMachineIdWithFallack(),
    LICENSE: config.LICENSE || "",
  }

  return {
    props: {
      data,
    },
  }
}
const { Content } = Layout

const Configure: BlitzPage = ({
  data: { machineId, LICENSE },
}: InferGetServerSidePropsType<typeof getServerSideProps>) => {
  const [saveConfigMutation] = useMutation(saveConfig)
  const [messageApi, contextHolder] = message.useMessage()
  const [license, setLicense] = useState(LICENSE)

  const decodedJwt: { exp?: number } = useMemo(() => {
    try {
      return jwt_decode(license)
    } catch (error) {
      return {}
    }
  }, [license])

  const tokenMessage = useMemo(() => {
    if (decodedJwt.exp) {
      const date = new Date(decodedJwt.exp)
      if (dayjs().isAfter(dayjs(date))) {
        return {
          isError: true,
          msg: `This Token expired since ${dayjs(date).format("DD/MM/YYYY")}`,
        }
      } else {
        return {
          isError: false,
          msg: `Valid Token, expiry date ${dayjs(date).format("DD/MM/YYYY")}`,
        }
      }
    } else {
      return { isError: true, msg: "Invalid Token" }
    }
  }, [decodedJwt])

  const onSubmit = async (values) => {
    try {
      await saveConfigMutation({ LICENSE: values.LICENSE, MACHINE_ID: values.machineId })
      await messageApi.success("Config Saved Successfully")
    } catch (error) {
      await messageApi.error("Something went wrong")
    }
  }
  return (
    <Layout>
      {contextHolder}
      <Content style={{ margin: "24px 16px 0" }}>
        <Card title="Configuation" style={{ width: "60vw" }}>
          <Form
            name="normal_login"
            initialValues={{ machineId, LICENSE }}
            className="login-form"
            size="large"
            onFinish={onSubmit}
          >
            <Form.Item label="Machine ID" name="machineId" rules={[{ required: true }]}>
              <Input placeholder="machineId" readOnly disabled />
            </Form.Item>
            <Form.Item
              label="LICENSE KEY"
              name="LICENSE"
              rules={[{ required: true }]}
              help={
                <Text type={tokenMessage.isError ? "danger" : "success"}>{tokenMessage.msg}</Text>
              }
            >
              <Input placeholder="LICENSE KEY" onChange={(e) => setLicense(e.target.value)} />
            </Form.Item>
            <Form.Item>
              <Button style={{ float: "right" }} type="primary" htmlType="submit">
                Save
              </Button>
            </Form.Item>
          </Form>
        </Card>
      </Content>
    </Layout>
  )
}

export default Configure
