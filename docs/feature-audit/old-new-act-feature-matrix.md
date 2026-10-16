# Old Act / New Act feature matrix

Checked against the code at commit `5ecedf1` on 13-Oct-2026. Where this file and the older
per-page audits in this folder disagree, trust this file. Section 7 lists what is stale.

- **Old Act** means the Income-tax Act, 1961: FY up to 2025-26, portal code `O`.
- **New Act** means the Income-tax Act, 2025: tax year 2026-27 onward, portal code `N`.

**Legend:** ✅ works · ⚠️ partial (see the notes) · ❌ not implemented · — not tied to an Act

---

## 1. Before you read

### Portals the app drives

| Short name | Host | How the app uses it |
|---|---|---|
| IT e-portal | `eportal.incometax.gov.in` | REST calls, plus a visible Chrome window for the e-Pay Tax screens |
| TRACES (legacy) | `traces61.tdscpc.gov.in/app/ded/*.xhtml` | Plain HTTP (axios + cookie jar) after a REST login + preauth bridge, no browser. See `docs/TRACES-OLD-PORTAL-API-MIGRATION.md` |
| TRACES (new) | `traces-app.tdscpc.gov.in` (the API behind `traces.tdscpc.gov.in`) | REST with a Bearer token, no browser |

**Menu paths.** The app opens portal pages by URL. It never clicks through menus. In this file:
- The **page title and URL are the authoritative reference.**
- A menu path marked **≈** is the usual portal label. Confirm it the first time you test by hand.

### How each feature decides Old vs New

| Rule | Code | Used by |
|---|---|---|
| FY `>= "2026-27"` → New | `src/challan/utils/paymentHistoryFiles.ts:169` | Payment-gaps batch, PDFs from unconsumed Excel, challan-status batch |
| Deposit date **after** 30-Apr-2026 → New | `paymentHistoryFiles.ts:181-191` | Payment PDFs from uploaded Excel |
| FY start year ≥ 2026 → New | `src/tldc/serialize.ts:8`, `src/pages/tldc/index.tsx:397` | TLDC per-row update; `act` filter on `/api/tldc/list` |
| The user picks the Act (radio, select or CSV `Act` column) | `src/challan/utils/incomeTaxAct.ts` | Challan create, e-Pay downloads, TLDC batch fetch, missing-PDF download, Form 140 extract |
| Form type `130`/`131`/`133`, or a file header `FH^..^FORM13x` | `src/utils/form131ParserExact.ts:239-248` | Certificate PDF generation |

> ⚠️ **The FY rule and the deposit-date rule disagree for deposits made 1–30 Apr 2026.**
> These are typically March 2026 deductions, which belong to the Old Act. The FY rule classes them as New.

---

## 2. Summary matrix

| # | Feature | App page | Portal page | Old Act | New Act |
|---|---|---|---|---|---|
| **TRACES** | | | | | |
| T1 | TLDC / lower-deduction certificates: fetch and update | `/tldc` | Old: legacy Communication Inbox + 197 Certificate Validation · New: child-certificate REST | ✅ | ✅ |
| T2 | LDC utilisation (limit, consumed, %) | `/ldc-utilisation` | none (built from T1 data) | ✅ | ✅ |
| T3 | TDS certificate download (16A / **131**) | `/form-16` | Old: Downloads → Requested Downloads · New: `tdscertificatesservice` | ✅ | ⚠️ 2026-27 Q1 only |
| T4 | TDS certificate request (16A / **131**) | `/form-16` | Old: Downloads → Form 16A + KYC · New: `tdscertificatesservice/initiate` | ✅ | ⚠️ 2026-27 Q1 only |
| T5 | Certificate PDFs from TRACES ZIPs | `/form-16` | none (offline, like TRACES-PDF-Converter) | ✅ 16A | ✅ 131 · ⚠️ 130/133 |
| T6 | Form 16 / **Form 130** (salary) | `/form-16` | Old: Downloads → Form 16 · New: `tdscertificatesservice` | ⚠️ no PDF | ⚠️ unverified, wrong layout |
| T7 | DSC signing of certificates | `/form-16` + `dsc:*` scripts | none (Windows token) | ✅ | ✅ |
| T8 | Email certificates to deductees | `/form-16` | none (SMTP) | ✅ | ✅ |
| T9 | Conso file: request and download | `/conso-files` | Statements / Payments → Request for Conso File; Downloads → Requested Downloads | ✅ | ❌ |
| T10 | Justification report | `/justification-report` | New TRACES `tanjustreportservice` | ⚠️ UI is fixed to Form 140 | ⚠️ downloads work, Excel crashes |
| T11 | Unconsumed challans / challan status | `/challan-status` | Legacy "Unconsumed Challans" | — works for both | — works for both |
| T12 | Outstanding demand | `/outstanding-demand` | Legacy `outstandingdemand.xhtml` | — works for both | — works for both |
| T13 | Return / statement status | `/return-status` | Statements / Payments → Statement Status | ✅ | ❌ |
| T14 | Clause 34(b)/(c) working paper (Form 3CD) | `/clause-34b` | Statement Filed Status servlet | ✅ FY 2025-26 only | ❌ |
| **IT e-portal** | | | | | |
| I1 | Create challan (manual) | `/challan-management` | e-Pay Tax → New Payment → TDS/TCS (281), via API | ✅ | ✅ combined only |
| I2 | Create challans (CSV batch) | `/challan-management` | same as I1 | ✅ | ✅ |
| I3 | Payment History receipts (filtered) | `/challan-management` | e-Pay Tax → Payment History | ✅ | ✅ |
| I4 | Generated Challans download | `/challan-management` | e-Pay Tax → Generated Challans | ✅ | ✅ |
| I5 | CSI file download | `/challan-management` | e-Pay Tax → Challan Status Inquiry (CSI) File | ✅ | ✅ |
| I6 | CSV-targeted e-Pay downloads | `/challan-management` | Payment History / Generated Challans tabs | ✅ | ✅ |
| I7 | Payment PDFs from an uploaded Excel | `/challan-management` | e-Pay Tax → Payment History | ✅ | ✅ Act auto-picked by date |
| I8 | Payment history and missing-PDF (gaps) report | `/payment-history-gaps` (not in sidebar) | `paymenthistory` API | ✅ | ✅ |
| I9 | Download missing payment PDFs | `/payment-history-gaps` | e-Pay Tax → Payment History | ✅ | ⚠️ no date filter |
| I10 | Receipts for the unconsumed-challan list | `/challan-status` | `paymenthistory` API + Payment History | ✅ | ✅ |
| I11 | Extract acknowledgements (Form 140 / 26Q) | `/extract-form140` | e-File → Income Tax Forms → View Filed Forms | ✅ 26Q only | ✅ 140 only |
| I12 | Extract RRR (token numbers) | `/extract-rrr` | View Filed Forms | ✅ | ❌ |
| **Platform** (not tied to an Act) | | | | | |
| P1 | Companies and credentials | `/companies` | — | — | — |
| P2 | Deductee masters (PAN → email) | `/deductee-masters` | — | — | — |
| P3 | SMTP settings | `/smtp-configs` | — | — | — |
| P4 | Logs / batch monitor and retry | `/logs` | — | — | — |
| P5 | Documents file browser | `/document` | — | — | — |
| P6 | Exports (xlsx / csv / pdf) | `ExportButtons` on each page | — | — | — |
| P7 | REST API, API tokens, Swagger | `/api-docs`, `/api/*` | — | act parameters, see P7 | act parameters, see P7 |
| P8 | Login and licence | `/auth/login`, `/configure` | — | — | — |

---

## 3. TRACES features

### T1. TLDC: lower-deduction certificates (s.197 Old / New Act child certificates)

**Where it is on the portal**

*Old Act — TRACES legacy*
- **Communication Inbox** (`/app/ded/dedinbox.xhtml`): category `Certificate`, rows matching 197/206C, then Download.
- **197 Certificate Validation** (`/app/ded/197certiverfication.xhtml`): PAN + FY + certificate number, then Go. This grid gives the limit, consumed amount, validity and cancel date.

*New Act — new TRACES REST on `traces-app.tdscpc.gov.in`*
- `POST /childcertgenservice/api/view/searchDeductor` lists certificates.
- `GET /childcertgenservice/api/download/requests` lists download requests.
- `POST /childcertgenservice/api/download/initiate` creates a download request.
- `POST /childcertgenservice/api/download/downloadChildCertificates` returns the PDF (base64).
- `GET /certificateservice/api/child-certificate?childCertNum&tan&pan` returns certificate detail.

**Where it is in the app**

`/tldc` → "Fetch TLDC Data" card:
- Inputs: **Income Tax Act** radio, Companies, Financial Year.
- New Act only: two switches, "Initiate if no download request exists" and "Force initiate".
- Buttons: **Fetch TLDC Data** and **Update Existing Data**.
- Each table row also has **Update from Portal**, which picks the Act from the row's FY.

**Code:**
- Old Act APIs: `src/pages/api/tldc/fetch-data.ts` and `update-data.ts`, using `src/scripts/fetchTldcData.ts` and `updateTldcData.ts`.
- New Act APIs: `fetch-data-new-act.ts` and `update-data-new-act.ts`, using `src/scripts/fetchTldcDataNewAct.ts`.
- Client read API: `/api/tldc/list`.

**Old Act ✅ / New Act ✅**
- New Act `section` holds the payment code (e.g. `1027`). The API adds `sectionDesc`; for `1027` that is `393(1) [Table: Sl. No. 6(iii)]`.
- New Act `cancelDate` is always null. `activeFlag` drives `isActive` instead.

**How to test**
1. On `/companies`, make sure the company has TRACES `User ID`, `Password` and `Tan`. `SERVER_URL` (the captcha service) must be set in `.env`.
2. **Old Act:**
   - Select Old Act, FY 2025-26, one company, then **Fetch TLDC Data**.
   - Check that the rows show PAN name, limit and consumed amount.
   - Click **Update from Portal** on one row.
   - Compare the row with the portal's 197 Certificate Validation screen.
3. **New Act:**
   - Select New Act, FY 2026-27, and leave "Initiate if no download request exists" on, then Fetch.
   - The first run often reports missing certificate numbers, because the portal needs time to generate the PDFs. Run it again a few minutes later.
   - PDFs land in `public/pdf/child-certificates/<Company>/`.
4. **API:**
   - Use the Postman collection `docs/client-response/01-Postman/Taxteck-TDS-APIs.postman_collection.json`, folder LDC.
   - Call `POST /api/tldc/list` with `{"tan":"…","act":"new"}`.
5. **Offline:** `node scripts/run-ts.js src/scripts/backfillTldcPdfPaths.ts --dry-run`.

**Test files**
- There is no input file.
- Existing New Act PDFs: `public/pdf/child-certificates/` (15 companies).
- Section codes and error codes: `docs/client-response/03-API-Reference/LDC-LOV-and-Error-Codes.xlsx`.

**Output**
- Database table `TldcData`, unique on (company, certNumber, fy).
- Old Act PDFs: `public/pdf/tldc-downloads/certificates/<cert>.pdf`.
- New Act PDFs: `public/pdf/child-certificates/<Company>/<requestId>.pdf`, with detail JSON in `details/`.

**Known issues**
- **Account lock risk.** The UI retries each company 3 times on any error, including a wrong password (`tldc/index.tsx:201-261`). That can lock the TRACES account.
- **FY stored as a bare year (likely).** Old Act rows are probably stored as `fy="2025"`, while Quick Add and New Act use `"2025-26"`. That can create duplicate rows and break the FY filter on LDC Utilisation. Check the database after the first Old Act fetch.
- **Duplicate check ignores the company.** The Old Act duplicate check matches only certificate number + FY.
- **Consumed amounts go stale.** Old Act **Update Existing Data** only refreshes rows with a blank PAN name. Only per-row Update refreshes consumed amounts.
- **No Act/FY validation.** For example, New Act with FY 2017-18 is accepted.
- **TCS certificates mixed in.** The Old Act inbox filter also picks up 206C(9) certificates.

### T2. LDC utilisation

**Portal:** none. The page reads the `TldcData` rows written by T1.

**App:** `/ldc-utilisation`, with company, FY and search filters. It shows Limit, Consumed, Remaining and a Utilisation % bar, and has Export.

**Old Act ✅ / New Act ✅.** Rows from both Acts are mixed, and there is no Act column or filter.

**How to test**
1. Run T1 first.
2. Check that Remaining = max(0, Limit − Consumed) and that % = Consumed ÷ Limit.
3. Export to Excel, PDF and CSV.

**Known issues**
- The FY dropdown is built from the rows on the current page.
- Old Act rows stored as `"2025"` will not match the `"2025-26"` filter.
- Figures are only as fresh as the last T1 refresh.

### T3. TDS certificate download: Form 16A (Old) / Form 131 (New)

**Where it is on the portal**
- **Old Act:** TRACES legacy **Downloads → Requested Downloads** (`/app/ded/filedownload.xhtml`). The app picks rows of type "Bulk Form 16A File" with status Available.
- **New Act:** new TRACES REST.
  - `GET /tdscertificatesservice/getActiveRequests?userId=<TAN>`
  - `POST /tdscertificatesservice/initiate` with `{financialYear, quarter, formType, downloadType: 14}`
  - `GET /tdscertificatesservice/downloadFile?requestId=`

**Where it is in the app:** `/form-16` → Form Type **Form 16A** → **Portal Method** (New Portal REST / Old Portal Puppeteer) → Action **Download File**.

**Old Act ✅.** It downloads every available bulk 16A file. It **ignores** the FY, quarter and form you select.

**New Act ⚠️**
- It works for **Form 131, FY 2026-27, Q1 only**. The period is hard-coded in:
  - `src/pages/form-16/index.tsx:297,312`
  - `src/shared/excel/periods.ts:52-54`
  - `src/form16/mutations/processExcelUploadForm16.ts:88-90`
- A real portal run is on record. `logs/267-it.log` shows an `initiate` call with `formType:"131"`, and it saved `public/pdf/form16a-download/Clean Max Aero Private Limited/2026-27/Q1/131/F16A_250935812.zip`.
- If there is no request yet, Download File starts one.
- **Q2 2026-27 certificates cannot be requested from the UI.** The REST code itself would accept any period.

**How to test the New Act flow**
1. Select Form 16A → New Portal → Specific period: 2026-27, Q1, 131 → Download File.
2. Watch `logs/<taskId>-it.log`. The first run initiates a request. Run it again once TRACES shows the request as Generated.
3. Check the ZIP at `public/pdf/form16a-download/<Company>/2026-27/Q1/131/`.
4. Check the PDFs at `public/pdf/form16a/<Company>/131_FY2026-27_Q1/<PAN>_131_2026-27_Q1.pdf`.

**How to test the Old Act flow:** select Form 16A → Old Portal → Download File. The output is `public/pdf/form16a-download/<Company>/<FY>/<Q>/<form>/`.

**Known issues**
- **Empty Excel for Form 131.** The Excel built under `public/pdf/traces_excel/` is empty for Form 131 files, because that parser expects CD/DD records.
- **Extracted data piles up.** `public/pdf/temp_extract/` is never cleaned, and the extracted certificate data in it is served statically.

### T4. TDS certificate request: Form 16A (Old) / Form 131 (New)

**Where it is on the portal**
- **Old Act:** **Downloads → Form 16A** (`/app/ded/download16a.xhtml`), then the bulk request, then KYC validation (`downloadreqspec.xhtml`).
  - KYC uses the token number (RRR), one challan (BSR, date, serial number, amount) and up to 3 PAN + amount pairs from the return.
- **New Act:** `POST /tdscertificatesservice/initiate`. No KYC is needed.

**Where it is in the app:** `/form-16` → Action **Send Request**.

**Old Act ✅.** It needs two things:
- The FVU return `.txt` under `public/pdf/data/<FY>/<Company>/…`.
- The company's IT password. The app uses it to fetch filed returns from IT portal View Filed Forms and caches them at `public/pdf/return/F26Q/<Company>/returns.json`.

**New Act ⚠️.** FY 2026-27, Q1 only, the same restriction as T3.

**How to test the Old Act flow:**
- Company: Clean Max Balam. FY 2025-26, Q3, 26Q.
- The FVU file is already present: `public/pdf/data/2025-26/Clean Max Balam Private Limited/FVU/CLEA26Q3.txt`.
- Check the result on the portal under Downloads → Requested Downloads.

**Known issues**
- **Stale RRR possible.** `returns.json` is never refreshed once written.
- **Unhelpful failure.** With no matching `.txt` or return, the task throws a TypeError and retries 5 times before failing.
- **Fragile selector.** It depends on a hard-coded JSF element id, `#j_id1972728517_7cc7de5f`.

### T5. Certificate PDFs from TRACES ZIPs (TRACES-PDF-Converter equivalent)

**Portal:** none. This runs offline.

**App:** `/form-16` → card **"Generate Form 16 / 16A PDFs from Existing ZIP Files"**. It also runs automatically after T3.

**Old Act ✅.** It renders "FORM NO. 16A … section 203 of the Income-tax Act, 1961" (`src/utils/form16APdfGeneratorExact.ts`).

**New Act**
- **Form 131 ✅.** The layout is matched to the official sample `public/131_AAECC1568J_Q1_2026-27.pdf` (`src/utils/form131PdfGeneratorExact.ts`). It uses "Tax Year" and s.397(3)(b), and the nature-of-payment legend comes from `src/utils/form131NatureLegend.ts`.
- **Form 130 and Form 133 ⚠️.** They get their own titles but the 131 layout. The legend has no codes 1001/1002 (salary) or 1068–1092 (TCS).

**How to test the New Act flow offline (no portal needed)**
1. Source folder: `public/pdf/form16a-download/Clean Max Aero Private Limited/2026-27/Q1/131`.
2. TAN: Clean Max Aero's TAN (it is the ZIP password).
3. Select Form 16A and New Portal, so that form 131 appears. Choose FY 2026-27, Q1, 131, then Generate.
4. Compare the result page by page with `public/131_AAECC1568J_Q1_2026-27.pdf`.
5. Alternative, a visual diff (needs poppler `pdftoppm`):
   ```bash
   SAMPLE_TXT="public/pdf/temp_extract/Clean_Max_Aero_Private_Limited/F16A_250935812/MUMxxxxx7G_FORM131_2026_Q1_250935812_1.txt" npm run pdf:preview
   ```

**How to test the Old Act flow offline**
1. Unzip `public/Swiggy_Q4.zip` into a folder. It is gitignored and holds 22 TRACES Form 16A ZIPs for 2025-26 Q4.
2. Point the card at that folder with Swiggy's TAN, 26Q, Q4, 2025-26.

**Output:** `public/pdf/form16a/<Company>/<form>_FY<FY>_<Q>/<PAN>_<form>_<FY>_<Q>.pdf`.

### T6. Form 16 (Old) / Form 130 (New): salary certificates

**Where it is on the portal**
- **Old Act:** **Downloads → Form 16** (`/app/ded/download16.xhtml`) to request. **Downloads → Requested Downloads** ("Bulk Form 16 File") to download.
- **New Act:** `tdscertificatesservice` with form `130`.

**Old Act ⚠️.** Request and download work, but **no PDF is ever generated** (`src/utils/processZipsForForm16.ts:447-450`; the worker only generates PDFs for 16A).

**New Act ⚠️**
- Form 130 can only be reached under **"Form 16A" + New Portal**. The "Form 16" option has no New Act path.
- It is rendered with the Form 131 layout.
- No log shows the portal accepting `downloadType:14` for form 130.

**How to test:** select Form 16 → Old Portal → Download File. Expect a ZIP under `public/pdf/form16-download/…` and no PDFs.

### T7. DSC signing

**App**
- On `/form-16`: DSC certificate picker, Action **Attach DSC**, and automatic signing after a 16A/131 download.
- CLI: `npm run dsc:test`, `dsc:unlock`, `dsc:sign`.
- Setup guide: `docs/DSC-SETUP.md`.

**Old Act ✅ / New Act ✅.** It signs whichever PDFs were generated.

**Requirements:** Windows, .NET 10 Desktop Runtime, `pdf-signer/pdf-signer.exe`, and the USB token plugged in.

**How to test**
1. Copy `public/131_AAECC1568J_Q1_2026-27.pdf` into `docs/pdf-reference/` (see the known issues).
2. Run:
   ```bash
   npm run dsc:test -- --no-sign
   ```
3. Then run:
   ```bash
   npm run dsc:sign -- --check
   ```

**Known issues**
- **The "unlock token" button returns HTTP 500.** `/api/dsc/unlock` and `dsc:unlock` read `docs/pdf-reference/131_AAECC1568J_Q1_2026-27.pdf`, and that folder is empty. `npm run pdf:preview` defaults to `docs/pdf-reference/fusion-form131-sample.txt`, which is also missing.
- **Possible double signing.** "Attach DSC" picks up every PDF in the company folder, including ones already signed.
- **No `pdf-signer/dsc-map.json`.** Only `dsc-map.json.example` exists.

### T8. Email certificates to deductees

**App:** `/form-16` → **Manual Email Trigger**, with optional company, FY, quarter and form filters.

**Requirements**
- One **active** SMTP config (P3).
- PAN → email rows in Deductee Masters (P2).

**Old Act ✅ / New Act ✅.** Folders are matched by `<form>_FY<FY>_<Q>`, so `131_FY2026-27_Q1` works.

**How to test**
1. Point the SMTP config at a test inbox.
2. Add one deductee master with your own email address, using a PAN that has a generated PDF.
3. Filter to that company, FY and quarter, then send.

> ⚠️ **If you leave every filter empty, the app emails every deductee of every company.** These are real emails.

**Known issue:** the subject and body say "Financial Year". The New Act term is "Tax Year".

### T9. Conso file

**Where it is on the portal**
- **Request:** **Statements / Payments → Request for Conso File** (`/app/ded/nsdlconsofile.xhtml`, page title "Request for Consolidated File"), then KYC.
- **Download:** **Downloads → Requested Downloads**, rows of type "NSDL Conso File". The app calls `GetReqListServlet` and `DownloadServlet` directly.

**App:** `/conso-files` → Download Conso Files / Send Request, with live progress and retry.

**Old Act ✅.** Forms 24Q, 26Q, 27Q and 27EQ.

**New Act ❌**
- The UI has no Form 140 or other New Act statement type (`src/shared/excel/periods.ts:13`).
- Returns are only looked up for F24Q, F26Q, F27Q and F27EQ.

**How to test**
1. **Download:** run Download Conso Files. It fetches every available file.
2. **Send Request:** Clean Max Balam, FY 2025-26, Q3, 26Q. It uses the FVU file from T4.
3. **Check the output:**
   - ZIP: `public/pdf/traces/<Company>/2025-26/Q3/26Q/`
   - Excel: `public/pdf/traces_excel/<Company>/26Q_FY2025-26_Q3.xlsx`
4. **Compare with existing output:**
   - `public/pdf/traces_excel/Clean Max Balam Private Limited/26Q_FY2025-26_Q1|Q2|Q4.xlsx`
   - The `.tds` files in `public/pdf/temp_extract/Clean_Max_Balam_Private_Limited/`

**Known issues**
- **Bug: multi-period and "All Periods" send requests.**
  - `src/jobs/queues/queue-conso.ts:38-40` passes the batch's selection arrays to the worker, and the worker takes `[0]` (`NoticeDownloader-conso.ts:57-59`). So every task runs the **first** FY, quarter and form.
  - With "All Periods" the FY becomes `""`, and the task fails with "No challan data found".
  - **Until this is fixed, test one period at a time.**
- **No Excel for 27EQ.** 27EQ deductee rows are not parsed.
- **Download ignores the selected FY and quarter.**
- **Not a filing date.** The conso header date is not the filing date. For that, use T13 or T14.

### T10. Justification report

**Where it is on the portal**
- New TRACES REST:
  - `GET /tanjustreportservice/api/justification/new-requests`
  - `POST /tanjustreportservice/api/justification/initiateDownload`
  - `GET /tanjustreportservice/api/justification/downloadFile`
- The legacy equivalent is **Defaults → Request for Justification Report** (`justrepdwnld.xhtml`). The code for that path exists but is never called.

**App:** `/justification-report`
- Company source: saved companies or a credentials Excel.
- Action: Download / Initiate, or Send Request.
- Progress refreshes every 2 seconds, and failed tasks can be retried.

**Old Act ⚠️.** The API accepts old forms, but **the UI is fixed to FY 2026-27, Q1, form 140** (`src/pages/justification-report/index.tsx:36-38`). 27EQ deductee rows are not parsed.

**New Act ⚠️**
- Requesting and downloading the Form 140 Q1 ZIP works.
- **Turning it into Excel crashes.** `NoticeDownloader-justification.ts:2254-2341` only builds deductee-row objects for 24Q, 26Q and 27Q. For form 140 the object is undefined, so a TypeError is thrown and no Excel is written.

**How to test**
1. Select a company → Download / Initiate.
2. Wait, then run it again.
3. Expect `public/pdf/traces/<Company>/2026-27/Q1/140/JR_<id>.zip`.
4. Today, also expect **no** `traces_excel` file and an error in `logs/<taskId>-it.log`.

### T11. Unconsumed challans and challan status (TRACES)

**Where it is on the portal:** TRACES legacy **"Unconsumed Challans"** (`/app/ded/unconschallandetail.xhtml`, ≈ under Statements / Payments).
- Servlet `GetUnconChlnDetailServlet`: `reqtype=0` lists the challans; `reqtype=1` is "View Amount", which reveals the unconsumed amount once you supply the challan amount.

**App:** `/challan-status`
- Inputs: Financial Years, and a company source (saved companies, or an Excel).
- Buttons: **Fetch Unconsumed List** and **Download Challan Status**.
- Download Challan Status reveals the unconsumed amounts using amounts read from payment receipt PDFs.

**Old Act and New Act: not tied to an Act.** The legacy page serves FY 2025-26 and FY 2026-27 challans alike. As of Sep 2026 the new portal had no OLTAS / unconsumed module.

**How to test**
1. Use either input:
   - the company picker `public/pdf/Unconsumed Challan List.xlsx` (columns Company Code, Company Name), or
   - a 5-column credentials Excel.
2. Select FY 2025-26 and FY 2026-27, then **Fetch Unconsumed List**.
3. Check `public/pdf/unconsumed_challan_results/<Company>_unconsumed_list.xlsx`.
4. **Download Challan Status.** This needs receipt PDFs from I3, I7 or I10 to know the amounts.
5. Check `public/pdf/challan_status_results/<Company>_challan_status.xlsx` and `_unmatched.xlsx`.
6. CLI:
   ```bash
   node scripts/run-ts.js src/scripts/runChallanStatusBatch.ts --trial --limit=1
   ```

**Known issues**
- **Hard-coded year folder.** The `.txt` fallback reads `public/pdf/data/2025-26` (worker `:79`).
- **Plaintext credentials.** The `.txt` fallback writes the TRACES user ID and password in plaintext to `challan_details.json`.
- **Client-specific files.** The Swiggy supplementary Excel paths are hard-coded.
- **Limited UI.** No retry UI, and one job runs at a time.

### T12. Outstanding demand

**Where it is on the portal:** TRACES legacy `outstandingdemand.xhtml` (≈ Dashboard / Defaults → Outstanding Demand).
- Grid columns: Financial Year | Manual Demand (AO) | Processed Demand (CPC).
- It has an expandable "Prior Years" row.

**App:** `/outstanding-demand` → select companies → **Fetch Outstanding Demand**. Rows expand per FY, and there is Export.

**Old Act and New Act: not tied to an Act.** The demand is TAN-level, per FY. FY 2026-27 rows are stored if the portal shows them.

**How to test:** fetch for one company, compare the result with the portal grid, then export. A unit test exists in `src/jobs/traces/tracesSession.test.ts`; read section 5 before running `npm test`.

**Known issues**
- A demand cleared on the portal is never removed from the database.
- Export ignores the page filters.

### T13. Return / statement status

**Where it is on the portal:** TRACES legacy **Statements / Payments → Statement Status** (`/app/ded/stmtstatus.xhtml`, page title "Statement Filed Status").
- Servlet `DedStmtStatusServlet`: `reqType=1` returns the rows, `reqType=5` returns the rejection reason.

**App:** `/return-status`
- Selections: companies, FYs, quarters, form types.
- Button: **Fetch Return Status**.
- Each row has a "View Rejection Reason" option.

**Old Act ✅.** Forms 24Q, 26Q, 27Q and 27EQ.

**New Act ❌**
- There is no Form 140 or other New Act statement option.
- The legacy page's form dropdown only offers the four old forms.

**How to test:** select a company, FY 2025-26, Q1–Q4 and 26Q, then Fetch. Check the token number, filing date, status and Regular/Correction against the portal.

**Known issues**
- "No statement filed" and "fetch failed" both come back as HTTP 400 "No data received", so you cannot tell them apart.
- The rejection-reason HTML from the portal is rendered unescaped.

### T14. Clause 34(b)/(c) working paper (Form 3CD)

**Where it is on the portal**
- The same Statement Filed Status servlet as T13.
- Optionally, IT e-portal View Filed Forms to cross-check the RRR.

**App:** `/clause-34b` → FY → **Fetch from TRACES** → **Build workbook** → Download.

**Old Act ✅,** with three limits:
- Only FY 2025-26.
- Only the Continuum group: 20 TANs hard-coded in `src/clause34/continuumGroup.ts`.
- Due dates follow Rules 31A and 31AA of the 1962 Rules.

**New Act ❌.** There are no New Act forms and no due-date rules for tax year 2026-27.

**How to test**
1. In the UI, choose FY 2025-26, then Fetch. It takes about 1 minute per TAN. Then Build and Download.
2. Verify the workbook from the CLI. It exits non-zero on failure:
   ```bash
   node scripts/run-ts.js src/scripts/verifyClause34Workbook.ts 2025
   ```

**Inputs** (all in `public/pdf/clause34/`)
- `Clause 34(b) - Continuum Group - FY 2025-26.xlsx`
- `Clause 34(b) and 34(c) - Continuum Group - FY 2025-26.xlsx`
- `Continuum Traces details.xlsx` (credentials)

**Known issue:** the baseline workbooks are always the FY 2025-26 files, whichever FY you choose.

---

## 4. IT e-portal features

All of these log in with the company **TAN + IT password**. There is no captcha. OTP / 2FA accounts are not supported.

### I1. Create challan (manual)

**Where it is on the portal:** **e-File → e-Pay Tax → New Payment → TDS/TCS (ITNS 281)**.
- The app calls the API directly: `/iec/paymentapi/auth/challan/savedraft` three times, then `/iec/paymentapi/auth/challan/create`.
- The new challan then shows under e-Pay Tax → **Generated Challans**.

**App:** `/challan-management` → **Create Challans** card.
- Fields: Assessment Year, **Income-tax Act** select, Add Section.
- The section list switches to the New Act codes 1001–1092 when New Act is selected.

**Old Act ✅**
- One challan per section.
- Major head 0021, minor head 200, `actType:"O"`.
- Section short codes such as `94C` and `94J` (`src/challan/utils/secCodes.ts`).

**New Act ✅**
- **One combined challan** for all sections.
- Major head 0020, minor head 200, `actType:"N"`, `taxYear`.
- Codes come from `src/challan/utils/newSecCodes.ts`. Salary codes are 392; resident codes are 393(1)/393(3); TCS codes are 394(1).

**How to test** (one company with a TAN and IT password)
- **Old Act:** year `2026-27`, section `94C`, ₹1. Click Create, then check the Challan Records table and the portal's Generated Challans tab.
- **New Act:** select New, year `2026-27`, section `1024`, ₹1, then Create.

> ⚠️ This creates a **real (unpaid) challan** on the portal.

**Known issues**
- **Combined only.** The manual UI cannot choose New Act "separate" mode.
- **Resident only.** It is hard-coded `resStatus:"R"`, and there are no 393(2) non-resident codes (1038–1057 are missing).
- **Amounts with commas fail.** `"1,000"` becomes NaN.
- **Misleading success.** The API returns `success:true` even when every section failed.
- **Earlier CRN overwritten.** `ChallanData` is unique per company + year + section, so a second challan replaces the first CRN.

### I2. Create challans (CSV batch)

**App:** `/challan-management` → **Batch Process from CSV** → Upload CSV File.

**CSV columns**

| Column | Meaning |
|---|---|
| `Company Code` | your reference |
| `Company Name` | required |
| `Username` | the company TAN; must match exactly, case-sensitive |
| `Password` | ignored by the UI (the stored IT password is used) |
| `Assessment Year` | e.g. `2026-27` |
| `Act` | `old` / `o` / blank, or `new` / `n` |
| `Challan Mode` | optional, New Act only: `combined` (default) or `separate` |
| one column per section code | e.g. `94C` or `1024`; the cell is the amount |

**Sample**
- `public/Input-Challan - final.csv`: 30 rows, New Act, 2026-27, section 1024, ₹10.
  > ⚠️ **This file contains real passwords and is tracked in git.**
- There is no Old Act sample. Copy the header, set `Act` to `old`, and use a `94C` column.

**Old Act ✅ / New Act ✅**

**CLI (end to end):** creates ₹10 challans, downloads them, checks each PDF shows ₹10, then zips them. These are **real challans**.
```bash
node scripts/run-ts.js src/scripts/createAndDownloadGeneratedChallansBatch.ts --trial
```

**Known issue:** any extra column, such as "Remarks", is treated as a section code and fails with "Invalid section code".

### I3. Payment History receipts (filtered)

**Where it is on the portal:** **e-File → e-Pay Tax**.
1. For New Act, tick the "Income-tax Act, 2025" radio, then Continue.
2. Open the **Payment History** tab.
3. Filter by tax/assessment year, type of payment (200) and date range.
4. Download the receipt from each row's menu.

**App:** `/challan-management` → **e-Pay downloads (filtered)** → Download Payment History.

**Old Act ✅ / New Act ✅**

**How to test:** set the date range as `DD-MMM-YYYY HH:mm:ss`. Check the results:
- receipts: `public/pdf/challans/<Company>/PaymentHistory/<CIN>_ChallanReceipt.pdf`
- summary workbook: `PaymentHistory_<Company>_<date>.xlsx`

**Known issues**
- **Folder mismatch.** Chrome saves into a folder named after the raw company name (`downloadChallanPayment.ts:1979`). The rename step looks in a fuzzy-matched folder (`:1571`). If the two differ, every CIN waits 30 s and the file is left un-renamed. Test once with a company whose name matches its existing folder exactly, and once with one that does not.
- **Later pages unverified.** Capturing page 2 onward has not been checked against a company with many pages.
- **Misleading success.** Success is reported even when nothing was downloaded.

### I4. Generated Challans download

**Portal:** e-Pay Tax → **Generated Challans** tab.

**App:** button **Download Generated Challans**.

**Old Act ✅ / New Act ✅.**

**Output:** `public/pdf/challans/<Company>/GeneratedChallansFiltered/`.

**Known issue:** files already downloaded are not skipped.

### I5. CSI file download

**Portal:** e-Pay Tax → **Challan Status Inquiry (CSI) File** tab → From/To date → Download Challan File.

**App:** button **Download CSI File**. It stays disabled until a date range is set.

**Old Act ✅ / New Act ✅.**

**Output:** `public/pdf/challans/<Company>/CSI/`.

### I6. CSV-targeted e-Pay downloads

**App:** **Select CSV for download**, then **Download Payment History from CSV** or **Download Generated Challans from CSV**.

**How matching works**
- Rows are matched on tax year + amount.
- For a New Act combined challan, the amount is the sum of its sections.

**Old Act ✅ / New Act ✅.**

**Test file:** the same CSV as I2.

**Known issue:** files are not renamed to `<CIN>_ChallanReceipt.pdf`, so the gaps report (I8) counts them as missing.

### I7. Payment PDFs from an uploaded Excel

**App:** card **"Download Payment PDFs from Excel"**.

**Excel columns**
- TAN: any of `TAN`, `Tan`, `Username`, `User ID`.
- `Date of Deposit` as **text** `DD-MMM-YYYY`.
- Optional: `Challan Amount`, `Company Name`.

**Act: picked automatically per row.** A deposit after 30-Apr-2026 is New Act. Each Act gets its own run.

**Old Act ✅ / New Act ✅.**

**Test file:** any `public/pdf/unconsumed_challan_results/*_unconsumed_list.xlsx`.

**Known issues**
- **Amount is ignored.** It downloads every missing receipt within ±1 day of the listed dates.
- **Real Excel dates fail.** A date cell (not text) cannot be parsed.

### I8. Payment history and missing-PDF (gaps) report

**App:** `/payment-history-gaps`. This page is **not in the sidebar**; type the URL.

**How it works**
- **Fetch from portal** calls the `paymenthistory` API for **both Acts** (O and N) and the last 2 FYs.
- The table shows whether each receipt PDF is present and whether it is in the challan-status Excel.

**Old Act ✅ / New Act ✅.** The table has no Act column.

**CLI:**
```bash
node scripts/run-ts.js src/scripts/fetchPaymentHistoryGapsBatch.ts --tan=<TAN>
```

**Output:** `payment_history_content.json` and `payment_history_gaps.json` in the company's challan folder.

### I9. Download missing payment PDFs

**App:** same page → **Old Act / New Act** toggle → **Download missing PDFs**.

**Old Act ✅.** It filters by the missing dates ±1 day and the list of missing CINs.

**New Act ⚠️.** There is no date filter. It pages through everything and downloads every missing CIN.

**CLI** (run I8's CLI first):
```bash
node scripts/run-ts.js src/scripts/downloadMissingPaymentPdfsBatch.ts --tan=<TAN>
```

### I10. Receipts for the unconsumed-challan list

**App:** `/challan-status` → **Download PDFs from Unconsumed Excel**. Saved companies only.

**Requirement:** the `*_unconsumed_list.xlsx` from T11 must exist first.

**Act:** New Act if the portal says `actType` is N **or** the FY is 2026-27 or later.

**Old Act ✅ / New Act ✅.**

**Known issue:** deposits made 1–30 Apr 2026 can be classed as New Act (see section 1).

### I11. Extract acknowledgements: Form 140 (New) / 26Q (Old)

**Where it is on the portal:** **e-File → Income Tax Forms → View Filed Forms**.
- The app uses `saveEntity` with `viewFiledForms` to list filings.
- It fetches the receipt PDF from `/iec/pdfweb/pdf`.

**App:** `/extract-form140` (sidebar "Extract Acknowledgements")
- Toggle: **New (T140)** / **Old (F26Q)**.
- Company source: upload a CSV/Excel, or use saved companies.

**Old Act ✅** for 26Q only. **New Act ✅** for Form 140 only.

**Test files**
- Template: `public/templates/acknowledgement_companies_template.csv` (`company_name,username,password`).
- Bulk New Act list: `public/pdf/companies1.csv`, 106 rows. It contains credentials and is not tracked in git.

**Output**
- PDFs: `public/pdf/Acknowledgement/form140/<Company>/<FY>/<Q>/<ack>_receipt.pdf`
- Summary: `form140_extract.xlsx` / `form140_extract.json`

**Known issues**
- The UI never sends the FY or quarter filters, so every run downloads all filings.
- Neither mode covers 24Q, 27Q, 27EQ or their New Act equivalents.

### I12. Extract RRR (token numbers)

**Portal:** View Filed Forms. The RRR is the `tempAckNo`, the same token the app uses for TRACES KYC in T4 and T9.

**App:** `/extract-rrr`. Saved companies only. Choose FY, quarter, and forms 24Q/26Q/27Q/27EQ.

**Old Act ✅.**

**New Act ❌.** The code always prefixes the form with `F` (`src/scripts/fetchRrrNumbers.ts:78-81`), so `T140` can never be requested. For Form 140, use the RRR column from I11 instead.

**Output:** `public/pdf/return/rrr-extract/rrr_extract.{json,csv}`.

---

## 5. Platform features (not tied to an Act)

| # | What | How to test | Notes |
|---|---|---|---|
| P1 | `/companies`: company + credentials master. Excel/CSV headers must be exactly `Company Name, Tan, IT Password, User ID, Password`. | Upload `sample-companies-template.csv` and expect "saved N / updated M". Negative test: `public/TDS Form 16 Request.xlsx` has the wrong headers and should be rejected. | One set of credentials serves both Acts. Passwords are encrypted at rest (`enc:v1:`) and masked in the UI. The DSC certificate name can only be set in the edit dialog. |
| P2 | `/deductee-masters`: PAN → email. Excel headers `PAN`, `Email`, optional `Name`. | Add a row, upload an Excel, then use it in T8. | One email per PAN across all companies. One bad row rejects the whole file. |
| P3 | `/smtp-configs`. | Add a config, click Test, mark it Active. | The SMTP password is stored in plaintext and sent to the browser. |
| P4 | `/logs`: batch monitor, refreshes every 10 s. | Run a Form 16 batch with a wrong password, then Select failed → Retry. | Retry only covers Form 16 batches. The queue is in memory, so a server restart loses queued tasks. |
| P5 | `/document`: file browser. | Browse and preview an `.xlsx`. | Shows only 4 folders. Download links are built correctly only on Windows (`index.tsx:600`). |
| P6 | Exports (`/api/export/[feature]`): tldc, ldc-utilisation, outstanding-demand, return-status, rrr, form140, deductee-masters. | Click Excel / PDF / More → CSV on each page. | No export for Clause 34 or Justification. |
| P7 | REST API: 48 endpoints. Swagger at `/api-docs` (not in the sidebar). | Postman collection in `docs/client-response/01-Postman/`. Create a token with `POST /api/rpc/createApiToken`, then call `/api/tldc/list` with `Authorization: Bearer tt_…`. | There is no UI for API tokens. Act parameters: `/api/tldc/list` takes `act: old\|new`; `challan/create` takes `sections[].actType`; the `download-*` routes take `incomeTaxAct`; `fetch-payment-history` takes `acts`/`actType` as `O`/`N`. |
| P8 | `/auth/login`, `/configure`. | Log in as the seeded admin (`db/seeds.ts`). | `/configure` and the licence-save call need no login, and `/api/env/license` has no auth. |

---

## 6. Not implemented

**New Act gaps**
- Conso file, statement status (T13) and Clause 34 for any New Act statement form.
- RRR extract for Form 140 (I12). Workaround: the RRR column in I11.
- Acknowledgement extract for New Act forms other than 140.
- Certificates (131/130/133) and Justification for any period other than **2026-27 Q1**. Q2 is not selectable in the UI.
- A proper Form 130 (salary) layout and flow, and a verified Form 133 (TCS) flow.
- Justification Excel extraction for Form 140 (crashes, see T10).
- Non-resident (393(2)) challan section codes, and New Act "separate" mode from the manual challan UI.

**Missing under either Act**
- Form 16 (salary) PDF generation.
- 26AS, AIS and Form 168. The client query sheet says "response to follow".
- Per-challan verification. Only the CSI file exists.
- Demand break-up and TRACES notices.
- A JSON API for reading conso files.
- A built-in scheduler, webhooks, a persistent job queue, rate limiting, request IDs and a UAT stub mode.

---

## 7. Read this before testing

1. **Do not run `npm test` as it stands.** Two problems:
   - `vitest.config.ts` points at `./test/setup.ts`, which does not exist.
   - `.env.test` uses the **same** `DATABASE_URL="file:./db.sqlite"` as `.env`. `src/auth/mutations/forgotPassword.test.ts` calls `db.$reset()`, which would wipe the live database, including the encrypted company credentials.

   Back up `db/db.sqlite`, or point `.env.test` at another file, first.

   No existing test covers Old Act / New Act logic.
2. **Some features act on the real portals:**
   - I1 and I2 create real challans.
   - T4 and T9 submit real TRACES requests.
   - T8 sends real emails.
   - T1's 3× retry on a wrong password can lock a TRACES account.
3. **Environment**
   - `.env` needs `SERVER_URL` (the TRACES captcha service), `CREDENTIALS_ENCRYPTION_KEY` and `DATABASE_URL`.
   - Google Chrome must be installed, and flows open a visible window.
   - DSC needs Windows.
4. **CLI.** Run scripts with `node scripts/run-ts.js src/scripts/<Script>.ts`. These commands are mentioned in script headers and older docs but **do not exist**:
   - `yarn challan:*`, `yarn tldc:new-act`, `yarn traces:*`, `yarn form16a:bulk`
   - `run_challan_status.bat`
5. **Credentials in tracked files.** These are tracked in git and served from `public/`:
   - `public/Input-Challan - final.csv`
   - `public/Input-Challan - final copy.csv`
   - `public/TDS Form 16 Request.xlsx`
   - `public/form16-companies-upload.xlsx`

### Stale docs in this folder

| Doc | What is stale |
|---|---|
| `00-INDEX.md` | Still lists `/test-form16`, which no longer exists, and says node-cron was removed. Its API appendix is missing `clause-34b/*`, `dsc/unlock`, `tldc/list` and `conso/batch-progress`. |
| `tldc.md`, `outstanding-demand.md`, `return-status.md` | Describe client-side CSV export; export is now the server `/api/export`. |
| `form-16.md` | Says there is no Old/New Act UI; there is now a Portal Method choice and REST mode. |
| `payment-history-gaps.md` | Says the Act is hard-coded to old; there is now an Old/New toggle. |
| `conso-files.md` | Says there is no live progress or retry; both now exist. |
| `extract-form140.md` | Describes FY/quarter filters that the UI does not send. |
| `justification-report.md` | Gives the wrong mutation file name. |
| `docs/API.md` | Challan examples use invalid section codes (`192`, `194C`) and the wrong date format. Several response shapes are wrong. |
