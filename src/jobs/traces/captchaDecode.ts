import { getAxiostClient } from "../helper"

const FILE = "src/jobs/traces/captchaDecode.ts"
function log(fn: string, message: string, detail?: string) {
  const extra = detail ? ` ${detail}` : ""
  console.log(`[TRACES] ${FILE} · ${fn} — ${message}${extra}`)
}

/**
 * Decodes captcha image (raw base64) via the same service used by TDSCPC Puppeteer flows.
 */
export async function resolveCaptchaFromImageBase64(imageBase64: string): Promise<string> {
  const raw = imageBase64.replace(/^data:image\/\w+;base64,/, "")
  const serverUrl = process.env.SERVER_URL
  if (!serverUrl) {
    throw new Error("SERVER_URL is required for resolveCaptchaFromImageBase64")
  }
  log("resolveCaptchaFromImageBase64", "POST captcha decode", `${serverUrl}/captcha/decode inputLen=${raw.length}`)
  const axiosClient = getAxiostClient()
  const captchaResponse = await axiosClient.post(`${serverUrl}/captcha/decode`, {
    captcha: raw,
    isSuperAdmin: true,
  })
  const text = captchaResponse.data.captcha as string
  log("resolveCaptchaFromImageBase64", "decode response", `chars=${String(text).length}`)
  return text
}
