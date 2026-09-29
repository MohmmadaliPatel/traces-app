# Page Audit: /extract-rrr

## 1. Overview
- Full route path: `/extract-rrr`
- Purpose of the page: Extract RRR / acknowledgement numbers from Income Tax portal TDS return filing history for selected companies and periods.
- Access control / authentication requirements (if any): `ExtractRrrPage.authenticate = { redirectTo: "/auth/login" }`. API uses `withApiAuth`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client page triggers one long-running API call; server writes incremental JSON/CSV to disk.

## 2. Features
- Feature name: Configure extract filters
- Short description: Pick companies, form types (24Q/26Q/27Q/27EQ), financial years, quarters (Q1–Q4), concurrency (1–4).
- How it works: Form state → `POST /api/rrr/extract` body with `companyIds`, `formTypes`, `financialYears` (start year), `quarters`, `concurrency`.
- Related API routes / server actions / server components: `/api/rrr/extract` → `src/scripts/fetchRrrNumbers.ts`.

- Feature name: Run extract & show results
- Short description: Display `RrrExtractRow[]` in a table after API returns.
- How it works: Single fetch; shows rows and disk output paths.
- Related API routes / server actions / server components: same API/script.

- Feature name: Download CSV
- Short description: Client CSV of result rows.
- How it works: Browser download; server also writes `public/pdf/return/rrr-extract/rrr_extract.csv` and `.json`.
- Related API routes / server actions / server components: disk paths returned by API.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: One-shot API call with loading spinner. No polling.
- Server-side logic: Concurrent company workers (`runWithConcurrency`); stops paging early once selected FY+quarter found; uses `it_password`.
- **Background processes**: No better-queue. Long synchronous API request with incremental disk saves. CLI: `src/scripts/fetchRrrNumbers.ts` (also used by API).

## 4. Portal Support
- Does this page/feature support multiple portals? Income Tax e-Portal only.
- Which portals are supported? Income Tax e-Portal (`tan` + `it_password`).
- How is portal selection / switching implemented? None — no Old/New Act control.
- Any recent portal-related changes or new portal support? Newer IT portal API extraction feature (alongside Form 140 extract).
- Portal-specific logic, configurations, or conditional rendering: Requires IT credentials on Companies page.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A (export/output only).
- Expected column structure / headers (output): `Company Name`, `Financial year`, `Quarter`, `Filing Type`, `returnType`, `Date of Tds return`, `RRR number`, `Acknowledgement number`.
- Validation rules: API requires companies + formTypes + financialYears + quarters.
- Parsing library used: N/A for upload.
- Differences compared to other pages that also accept Excel/CSV: Unlike Extract Form 140, no company CSV/Excel upload — saved companies only.
- Error handling for invalid files: N/A. Missing IT password fails per company in batch.

## 6. Key Files & Components
- Page file path: `src/pages/extract-rrr/index.tsx`
- Important components used: Company/period Selects, Table, Export; Layout.
- Related API routes / server actions: `/api/rrr/extract`.
- Shared utilities: `src/scripts/fetchRrrNumbers.ts`, `src/utils/incomeTaxPortalAuth.ts`, `runWithConcurrency`.

## 7. Notes / Observations
- FY UI labels like `2026-27` map to API start year `"2026"`.
- Quarters are `Q1`–`Q4` (not Return Status portal codes `3`–`6`).
- Long runs may approach HTTP timeout limits for many companies.
