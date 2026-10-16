import { vi, describe, it, expect, beforeEach } from "vitest"

/**
 * Regression test: TRACES sync APIs used to keep one logged-in browser page at module level,
 * so a second call for another company ran on the first company's login. Every call must now
 * open its own session (a browser for openTracesSession, an API session for the migrated
 * scripts), log in with its own credentials and close it afterwards.
 */

type FakeResponse = { url: () => string; json: () => Promise<unknown> }

const launched: Array<{ closed: boolean; loginTan?: string }> = []
let loginShouldFail = false

vi.mock("puppeteer", () => {
  const launch = vi.fn(async () => {
    const record: { closed: boolean; loginTan?: string } = { closed: false }
    launched.push(record)
    const handlers: Record<string, Array<(arg: unknown) => unknown>> = { response: [], request: [] }
    const page = {
      __record: record,
      setRequestInterception: vi.fn(async () => {}),
      on: (event: string, fn: (arg: unknown) => unknown) => handlers[event]?.push(fn),
      goto: vi.fn(async () => {
        // TRACES answers the demand servlet with data for whoever is logged in on this page
        const response: FakeResponse = {
          url: () => "https://traces61.tdscpc.gov.in/app/srv/TagChallanServlet?reqtype=0",
          json: async () => ({ rows: [{ finYr: "2025-26", fin: 2025, aodmnd: "0.00", cpcdmd: record.loginTan }] }),
        }
        for (const h of handlers.response ?? []) await h(response)
      }),
      evaluate: vi.fn(async () => false),
    }
    return {
      newPage: async () => page,
      close: vi.fn(async () => {
        record.closed = true
      }),
    }
  })
  return { default: { launch }, launch }
})

vi.mock("./puppeteerSession", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./puppeteerSession")
  return {
    ...actual,
    loginWithTracesApiAndPreauth: vi.fn(async (page: { __record: { loginTan?: string } }, creds: { tan: string }) => {
      if (loginShouldFail) throw new Error("TRACES login failed (non-retryable): LGN001 — Invalid credentials")
      page.__record.loginTan = creds.tan
    }),
  }
})

const apiSessions: Array<{ credentials: { tan: string }; closed: boolean; close: () => Promise<void> }> = []
const servletPaths: string[] = []
let priorYearsRow = false
let servletShouldFail = false

vi.mock("./apiSession", async () => {
  const actual = await vi.importActual<Record<string, unknown>>("./apiSession")
  return {
    ...actual,
    openTraces61ApiSession: vi.fn(async (credentials: { tan: string }) => {
      const session = {
        credentials,
        closed: false,
        close: async () => {
          session.closed = true
        },
      }
      apiSessions.push(session)
      return session
    }),
    // TRACES answers the demand servlet with data for whoever owns the session.
    postLegacyServletJson: vi.fn(async (session: { credentials: { tan: string } }, path: string) => {
      servletPaths.push(path)
      if (servletShouldFail) throw new Error("session expired: redirected to the new portal")
      if (path.endsWith("reqtype=11")) return { rows: [{ finYr: "2015-16", aodmnd: "10.00", fin: 1 }] }
      const rows: Array<Record<string, unknown>> = [
        { finYr: "2025-26", fin: 2025, aodmnd: "0.00", cpcdmd: session.credentials.tan },
      ]
      if (priorYearsRow) rows.push({ finYr: "Prior Years", fin: 1, aodmnd: "10.00", cpcdmd: "0.00" })
      return { rows }
    }),
  }
})

beforeEach(() => {
  launched.length = 0
  loginShouldFail = false
  apiSessions.length = 0
  servletPaths.length = 0
  priorYearsRow = false
  servletShouldFail = false
})

const credsA = { userId: "USERA", password: "pa", tan: "TANA00001A" }
const credsB = { userId: "USERB", password: "pb", tan: "TANB00002B" }

describe("openTracesSession", () => {
  it("launches a new browser and logs in with the given credentials on every call", async () => {
    const { openTracesSession } = await import("./tracesSession")
    const a = await openTracesSession(credsA)
    const b = await openTracesSession(credsB)
    expect(launched).toHaveLength(2)
    expect(launched.map((l) => l.loginTan)).toEqual([credsA.tan, credsB.tan])
    await a.close()
    await b.close()
    await b.close() // idempotent
    expect(launched.every((l) => l.closed)).toBe(true)
  })

  it("closes the browser when login fails", async () => {
    const { openTracesSession } = await import("./tracesSession")
    loginShouldFail = true
    await expect(openTracesSession(credsA)).rejects.toThrow(/login failed/)
    expect(launched).toHaveLength(1)
    expect(launched[0]!.closed).toBe(true)
  })
})

describe("fetchOutstandingDemand", () => {
  it("returns each company's own data and closes its session after each call", async () => {
    const { fetchOutstandingDemand } = await import("src/scripts/fetchOutstandingDemand")
    const first = await fetchOutstandingDemand({ credentials: credsA })
    const second = await fetchOutstandingDemand({ credentials: credsB })

    expect(apiSessions.map((s) => s.credentials.tan)).toEqual([credsA.tan, credsB.tan])
    expect(first.data.rows[0].cpcdmd).toBe(credsA.tan)
    expect(second.data.rows[0].cpcdmd).toBe(credsB.tan)
    expect(apiSessions.every((s) => s.closed)).toBe(true)
  })

  it("fetches the Prior Years feed only when the demand grid has a Prior Years row", async () => {
    const { fetchOutstandingDemand } = await import("src/scripts/fetchOutstandingDemand")
    const without = await fetchOutstandingDemand({ credentials: credsA })
    expect(without.priorYearsData).toBeNull()

    priorYearsRow = true
    const withPrior = await fetchOutstandingDemand({ credentials: credsA })
    expect(servletPaths.filter((p) => p.endsWith("reqtype=11"))).toHaveLength(1)
    expect(withPrior.priorYearsData.rows[0].finYr).toBe("2015-16")
  })

  it("closes the session when the servlet call throws", async () => {
    const { fetchOutstandingDemand } = await import("src/scripts/fetchOutstandingDemand")
    servletShouldFail = true
    await expect(fetchOutstandingDemand({ credentials: credsA })).rejects.toThrow(/session expired/)
    expect(apiSessions[0]!.closed).toBe(true)
  })
})
