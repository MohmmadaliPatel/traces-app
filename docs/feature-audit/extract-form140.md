# Page Audit: /extract-form140

## 1. Overview
- Full route path: `/extract-form140`
- Purpose of the page: Extract Form 140 (T140) e-verified receipts (acknowledgement, RRR, PDF) from the Income Tax portal for uploaded company lists or saved companies.
- Access control / authentication requirements (if any): `ExtractForm140Page.authenticate = { redirectTo: "/auth/login" }`. API `withApiAuth`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client page + long-running sync API; outputs Excel/JSON on disk.

## 2. Features
- Feature name: Dual company source
- Short description: Upload CSV/Excel company list **or** select saved companies.
- How it works: Upload path parses to `{ companies }`; saved path sends `{ companyIds }` using DB `it_password`.
- Related API routes / server actions / server components: `/api/form140/extract` (`normalizeCsvCompanies` / DB load).

- Feature name: Optional FY / quarter filters + concurrency
- Short description: Narrow extract; concurrency 1–4.
- How it works: Sent as `financialYears`, `quarters`, `concurrency`; empty means all. Server defaults `skipExistingPdfs: true`.
- Related API routes / server actions / server components: same API → `src/scripts/fetchForm140Receipts.ts`.

- Feature name: Results table + disk outputs
- Short description: Show extract rows; write aggregate Excel/JSON.
- How it works: API returns rows; writes `/pdf/form140/form140_extract.xlsx` and `.json`.
- Related API routes / server actions / server components: `fetchForm140Receipts.ts`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: File parse; one-shot extract POST. No polling.
- Server-side logic: Concurrent portal extraction; skip existing PDFs; normalize/dedupe companies by TAN.
- **Background processes**: No better-queue. Long synchronous API. Script reusable from CLI.

## 4. Portal Support
- Does this page/feature support multiple portals? Income Tax e-Portal only.
- Which portals are supported? Income Tax e-Portal Form 140 receipts (`it_password`).
- How is portal selection / switching implemented? None.
- Any recent portal-related changes or new portal support? Newer IT portal extraction feature (pairs with RRR extract).
- Portal-specific logic, configurations, or conditional rendering: Upload password column aliases map to IT password (not TRACES password).

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? Yes (optional source).
- Accepted formats: `.csv`, `.xlsx`, `.xls`.
- Expected column structure / headers (flexible aliases via `parseCompaniesFromRows`):
  - **Name** (required): `company_name`, `Company Name`, `company name`, `Company`, `name`
  - **TAN** (required): `username`, `Tan`, `TAN`, `tan`, `Username`, `User ID` (uppercased)
  - **Password** (required): `IT Password`, `it_password`, `IT password`, `password`
  - **Optional**: `tax_year`/`Tax Year`/`financial year`/`Financial Year`/`FY`; `quarter`/`Quarter`/`Qtr`/`qtr` → Q1–Q4; `form_type`/`Form Type`/`formType`/`form`
- Validation rules: Rows missing name/TAN/password skipped; dedupe by TAN. Server `normalizeCsvCompanies` accepts similar aliases.
- Parsing library used: SheetJS (`xlsx`) for all formats (array buffer).
- Differences compared to other pages that also accept Excel/CSV: Most flexible header aliases; accepts CSV+Excel; credentials drive IT portal extract (not TRACES queue jobs). Unlike Companies page, does not persist masters by default. Unlike Challan Management CSV, not section/amount oriented.
- Error handling for invalid files: Skips invalid rows; empty company list fails extract; toasts on API errors.

## 6. Key Files & Components
- Page file path: `src/pages/extract-form140/index.tsx`
- Important components used: Upload, company Select, filters, results Table; Layout.
- Related API routes / server actions: `/api/form140/extract`.
- Shared utilities: `src/scripts/fetchForm140Receipts.ts`, `incomeTaxPortalAuth.ts`.

## 7. Notes / Observations
- Output columns: Company Name, TAN, Status, Acknowledgement No, RRR Number, PDF, Financial Year, Quarter, Filing Date.
- Related conceptually to Justification Form 140 on TRACES, but this page is IT portal receipt extraction.

## Post-refactor notes (Phases 1–5)
- Company file parse via `parseFlexibleCompanyRows` + `toAssessmentYearRef` in `src/shared/excel`.
- Extract script/API use `src/shared/portals/incomeTax` and `src/shared/http`.
