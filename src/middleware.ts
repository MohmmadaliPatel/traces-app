import { NextResponse, type NextRequest } from "next/server"
import * as jose from "jose"
import { isTrial } from "./utils/isTrial"
import dayjs from "dayjs"

const PUBLIC_FILE = /\.(.*)$/
const publicKey = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAqvLhCXHNo7QZxg7w8O0b
Vr8s7UiQ+SCy3bIVuWjUsLeeL12GRovYScDQXv5VryaEDnFwTwHJKxtzMGYfZfJP
/mPl/z3ie3PJlOvEkMJf38ZthPAZTkaVUd54R1quhbZVPTihJerZxnCs8PQk5rwf
oQmyexZJ9uIwR2kDlW27RD7be5v8kZsnyOOoKIPBa9Nxz819q+/1kaB9J2xvs8SM
DZBKcrdqHy3zoqXiNZy9Q0fpLB/X47MEQcChSyZsp7AP59hq8R6eu2oRip9dtdIx
ZjuU6M5ddQGsJOoS+IsvxMNdy0f26jmTQFMfhwEzNUdmhEV/URmG2st0UvmfztJT
4QIDAQAB
-----END PUBLIC KEY-----`

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl

  return NextResponse.next()
  if (
    pathname.startsWith("/_next") || // exclude Next.js internals
    pathname.startsWith("/api") || //  exclude all API routes
    pathname.startsWith("/static") || // exclude static files
    pathname.startsWith("/auth") ||
    pathname.startsWith("/configure") ||
    PUBLIC_FILE.test(pathname) // exclude all files in the public folder
  ) {
  }

  try {
    const alg = "RS256"
    const publicKeyParsed = await jose.importSPKI(publicKey, alg)

    const { payload } = await jose.jwtVerify(process.env.LICENSE!, publicKeyParsed)

    const res = await fetch(process.env.ENDPOINT + "/api/rpc/getMachineId", {
      body: JSON.stringify({ params: { id: "" }, meta: {} }),
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
    })
    const {
      result: { machineId },
    } = await res.json()

    if (payload.machineId !== machineId) {
      throw "Machine Id mismatch"
    }
    console.log(payload.exp, Number(new Date()))

    if (payload.exp! < Number(new Date())) {
      throw "JWT Expired"
    }
    if (pathname !== "/dashboard") {
      if (
        payload.module &&
        payload.module !== "all" &&
        payload.module !== "it" &&
        payload.module !== "gst"
      ) {
        throw "Module Mismatch"
      }
      if (payload.module === "it" && !pathname.startsWith("/it")) {
        const url = req.nextUrl.clone()
        url.pathname = "/dashboard"
        return NextResponse.redirect(url)
      }
      if (payload.module === "gst" && !pathname.startsWith("/gst")) {
        const url = req.nextUrl.clone()
        url.pathname = "/dashboard"
        return NextResponse.redirect(url)
      }
    }
  } catch (error) {
    console.log("error", error)

    if (isTrial) {
      const res = await fetch(process.env.ENDPOINT + "/api/rpc/getTrialExpiryDate", {
        body: JSON.stringify({ params: { id: "" }, meta: {} }),
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
        },
      })
      const {
        result: { trialExpDate },
      } = await res.json()
      const isTrialExpired = dayjs().isAfter(dayjs(trialExpDate), "day")
      if (!isTrialExpired) {
        return NextResponse.next()
      }
    }

    const url = req.nextUrl.clone()
    url.pathname = "/auth/license-expired/"
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}
