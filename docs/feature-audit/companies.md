# Page Audit: /companies

## 1. Overview
- Full route path: `/companies`
- Purpose of the page: Master data for companies — store names, TAN, Income Tax portal password, and TRACES credentials used across the app.
- Access control / authentication requirements (if any): No page-level `Page.authenticate`. RPCs use `resolver.authorize()`. Unauthenticated users may briefly see the shell before RPC fails and `_app` redirects to login. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client-side Blitz page with RPC queries/mutations; embeds `<Layout>` as JSX (not `getLayout`).

## 2. Features
- Feature name: List companies
- Short description: Paginated table of companies (name, TAN, User ID, created at).
- How it works: `useQuery(getCompanies)` with client-side search on name/TAN/user_id.
- Related API routes / server actions / server components: `src/companies/queries/getCompanies.ts` (Blitz RPC).

- Feature name: Add / Edit / Delete company
- Short description: Modal CRUD for a single company including portal passwords.
- How it works: Create uses `saveCompaniesFromExcel` with one row; edit uses `updateCompany`; delete uses `deleteCompany` with Popconfirm.
- Related API routes / server actions / server components: `saveCompaniesFromExcel`, `updateCompany`, `deleteCompany`.

- Feature name: Bulk import from Excel/CSV
- Short description: Upload a template file to upsert many companies by TAN.
- How it works: Client parses file with SheetJS → `saveCompaniesFromExcel({ companies, isTemporary: false })`.
- Related API routes / server actions / server components: `src/companies/mutations/saveCompaniesFromExcel.ts`.

- Feature name: Download template
- Short description: Generate sample CSV or XLSX with required headers.
- How it works: Client-side generation (`companies-template.csv` / `.xlsx`); no API.
- Related API routes / server actions / server components: None.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: `useState` for modal/search/file list; no polling `useEffect`.
- Server-side logic: Upsert by TAN (uppercase); Zod validation of company rows.
- **Background processes**: None. No queues, cron, or workers on this page.

## 4. Portal Support
- Does this page/feature support multiple portals? Yes — stores credentials for both systems used elsewhere.
- Which portals are supported?
  - Income Tax e-Portal → field `IT Password` / DB `it_password`
  - TRACES → fields `User ID` + `Password` / DB `user_id` + `password`
- How is portal selection / switching implemented? No runtime switcher; other pages pick the credential set they need.
- Any recent portal-related changes or new portal support? Dual credential model is foundational for New Act / TRACES REST features elsewhere.
- Portal-specific logic, configurations, or conditional rendering: List table hides passwords; form labels distinguish “IT Portal Password” vs “TRACES Password”.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes.
- Accepted formats: `.xlsx`, `.xls`, `.csv` (`accept=".xlsx,.xls,.csv"`, maxCount 1).
- Expected column structure / headers (exact):
  - `Company Name`
  - `Tan`
  - `IT Password`
  - `User ID`
  - `Password`
- Validation rules: All five fields required per row (client throw `Missing required fields in row N`); TAN trimmed/uppercased. Modal: TAN length 10. Server Zod mirrors the five fields.
- Parsing library used: SheetJS (`xlsx`) — CSV via `readAsText` + `XLSX.read(..., { type: "string" })`; Excel via `readAsArrayBuffer`.
- Differences compared to other pages that also accept Excel/CSV: Same 5-column template as Conso/Form16/Justification/Challan Status credential uploads, but this page **also accepts CSV** and **persists** companies permanently (`isTemporary: false`) without enqueueing jobs. Unlike Form140, headers are fixed (no aliases).
- Error handling for invalid files: Client/server error messages via Ant Design `message`; partial save returns `errors` / `errorDetails`.

## 6. Key Files & Components
- Page file path: `src/pages/companies/index.tsx`
- Important components used: Ant Design Table, Modal, Upload, Form; app `Layout`.
- Related API routes / server actions: Blitz RPC under `src/companies/queries|mutations/*`.
- Shared utilities: `xlsx`; company model in `db/schema.prisma`.

## 7. Notes / Observations
- `getCompanies` has a multi-tenant TODO comment.
- Missing explicit `Page.authenticate` unlike most operational pages.
- Passwords stored in DB; not displayed in table columns.

## Post-refactor notes (Phases 1–5)
- Page auth added; credentials Excel/CSV via `src/shared/ui/readCompanyCredentialsFile`.
- Batch feature mutations moved out of companies into `conso` / `form16` / `justification` / `challan` (compat re-exports remain).
