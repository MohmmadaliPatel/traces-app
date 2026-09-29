# Page Audit: /justification-report

## 1. Overview
- Full route path: `/justification-report`
- Purpose of the page: Initiate and download TRACES justification reports (Form 140 defaults) with live batch progress and retry.
- Access control / authentication requirements (if any): `JustificationReportPage.authenticate = { redirectTo: "/auth/login" }`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client Blitz page; jobs via `better-queue`; progress polled every 2s.

## 2. Features
- Feature name: Company source (saved vs Excel)
- Short description: Multi-select saved companies or upload credential Excel.
- How it works: Same pattern as Conso/Form16; submit calls `processExcelUploadJustification`.
- Related API routes / server actions / server components: `processExcelUploadJustification`.

- Feature name: Download / Initiate
- Short description: Queue `DownloadFile` jobs that initiate-if-needed then download via TRACES REST.
- How it works: Mutation → `queue-justification` → `NoticeDownloaderJustification.process()` → `runJustificationApiFlow("download")`.
- Related API routes / server actions / server components: `src/jobs/traces/justificationApi.ts`, `NoticeDownloader-justification.ts`.

- Feature name: Send Request
- Short description: Queue REST send/initiate justification requests.
- How it works: Same queue with `SendRequest` → `runJustificationApiFlow("send")`.
- Related API routes / server actions / server components: same as above.

- Feature name: Live batch progress
- Short description: Progress bar, status counts, per-task table while a batch is active.
- How it works: `useQuery(getJustificationBatchProgress, { refetchInterval: 2000 })` when `activeBatchId` set; stops when complete.
- Related API routes / server actions / server components: `src/tasks/queries/getJustificationBatchProgress.ts`.

- Feature name: Retry failed tasks
- Short description: Retry one task or all failed in the batch.
- How it works: `retryFailedJustificationBatchTasks` resets status and re-pushes to `queue-justification`.
- Related API routes / server actions / server components: `src/tasks/mutations/retryFailedJustificationBatchTasks.ts`.

- Feature name: Download / upload history
- Short description: History table with clickable Batch ID to reopen progress.
- How it works: `getUploadHistory` type `justification` + batch click sets `activeBatchId`.
- Related API routes / server actions / server components: `getUploadHistory`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: 2s polling while batch active; `useEffect` refetch history on complete.
- Server-side logic: TaskBatch/Task/UploadHistory creation; sequential concurrency documented as 1.
- **Background processes**:
  - Queue: `src/jobs/queue-justification.ts` (`concurrent: 1`, `afterProcessDelay: 200ms`)
  - Worker: `NoticeDownloaderJustification`
  - Trigger: Submit or Retry mutations
  - Processes: TRACES REST (`tanjustreportservice` new-requests / initiateDownload / downloadFile) via Bearer auth from `loginTraces()`
  - Legacy Puppeteer code remains in worker file but primary `process()` path is REST
  - Defaults hardcoded: FY `2026-27`, Quarter `Q1`, Form `140`

## 4. Portal Support
- Does this page/feature support multiple portals? Uses TRACES (new REST / traces-app API), not IT e-Portal UI.
- Which portals are supported? TRACES REST on `traces-app.tdscpc.gov.in` (credentials: `user_id`, `password`, `tan`).
- How is portal selection / switching implemented? No UI switcher; form type effectively New Act justification Form **140** by default.
- Any recent portal-related changes or new portal support? **Yes** — primary migration to `justificationApi.ts` REST flow (new portal APIs) instead of Puppeteer.
- Portal-specific logic, configurations, or conditional rendering: No FY/Q/form controls on UI (hardcoded defaults). Mutation supports `sendToAllPeriods` but UI never enables it.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes (optional company source).
- Accepted formats: `.xlsx`, `.xls`.
- Expected column structure / headers: `Company Name`, `Tan`, `IT Password`, `User ID`, `Password` (same as Conso; IT Password stored even though REST uses TRACES creds).
- Validation rules: Five fields required per row; TAN uppercased.
- Parsing library used: SheetJS (`xlsx`), client-side.
- Differences compared to other pages that also accept Excel/CSV: Same credential columns; no period UI (defaults to 2026-27/Q1/140); includes live progress/retry unlike Conso.
- Error handling for invalid files: Row throw + toast.

## 6. Key Files & Components
- Page file path: `src/pages/justification-report/index.tsx`
- Important components used: Progress card, history table, Upload, company Select; Layout.
- Related API routes / server actions: Blitz process/retry/progress/history RPCs.
- Shared utilities: `src/jobs/traces/justificationApi.ts`, `src/jobs/traces/auth.ts`, queue-justification; downloads under `public/pdf/traces/{Company}/`.

## 7. Notes / Observations
- Hardcoded period/form defaults are a product limitation for multi-period use.
- Progress panel appears after submit in-session; can also open via history Batch click.
- Retry is on this page (unlike Conso/Challan Status).

## Post-refactor notes (Phases 1–5)
- Mutation: `src/justification/mutations/processExcelUpload.ts`.
- Reference UX for shared `BatchJobControls`, `UploadHistoryTable`, `BatchProgressPoller`, `CompanyCredentialsUpload`.
