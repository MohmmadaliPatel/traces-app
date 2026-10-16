import { vi, describe, it, expect } from "vitest"

vi.mock("./auth", async () => ({
  ...(await vi.importActual<typeof import("./auth")>("./auth")),
  tracesRetryDelayMs: () => 0,
}))

import {
  LegacyFlowError,
  assertLegacyStep,
  ensureLegacySelectOption,
  runLegacyRequestFlow,
  submitLegacyControl,
  type LegacyPage,
} from "./legacyForms"
import { createDownloadRequestUrl, submitNormalKycChain } from "./legacyKyc"

type Call = { method: "GET" | "POST"; url: string; body?: string }
type Reply = { status?: number; html?: string; headers?: Record<string, string> }

/** Fake traces61 client: routes every GET/POST through `handler` and records the calls. */
function fakeSession(handler: (call: Call) => Reply) {
  const calls: Call[] = []
  const respond = async (call: Call) => {
    calls.push(call)
    const reply = handler(call)
    return { status: reply.status ?? 200, data: reply.html ?? "", headers: reply.headers ?? {}, config: { url: call.url } }
  }
  const client = {
    get: (url: string) => respond({ method: "GET", url }),
    post: (url: string, body: string) => respond({ method: "POST", url, body }),
  }
  return { session: { client } as any, calls }
}

function posted(call: Call | undefined): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const [name, value] of new URLSearchParams(call?.body ?? "")) (out[name] ??= []).push(value)
  return out
}

const ORIGIN = "https://traces61.tdscpc.gov.in"
const page = (html: string, path: string): LegacyPage => ({
  status: 200,
  html,
  url: `${ORIGIN}/${path}`,
  redirectedToNewPortal: false,
})

const CONSO_FORM = `<form id="requestnsdlconsoForm" name="requestnsdlconsoForm" method="post" action="/app/ded/nsdlconsofile.xhtml">
<input type="hidden" name="requestnsdlconsoForm_SUBMIT" value="1" />
<input type="hidden" id="renderPage" name="renderPage" value="0" />
<select id="finYr" name="finYr"><option value="">Select</option><option value="2025">2025-26</option></select>
<select id="qrtr" name="qrtr"><option value="">Select</option>QUARTERS</select>
<input id="download_conso" name="download_conso" type="submit" value="Go" />
<input id="reset" name="reset" type="submit" value="Reset" />
<input type="hidden" name="javax.faces.ViewState" value="VS-1" />
</form>`

describe("submitLegacyControl", () => {
  it("posts the form's own fields, its ViewState and only the clicked button to the form action", async () => {
    const { session, calls } = fakeSession((call) =>
      call.method === "POST"
        ? { status: 302, headers: { location: "http://traces61.tdscpc.gov.in/app/ded/downloadreqspec.xhtml" } }
        : { html: "<p>KYC options</p>" }
    )
    const result = await submitLegacyControl(
      session,
      page(CONSO_FORM.replace("QUARTERS", ""), "app/ded/nsdlconsofile.xhtml"),
      "download_conso",
      { fields: { finYr: "2025", qrtr: "3" } }
    )

    expect(calls[0]!.url).toBe(`${ORIGIN}/app/ded/nsdlconsofile.xhtml`)
    expect(posted(calls[0])).toEqual({
      requestnsdlconsoForm_SUBMIT: ["1"],
      renderPage: ["0"],
      finYr: ["2025"],
      qrtr: ["3"],
      "javax.faces.ViewState": ["VS-1"],
      download_conso: ["Go"],
    })
    // POST → 302 is followed as a GET, with the http:// Location upgraded to https://.
    expect(calls[1]).toEqual({ method: "GET", url: `${ORIGIN}/app/ded/downloadreqspec.xhtml` })
    expect(result.url).toBe(`${ORIGIN}/app/ded/downloadreqspec.xhtml`)
    expect(result.html).toContain("KYC options")
  })

  it("surfaces a redirect to the new portal instead of following it", async () => {
    const { session, calls } = fakeSession(() => ({
      status: 302,
      headers: { location: "https://traces.tdscpc.gov.in/auth/" },
    }))
    const result = await submitLegacyControl(
      session,
      page(CONSO_FORM.replace("QUARTERS", ""), "app/ded/nsdlconsofile.xhtml"),
      "download_conso"
    )
    expect(result.redirectedToNewPortal).toBe(true)
    expect(calls).toHaveLength(1)
  })

  it("clicks a commandLink via its onclick, checks radios and maps field ids to names", async () => {
    const html = `<form id="kycform" name="kycform" method="post" action="/app/ded/downloadreqspec.xhtml">
      <input type="hidden" name="kycform_SUBMIT" value="1" />
      <input type="radio" id="search1" name="kycform:kycentryfrm" value="DSC_KYC" checked="checked" />
      <input type="radio" id="search2" name="kycform:kycentryfrm" value="NORMAL_KYC" />
      <input type="text" id="token" name="kycform:token" value="" />
      <a id="normalkyc" href="#" onclick="return myfaces.oam.submitForm('kycform','kycform:normalkyc');">Proceed</a>
      <input type="hidden" name="kycform:_idcl" value="" />
      <input type="hidden" name="javax.faces.ViewState" value="VS-2" />
    </form>`
    const { session, calls } = fakeSession(() => ({ html: "next" }))
    await submitLegacyControl(session, page(html, "app/ded/downloadreqspec.xhtml"), "normalkyc", {
      check: ["search2"],
      fields: { token: "RRR1" },
    })
    expect(posted(calls[0])).toEqual({
      kycform_SUBMIT: ["1"],
      "kycform:kycentryfrm": ["NORMAL_KYC"],
      "kycform:token": ["RRR1"],
      "kycform:_idcl": ["kycform:normalkyc"],
      "javax.faces.ViewState": ["VS-2"],
    })
  })
})

describe("ensureLegacySelectOption", () => {
  it("posts the FY back when the quarter list is empty, then picks the quarter", async () => {
    const withQuarters = CONSO_FORM.replace("QUARTERS", `<option value="3">Q1</option><option value="4">Q2</option>`)
    const { session, calls } = fakeSession(() => ({ html: withQuarters }))
    const result = await ensureLegacySelectOption(
      session,
      page(CONSO_FORM.replace("QUARTERS", ""), "app/ded/nsdlconsofile.xhtml"),
      "qrtr",
      "4",
      { finYr: "2025" }
    )
    expect(result.value).toBe("4")
    expect(calls).toHaveLength(1)
    const body = posted(calls[0])
    expect(body.finYr).toEqual(["2025"])
    expect(body.download_conso).toBeUndefined()
  })

  it("fails instead of posting a value the select does not offer", async () => {
    const { session } = fakeSession(() => ({ html: CONSO_FORM.replace("QUARTERS", "") }))
    await expect(
      ensureLegacySelectOption(session, page(CONSO_FORM.replace("QUARTERS", ""), "x.xhtml"), "qrtr", "3", {
        finYr: "2025",
      })
    ).rejects.toThrow(/Could not select #qrtr/)
  })
})

describe("assertLegacyStep", () => {
  it("classifies dead ends", () => {
    const err = (html: string) => {
      try {
        assertLegacyStep(page(html, "x.xhtml"), "test step", ["redirect"])
      } catch (e) {
        return e as LegacyFlowError
      }
      throw new Error("expected a throw")
    }
    expect(assertLegacyStep(page(`<a id="redirect">Go</a>`, "x.xhtml"), "s", ["redirect"])).toBe("redirect")
    expect(err(`<input name="captchaCode" />`)).toMatchObject({ retryable: true })
    expect(err(`<input name="captchaCode" />`).message).toMatch(/^CAPTCHA_FAILED_IN_FLOW/)
    expect(err(`<span class="infoMsg">Requested resource could not be found</span>`).message).toMatch(
      /^RESOURCE_NOT_FOUND_ERROR/
    )
    const validation = err(`<span class="error">Invalid BSR code</span>`)
    expect(validation.retryable).toBe(false)
    expect(validation.message).toContain("Invalid BSR code")
  })
})

describe("runLegacyRequestFlow", () => {
  const opts = { label: "test", maxAttempts: 3, log: () => {} }

  it("retries retryable failures from scratch", async () => {
    let n = 0
    const result = await runLegacyRequestFlow(opts, async () => {
      if (++n < 3) throw new LegacyFlowError("CAPTCHA_FAILED_IN_FLOW", true)
      return "ok"
    })
    expect(result).toBe("ok")
    expect(n).toBe(3)
  })

  it("never retries after the final submit or on a portal validation error", async () => {
    let n = 0
    await expect(
      runLegacyRequestFlow(opts, async () => {
        n++
        throw new LegacyFlowError("FINAL_SUBMIT_UNCONFIRMED", true, true)
      })
    ).rejects.toThrow(/FINAL_SUBMIT_UNCONFIRMED/)
    expect(n).toBe(1)

    n = 0
    await expect(
      runLegacyRequestFlow(opts, async () => {
        n++
        throw new LegacyFlowError("Invalid BSR code", false)
      })
    ).rejects.toThrow(/Invalid BSR/)
    expect(n).toBe(1)
  })
})

describe("submitNormalKycChain", () => {
  // Shapes recorded from the Puppeteer Conso flow (TRACES, 13-Oct-2026).
  const KYC_OPTIONS = `<form id="kycformdsc" name="kycformdsc" method="post" action="/app/ded/kyc3formdsc.xhtml">
    <input type="hidden" id="kycentryfrm" name="kycentryfrm" value="DSC_KYC" />
    <input type="hidden" id="fnct" name="fnct" value="KYC" />
    <input type="radio" name="search1" id="search1" onclick="showSearchOption1()" checked="checked" />
    <input type="radio" name="search2" id="search2" onclick="showSearchOption2()" />
    <a href="#" onclick="return myfaces.oam.submitForm('kycformdsc','nxtSrcn');" id="nxtSrcn" type="submit"></a>
    <input type="hidden" name="kycformdsc_SUBMIT" value="1" />
    <input type="hidden" name="javax.faces.ViewState" value="VS-A" />
  </form>
  <input type="button" id="normalkyc" class="button" value="Proceed" style="display:none" />`
  const CHALLAN_FORM = `<form id="dedkyc" name="dedkyc" method="post" action="/app/ded/kyc3form.xhtml">
    <input type="hidden" name="tan" value="MUMC29054E" />
    <input type="checkbox" name="panAmtCheck" value="true" />
    ${["token", "bsr", "dtoftaxdep", "csn", "chlnamt", "pan1", "amt1", "pan2", "amt2", "pan3", "amt3"]
      .map((id) => `<input type="text" id="${id}" name="${id}" value="" />`)
      .join("")}
    <input id="clickKYC" name="clickKYC" type="submit" value="Proceed" />
    <input type="hidden" name="dedkyc_SUBMIT" value="1" />
    <input type="hidden" name="javax.faces.ViewState" value="VS-B" />
  </form>`
  const CONFIRM = `<form id="dedkyc" name="dedkyc" method="post" action="/app/ded/kyc3confirm.xhtml">
    <input id="authcode" name="authcode" type="text" value="tkTq+h" readonly="readonly" />
    <input id="redirect" name="redirect" type="submit" value="Proceed with Transaction" />
    <input type="hidden" name="dedkyc_SUBMIT" value="1" />
    <input type="hidden" name="javax.faces.ViewState" value="VS-C" />
  </form>`
  const REQ_SPEC = `<form id="downloadreqspec" name="downloadreqspec" method="post" action="/app/ded/downloadreqspec.xhtml">
    <input type="hidden" id="finYr" name="finYr" value="2025" /><input type="hidden" id="qrtr" name="qrtr" value="5" />
    <input type="hidden" id="formType" name="formType" value="26Q" /><input type="hidden" id="dwldType" name="dwldType" value="5" />
    <input type="hidden" id="unmFlg" name="unmFlg" value="" />
  </form><script>var url = g_ContextPath + "/srv/CreateDwnldReqServlet?fy=" + fy;</script>`
  const CONFIRMED = `<span>Request for NSDL Conso File has been submitted. Request Number is 203680159.</span>`
  const kyc = { rrr: "R1", bsr: "6939001", dtoftaxdep: "03122025", csn: "13549", chlnamt: 22048, pan1: "AAGCG6228H", amt1: 2984 }

  /** Serve the recorded sequence: each request gets the next reply. */
  const recorded = (): Reply[] => [
    { status: 302, headers: { location: "https://traces61.tdscpc.gov.in/app/ded/kyc3form.xhtml?dt=5" } },
    { html: CHALLAN_FORM },
    { html: CONFIRM },
    { status: 302, headers: { location: "https://traces61.tdscpc.gov.in/app/ded/downloadreqspec.xhtml?rdrctfrm=frmKycScrn" } },
    { html: REQ_SPEC },
    {
      status: 302,
      headers: { location: "https://traces61.tdscpc.gov.in/app/ded/dwnldreqconfirm.xhtml?DWNLDREQID=203680159&Submitted=N" },
    },
    { html: CONFIRMED },
  ]

  it("follows the recorded sequence through CreateDwnldReqServlet and returns the request number", async () => {
    const steps = recorded()
    const { session, calls } = fakeSession(() => steps.shift()!)
    const result = await submitNormalKycChain(session, page(KYC_OPTIONS, "app/ded/kyc3formdsc.xhtml?dt=5"), kyc, () => {})

    expect(result.requestNumber).toBe("203680159")
    expect(calls.map((c) => `${c.method} ${c.url.replace(ORIGIN, "")}`)).toEqual([
      "POST /app/ded/kyc3formdsc.xhtml",
      "GET /app/ded/kyc3form.xhtml?dt=5",
      "POST /app/ded/kyc3form.xhtml",
      "POST /app/ded/kyc3confirm.xhtml",
      "GET /app/ded/downloadreqspec.xhtml?rdrctfrm=frmKycScrn",
      "GET /app/srv/CreateDwnldReqServlet?fy=2025&qr=5&ft=26Q&dt=5&unmflg=",
      "GET /app/ded/dwnldreqconfirm.xhtml?DWNLDREQID=203680159&Submitted=N",
    ])
    // #normalkyc → hidden commandLink #nxtSrcn; search1 unticked, search2 ticked (as Chrome sent).
    expect(posted(calls[0])).toEqual({
      kycentryfrm: ["NORMAL_KYC"],
      fnct: ["KYC"],
      search2: ["on"],
      kycformdsc_SUBMIT: ["1"],
      "javax.faces.ViewState": ["VS-A"],
      "kycformdsc:_idcl": ["nxtSrcn"],
    })
    expect(posted(calls[2])).toMatchObject({
      token: ["R1"],
      dtoftaxdep: ["03-Dec-2025"],
      chlnamt: ["22048"],
      pan2: [""],
      clickKYC: ["Proceed"],
      "javax.faces.ViewState": ["VS-B"],
    })
    expect(posted(calls[2]).panAmtCheck).toBeUndefined()
    expect(posted(calls[3])).toEqual({
      authcode: ["tkTq+h"],
      redirect: ["Proceed with Transaction"],
      dedkyc_SUBMIT: ["1"],
      "javax.faces.ViewState": ["VS-C"],
    })
  })

  it("stops before the final submit when the KYC details are rejected", async () => {
    const steps: Reply[] = [recorded()[0]!, { html: CHALLAN_FORM }, { html: `<span class="error">Challan details do not match</span>${CHALLAN_FORM}` }]
    const { session, calls } = fakeSession(() => steps.shift()!)
    await expect(
      submitNormalKycChain(session, page(KYC_OPTIONS, "app/ded/kyc3formdsc.xhtml"), kyc, () => {})
    ).rejects.toMatchObject({ retryable: false, finalSubmitSent: false })
    expect(calls).toHaveLength(3)
  })

  it("never reports success without a request number, and marks it as already submitted", async () => {
    const steps = recorded().slice(0, 5)
    steps.push({ html: `<span class="error">Unable to process the request</span>` }) // CreateDwnldReqServlet
    const { session } = fakeSession(() => steps.shift()!)
    await expect(
      submitNormalKycChain(session, page(KYC_OPTIONS, "app/ded/kyc3formdsc.xhtml"), kyc, () => {})
    ).rejects.toMatchObject({ finalSubmitSent: true })
  })

  it("marks a failure after Proceed with Transaction as already submitted", async () => {
    const steps = recorded()
    steps[3] = { status: 500, html: "boom" }
    const { session } = fakeSession(() => steps.shift()!)
    await expect(
      submitNormalKycChain(session, page(KYC_OPTIONS, "app/ded/kyc3formdsc.xhtml"), kyc, () => {})
    ).rejects.toMatchObject({ finalSubmitSent: true })
  })
})

describe("createDownloadRequestUrl", () => {
  it("builds the servlet URL the downloadreqspec page script opens", () => {
    const html = (dt: string, qr: string) => `<form id="downloadreqspec" name="downloadreqspec">
      <input type="hidden" name="finYr" value="2025" /><input type="hidden" name="qrtr" value="${qr}" />
      <input type="hidden" name="formType" value="26Q" /><input type="hidden" name="dwldType" value="${dt}" />
      <input type="hidden" name="unmFlg" value="" /></form>`
    expect(createDownloadRequestUrl(html("5", "5"))).toBe(
      "app/srv/CreateDwnldReqServlet?fy=2025&qr=5&ft=26Q&dt=5&unmflg="
    )
    expect(createDownloadRequestUrl(html("13", ""))).toBe(
      "app/srv/CreateDwnldReqServlet?fy=2025&qr=0&ft=26Q&dt=13&unmflg=undefined"
    )
  })
})
