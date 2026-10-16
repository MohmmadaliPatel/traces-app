import { vi, describe, it, expect, beforeEach } from "vitest"

const loginTraces = vi.fn()
const generateCaptcha = vi.fn(async () => ({ id: "cap-1", image: "aW1n" }))

vi.mock("./auth", async () => ({
  ...(await vi.importActual<typeof import("./auth")>("./auth")),
  generateCaptcha: (...args: unknown[]) => generateCaptcha(...(args as [])),
  loginTraces: (...args: unknown[]) => loginTraces(...args),
  tracesRetryDelayMs: () => 0,
}))
vi.mock("./captchaDecode", () => ({ resolveCaptchaFromImageBase64: vi.fn(async () => "ABCD") }))
vi.mock("./http", () => ({
  // preauthV2 answers with the legacy JSESSIONID.
  createTracesHttp: () => ({
    get: vi.fn(async () => ({
      status: 200,
      data: "Authentication successful",
      headers: { "set-cookie": ["JSESSIONID=abc; Path=/app; Secure"] },
    })),
  }),
}))

import {
  openTraces61ApiSession,
  parseDownloadServletReply,
  postLegacyServletJson,
} from "./apiSession"

const creds = { userId: "USERA", password: "pa", tan: "TANA00001A" }
const ok = { authTokenDto: { accessToken: "jwt", refreshToken: "refresh" } }

beforeEach(() => {
  loginTraces.mockReset()
  generateCaptcha.mockClear()
})

describe("openTraces61ApiSession login retries", () => {
  it("stops at the first non-retryable rejection (wrong password must not be retried)", async () => {
    loginTraces.mockResolvedValue({ errorCode: "LGN001", message: "Invalid User ID or Password" })
    await expect(openTraces61ApiSession(creds, { verifySession: false })).rejects.toThrow(/non-retryable/)
    expect(loginTraces).toHaveBeenCalledTimes(1)
  })

  it("retries a captcha mismatch with a new captcha", async () => {
    loginTraces
      .mockResolvedValueOnce({ errorCode: "CPT403", message: "Invalid captcha" })
      .mockResolvedValueOnce(ok)
    const session = await openTraces61ApiSession(creds, { verifySession: false })
    expect(loginTraces).toHaveBeenCalledTimes(2)
    expect(generateCaptcha).toHaveBeenCalledTimes(2)
    const cookies = await session.jar.getCookies("https://traces61.tdscpc.gov.in/app/ded/dashboard.xhtml")
    expect(cookies.map((c) => c.key)).toContain("JSESSIONID")
  })

  it("retries a gateway timeout but not other thrown errors", async () => {
    loginTraces
      .mockRejectedValueOnce(Object.assign(new Error("loginTraces failed HTTP 504"), { status: 504 }))
      .mockResolvedValueOnce(ok)
    await openTraces61ApiSession(creds, { verifySession: false })
    expect(loginTraces).toHaveBeenCalledTimes(2)

    loginTraces.mockReset()
    loginTraces.mockRejectedValueOnce(Object.assign(new Error("loginTraces failed HTTP 400"), { status: 400 }))
    await expect(openTraces61ApiSession(creds, { verifySession: false })).rejects.toThrow(/HTTP 400/)
    expect(loginTraces).toHaveBeenCalledTimes(1)
  })
})

describe("legacy servlet calls", () => {
  const sessionReplying = (reply: { status: number; data?: string; headers?: Record<string, string> }) => ({
    client: { post: vi.fn(async () => ({ data: "", headers: {}, ...reply })) } as any,
  })

  it("reports a redirect to the new portal as an expired session", async () => {
    const session = sessionReplying({ status: 302, headers: { location: "https://traces.tdscpc.gov.in/auth/" } })
    await expect(postLegacyServletJson(session, "app/ded/srv/TagChallanServlet?reqtype=0")).rejects.toThrow(
      /session expired/
    )
  })

  it("parses JSON and rejects anything else", async () => {
    await expect(
      postLegacyServletJson(sessionReplying({ status: 200, data: '{"rows":[1]}' }), "x")
    ).resolves.toEqual({ rows: [1] })
    await expect(
      postLegacyServletJson(sessionReplying({ status: 200, data: "<html>login</html>" }), "x")
    ).rejects.toThrow(/non-JSON/)
  })
})

describe("parseDownloadServletReply", () => {
  it("accepts every reply shape the Puppeteer flows handled", () => {
    expect(parseDownloadServletReply(" http://dl.tdscpc.gov.in/f.zip\n")).toBe("https://dl.tdscpc.gov.in/f.zip")
    expect(parseDownloadServletReply('{"success":"https://dl/f.zip"}')).toBe("https://dl/f.zip")
    expect(parseDownloadServletReply('[{"success":"https://dl/f.zip"}]')).toBe("https://dl/f.zip")
    expect(parseDownloadServletReply('"https://dl/f.zip"')).toBe("https://dl/f.zip")
    expect(parseDownloadServletReply("<html>error</html>")).toBe("")
  })
})
