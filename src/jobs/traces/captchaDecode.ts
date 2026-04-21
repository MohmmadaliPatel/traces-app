import { getAxiostClient } from "../helper"

/**
 * Decodes captcha image (raw base64) via the same service used by TDSCPC Puppeteer flows.
 */
export async function resolveCaptchaFromImageBase64(imageBase64: string): Promise<string> {
  const raw = imageBase64.replace(/^data:image\/\w+;base64,/, "")
  const serverUrl = process.env.SERVER_URL
  if (!serverUrl) {
    throw new Error("SERVER_URL is required for resolveCaptchaFromImageBase64")
  }
  const axiosClient = getAxiostClient()
  const captchaResponse = await axiosClient.post(`${serverUrl}/captcha/decode`, {
    captcha: raw,
    isSuperAdmin: true,
  })
  return captchaResponse.data.captcha as string
}
