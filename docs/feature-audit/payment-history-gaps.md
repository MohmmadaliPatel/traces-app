# Page Audit: /payment-history-gaps

## 1. Overview
- Full route path: `/payment-history-gaps`
- Purpose of the page: Analyze missing challan payment receipt PDFs vs Income Tax portal payment history for a single company; download missing PDFs; optionally queue challan-status coverage jobs.
- Access control / authentication requirements (if any): `PaymentHistoryGapsPage.authenticate = { redirectTo: "/auth/login" }`. APIs use `withApiAuth`. **Not listed in sidebar** (direct URL).
- Whether it is client-side only, server-rendered, or hybrid: Client page; mix of sync APIs and challan-status queue enqueue.

## 2. Features
- Feature name: Load cached gaps / coverage
- Short description: Read previously computed payment-history gaps JSON for a company.
- How it works: `GET /api/challan/payment-history-gaps?companyId=` (+ optional `refreshCoverage=true`).
- Related API routes / server actions / server components: `/api/challan/payment-history-gaps`.

- Feature name: Fetch payment history from portal
- Short description: Pull portal payment history and compare CINs to on-disk PaymentHistory PDFs.
- How it works: `POST /api/challan/fetch-payment-history` → `fetchPaymentHistory.ts`.
- Related API routes / server actions / server components: `/api/challan/fetch-payment-history`.

- Feature name: Download missing payment PDFs
- Short description: Download PDFs for gaps.
- How it works: `POST /api/challan/download-missing-payment-pdfs` with **hardcoded** `incomeTaxAct: "old"` from UI.
- Related API routes / server actions / server components: `/api/challan/download-missing-payment-pdfs` → `downloadChallanPayment.ts`.

- Feature name: Challan status Excel coverage
- Short description: Compare payment PDFs against challan status Excel membership.
- How it works: Refresh coverage flag on gaps GET; row field `challanStatusInExcel`.
- Related API routes / server actions / server components: payment-history-gaps API + challan status Excel utils.

- Feature name: Queue challan status for PDFs not in Excel
- Short description: Enqueue challan status worker with `onlyPaymentPdfNotInExcel: true`.
- How it works: Calls `processExcelUploadChallanStatus` with company + flag → `queue-challanStatus`.
- Related API routes / server actions / server components: mutation + `queue-challanStatus.ts`.

- Feature name: Gaps table UI
- Short description: Show CIN/amount/time/PDF existence; toggle “missing PDFs only”.
- How it works: Client table over payment rows (`cin`, `brnNum`, `assessmentYear`, `paymentType`, `amount`, `paymentTime`, `crn`, `pdfExists`, `expectedPdfPath`, `challanStatusInExcel`).
- Related API routes / server actions / server components: gaps API response.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Company select; sync API calls; reload after download. No interval polling.
- Server-side logic: Cache JSON under company challan folders; coverage audit vs Excels.
- **Background processes**:
  - Challan status enqueue → `NoticeDownloaderChallanStatus` via `better-queue`
  - Other actions synchronous in API request
  - Related CLI: `yarn challan:payment-gaps`, `yarn challan:download-missing-pdfs`, `.bat` wrappers, checkpointed batch reports under `public/pdf/*_batch_report.json`

## 4. Portal Support
- Does this page/feature support multiple portals? Income Tax e-Pay payment history (+ TRACES challan status when queued).
- Which portals are supported? IT e-Portal primarily; challan status path uses TRACES worker.
- How is portal selection / switching implemented? **No New Act UI** — missing PDF download hardcodes Old Act.
- Any recent portal-related changes or new portal support? Gaps tooling and batch scripts support New Act in CLI contexts, but this page’s download button is Old Act only.
- Portal-specific logic, configurations, or conditional rendering: Uses company IT credentials for history/PDF APIs.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A.
- Expected column structure / headers: N/A (reads server-side payment history JSON / challan status Excels).
- Validation rules: Single company required.
- Parsing library used: N/A on page (server/utils parse Excels elsewhere).
- Differences compared to other pages that also accept Excel/CSV: Related to Challan Status/Management Excel flows but this page uses company dropdown + portal APIs only.
- Error handling for invalid files: N/A.

## 6. Key Files & Components
- Page file path: `src/pages/payment-history-gaps/index.tsx`
- Important components used: Company Select, Tables, action Buttons; Layout.
- Related API routes / server actions: `/api/challan/payment-history-gaps`, `fetch-payment-history`, `download-missing-payment-pdfs`; `processExcelUploadChallanStatus`.
- Shared utilities: `paymentHistoryFiles.ts`, `incomeTaxAct.ts`, `queue-challanStatus.ts`, `fetchPaymentHistory.ts`, `downloadChallanPayment.ts`.

## 7. Notes / Observations
- Single-company workflow (batching is CLI).
- Hardcoded Old Act on missing PDF download is a functional gap for New Act payments.
- Not in sidebar — discoverability limited.

## Post-refactor notes (Phases 1–5)
- Download missing PDFs supports Old/New Act via UI radio (`incomeTaxAct`).
- Challan status enqueue uses `src/challan/mutations/processExcelUploadChallanStatus`.
- APIs use `src/shared/http` `withApiAuth`.
