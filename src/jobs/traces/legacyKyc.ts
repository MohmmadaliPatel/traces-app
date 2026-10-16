/**
 * Normal KYC chain shared by the legacy "send request" flows (Conso file, Form 16/16A).
 *
 * After a request's Go/Submit the portal shows the KYC choice (#search2 = Normal KYC,
 * #normalkyc = Proceed), then the challan form (#token … #amt3, #clickKYC), then
 * "Proceed with Transaction" (#redirect); the page that follows creates the request.
 */
import type { Traces61ApiSession } from "./apiSession"
import {
  LegacyFlowError,
  LegacyPage,
  assertLegacyStep,
  extractLegacyFormInputs,
  loadLegacyPage,
  submitLegacyControl,
} from "./legacyForms"
import {
  extractHtmlMessages,
  extractRequestNumber,
  findFormContainingElement,
  htmlHasCaptcha,
  htmlIsResourceNotFound,
} from "./legacyHtml"

/** Challan details the KYC form asks for (record fields as built by the workers). */
export type ChallanKycDetails = {
  rrr?: string
  bsr?: string
  dtoftaxdep?: string
  csn?: string
  chlnamt?: string | number
  pan1?: string
  amt1?: string | number
  pan2?: string
  amt2?: string | number
  pan3?: string
  amt3?: string | number
}

export type NormalKycResult = {
  page: LegacyPage
  /** Request number shown on the confirmation page, when the portal shows one. */
  requestNumber: string | null
  messages: string[]
}

/** DDMMYYYY → DD-Mon-YYYY (what the KYC date field expects); other shapes pass through. */
export function formatKycDepositDate(dateStr: string): string {
  if (!dateStr || dateStr.length !== 8) return dateStr
  const day = dateStr.slice(0, 2)
  const monthNum = parseInt(dateStr.slice(2, 4))
  const monthNames = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]
  const monthName = monthNames[monthNum - 1] || ""
  const year = dateStr.slice(4, 8)
  return `${day}-${monthName}-${year}`
}

/**
 * Run Normal KYC → challan details → Proceed with Transaction → create the download request,
 * from the page the request's Go/Submit returned. This is the sequence recorded from the
 * Puppeteer Conso flow (logs/traces-capture, 13-Oct-2026, request 203680159):
 *
 *   kyc3formdsc.xhtml  #search2 (showSearchOption2: untick #search1, kycentryfrm=NORMAL_KYC),
 *                      then #normalkyc — a plain button outside the form whose jQuery handler
 *                      clicks the hidden commandLink #nxtSrcn (kycformdsc:_idcl=nxtSrcn)
 *   kyc3form.xhtml     form dedkyc: #token … #amt3 + #clickKYC
 *   (same URL)         form dedkyc → kyc3confirm.xhtml: authcode + #redirect
 *   downloadreqspec    document.ready → GET /app/srv/CreateDwnldReqServlet?fy&qr&ft&dt&unmflg
 *                      → 302 dwnldreqconfirm.xhtml?DWNLDREQID=<request number>
 *
 * Every step must render its expected control; a failure from Proceed with Transaction on
 * carries `finalSubmitSent` so callers never retry it.
 */
export async function submitNormalKycChain(
  session: Pick<Traces61ApiSession, "client">,
  page: LegacyPage,
  kyc: ChallanKycDetails,
  log: (message: string) => void
): Promise<NormalKycResult> {
  // Step 1: choose Normal KYC (#search2) and Proceed.
  assertLegacyStep(page, "after request submit (KYC options)", ["search2"])
  // #normalkyc normally sits outside the form and only triggers #nxtSrcn; click it directly
  // if a page ever renders it as a real form control.
  const proceedId = findFormContainingElement(page.html, "normalkyc") ? "normalkyc" : "nxtSrcn"
  assertLegacyStep(page, "after request submit (KYC options)", [proceedId])
  let current = await submitLegacyControl(session, page, proceedId, {
    check: ["search2"],
    uncheck: ["search1"],
    fields: { kycentryfrm: "NORMAL_KYC" },
  })
  log("Normal KYC Proceed submitted")

  // Step 2: challan details + Proceed (#clickKYC).
  assertLegacyStep(current, "after Normal KYC Proceed", ["token"])
  assertLegacyStep(current, "after Normal KYC Proceed", ["clickKYC"])
  current = await submitLegacyControl(session, current, "clickKYC", {
    fields: {
      token: kyc.rrr || "",
      bsr: kyc.bsr || "",
      dtoftaxdep: formatKycDepositDate(kyc.dtoftaxdep || "") || "",
      csn: kyc.csn || "",
      chlnamt: String(kyc.chlnamt || ""),
      pan1: kyc.pan1 || "",
      amt1: String(kyc.amt1 || ""),
      pan2: kyc.pan2 || "",
      amt2: String(kyc.amt2 || ""),
      pan3: kyc.pan3 || "",
      amt3: String(kyc.amt3 || ""),
    },
  })
  log("KYC details submitted")

  // Step 3: Proceed with Transaction (#redirect), then the request itself.
  assertLegacyStep(current, "after KYC details", ["redirect"])
  const unconfirmed = (reason: string) =>
    new LegacyFlowError(
      `FINAL_SUBMIT_UNCONFIRMED: ${reason} after Proceed with Transaction — check Requested Downloads on TRACES before retrying`,
      false,
      true
    )
  let finalPage: LegacyPage
  try {
    finalPage = await submitLegacyControl(session, current, "redirect")
    log("Transaction submitted (Proceed with Transaction)")
    if (finalPage.redirectedToNewPortal) throw unconfirmed("session expired (redirect to the new portal)")
    if (/CreateDwnldReqServlet/.test(finalPage.html)) {
      // The landing page's document.ready navigates here; this GET creates the request.
      finalPage = await loadLegacyPage(session, createDownloadRequestUrl(finalPage.html))
      log(`Download request created (${finalPage.url})`)
    }
  } catch (err: any) {
    if (err instanceof LegacyFlowError) throw err
    throw unconfirmed(`request failed (${err?.message || err})`)
  }

  if (finalPage.redirectedToNewPortal) throw unconfirmed("session expired (redirect to the new portal)")
  if (finalPage.status >= 400) throw unconfirmed(`HTTP ${finalPage.status}`)
  if (htmlIsResourceNotFound(finalPage.html)) throw unconfirmed('"Requested resource could not be found"')
  if (htmlHasCaptcha(finalPage.html)) throw unconfirmed("CAPTCHA_FAILED_IN_FLOW: captcha presented")

  const messages = extractHtmlMessages(finalPage.html)
  const requestNumber =
    new URL(finalPage.url).searchParams.get("DWNLDREQID") || extractRequestNumber(finalPage.html)
  if (!requestNumber) {
    throw unconfirmed(
      `no request number on ${finalPage.url}` + (messages.length ? ` — portal says: ${messages.join(" | ")}` : "")
    )
  }
  log(`Request filed — request number ${requestNumber}`)
  return { page: finalPage, requestNumber, messages }
}

/**
 * The URL the downloadreqspec page's script opens:
 * `/srv/CreateDwnldReqServlet?fy=…&qr=…&ft=…&dt=…&unmflg=…` from its `downloadreqspec` form
 * (empty quarter → 0; `unmflg` is only set for download type 5, else the script sends "undefined").
 */
export function createDownloadRequestUrl(downloadReqSpecHtml: string): string {
  const form = extractLegacyFormInputs(downloadReqSpecHtml, "downloadreqspec")
  const dt = form.dwldType ?? ""
  const params = [
    ["fy", form.finYr ?? ""],
    ["qr", form.qrtr || "0"],
    ["ft", form.formType ?? ""],
    ["dt", dt],
    ["unmflg", dt === "5" ? form.unmFlg ?? "" : "undefined"],
  ]
  return `app/srv/CreateDwnldReqServlet?${params.map(([k, v]) => `${k}=${encodeURIComponent(v!)}`).join("&")}`
}
