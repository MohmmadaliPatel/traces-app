import { AuthenticationError, PromiseReturnType } from "blitz"
import Link from "next/link"
import { Alert, Button, Card, Checkbox, Form, Input } from "antd"
import { LabeledTextField } from "src/core/components/LabeledTextField"
import login from "src/auth/mutations/login"
import { Login } from "src/auth/validations"
import { useMutation } from "@blitzjs/rpc"
import { UserOutlined, LockOutlined } from "@ant-design/icons"
import { useState } from "react"
import { LOCALSTORAGE_PUBLIC_DATA_TOKEN } from "@blitzjs/auth"
import { toBase64 } from "b64-lite"

type LoginFormProps = {
  onSuccess?: (user: PromiseReturnType<typeof login>) => void
}

export const LoginForm = (props: LoginFormProps) => {
  const [loginMutation] = useMutation(login)
  const [error, setError] = useState("")
  const onSubmit = async (values) => {
    try {
      const { user, publicData } = await loginMutation(values)
      localStorage.setItem(LOCALSTORAGE_PUBLIC_DATA_TOKEN(), toBase64(JSON.stringify(publicData)))
      props.onSuccess?.({ user, publicData })
    } catch (error: any) {
      if (error instanceof AuthenticationError) {
        setError("Sorry, those credentials are invalid")
      } else {
        setError("Sorry, we had an unexpected error. Please try again. - " + error.toString())
      }
    }
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "80vh" }}
    >
      <Card title="Login" style={{ width: "500px" }}>
        <Form
          name="normal_login"
          className="login-form"
          initialValues={{
            remember: true,
          }}
          size="large"
          onFinish={onSubmit}
        >
          <Form.Item
            name="email"
            rules={[
              {
                required: true,
                type: "email",
                message: "Please input your Email!",
              },
            ]}
          >
            <Input
              prefix={<UserOutlined className="site-form-item-icon" />}
              placeholder="Email"
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item
            name="password"
            rules={[
              {
                required: true,
                message: "Please input your Password!",
              },
            ]}
          >
            <Input
              prefix={<LockOutlined className="site-form-item-icon" />}
              type="password"
              placeholder="Password"
              autoComplete="off"
            />
          </Form.Item>
          <Form.Item>
            <Button block type="primary" htmlType="submit">
              Log in
            </Button>
          </Form.Item>
          {error && <Alert message="Error" description={error} type="error" showIcon />}
        </Form>
      </Card>
    </div>
  )
}

export default LoginForm
