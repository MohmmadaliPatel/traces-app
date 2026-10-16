# TRACES Old Portal — Puppeteer → API Migration Reference

> Date: 2026-10-13 · Scope: legacy TRACES portal at `traces61.tdscpc.gov.in` (`/app/*`)
>
> Goal: replace the Puppeteer-driven extraction on the **old** TRACES portal with plain HTTP
> (axios + cookie jar), keeping the existing API login (`loginservice`) + preauth bridge as the
> authentication base. The **new** portal (`traces.tdscpc.gov.in` REST) was already API-based.

---

## 1. TL;DR — how the old portal works over HTTP

The old portal is an **Apache MyFaces (JSF) application** behind F5/IBM edge devices. Every
authenticated interaction reduces to **three request patterns** plus one session bootstrap:

```
Bootstrap:
  POST  https://traces-app.tdscpc.gov.in/loginservice/api/auth/generateCaptcha   → { image(base64), id }
  POST  https://traces-app.tdscpc.gov.in/loginservice/api/auth/login             → authTokenDto.{accessToken,refreshToken}
        body: { userId: <TAN>, userType: "Deductor", subUserPanId: "",
                password, captcha, captchaId }
  GET   https://traces61.tdscpc.gov.in/app/preauthV2.xhtml
        headers: authorization: Bearer <accessToken>, refreshtoken: <refreshToken>
                 (+ Cookie header carrying the login-service session cookies — see §3.2)
        → Set-Cookie: JSESSIONID=…; Path=/app  (this is the legacy session) + F5 sticky cookies

Pattern A — dashboard widgets (no ViewState):
  POST /app/ded/dashbdoutdmnd.xhtml   (empty body, X-Requested-With: XMLHttpRequest)
  → raw HTML fragment, e.g. <span id="outsdmndfinyear">0.00</span>

Pattern B — jqGrid JSON servlets (no ViewState):
  POST /app/ded/srv/<X>Servlet?<params>
  body: _search=false&nd=<epoch>&rows=100&page=<n>&sidx=&sord=asc
  → { totalpages, page, rowCount/records, rows: [...] }

Pattern C — MyFaces form submits:
  GET  /app/ded/<page>.xhtml → parse the <form> that contains the control to click
  POST <that form's action> (urlencoded), i.e. exactly what a browser sends:
       the form's successful controls (hidden fields + its javax.faces.ViewState;
       NOT other buttons, NOT unchecked radios/checkboxes) + changed fields
       + ONLY the clicked control: button name=value, or for a commandLink
       <formId>:_idcl=<linkId> (+ params) read from the link's own onclick
  → 200 re-render (multi-step flows) or 302 (follow manually, cookies captured per hop)
  Next step submits the form rendered by THIS response, to ITS action.
```

**Session validity signal:** any `/app/*` request that answers `302 Location: https://traces.tdscpc.gov.in/auth/`
means the session is dead → re-login. (This replaces the old `redirectGuard` CDP rewriting.)

---

## 2. Verified live (what was tested and how)

Per the project rule, **only GET requests and the login flow were executed against the live
portal during verification**. No state-changing POST was fired (no request submissions,
downloads of *new* items, KYC submits, etc.).

| # | Check | Method | Result |
|---|-------|--------|--------|
| 1 | Captcha → login API → Bearer tokens | POST (login only, authorised) | `User Authenticated` |
| 2 | `preauthV2.xhtml` with Bearer + `refreshtoken` headers | GET | 200 `Authentication successful` + `JSESSIONID` (Path=/app) |
| 3 | Session validity (`dashboard.xhtml`) | GET | 200 `TRACES | Deductor Dashboard` |
| 4 | `stmtstatus.xhtml` | GET | 200 `TRACES | Statement Filed Status`, ViewState present |
| 5 | **`dashbdoutdmnd.xhtml` (the API in question)** | GET + POST (empty body) | 200, exact fragment: `(Across all Financial Years) Rs. 0.00` (`#outsdmndfinyear`) — real data for the test TAN |
| 6 | `DedStmtStatusServlet` (statement status feed) | POST (read query) | `{"totalpages":1,"page":"1","rowCount":0,"rows":[]}` |
| 7 | Every legacy page used by the consumers | GET | 200 with forms/servlets extracted (see §5) |
| 8 | Headless-Chrome A/B (old Puppeteer flow) | GET | same cookies → same pages served; confirms parity |

Also reverse-engineered from page JS (no requests needed): servlet URLs + parameters for
every grid, the MyFaces `oamSubmit.js` commandLink protocol, and the exact form/field names
of every migrated flow (§5).

---

## 3. Authentication details

### 3.1 Login service (reused from `src/jobs/traces/auth.ts`)

- `generateCaptcha` → `{ image (base64 PNG), id }`
- Retry policy is the same as the Puppeteer `loginWithTracesApiAndPreauth`: a new captcha
  only for captcha mismatches (`isRetryableTracesLoginFailure`), backoff only for
  gateway/network errors (`isTransientTracesFailure`), and an **immediate stop** on any other
  rejection — retrying a wrong password would lock the TRACES account.
- Captcha decoded via the existing `SERVER_URL/captcha/decode` service
  (`resolveCaptchaFromImageBase64`).
- `loginTraces` → `authTokenDto.accessToken` (JWT, issuer `etds-sso…/TRACES_WEB_APP` Keycloak,
  roles include `deductor`) + `refreshToken`.

### 3.2 preauthV2 SSO bridge (`src/jobs/traces/apiSession.ts`)

`GET https://traces61.tdscpc.gov.in/app/preauthV2.xhtml` with:

```
authorization: Bearer <accessToken>
refreshtoken:  <refreshToken>
x-requested-with: XMLHttpRequest
referer: https://traces.tdscpc.gov.in/
cookie: <traces-app login-service session cookies>
```

Response `Set-Cookie` includes `JSESSIONID; Path=/app` (the legacy session), `BIGipServerPool_traces61…`,
`TS01b37992`, `TS01afa4c8`, `TSde3a083f027` (F5/edge sticky cookies).

**Important fix carried over from the Puppeteer era:** sending the traces-app login-service
cookies along with the preauth call makes the bridge reliable. Without them the preauth-created
`JSESSIONID` was intermittently rejected by the legacy app (first page hit bounced to the new
portal with `302 → https://traces.tdscpc.gov.in/auth/`).

### 3.3 Cookie jar plumbing

`openTraces61ApiSession()` wires a `tough-cookie` jar into an axios instance:

- **request interceptor** — sets `Cookie` from `jar.getCookieString(url)`
- **response interceptor** — feeds every `Set-Cookie` back into the jar
- redirects are followed **manually** (`legacyGet` / form helpers) so intermediate `Set-Cookie`
  hops are not lost (axios hides them), `http://` Locations are rewritten to `https://`
  (replaces the old CDP "https upgrade" guard), and a redirect to the **new** portal is surfaced
  instead of followed (session-death signal).

---

## 4. Migration map — file by file

| Old (Puppeteer) | New (API) | Pattern |
|---|---|---|
| `src/jobs/traces/tracesSession.ts` `openTracesSession` | `src/jobs/traces/apiSession.ts` `openTraces61ApiSession` | full session via login + preauth + jar |
| — | `src/jobs/traces/legacyHtml.ts` | HTML parsing (forms, successful controls, selects, onclick commandLinks, captcha / error / request-number detection) |
| — | `src/jobs/traces/legacyForms.ts` | MyFaces submit helpers (`submitLegacyControl`, `submitLegacyPostback`, `ensureLegacySelectOption`, `assertLegacyStep`, `runLegacyRequestFlow`, …) |
| — | `src/jobs/traces/legacyKyc.ts` | Normal KYC chain shared by the Conso and Form 16/16A request flows |
| `src/scripts/fetchOutstandingDemand.ts` (page + response interception of `TagChallanServlet`) | same file — `TagChallanServlet?reqtype=0` (current) + `?reqtype=11` (Prior Years) | Pattern B |
| `src/scripts/fetchReturnStatus.ts` (selects + Go + table paging) | same file — `DedStmtStatusServlet?…&reqType=1` paged, `reqType=5` (`errIds=`) for rejection reasons | Pattern B |
| `src/clause34/fetchStatementStatus.ts` (`page.evaluate` fetch in-page) | same file — same servlet via axios; `StatementSession` now wraps `Traces61ApiSession` (relogin preserved) | Pattern B |
| `src/scripts/updateTldcData.ts` (197 cert verification form + table) | same file — `CertiVerifyServlet?deducteePan&financialYear&certiNo&reqType=1` | Pattern B |
| `src/scripts/fetchTldcData.ts` (ded inbox + row click + download) | same file — `CommInboxServlet?reqtype=1&category=42…` listing + `GET …&reqtype=5&commId…` for the cert PDF | Pattern B + GET download |
| `src/jobs/workers/NoticeDownloader-conso.ts` `getTracesFilepuppeteer` | new `getTracesFileApi` — `GetReqListServlet` + `DownloadServlet` (downloads existing NSDL conso files) | Pattern B + GET download |
| `src/jobs/workers/NoticeDownloader-conso.ts` `getTracesDatapuppeteer` (Conso Go / KYC) | new `sendConsoRequestApi` — `nsdlconsofile.xhtml` (#finYr, #qrtr, #frmType, #download_conso) → Normal KYC chain (`legacyKyc.ts`: #search2, #normalkyc → #token…#amt3, #clickKYC → #redirect) | Pattern C (multi-step, **not live-tested**) |
| `src/jobs/workers/NoticeDownloader-form16.ts` `getTracesFilepuppeteer` | new `getTracesFileApi` — same servlets, filter `bulk form 16[a] file` | Pattern B + GET download |
| `src/jobs/workers/NoticeDownloader-form16.ts` `getTracesDatapuppeteer` (Form 16/16A request) | new `sendForm16RequestApi` — `download16[a].xhtml` (#bulkfinYr [+ #bulkquarter, #bulkformType], #bulkGo) → optional #clickGo → Submit `#j_id1972728517_7cc7de5f` → Normal KYC chain | Pattern C (multi-step, **not live-tested**) |
| `src/jobs/workers/NoticeDownloader-justification.ts` | **already migrated previously** — `runJustificationApiFlow` (new-portal REST); Puppeteer methods left unused | — |
| `src/jobs/workers/NoticeDownloader-challanStatus.ts` (`queryChallanStatusPuppeteer`, `scrapeUnconsumedListPuppeteer`) | same methods now API: `GetUnconChlnDetailServlet?reqtype=0` listing + `reqtype=1` amount reveal (`recptNum&chlnSNo&enteredAmt&dateOfDep&bsrCode` → `unConsChlnAmt`) | Pattern B |
| `src/scripts/runBalamConsoSendRequest.ts` | now calls `sendConsoRequestApi` | — |

### Still Puppeteer (deliberately)

- Dev/debug scripts only: `src/scripts/probeStmtStatus.ts`, `probeChallanStatus.ts`,
  `crawlTracesPages.ts`, `debugConsoGo.ts`, `debugConsoDownload.ts` (unchanged; not production paths).
- The old worker methods (`getTracesFilepuppeteer`, `getTracesDatapuppeteer`) are **retained but
  no longer called** — they serve as rollback reference. Remove them after the API paths are
  validated with a test TAN (they are the only remaining `puppeteer.launch` sites in workers).
- `src/jobs/traces/puppeteerSession.ts` / `tracesSession.ts` are kept exported for those
  scripts; no production job uses them any more.

---

## 5. Endpoint reference (extracted from the portal's own JS)

| Page | Purpose | Servlet / form |
|---|---|---|
| `dashboard.xhtml` | ded dashboard | widgets: `dashbdoutdmnd.xhtml`, `dashbdinboxcount.xhtml`, `dashbdreqdwnld.xhtml`, `dashboardactivity.xhtml`, `dashboardalert.xhtml`, `dashboardTDSExpand.xhtml?typedetail=…`; graph: `srv/TdsPerfGraphServlet` |
| `outstandingdemand.xhtml` | demand | `srv/TagChallanServlet?reqtype=0` rows `{finYr,aodmnd,cpcdmd,fin}`; Prior Years `?reqtype=11` (fin=1) |
| `stmtstatus.xhtml` | statement status | `srv/DedStmtStatusServlet?financialYear&quarter&formType&reqType=1`; rejection `?reqType=5` body `errIds=<row.remarks>` → `[{failMsg}]` |
| `filedownload.xhtml` | request list | `srv/GetReqListServlet?reqtype=0` rows `{reqDate,reqNo,finYr,qrtr,frmType,dntype,status,remarks,file,…}`; download `srv/DownloadServlet` body `reqNo=…` → URL |
| `download16.xhtml` | Form 16 request | form `bulkPan`: `bulkfinYr`, `dwnldFormBulkType=13`, `renderPage1`, `bulkGo=Go` |
| `download16a.xhtml` | Form 16A request | form `bulkSearch`: `bulkfinYr`, `bulkquarter`, `bulkformType`, `dwnldFormBulkType=14`, `bulkGo=Go` |
| `justrepdwnld.xhtml` | justification report | form `justificationForm`: `finYr`, `qrtr`, `frmType`, `download_justReport=Go`, `renderPage` (+ OTP `otpNo`/`valPin` after Go) |
| `nsdlconsofile.xhtml` | conso request | form `requestnsdlconsoForm`: `finYr`, `qrtr`, `frmType`, `download_conso=Go` → 302 `downloadreqspec.xhtml?dt=5&qr&fy&unmFlg&ft` → 302 `kyc3formdsc.xhtml?…` |
| `kyc3formdsc.xhtml` | KYC choice | form `kycformdsc`. `#search2` (own name, not a group with `#search1`) → script unticks `search1`, sets `kycentryfrm=NORMAL_KYC`. `#normalkyc` is a button **outside** the form; jQuery clicks the hidden commandLink → POST `kycformdsc:_idcl=nxtSrcn` → 302 `downloadreqspec…rdrctfrm=frwdToKycFn` → 302 `kyc3form.xhtml?…` |
| `kyc3form.xhtml` | challan details | form `dedkyc`: `token,bsr,dtoftaxdep(DD-Mon-YYYY),csn,chlnamt,pan1-3,amt1-3` + `clickKYC=Proceed` → 200, page now has form `dedkyc` → `kyc3confirm.xhtml` with `authcode` + `redirect` |
| `kyc3confirm.xhtml` | Proceed with Transaction | POST `authcode`, `redirect=Proceed with Transaction` → 302 `downloadreqspec.xhtml?…rdrctfrm=frmKycScrn` (200) |
| `downloadreqspec.xhtml` | creates the request | `document.ready` → `GET /app/srv/CreateDwnldReqServlet?fy&qr&ft&dt&unmflg` (from its hidden `finYr,qrtr,formType,dwldType,unmFlg`) → 302 `dwnldreqconfirm.xhtml?DWNLDREQID=<request no>&DWNLDTYPE=NSDL Conso File` ("Request Number is …") |
| `197certiverfication.xhtml` | 197 cert verify | `srv/CertiVerifyServlet?deducteePan&financialYear&certiNo&reqType=1` → 19 columns (`serialno…tanCode`) |
| `dedinbox.xhtml` | comm inbox | `srv/CommInboxServlet?reqtype=1&sdate&edate&category&finYear&quarter&commClassify=1`; category **42** = Certificate U/S 197,206C; PDF = `GET …?commId&finYear&formType&reqtype=5&certNum&description` |
| `unconschallandetail.xhtml` | unconsumed challans | `srv/GetUnconChlnDetailServlet?reqtype=0` rows `{recptNo,chlnbsrcode,dateofdep,chlnsrno,chlnamt,unconschlnamt}`; reveal `?reqtype=1` body `recptNum&chlnSNo&enteredAmt&dateOfDep&bsrCode` → `[{success:2,unConsChlnAmt}]` |

Grid rows: masked tokens keep the `first-4 + X… + last-4` convention (`tokenMatches` unchanged).

---

## 6. Feature migration status (count)

**10 production features moved off Puppeteer; 2 of them are state-changing flows migrated but
not live-tested (per the no-state-changing-POST test policy).**

| # | Feature | Status | Live-tested |
|---|---|---|---|
| 1 | Outstanding Demand (`fetchOutstandingDemand`) | ✅ Migrated | GET + servlet structure verified |
| 2 | Return Status (`fetchReturnStatus`) | ✅ Migrated | servlet structure verified |
| 3 | Statement Filed Status / clause 34 (`fetchStatementStatusBatch`) | ✅ Migrated | servlet verified earlier (same endpoint) |
| 4 | TLDC 197 Certificate Verification (`updateTldcData`) | ✅ Migrated | page/servlet structure verified |
| 5 | TLDC data + certificate PDF (`fetchTldcData`) | ✅ Migrated | page/servlet structure verified |
| 6 | Conso file listing + download (`NoticeDownloader-conso` DownloadFile) | ✅ Migrated | servlet structure verified |
| 7 | Conso request submission / Conso Go (`sendConsoRequestApi`) | ✅ Migrated, ⚠ API run pending | Puppeteer flow captured live 13-Oct-2026 (request 203680159); the API code replayed against that capture sends the same 12 requests with identical form bodies |
| 8 | Form 16/16A listing + download (`NoticeDownloader-form16` DownloadFile) | ✅ Migrated | servlet structure verified |
| 9 | Form 16/16A request submission (`sendForm16RequestApi`) | ✅ Migrated, ⚠ not live-tested | KYC part shares the captured Conso chain; the Form 16 pages before it are not captured yet |
| 10 | Unconsumed Challan Status, full + list (`NoticeDownloader-challanStatus`) | ✅ Migrated | listing structure verified; reveal POST untested |
| 11 | Justification Report | ✅ Already API (new-portal REST) | n/a |
| 12 | Session infrastructure | ✅ Migrated | full live verification (§2) |

**Capturing a Puppeteer flow:** `node scripts/run-ts.js src/scripts/runBalamConsoSendRequest.ts --puppeteer`
records the old flow's clicks and every TRACES request/response to `logs/traces-capture/`
(`src/jobs/traces/puppeteerTrafficCapture.ts`). The API mode (no flag) writes every page/POST it
makes to the same place (`TRACES_LEGACY_DUMP_DIR`). Both modes file a real request.

**To validate the two ⚠ flows:** run them for one test TAN with `SendRequest` enabled and
check **Requested Downloads** for the created request (the job logs the request number when
the confirmation page shows one). Rollback = point the call site back to
`getTracesDatapuppeteer` (kept in place).

**Read-only assumptions still to confirm with a TAN that has data** (only
`DedStmtStatusServlet` was actually POSTed during verification):

| Assumption | Used by | If wrong |
|---|---|---|
| `TagChallanServlet`, `CertiVerifyServlet`, `CommInboxServlet`, `GetUnconChlnDetailServlet` live under `/app/ded/srv/` (`GetReqListServlet`/`DownloadServlet` are under `/app/srv/`) | demand, TLDC, unconsumed challans | every call fails with HTTP 404 |
| Prior Years = `TagChallanServlet?reqtype=11` | `fetchOutstandingDemand` | prior-years data missing |
| Rejection reason = `DedStmtStatusServlet?reqType=5`, `errIds=<row.remarks>` | `fetchReturnStatus` | no rejection text |
| CertiVerify JSON keys (`certino`, `cncldate`, `validto`, …) | `updateTldcData` | empty fields; an empty cancel date marks a certificate active |
| Unconsumed grid: `unconschlnamt` shows "View Amount" (or no amount) until revealed | challan status | reveal skipped / wrong amount column |

---

## 7. Code notes / gotchas

1. **ViewState freshness.** Single-step flows may fetch the page then POST (fresh ViewState is
   fine). Multi-step flows MUST submit the form from the previous response —
   `submitLegacyControl(session, previousPage, …)` does this (the form's own hidden
   `javax.faces.ViewState` is sent). A fresh GET between steps can reset the flow state.
2. **Only the clicked control.** MyFaces treats a button as clicked when its name is in the
   request, so other buttons in the form must never be posted. commandLinks are read from the
   link's own `onclick` (`myfaces.oam.submitForm(form, linkId, target, params)`), falling back to
   `<formId>:_idcl=<link id>`. Fields are given by element id and mapped to input names.
3. **`_SUBMIT=1`.** Every MyFaces form carries `<formId>_SUBMIT=1`; the helpers preserve it.
4. **Redirect hops.** Post-GET after a POST-302 must keep the cookie jar updated (helpers do).
5. **Session expiry mid-sweep.** Keep the existing warm-up + relogin recovery patterns
   (kept in `fetchStatementStatusForCompany`); `relogin()` rebuilds the jar in place and the
   axios interceptors keep working because they read the jar through a mutable reference.
6. **Every step must render its expected control.** `assertLegacyStep` throws
   `TRACES_SESSION_EXPIRED`, `RESOURCE_NOT_FOUND_ERROR`, `CAPTCHA_FAILED_IN_FLOW` (captcha
   input/image instead of the expected control), or the portal's own error messages. The
   request flows never report success after skipping a step.
7. **Retries never file twice.** `runLegacyRequestFlow` re-runs a request flow from login
   (Form 16: 5 attempts like the Puppeteer flow; Conso: 3) only for retryable failures
   *before* "Proceed with Transaction". Anything after that POST is `FINAL_SUBMIT_UNCONFIRMED`
   and is never retried — check Requested Downloads instead.
8. **Preauth flakiness.** Sending the traces-app cookies on the preauth call stabilises the
   bridge. A preauth failure itself is not retried; the job fails and the caller's own retry
   (e.g. clause 34 `runCompany`) applies.
9. **Servlet redirects = dead session.** `postLegacyServletJson` does not follow redirects; a
   302 to the new portal throws `session expired`, so recovery code can re-login.
10. **`BIGipServer`/`TS*` cookies rotate** on every response — the jar approach handles this
   automatically (tough-cookie setCookieSync per response).

---

## 8. Files touched

```
src/jobs/traces/apiSession.ts          (new) API session: login + preauth + cookie jar + legacy GET/servlet helpers
src/jobs/traces/legacyHtml.ts          (new) HTML parsing for legacy pages (forms, controls, messages)
src/jobs/traces/legacyForms.ts         (new) MyFaces submit helpers, step checks, request-flow retries
src/jobs/traces/legacyKyc.ts           (new) Normal KYC chain shared by the request flows
src/jobs/traces/*.test.ts              unit tests for the above (offline, fake client)
src/jobs/traces/index.ts               exports the new modules
src/scripts/fetchOutstandingDemand.ts  rewritten (API)
src/scripts/fetchReturnStatus.ts       rewritten (API)
src/scripts/updateTldcData.ts          rewritten (API)
src/scripts/fetchTldcData.ts           rewritten (API)
src/scripts/runBalamConsoSendRequest.ts call switched to sendConsoRequestApi
src/clause34/fetchStatementStatus.ts   rewritten (API; same public API)
src/jobs/workers/NoticeDownloader-conso.ts           + getTracesFileApi, sendConsoRequestApi; call sites switched
src/jobs/workers/NoticeDownloader-form16.ts          + getTracesFileApi, sendForm16RequestApi; call sites switched
src/jobs/workers/NoticeDownloader-challanStatus.ts   queryChallanStatusPuppeteer/scrapeUnconsumedListPuppeteer now API
```
