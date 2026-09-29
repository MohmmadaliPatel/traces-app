# Page Audit: /challan-status

## 1. Overview
- Full route path: `/challan-status`
- Purpose of the page: Fetch TRACES unconsumed challan lists and/or full challan status Excels; optionally download payment PDFs matched from unconsumed Excel.
- Access control / authentication requirements (if any): `ChallanStatusPage.authenticate = { redirectTo: "/auth/login" }`. PDF API uses `withApiAuth`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client Blitz page; status jobs queued; PDF-from-Excel API runs synchronously in request.

## 2. Features
- Feature name: Company source toggle
- Short description: Saved companies or credential Excel upload.
- How it works: Saved mode loads companies; Excel mode parses credential template then queues.
- Related API routes / server actions / server components: `getCompanies`, `processExcelUploadChallanStatus`.

- Feature name: Excel company picker (saved mode)
- Short description: Upload any Excel, pick a column, match companies by name or TAN into selection.
- How it works: Client SheetJS parse → user selects column/match mode → fuzzy match against saved companies → sets `selectedCompanyIds`. No mutation.
- Related API routes / server actions / server components: None (client-only).

- Feature name: Fetch Unconsumed List
- Short description: Queue Puppeteer scrape of unconsumed challan list (`mode: "list"`).
- How it works: `processExcelUploadChallanStatus` with `mode: "list"` → `queue-challanStatus` → `NoticeDownloaderChallanStatus`.
- Related API routes / server actions / server components: mutation + `src/jobs/queue-challanStatus.ts`.

- Feature name: Download Challan Status (full)
- Short description: Full status scrape including View Amount; optional “only payment PDFs not in Excel” filter.
- How it works: `mode: "full"` + FY multi-select + switch → same queue/worker reading filters from `TaskBatch.filters`.
- Related API routes / server actions / server components: same queue/worker; Excel helpers in `src/challan/utils/challanStatusExcel.ts`.

- Feature name: Download PDFs from Unconsumed Excel
- Short description: For selected saved companies, download missing payment receipt PDFs using unconsumed Excel rows.
- How it works: Sequential client calls to `POST /api/challan/download-pdfs-from-unconsumed-excel` (not queued).
- Related API routes / server actions / server components: API route + `fetchPaymentHistory` / `downloadMissingPaymentHistoryPdfs`.

- Feature name: Upload history
- Short description: Status of challan_status jobs with manual refresh.
- How it works: `getUploadHistory` type `challan_status`.
- Related API routes / server actions / server components: `getUploadHistory`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: FY defaults (last 2 Indian FYs); company picker; sequential API loop for PDFs. No auto-polling.
- Server-side logic: TaskBatch filters store `mode`, `financialYears`, `onlyPaymentPdfNotInExcel`.
- **Background processes**:
  - Queue: `NoticeDownloaderChallanStatusQueue` (`src/jobs/queue-challanStatus.ts`), concurrent 1
  - Worker: `NoticeDownloaderChallanStatus` — TRACES Puppeteer list/full modes; writes Excels under `public/pdf/unconsumed_challan_results/` and `public/pdf/challan_status_results/`
  - Sync API: download-pdfs-from-unconsumed-excel (IT payment history + PDF download)
  - Related CLI (not page-triggered): `yarn challan:status-batch`, `run_challan_status.bat`, trial/retry variants via `runChallanStatusBatch.ts`

## 4. Portal Support
- Does this page/feature support multiple portals? Yes in the overall feature set (TRACES scrape + IT payment PDFs), no act radio on page.
- Which portals are supported? TRACES 6.1 for list/status; Income Tax portal for payment PDF API path.
- How is portal selection / switching implemented? Implicit. Act for payment history inferred via `incomeTaxActForFinancialYear(fy)` in utilities.
- Any recent portal-related changes or new portal support? Uses shared TRACES preauth; related New Act payment rules exist in challan utils used by APIs/scripts.
- Portal-specific logic, configurations, or conditional rendering: Switch “Only payment PDFs not in challan status Excel” affects full mode filters (also used by Payment History Gaps).

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes — two different Excel UIs.
- Accepted formats:
  - Credential upload: `.xlsx`, `.xls`
  - Company picker: `.xlsx`, `.xls`
  - No CSV on this page
- Expected column structure / headers:
  - Credential Excel: `Company Name`, `Tan`, `IT Password`, `User ID`, `Password`
  - Company picker: any columns; auto-prefers headers like Company Name / TAN / username
- Validation rules: Credential rows require all five fields. Picker requires ≥1 data row; matching is fuzzy for names.
- Parsing library used: SheetJS (`xlsx`).
- Differences compared to other pages that also accept Excel/CSV: Unique flexible company-picker Excel. Credential template matches Conso/Form16/Justification. Unconsumed/status Excels are **outputs** (and inputs to PDF API on disk), not uploaded here — contrast Challan Management uploaded-excels PDF flow.
- Error handling for invalid files: Throws/toasts on bad credential rows; picker warns if no matches.

## 6. Key Files & Components
- Page file path: `src/pages/challan-status/index.tsx`
- Important components used: Upload, Select, Switch, Tables; Layout.
- Related API routes / server actions: `processExcelUploadChallanStatus`; `/api/challan/download-pdfs-from-unconsumed-excel`; related `/api/challan/run-challan-status` exists but is not wired from this page.
- Shared utilities: `challanStatusExcel.ts`, `paymentHistoryFiles.ts`, `queue-challanStatus.ts`, `NoticeDownloader-challanStatus.ts`.

## 7. Notes / Observations
- PDF-from-unconsumed button only in saved-companies mode.
- Mutation challan-count helper may use a hardcoded FY folder path (misleading counts).
- No retry UI for failed challan status batches (unlike Justification).

## Post-refactor notes (Phases 1–5)
- Mutation: `src/challan/mutations/processExcelUploadChallanStatus.ts`.
- Worker: `src/jobs/workers/NoticeDownloader-challanStatus.ts`.
- Shared credentials upload + history table.
