# Page Audit: /document

## 1. Overview
- Full route path: `/document`
- Purpose of the page: Browse downloaded IT/TRACES document folders under `public/pdf` (preview PDFs/images, preview Excel, download).
- Access control / authentication requirements (if any): **No page-level `authenticate`**. Uses Layout component; may not enforce Blitz page auth the same way as `Page.authenticate` pages. Listed in sidebar as “Documents”.
- Whether it is client-side only, server-rendered, or hybrid: Hybrid — `getServerSideProps` builds filesystem tree; client handles navigation/preview.

## 2. Features
- Feature name: Virtual folder browser
- Short description: Navigate mapped document roots and nested folders in a grid.
- How it works: SSR maps logical roots to disk paths; creates missing folders if absent; client navigates tree, search, sort.
- Related API routes / server actions / server components: `getServerSideProps` in page; downloads via public `/` paths or `/api/file/[...slug]` patterns as applicable.

- Feature name: Preview & download
- Short description: Open PDFs/images; modal Excel preview; download links.
- How it works: New-tab preview for PDF/images; fetch file + SheetJS for Excel modal preview.
- Related API routes / server actions / server components: Client `fetch` of file URL; SheetJS parse.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Folder navigation state; Excel preview parse. No polling.
- Server-side logic: Directory walk in `getServerSideProps`; ensure virtual folders exist.
- **Background processes**: None. This page only reads outputs produced by other features’ jobs/scripts.

### Mapped roots (typical)
- `Conso excel` → `public/pdf/traces_excel`
- `form 16` → `public/pdf/form16-download`
- `form 16a` → `public/pdf/form16a-download`
- `challan details` → `public/pdf/challan_status_results`

## 4. Portal Support
- Does this page/feature support multiple portals? No — local filesystem browser of portal download artifacts.
- Which portals are supported? N/A.
- How is portal selection / switching implemented? N/A.
- Any recent portal-related changes or new portal support? Folder mappings reflect TRACES/IT download outputs.
- Portal-specific logic, configurations, or conditional rendering: None.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A for upload. Preview supports existing `.xlsx` via SheetJS.
- Expected column structure / headers: N/A (displays whatever is in the file).
- Validation rules: N/A.
- Parsing library used: SheetJS (`xlsx`) for preview only.
- Differences compared to other pages that also accept Excel/CSV: Read-only preview of already-downloaded Excels; no import/upsert.
- Error handling for invalid files: Preview failures surface as UI errors; no upload validation.

## 6. Key Files & Components
- Page file path: `src/pages/document/index.tsx`
- Important components used: Grid/folder UI, preview modal; Layout.
- Related API routes / server actions: File serving via public assets / `src/pages/api/file/[...slug].ts` (related). Generic `src/pages/api/file/upload.ts` exists but is unused by this page.
- Shared utilities: `xlsx` for Excel preview.

## 7. Notes / Observations
- Potential auth gap if Layout auth is not applied as page auth.
- Some path normalization historically Windows-oriented (`\\public\\`) — watch macOS/Linux edge cases.
- Depends on other pages/jobs having produced files under `public/pdf`.
