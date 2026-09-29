# Page Audit: /logs

## 1. Overview
- Full route path: `/logs`
- Purpose of the page: Monitor TaskBatch / Task history across download modules; retry failed Form 16 batch tasks.
- Access control / authentication requirements (if any): `TasksListPage.authenticate = { redirectTo: "/auth/login" }`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client Blitz page with 10s polling.

## 2. Features
- Feature name: Batch history list
- Short description: Table of batches with job-type tags, task counts, status summaries, relative created time.
- How it works: `useQuery(getTaskBatch, { refetchInterval: 10000 })`; expandable rows show filter parameters.
- Related API routes / server actions / server components: `src/tasks/queries/getTaskBatch.ts`.

- Feature name: View tasks for a batch
- Short description: Drill into per-task status (company, TAN, message, filterable status).
- How it works: Selecting “View Tasks” loads nested task data from the batch query page.
- Related API routes / server actions / server components: `getTaskBatch`.

- Feature name: Batch parameters modal
- Short description: Shows FY, Quarter, Form Type, Action Type, Form 16 Type, All Periods from stored filters.
- How it works: Modal Descriptions from `batch.filters` JSON.
- Related API routes / server actions / server components: None beyond query data.

- Feature name: Retry failed Form 16 tasks
- Short description: Select failed tasks and re-enqueue on Form 16 queue.
- How it works: Detects `filters.form16Type`; `getTaskBatchTaskIds` for failed IDs; `retryFailedForm16BatchTasks` → `queue-form16.push`. Blocks `sign_pdf` retries.
- Related API routes / server actions / server components: `src/tasks/mutations/retryFailedForm16BatchTasks.ts`, `getTaskBatchTaskIds`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: **Polling every 10 seconds** via Blitz `refetchInterval`.
- Server-side logic: Paginated TaskBatch + Task reads; retry mutation resets Failed → Queued and re-pushes.
- **Background processes**:
  - Does not start new business jobs except Form16 retries
  - Observes all modules that create TaskBatches (`module: "IT"`) including conso/form16/justification/challan_status
  - Justification retries live on `/justification-report`, not here
  - Per-task logs on disk: `logs/{taskId}-it.log`

## 4. Portal Support
- Does this page/feature support multiple portals? Indirectly — displays batches that targeted IT/TRACES portals.
- Which portals are supported? N/A for selection.
- How is portal selection / switching implemented? N/A.
- Any recent portal-related changes or new portal support? Shows batches from new Justification REST flow when present.
- Portal-specific logic, configurations, or conditional rendering: Form16-type badge (`form16` / `form16a`); action labels Send Request / Download / Attach DSC.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A.
- Expected column structure / headers: N/A.
- Validation rules: N/A.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: N/A.
- Error handling for invalid files: N/A.

## 6. Key Files & Components
- Page file path: `src/pages/logs/index.tsx`
- Important components used: Ant Design Table, Modal, Tags; Layout.
- Related API routes / server actions: `getTaskBatch`, `getTaskBatchTaskIds`, `retryFailedForm16BatchTasks`.
- Shared utilities: Queue `src/jobs/queue-form16.ts` for retries; Prisma Task/TaskBatch models.

## 7. Notes / Observations
- Retry UI is Form 16/16A only; Conso and Challan Status have no retry entry points here.
- Company filter options built from current page of tasks may be incomplete for large batches.
- Status summary may only reflect the first page of tasks nested in the batch query.
