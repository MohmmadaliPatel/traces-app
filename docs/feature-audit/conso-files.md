# Page Audit: /conso-files

## 1. Overview
- Full route path: `/conso-files`
- Purpose of the page: Queue TRACES consolidated (conso) file Send Request or Download jobs for one or many companies (saved or Excel).
- Access control / authentication requirements (if any): `ConsoFilesPage.authenticate = { redirectTo: "/auth/login" }`. Mutation uses `resolver.authorize()`. Default landing after login/home redirect. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client Blitz page; work runs in-process via `better-queue`.

## 2. Features
- Feature name: Company source selection
- Short description: Use saved companies (multi-select) or upload credential Excel.
- How it works: Toggle UI; saved path loads `getCompanies`; Excel path parses client-side then submits companies array.
- Related API routes / server actions / server components: `getCompanies`; `processExcelUploadConso`.

- Feature name: Download File
- Short description: Queue TRACES download of consolidated files (default action).
- How it works: Submit → mutation creates `TaskBatch` + Tasks → `queue-conso` pushes `DownloadFile` (one task per company).
- Related API routes / server actions / server components: `src/companies/mutations/processExcelUploadConso.ts` → `src/jobs/queue-conso.ts`.

- Feature name: Send Request (specific periods)
- Short description: Request conso generation on TRACES for selected FY × Quarter × Form Type.
- How it works: Cartesian product of selected periods; each combination becomes a queued `SendRequest` task.
- Related API routes / server actions / server components: same mutation/queue; worker `NoticeDownloaderConso`.

- Feature name: Send Request (all periods)
- Short description: Expand to many historical periods automatically.
- How it works: Mutation generates 15 FY × 4 quarters × 4 form types (24Q/26Q/27Q/27EQ) per company.
- Related API routes / server actions / server components: same as above.

- Feature name: Upload history
- Short description: Per-company/period status table with manual refresh.
- How it works: `getUploadHistory` for type `conso`; status tags + combination JSON details.
- Related API routes / server actions / server components: `src/companies/queries/getUploadHistory.ts`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Form state for action/periods; Excel `handleFileUpload`; manual history refetch. No auto-polling.
- Server-side logic: Upsert companies by TAN (often temporary); create TaskBatch/Task/UploadHistory; enqueue jobs.
- **Background processes**:
  - System: in-process `better-queue` (`src/jobs/queue-conso.ts`), `concurrent: 1`, `maxRetries: 1`, `afterProcessDelay: 500ms`
  - Worker: `NoticeDownloaderConso` (`src/jobs/NoticeDownloader-conso.ts`)
  - Trigger: `processExcelUploadConso` after user Submit
  - Processes: IT portal login for returns metadata (Send Request) + TRACES 6.1 Puppeteer for conso request/download
  - Logs: `logs/{taskId}-it.log` (and `.log` on failure)
  - Note: Queue is in-memory; server restart drops pending jobs

## 4. Portal Support
- Does this page/feature support multiple portals? Yes (hybrid flow), but no UI portal switcher.
- Which portals are supported? Income Tax e-Portal (`it_password`) for returns data on Send Request; TRACES 6.1 (`user_id`/`password`/`tan`) for request/download via Puppeteer + API preauth.
- How is portal selection / switching implemented? Automatic inside worker by job type.
- Any recent portal-related changes or new portal support? Shares TRACES preauth helpers in `src/jobs/traces/` (rewrite new SPA URLs to traces61).
- Portal-specific logic, configurations, or conditional rendering: No Old/New Act selector on this page.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes (optional company source).
- Accepted formats: `.xlsx`, `.xls` only.
- Expected column structure / headers: `Company Name`, `Tan`, `IT Password`, `User ID`, `Password`.
- Validation rules: All five required per row; TAN uppercased; first sheet only.
- Parsing library used: SheetJS (`xlsx`), client-side; `beforeUpload` returns false (no multer upload).
- Differences compared to other pages that also accept Excel/CSV: Same credential template as Form16/Justification/Challan Status; unlike Companies, no CSV and upload triggers jobs rather than permanent master save only.
- Error handling for invalid files: Throws on first bad row; Ant Design error toast.

## 6. Key Files & Components
- Page file path: `src/pages/conso-files/index.tsx`
- Important components used: Ant Design Form, Upload, Table, Select; app Layout.
- Related API routes / server actions: Blitz `processExcelUploadConso`, `getUploadHistory`, `getCompanies`.
- Shared utilities: `src/jobs/queue-conso.ts`, `NoticeDownloader-conso.ts`, `src/jobs/traces/*`; outputs under `public/pdf/return/...` and TRACES excel paths.

## 7. Notes / Observations
- No live batch progress / retry UI (unlike Justification / Logs for Form16).
- FY dropdown shows ~10 years while “all periods” expands 15 years.
- Dead/unused path elsewhere: `downloadProceedings` also pushes conso queue but is not wired to this page.

## Post-refactor notes (Phases 1–5)
- Mutation: `src/conso/mutations/processExcelUpload.ts`.
- Shared upload + history UI; queue under `src/jobs/queues/queue-conso.ts`.
