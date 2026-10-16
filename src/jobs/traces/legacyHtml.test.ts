import { describe, it, expect } from "vitest"
import {
  extractHtmlMessages,
  extractRequestNumber,
  extractViewStateFromHtml,
  findFormContainingElement,
  findHtmlForm,
  htmlHasCaptcha,
  htmlIsResourceNotFound,
  listSelectOptions,
  matchSelectOption,
  parseMyFacesSubmitCall,
  parseOnclickFieldAssignments,
  successfulFormEntries,
} from "./legacyHtml"

/** Shaped like nsdlconsofile.xhtml as MyFaces renders it. */
const CONSO_PAGE = `<html><body>
<form id="requestnsdlconsoForm" name="requestnsdlconsoForm" method="post" action="/app/ded/nsdlconsofile.xhtml;jsessionid=abc" enctype="application/x-www-form-urlencoded">
<input type="hidden" name="requestnsdlconsoForm_SUBMIT" value="1" />
<input type="hidden" id="renderPage" name="renderPage" value="0" />
<select id="finYr" name="finYr" onchange="if (a > b) { refresh() }">
  <option value="">--Select--</option>
  <option value="2024">2024-25</option>
  <option value="2025" selected="selected">2025-26</option>
</select>
<select id="qrtr" name="qrtr"><option value="">--Select--</option></select>
<input type="text" id="note" name="note" value="a &amp; b" disabled="disabled" />
<input type="checkbox" id="agree" name="agree" value="Y" />
<input type="radio" id="kyc1" name="kycentryfrm" value="DSC" />
<input type="radio" id="kyc2" name="kycentryfrm" value="NORMAL_KYC" checked="checked" />
<textarea id="remarks" name="remarks">
line &lt;1&gt;</textarea>
<input id="download_conso" name="download_conso" type="submit" value="Go" />
<input id="reset" name="reset" type="submit" value="Reset" />
<button id="cancel" name="cancel" type="submit">Cancel</button>
<input type="hidden" name="javax.faces.ViewState" id="j_id__v_0:javax.faces.ViewState:1" value="ABC+/123==" autocomplete="off" />
</form></body></html>`

describe("successfulFormEntries", () => {
  it("submits what a browser would before a button is clicked", () => {
    const form = findHtmlForm(CONSO_PAGE, "requestnsdlconsoForm")!
    expect(successfulFormEntries(form.inner)).toEqual([
      ["requestnsdlconsoForm_SUBMIT", "1"],
      ["renderPage", "0"],
      ["finYr", "2025"],
      ["qrtr", ""],
      ["kycentryfrm", "NORMAL_KYC"],
      ["remarks", "line <1>"],
      ["javax.faces.ViewState", "ABC+/123=="],
    ])
  })
})

describe("form lookup", () => {
  it("reads the form action, the ViewState and the form that holds a control", () => {
    expect(findHtmlForm(CONSO_PAGE, "requestnsdlconsoForm")?.action).toBe(
      "/app/ded/nsdlconsofile.xhtml;jsessionid=abc"
    )
    expect(extractViewStateFromHtml(CONSO_PAGE)).toBe("ABC+/123==")
    const found = findFormContainingElement(CONSO_PAGE, "download_conso")
    expect(found?.form.key).toBe("requestnsdlconsoForm")
    expect(found?.element.attrs).toMatchObject({ name: "download_conso", value: "Go", type: "submit" })
  })
})

describe("select options", () => {
  it("matches by value or by visible text and never picks the placeholder", () => {
    const options = listSelectOptions(CONSO_PAGE, "finYr")!
    expect(matchSelectOption(options, "2024")?.value).toBe("2024")
    expect(matchSelectOption(options, "2025-26")?.value).toBe("2025")
    expect(matchSelectOption(options, "")).toBeNull()
    expect(matchSelectOption(listSelectOptions(CONSO_PAGE, "qrtr")!, "3")).toBeNull()
  })
})

describe("onclick parsing", () => {
  it("reads a MyFaces 2 commandLink wrapped in jsf.util.chain with entity-encoded quotes", () => {
    const html = `<form id="kycformdsc"><a id="nxtSrcn" href="#" onclick="jsf.util.chain(this,event,&#39;return myfaces.oam.submitForm(\\&#39;kycformdsc\\&#39;,\\&#39;kycformdsc:nxtSrcn\\&#39;,null,[[\\&#39;mode\\&#39;,\\&#39;1\\&#39;]]);&#39;);return false;">Proceed</a></form>`
    const link = findFormContainingElement(html, "nxtSrcn")!.element
    expect(parseMyFacesSubmitCall(link.attrs.onclick!)).toEqual({
      formName: "kycformdsc",
      linkId: "kycformdsc:nxtSrcn",
      params: [["mode", "1"]],
    })
  })

  it("reads MyFaces 1 oamSubmitForm and hidden-field assignments", () => {
    const onclick =
      "document.getElementById('renderPage1').value='1';document.forms['f'].elements['f:mode'].value='X';return oamSubmitForm('f','f:go');"
    expect(parseMyFacesSubmitCall(onclick)).toMatchObject({ formName: "f", linkId: "f:go", params: [] })
    expect(parseOnclickFieldAssignments(onclick)).toEqual([
      ["renderPage1", "1"],
      ["f:mode", "X"],
    ])
  })
})

describe("page state", () => {
  it("detects a captcha challenge by control, not by the word alone", () => {
    expect(htmlHasCaptcha(`<input type="text" name="captchaText" />`)).toBe(true)
    expect(htmlHasCaptcha(`<img src="/app/srv/GetCaptchaImg?x=1" />`)).toBe(true)
    expect(htmlHasCaptcha(`<div id="captcha"></div>`)).toBe(true)
    expect(htmlHasCaptcha(`<span>Enter the captcha shown at login</span>`)).toBe(false)
  })

  it("finds the dead-end page, portal messages and a request number", () => {
    expect(htmlIsResourceNotFound(`<span class="infoMsg">Requested resource could not be found</span>`)).toBe(true)
    expect(
      extractHtmlMessages(`<div><span class="error">Challan details do not match</span><p>other</p></div>`)
    ).toEqual(["Challan details do not match"])
    expect(
      extractRequestNumber(`<span class="infoMsg">Your request has been submitted. Request Number : 123456789</span>`)
    ).toBe("123456789")
    expect(extractRequestNumber(`<p>Done</p>`)).toBeNull()
  })
})
