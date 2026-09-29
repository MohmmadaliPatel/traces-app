import { wrapper } from "axios-cookiejar-support"
import { CookieJar } from "tough-cookie"
import axios, { type AxiosInstance } from "axios"
// eslint-disable-next-line @typescript-eslint/no-var-requires
const axiosRetry = require("axios-retry").default

const LOGIN_PAGE_URL = "https://eportal.incometax.gov.in/iec/foservices/#/login"
const LOGIN_API_URL = "https://eportal.incometax.gov.in/iec/loginapi/login"
const SAVE_ENTITY_URL = "https://eportal.incometax.gov.in/iec/servicesapi/auth/saveEntity"
export const INCOME_TAX_ORIGIN = "https://eportal.incometax.gov.in"
export const INCOME_TAX_REFERER = "https://eportal.incometax.gov.in/iec/foservices/"

/** Portal WAF requires `sn` to match serviceName (see access-control-allow-headers). */
export function viewFiledFormsRequestHeaders() {
  return {
    Accept: "application/json, text/plain, */*",
    "Content-Type": "application/json",
    Origin: INCOME_TAX_ORIGIN,
    Referer: INCOME_TAX_REFERER,
    "Sec-Fetch-Dest": "empty",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Site": "same-origin",
    sn: "viewFiledForms",
  }
}

export function buildViewFiledFormsPayload(
  entityNum: string,
  formTypeCd: string,
  currentPage = 0,
  pageSize = 5
) {
  return {
    serviceName: "viewFiledForms",
    entityNum,
    formTypeCd,
    currentPage: String(currentPage),
    pageSize: String(pageSize),
    filterParameterDetails: [] as unknown[],
  }
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function createIncomeTaxAxiosClient(): AxiosInstance {
  const jar = new CookieJar()
  const client = wrapper(
    axios.create({
      jar,
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/plain, */*",
        "accept-language": "en-US,en;q=0.9",
        "cache-control": "no-cache",
        pragma: "no-cache",
        "sec-fetch-dest": "empty",
        "sec-fetch-mode": "cors",
        "sec-fetch-site": "same-origin",
        "sec-gpc": "1",
        Origin: INCOME_TAX_ORIGIN,
        Referer: INCOME_TAX_REFERER,
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/98.0.4758.82 Safari/537.36",
      },
    } as any) as any
  ) as AxiosInstance
  axiosRetry(client, { retries: 3 })
  client.interceptors.request.use((config) => {
    const url = String(config.url || "")
    if (url.includes("/servicesapi/auth/saveEntity")) {
      const body = config.data
      const serviceName =
        body && typeof body === "object" && !Buffer.isBuffer(body)
          ? (body as { serviceName?: unknown }).serviceName
          : undefined
      if (typeof serviceName === "string" && serviceName && !config.headers?.sn) {
        config.headers = config.headers || {}
        config.headers.sn = serviceName
      }
    }
    return config
  })
  return client
}

async function loadLoginPage(client: AxiosInstance) {
  await client.get(LOGIN_PAGE_URL, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  })
}

async function verifyPan(client: AxiosInstance, pan: string) {
  const res = await client.post(LOGIN_API_URL, {
    entity: pan,
    serviceName: "wLoginService",
  })
  return res.data
}

async function verifyPassword(
  client: AxiosInstance,
  reqId: string,
  role: string,
  pan: string,
  encodedPassword: string
) {
  const res = await client.post(LOGIN_API_URL, {
    errors: [],
    reqId,
    entity: pan,
    entityType: "PAN",
    role,
    uidValdtnFlg: "true",
    aadhaarMobileValidated: "false",
    secAccssMsg: "",
    secLoginOptions: "",
    dtoService: "LOGIN",
    exemptedPan: "false",
    userConsent: "",
    imgByte: null,
    pass: encodedPassword,
    passValdtnFlg: null,
    otpGenerationFlag: null,
    otp: null,
    otpValdtnFlg: null,
    otpSourceFlag: null,
    contactPan: null,
    contactMobile: null,
    contactEmail: null,
    email: null,
    mobileNo: null,
    forgnDirEmailId: null,
    imagePath: null,
    serviceName: "loginService",
  })
  return res.data
}

async function forceLogin(
  client: AxiosInstance,
  reqId: string,
  role: string,
  pan: string,
  encodedPassword: string
) {
  const res = await client.post(LOGIN_API_URL, {
    errors: [],
    reqId,
    entity: pan,
    entityType: "PAN",
    role,
    uidValdtnFlg: "true",
    aadhaarMobileValidated: "false",
    secAccssMsg: "",
    secLoginOptions: "",
    dtoService: "LOGIN",
    exemptedPan: "false",
    userConsent: "",
    imgByte: null,
    pass: encodedPassword,
    passValdtnFlg: null,
    otpGenerationFlag: null,
    otp: null,
    otpValdtnFlg: null,
    otpSourceFlag: null,
    contactPan: null,
    contactMobile: null,
    contactEmail: null,
    email: null,
    mobileNo: null,
    forgnDirEmailId: null,
    imagePath: null,
    serviceName: "loginService",
    aadhaarLinkedWithUserId: "Y",
    userType: "IND",
    remark: "Continue",
    lastLoginSuccessFlag: "true",
  })
  return res.data
}

/** Login to Income Tax e-portal (TAN + IT password). Password is base64-encoded for the API. */
export async function loginIncomeTaxPortal(
  client: AxiosInstance,
  tan: string,
  itPassword: string
): Promise<void> {
  const pan = tan.toUpperCase()
  const encodedPassword = Buffer.from(itPassword).toString("base64")

  await loadLoginPage(client)
  const panResponse = await verifyPan(client, pan)
  await delay(5000)

  const res = await verifyPassword(
    client,
    panResponse.reqId,
    panResponse.role,
    pan,
    encodedPassword
  )
  const messages = res.messages ?? []
  if (messages.some((m: { code?: string }) => m.code === "EF00027")) {
    throw new Error("Invalid IT portal password")
  }
  if (messages.some((m: { code?: string }) => m.code === "EF00177")) {
    await delay(5000)
    await forceLogin(client, panResponse.reqId, panResponse.role, pan, encodedPassword)
  }
}

/** Required after login before paymentapi calls. */
export async function saveIncomeTaxUserProfile(client: AxiosInstance, tan: string) {
  await client.post(SAVE_ENTITY_URL, {
    serviceName: "userProfileService",
    userId: tan.toUpperCase(),
  })
}

/** Request body for paymentapi/challan/paymenthistory (e-Pay session context). */
export function buildPaymentHistoryRequestBody(
  tan: string,
  actType: "O" | "N" = "O",
  pageNumber = 0,
  pageSize = 50
): {
  header: { formName: string }
  formData: {
    actType: string
    pan: string
    loggedInUserID: string
    loggedInUserType: string
    pageNumber: number
    pageSize: number
  }
} {
  const pan = tan.toUpperCase()
  return {
    header: { formName: "PO-03-PYMNT" },
    formData: {
      actType,
      pan,
      loggedInUserID: pan,
      loggedInUserType: "TDS",
      pageNumber,
      pageSize,
    },
  }
}
