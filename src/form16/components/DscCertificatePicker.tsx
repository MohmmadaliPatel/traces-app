import React, { useMemo, useState } from "react"
import { Alert, Button, Input, Select, Space, Tag, Tooltip, message } from "antd"
import { LockOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons"
import { useMutation, useQuery } from "@blitzjs/rpc"
import getDscCertificates from "src/form16/queries/getDscCertificates"
import lockDscToken from "src/form16/mutations/lockDscToken"

type Props = {
  value: string
  onChange: (certificateName: string) => void
  /** Shown above the picker to explain what the certificate will be used for. */
  hint?: string
}

/**
 * Pick the DSC to sign with, and unlock the token before a batch runs.
 *
 * The PIN box deserves a word: the PIN is sent with this one request, used to unlock the token,
 * and then forgotten — it is never stored, never queued with the download jobs, and never
 * written to disk. Unlocking here is what keeps a long unattended batch from stopping on a
 * modal PIN dialog on the server, because the token stays unlocked for the rest of the Windows
 * session once it has signed successfully.
 */
export function DscCertificatePicker({ value, onChange, hint }: Props) {
  const [messageApi, contextHolder] = message.useMessage()
  const [pin, setPin] = useState("")
  const [unlocking, setUnlocking] = useState(false)
  const [unlocked, setUnlocked] = useState(false)

  const [data, { refetch, isFetching }] = useQuery(
    getDscCertificates,
    {},
    { refetchOnWindowFocus: false, staleTime: 30_000 }
  )
  const [lockDscTokenMutation] = useMutation(lockDscToken)

  const options = useMemo(
    () =>
      (data?.certificates || []).map((cert) => ({
        value: cert.commonName,
        label: (
          <Space size={6}>
            <SafetyCertificateOutlined />
            <span>{cert.commonName}</span>
            {!cert.hasPrivateKey && <Tag color="red">no private key</Tag>}
            {cert.expired && <Tag color="red">expired</Tag>}
            {cert.usable && <Tag color="green">usable</Tag>}
            <Tag>{cert.store.startsWith("CurrentUser") ? "user" : "machine"}</Tag>
          </Space>
        ),
        disabled: !cert.usable,
        title: `${cert.subject} — valid to ${cert.notAfter || "?"}`,
      })),
    [data]
  )

  const handleUnlock = async () => {
    if (!value) {
      messageApi.error("Choose a certificate first")
      return
    }
    setUnlocking(true)
    try {
      // Posted to an API route rather than an RPC mutation: Blitz logs every resolver input,
      // which would print the PIN to the server console in clear text.
      const response = await fetch("/api/dsc/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ certificateName: value, pin: pin || undefined }),
      })
      const result = (await response.json()) as { ok: boolean; message: string }
      if (result.ok) {
        setUnlocked(true)
        // The PIN has done its job; don't keep it in the page.
        setPin("")
        messageApi.success(result.message)
        await refetch()
      } else {
        setUnlocked(false)
        messageApi.error(result.message)
      }
    } catch (err: any) {
      setUnlocked(false)
      messageApi.error(err?.message || "Could not unlock the DSC token")
    } finally {
      setUnlocking(false)
    }
  }

  return (
    <Space direction="vertical" style={{ width: "100%" }} size={8}>
      {contextHolder}

      {!data?.windows && (
        <Alert
          type="info"
          showIcon
          message="Certificates are read from the Windows certificate store"
          description="This server is not running Windows, so no DSC tokens can be listed here. Run the app on the machine that holds the token."
        />
      )}

      {data?.windows && options.length === 0 && (
        <Alert
          type="warning"
          showIcon
          message="No certificates found on this machine"
          description="Plug in the DSC token and make sure you are logged in as its owner, then refresh."
        />
      )}

      {hint && <span style={{ color: "#888" }}>{hint}</span>}

      <Space.Compact style={{ width: "100%" }}>
        <Select
          showSearch
          allowClear
          style={{ width: 420 }}
          placeholder="Select DSC certificate..."
          value={value || undefined}
          onChange={(v) => {
            onChange(v || "")
            setUnlocked(false)
          }}
          options={options}
          optionFilterProp="title"
          notFoundContent="No certificates in the Windows store"
        />
        <Tooltip title="Re-read the Windows certificate store">
          <Button icon={<ReloadOutlined />} loading={isFetching} onClick={() => refetch()} />
        </Tooltip>
      </Space.Compact>

      <Space wrap>
        <Input.Password
          placeholder="Token PIN (optional)"
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          style={{ width: 220 }}
          autoComplete="off"
          onPressEnter={handleUnlock}
        />
        <Button icon={<LockOutlined />} loading={unlocking} onClick={handleUnlock} disabled={!value}>
          Unlock token
        </Button>
        {data?.pin?.remembered ? (
          <>
            <Tag color="green">PIN held — companies sign without prompting</Tag>
            <Button
              size="small"
              onClick={async () => {
                await lockDscTokenMutation({})
                setUnlocked(false)
                await refetch()
                messageApi.success("PIN forgotten. Signing will prompt again.")
              }}
            >
              Forget PIN
            </Button>
          </>
        ) : (
          (unlocked || data?.tokenWarm) && <Tag color="blue">token unlocked for this session</Tag>
        )}
      </Space>

      <span style={{ color: "#888", fontSize: 12 }}>
        Unlock before starting a download so the batch signs without stopping on a PIN dialog.
        Each company is signed by its own signer process, so the PIN is held in the server&apos;s
        memory for the rest of the run — never written to disk, and cleared when the app restarts
        or you press <b>Forget PIN</b>. Leave it blank to let the token&apos;s own dialog ask for
        the PIN on the server instead.
      </span>
    </Space>
  )
}
