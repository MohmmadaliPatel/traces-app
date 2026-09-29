# Page Audit: /challan-management

## 1. Overview
- Full route path: `/challan-management`
- Purpose of the page: Create e-Pay challans on the Income Tax portal, download payment/generated/CSI artifacts, and download payment PDFs from uploaded Excels; manage stored challan rows.
- Access control / authentication requirements (if any): `ChallanManagementPage.authenticate = true`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client page driving long-running REST APIs with client-side concurrency (`runWithConcurrency`). No better-queue.

## 2. Features
- Feature name: Company multi-select (+ CSV picker)
- Short description: Choose saved companies; optional CSV to select by TAN.
- How it works: `getCompanies`; CSV parse matches Username/Tan to DB TAN.
- Related API routes / server actions / server components: `getCompanies`; client `parseCsvFileText`.

- Feature name: Batch create challans from CSV
- Short description: Create portal challans from structured CSV rows (sections as dynamic columns).
- How it works: Parse CSV → validate companies exist → `runCreateBatch` → `POST /api/challan/create` per item (`skipDownload: true`).
- Related API routes / server actions / server components: `/api/challan/create` → `src/scripts/createChallan.ts`.

- Feature name: Manual create
- Short description: Assessment year + section/amount lines for selected companies.
- How it works: Same create API with UI-built section list; Old/New Act section code lists.
- Related API routes / server actions / server components: `/api/challan/create`.

- Feature name: e-Pay downloads (Payment History / Generated Challans / CSI)
- Short description: Puppeteer/Chrome downloads from Income Tax e-Pay for selected companies or CSV-driven rows.
- How it works: `POST /api/challan/download-payment`, `download-generated-challans`, `download-csi` with act + date filters; CSI requires payment date range.
- Related API routes / server actions / server components: those API routes → `downloadChallanPayment.ts`.

- Feature name: CSV-driven e-Pay download batch
- Short description: Use challan CSV to drive per-row assessment year/act/amount targets.
- How it works: `buildEpayDownloadBatchItems` then concurrent download API calls.
- Related API routes / server actions / server components: `src/challan/utils/parseChallanCsv.ts`.

- Feature name: Download payment PDFs from uploaded Excels
- Short description: Parse TAN + deposit dates from Excel(s) and download matching payment PDFs.
- How it works: Client `parseUnconsumedExcelFiles` → `POST /api/challan/download-pdfs-from-uploaded-excels`.
- Related API routes / server actions / server components: `/api/challan/download-pdfs-from-uploaded-excels`.

- Feature name: Challan data table + delete
- Short description: View stored challan records for selected companies; delete rows.
- How it works: `getChallanData` / `deleteChallanData`.
- Related API routes / server actions / server components: challan Blitz queries/mutations.

- Feature name: Result modals with retry
- Short description: Review failed create/e-Pay items and retry.
- How it works: Client progress state + retry handlers re-run failed items.
- Related API routes / server actions / server components: same APIs.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Concurrent batch runners; progress bars; CSV/Excel parsers. No polling interval.
- Server-side logic: Synchronous API routes perform portal HTTP/Puppeteer work until response.
- **Background processes**:
  - No better-queue on this page
  - Client concurrency pool `runWithConcurrency` (1–7)
  - Related CLI: `yarn challan:create-download-generated`, payment gaps/missing PDF batch scripts, CSI/collect Excel scripts
  - Dead code: `handleDownloadChallans` → `/api/challan/download` declared but not wired in UI

## 4. Portal Support
- Does this page/feature support multiple portals? Focused on Income Tax e-Portal (e-Pay / payment APIs). Uses company `it_password` / TAN.
- Which portals are supported? Income Tax e-Portal; Old Act (1961) and New Act (2025).
- How is portal selection / switching implemented?
  - Create UI: `challanActType` select (`old` | `new`) with `oldSecCodes` / `newSecCodes`
  - e-Pay filters: `paymentIncomeTaxAct` (`old` | `new`)
  - CSV `Act` column: `old`/`o`/empty → old; `new`/`n` → new
  - Excel deposit-date PDF flow: act inferred (on/before 30-Apr-2026 → old; after → new)
- Any recent portal-related changes or new portal support? Explicit New Act create/download paths; new section codes; combined vs separate challan mode for new regime.
- Portal-specific logic, configurations, or conditional rendering: New regime blocks duplicate section codes in combined mode; `Challan Mode` column `combined`/`separate`.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes — multiple surfaces.
- Accepted formats:
  - Batch create / company picker / e-Pay CSV: `.csv`
  - Payment PDF Excels: `.xlsx`, `.xls` (multiple)
- Expected column structure / headers:
  - **Challan CSV meta**: `Company Code`, `Company Name`, `Username`, `Password`, `Assessment Year`, `Act`, `Challan Mode` + dynamic section amount columns
  - **Company picker CSV**: `Company Name` + one of `Username` / `Tan` / `TAN` / `User ID`
  - **Payment Excel**: required `TAN`/`Tan`/`Username` + `Date of Deposit`/`Date Of Deposit`/`Deposit Date`; optional `Company Name`, `Challan Amount`
- Validation rules: Companies must exist in DB (match Username=TAN). Skip rows with no sections. New-regime combined mode rejects duplicate sections. CSI requires date range.
- Parsing library used: Custom `parseCsvFileText` / `parseChallanCsv.ts` (naive comma-split); SheetJS for Excels.
- Differences compared to other pages that also accept Excel/CSV: Only page with structured challan CSV + dynamic section columns and Old/New Act columns. Credential 5-column template not used here. Unlike Challan Status, Excels are uploaded for PDF download rather than only reading server-side unconsumed files.
- Error handling for invalid files: Parse warnings/skips; batch result modal lists failures.

## 6. Key Files & Components
- Page file path: `src/pages/challan-management/index.tsx`
- Important components used: Ant Design forms, uploads, tables, progress; Layout.
- Related API routes / server actions: `/api/challan/create`, `download-payment`, `download-generated-challans`, `download-csi`, `download-pdfs-from-uploaded-excels`; Blitz challan CRUD.
- Shared utilities: `parseChallanCsv.ts`, `incomeTaxAct.ts`, `challanMode.ts`, `runWithConcurrency.ts`, `incomeTaxPortalAuth.ts`.

## 7. Notes / Observations
- Edit modal / `upsertChallanData` appear unfinished (unused UI).
- CSV parser does not handle quoted commas.
- Long API calls may hit HTTP timeouts on large batches — CLI scripts are alternatives.
