import axios, { AxiosInstance } from "axios"
import { getTracesApiBaseUrl } from "./constants"

export function createTracesHttp(): AxiosInstance {
  return axios.create({
    baseURL: getTracesApiBaseUrl(),
    timeout: 120000,
    headers: {
      Accept: "application/json, text/plain, */*",
      "Content-Type": "application/json",
    },
  })
}

export function createAuthenticatedTracesClient(accessToken: string): AxiosInstance {
  const c = createTracesHttp()
  c.defaults.headers.common.Authorization = `Bearer ${accessToken}`
  return c
}
