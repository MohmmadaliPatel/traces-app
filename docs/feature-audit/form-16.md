# Page Audit: /form-16

## 1. Overview
- Full route path: `/form-16`
- Purpose of the page: Form 16 / Form 16A workflows — TRACES send/download, local DSC signing, ZIP→PDF generation, and email dispatch.
- Access control / authentication requirements (if any): `Form16Page.authenticate = { redirectTo: "/auth/login" }`. Mutations authorize via Blitz. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client Blitz page; portal jobs queued; sign/ZIP/email run synchronously in mutations.

## 2. Features
- Feature name: Form type selection
- Short description: Choose `form16` vs `form16a` (affects history type and queue payload).
- How it works: Radio/control sets `form16Type` passed into `processExcelUploadForm16`.
- Related API routes / server actions / server components: `processExcelUploadForm16`.

- Feature name: Download File / Send Request
- Short description: Queue TRACES Form 16/16A download or send-request jobs (same period UX as Conso).
- How it works: Saved companies or Excel → mutation → `queue-form16` → `NoticeDownloaderForm16`.
- Related API routes / server actions / server components: `src/companies/mutations/processExcelUploadForm16.ts`, `src/jobs/queue-form16.ts`.

- Feature name: Attach DSC (`sign_pdf`)
- Short description: Digitally sign generated Form 16A PDFs via external Windows exe.
- How it works: Mutation spawns `pdf-signer/pdf-signer.exe` with temp JSON input; **not** queued.
- Related API routes / server actions / server components: same Form16 mutation branch.

- Feature name: Generate PDFs from ZIP folder
- Short description: Offline conversion of TRACES ZIP/text extracts into PDFs.
- How it works: User supplies folder path + company/FY/Q/form filters → `generateForm16PdfsFromZips` mutation (sync).
- Related API routes / server actions / server components: Form16 PDF generation helpers / cluster script related tooling.

- Feature name: Manual email trigger
- Short description: Email Form 16 PDFs using active SMTP + deductee masters (PAN→email).
- How it works: `sendForm16Emails` scans `public/pdf/{form16|form16a}/` with optional filters; results table.
- Related API routes / server actions / server components: Form16 email mutation; depends on `/smtp-configs` and `/deductee-masters`.

- Feature name: Upload history management
- Short description: View history, select failed rows, delete selected, refresh.
- How it works: `getUploadHistory` + `deleteUploadHistory`.
- Related API routes / server actions / server components: `src/companies/queries/getUploadHistory.ts`, delete mutation.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Action/period form state; Excel parse; history selection. No auto-polling on this page.
- Server-side logic: TaskBatch creation for portal actions; child_process for pdf-signer; filesystem scan for email/ZIP tools.
- **Background processes**:
  - Queue: `src/jobs/queue-form16.ts` → `NoticeDownloaderForm16` (`concurrent: 1`, delay 500ms)
  - Trigger: Submit with `download_file` or `send_request`
  - Worker: IT e-portal + TRACES Puppeteer; Form16A PDF generation via `form16APdfGeneratorExact`
  - Retry: Available on `/logs` via `retryFailedForm16BatchTasks` (not on this page)
  - Related CLI: `yarn form16a:bulk` → `generateForm16PdfsCluster.ts` (multi-process Chromium forks)
  - `sign_pdf` / ZIP / email: synchronous (not better-queue)

## 4. Portal Support
- Does this page/feature support multiple portals? Yes for send/download; local-only for sign/ZIP/email.
- Which portals are supported? Income Tax e-Portal + TRACES 6.1 (hybrid), same pattern as Conso.
- How is portal selection / switching implemented? Automatic in worker; no Old/New Act UI.
- Any recent portal-related changes or new portal support? Uses shared `src/jobs/traces` preauth.
- Portal-specific logic, configurations, or conditional rendering: `form16` vs `form16a` toggles paths under `public/pdf/`.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes for company credentials (optional source).
- Accepted formats: `.xlsx`, `.xls`.
- Expected column structure / headers: `Company Name`, `Tan`, `IT Password`, `User ID`, `Password`.
- Validation rules: Same five-field row check as Conso; extra UI validation for FY/Q/form on send_request; certificate name expected for `sign_pdf` (see Notes — validation bug).
- Parsing library used: SheetJS (`xlsx`), client-side.
- Differences compared to other pages that also accept Excel/CSV: Same credential template; unique actions `sign_pdf`, ZIP folder path tool, and email — none of which use Excel for content.
- Error handling for invalid files: Row throw + toast.

## 6. Key Files & Components
- Page file path: `src/pages/form-16/index.tsx`
- Important components used: Ant Design cards/forms/tables; Layout.
- Related API routes / server actions: `processExcelUploadForm16`, `sendForm16Emails`, `deleteUploadHistory`, `generateForm16PdfsFromZips`; queue/worker Form16.
- Shared utilities: `src/jobs/NoticeDownloader-form16.ts`, `pdf-signer/`, `public/pdf/form16*` paths.

## 7. Notes / Observations
- `getUploadHistory` has a known hardcoding bug when `batchId` is passed (ignores requested ID / forces Failed filter) — history may be wrong.
- `sign_pdf` always scans `public/pdf/form16a/` even if form type is form16; uses Windows `.exe` only; certificate validation may not `return` after error toast.
- Hardcoded example ZIP path appears in UI.
- Retry for failed Form16 batches is on `/logs`, not here.

## Post-refactor notes (Phases 1–5)
- Mutation: `src/form16/mutations/processExcelUpload.ts` (compat re-export under companies).
- Queue/worker: `src/jobs/queues/queue-form16.ts` → `src/jobs/workers/NoticeDownloader-form16.ts`.
- UI: shared `CompanyCredentialsUpload` + `UploadHistoryTable`.
- Fixed: `sign_pdf` uses `form16`/`form16a` folder from `form16Type`; `getUploadHistory` batchId bug fixed.

## DSC signing
- Auto-attach of the digital signature after Form 16A / Form 131 PDF generation is documented in [../DSC-SETUP.md](../DSC-SETUP.md) — prerequisites (.NET 10), certificate resolution order, the once-per-session token unlock (`yarn dsc:unlock`), and recovery of unsigned batches (`yarn dsc:sign`).
