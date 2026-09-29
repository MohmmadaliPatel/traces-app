# Page Audit: /deductee-masters

## 1. Overview
- Full route path: `/deductee-masters`
- Purpose of the page: Maintain deductee master records (PAN, email, optional name) used for Form 16 email and related deductee communication.
- Access control / authentication requirements (if any): No page-level `Page.authenticate`. RPCs use `resolver.authorize()`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client-side Blitz page with RPC; embeds `<Layout>` as JSX.

## 2. Features
- Feature name: List deductee masters
- Short description: Table of PAN, Email, Name, Created At with client search.
- How it works: `useQuery(getDeducteeMasters)`; filter locally on PAN/email/name.
- Related API routes / server actions / server components: `src/deductee-masters/queries/getDeducteeMasters.ts`.

- Feature name: Add / Edit / Delete
- Short description: Modal CRUD; PAN disabled when editing.
- How it works: `createDeducteeMaster` / `updateDeducteeMaster` / `deleteDeducteeMaster`.
- Related API routes / server actions / server components: matching mutations under `src/deductee-masters/mutations/`.

- Feature name: Bulk Excel upload
- Short description: Upsert many deductees by PAN from Excel.
- How it works: Client SheetJS parse → `bulkUploadDeducteeMasters`.
- Related API routes / server actions / server components: `src/deductee-masters/mutations/bulkUploadDeducteeMasters.ts`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Upload handler + modal state; no polling.
- Server-side logic: Upsert by PAN (uppercase); email lowercased.
- **Background processes**: None.

## 4. Portal Support
- Does this page/feature support multiple portals? No.
- Which portals are supported? N/A.
- How is portal selection / switching implemented? N/A.
- Any recent portal-related changes or new portal support? N/A.
- Portal-specific logic, configurations, or conditional rendering: None — not portal credentials.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes.
- Accepted formats: `.xlsx`, `.xls` only (`accept=".xlsx,.xls"`). No CSV.
- Expected column structure / headers:
  - `PAN` (required)
  - `Email` (required)
  - `Name` (optional)
- Validation rules: Client throws if PAN/Email missing. Email normalized (lowercase; strips `Name <email>` wrappers). PAN uppercased. Form: PAN length 10; email type validation.
- Parsing library used: SheetJS (`xlsx`), first sheet, `readAsArrayBuffer`.
- Differences compared to other pages that also accept Excel/CSV: Different schema from company-credential uploads; no CSV; no template download button; upsert key is PAN not TAN. Bulk mutation lacks Zod (casts input).
- Error handling for invalid files: Row-level throw + Ant Design messages; mutation returns `errors` / `errorDetails`.

## 6. Key Files & Components
- Page file path: `src/pages/deductee-masters/index.tsx`
- Important components used: Ant Design Table, Modal, Upload, Form; app `Layout`.
- Related API routes / server actions: Blitz RPC under `src/deductee-masters/*`.
- Shared utilities: `xlsx`.

## 7. Notes / Observations
- Unused Ant Design imports (`Tag`, `InputNumber`, `Switch`) in page file.
- Debug `console.log` in client upload handler and bulk mutation.
- Related consumer: Form 16 email dispatch (`sendForm16Emails`) uses PAN→email mapping.
