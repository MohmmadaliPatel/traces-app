# Page Audit: /test-form16

## 1. Overview
- Full route path: `/test-form16`
- Purpose of the page: Dev/test harness for Form 16A PDF generation from a hardcoded ZIP/extracted text sample.
- Access control / authentication requirements (if any): **No `.authenticate`**. Uses custom `getLayout` with Layout. **Not in sidebar** — treat as development-only.
- Whether it is client-side only, server-rendered, or hybrid: Client page calling a test API endpoint.

## 2. Features
- Feature name: Run Form 16A generation test
- Short description: Trigger test generation with or without ZIP extraction.
- How it works: Buttons call `GET /api/test-form16?useExtracted=true` or `?password=...` then display employee details, PDF links, logs.
- Related API routes / server actions / server components: Intended `/api/test-form16` — **route file not present in current repo tree** (calls may 404).

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: One-shot fetch; result rendering.
- Server-side logic: Expected to run Form16A PDF pipeline against hardcoded paths under `public/pdf/`.
- **Background processes**: None (sync test call). Related production cluster: `yarn form16a:bulk` / `generateForm16PdfsCluster.ts`.

## 4. Portal Support
- Does this page/feature support multiple portals? No — local file processing only.
- Which portals are supported? N/A.
- How is portal selection / switching implemented? N/A.
- Any recent portal-related changes or new portal support? N/A.
- Portal-specific logic, configurations, or conditional rendering: None.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A.
- Expected column structure / headers: N/A.
- Validation rules: N/A.
- Parsing library used: N/A (hardcoded ZIP/txt paths).
- Differences compared to other pages that also accept Excel/CSV: N/A.
- Error handling for invalid files: Displays API error/logs if generation fails.

### Hardcoded sample paths (examples)
- ZIP / extracted Form16A sample under `public/pdf/`
- Output folder: `public/pdf/form16-test-output`

## 6. Key Files & Components
- Page file path: `src/pages/test-form16.tsx`
- Important components used: Simple buttons/result panels; Layout via `getLayout`.
- Related API routes / server actions: Missing `/api/test-form16`; production Form16 pipeline in `NoticeDownloader-form16.ts` / PDF generators.
- Shared utilities: Form16A PDF generation helpers.

## 7. Notes / Observations
- Incomplete/broken if API route absent — document as incomplete feature.
- Hardcoded TAN/password in query examples — do not expose in production.
- Prefer `/form-16` production flows or `yarn form16a:bulk` for real work.

## Post-refactor notes (Phases 1–5)
- Page **removed** (`src/pages/test-form16.tsx`) — API was missing; treat as deleted dead harness.
