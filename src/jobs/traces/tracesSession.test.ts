import { vi, describe, it, expect, beforeEach } from "vitest"

/**
 * Regression test: TRACES sync APIs used to keep one logged-in browser page at module level,
 * so a second call for another company ran on the first company's login. Every call must now
 * launch its own browser, log in with its own credentials and close the browser afterwards.
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

beforeEach(() => {
  launched.length = 0
  loginShouldFail = false
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
  it("returns each company's own data and closes the browser after each call", async () => {
    const { fetchOutstandingDemand } = await import("src/scripts/fetchOutstandingDemand")
    const first = await fetchOutstandingDemand({ credentials: credsA })
    const second = await fetchOutstandingDemand({ credentials: credsB })

    expect(launched).toHaveLength(2)
    expect(first.data.rows[0].cpcdmd).toBe(credsA.tan)
    expect(second.data.rows[0].cpcdmd).toBe(credsB.tan)
    expect(launched.every((l) => l.closed)).toBe(true)
  }, 20000) // the script waits 3 s per call for TRACES to answer

  it("closes the browser when the portal step throws", async () => {
    const { fetchOutstandingDemand } = await import("src/scripts/fetchOutstandingDemand")
    const puppeteer = (await import("puppeteer")).default as unknown as { launch: ReturnType<typeof vi.fn> }
    puppeteer.launch.mockImplementationOnce(async () => {
      const record = { closed: false, loginTan: undefined as string | undefined }
      launched.push(record)
      const page = {
        __record: record,
        setRequestInterception: vi.fn(async () => {}),
        on: vi.fn(),
        goto: vi.fn(async () => {
          throw new Error("Navigation timeout of 60000 ms exceeded")
        }),
        evaluate: vi.fn(),
      }
      return { newPage: async () => page, close: vi.fn(async () => { record.closed = true }) }
    })
    await expect(fetchOutstandingDemand({ credentials: credsA })).rejects.toThrow(/timeout/)
    expect(launched[0]!.closed).toBe(true)
  })
})
