# Page Audit: /outstanding-demand

## 1. Overview
- Full route path: `/outstanding-demand`
- Purpose of the page: Fetch and display TRACES outstanding demand amounts by company and financial year; export CSV.
- Access control / authentication requirements (if any): `OutstandingDemandPage.authenticate = { redirectTo: "/auth/login" }`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client page; sequential sync API fetches; DB read via Blitz query.

## 2. Features
- Feature name: Fetch outstanding demand
- Short description: Pull demand data from TRACES for selected companies.
- How it works: Client loops selected companies → `POST /api/outstanding-demand/fetch` with portal credentials from company record.
- Related API routes / server actions / server components: `/api/outstanding-demand/fetch` → `src/scripts/fetchOutstandingDemand.ts`.

- Feature name: View grouped results
- Short description: Company groups with expandable FY breakdown (`aodmnd`, `cpcdmd`).
- How it works: `getOutstandingDemand` (up to ~10k rows) rendered in Ant Design tables.
- Related API routes / server actions / server components: `src/outstanding-demand/queries/getOutstandingDemand.ts`.

- Feature name: Export CSV
- Short description: Download current demand data as CSV.
- How it works: Client-side CSV generation from query results.
- Related API routes / server actions / server components: None.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Sequential fetch loop with loading state. No polling.
- Server-side logic: Puppeteer/TRACES scrape in API/script; persists results.
- **Background processes**: None (no queue). Sync request-bound work only.

## 4. Portal Support
- Does this page/feature support multiple portals? TRACES only.
- Which portals are supported? TRACES (legacy automation path with company `user_id`/`password`/`tan`).
- How is portal selection / switching implemented? None — no Old/New Act control.
- Any recent portal-related changes or new portal support? No act UI; uses TRACES credentials stored on Companies.
- Portal-specific logic, configurations, or conditional rendering: None beyond credential pass-through.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A (export only).
- Expected column structure / headers: Export/display fields include financial year (`finYr`/`fin`), Assessment Order Demand (`aodmnd`), CPC Demand (`cpcdmd`), company identity.
- Validation rules: N/A.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: Export-only like Return Status/TLDC.
- Error handling for invalid files: N/A.

## 6. Key Files & Components
- Page file path: `src/pages/outstanding-demand/index.tsx`
- Important components used: Company Select, Tables, Export button; Layout.
- Related API routes / server actions: `/api/outstanding-demand/fetch`; `getOutstandingDemand`.
- Shared utilities: `src/scripts/fetchOutstandingDemand.ts`; TRACES session helpers.

## 7. Notes / Observations
- No FY/quarter filters on fetch — portal returns available years.
- Depends on companies having valid TRACES credentials.
