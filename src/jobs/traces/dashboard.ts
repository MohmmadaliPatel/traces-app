import { AxiosInstance } from "axios"

export async function fetchCertificateStatistics(
  authed: AxiosInstance,
  params: { userId: string; finYear: string }
): Promise<unknown> {
  const path =
    process.env.TRACES_CERTIFICATE_STATISTICS_PATH ?? "/api/dashboard/certificate-Statistics"
  const res = await authed.get(path, {
    params: {
      userId: params.userId,
      finYear: params.finYear,
    },
  })
  if (res.status >= 400) {
    throw new Error(
      `certificate-Statistics failed HTTP ${res.status}: ${JSON.stringify(res.data)}`
    )
  }
  return res.data
}
