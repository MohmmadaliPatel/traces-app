# Page Audit: /return-status

## 1. Overview
- Full route path: `/return-status`
- Purpose of the page: Fetch and display TDS return filing status from TRACES for selected companies, FYs, quarters, and form types; export CSV; view rejection HTML.
- Access control / authentication requirements (if any): `ReturnStatusPage.authenticate = { redirectTo: "/auth/login" }`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client page with sequential sync API fetches + Blitz query for stored rows.

## 2. Features
- Feature name: Parameterized fetch
- Short description: Select companies, financial years, quarters, form types then fetch from TRACES.
- How it works: Sequential `POST /api/return-status/fetch` per company with filters.
- Related API routes / server actions / server components: `/api/return-status/fetch` → `src/scripts/fetchReturnStatus.ts`.

- Feature name: Status table + filters
- Short description: Show stored return status rows with company filter and status styling.
- How it works: `getReturnStatus`; tags for rejected / processed / pending-style statuses.
- Related API routes / server actions / server components: `src/return-status/queries/getReturnStatus.ts`.

- Feature name: Rejection message modal
- Short description: Render portal rejection HTML for a row.
- How it works: Modal displays `rejectionMsg` as HTML.
- Related API routes / server actions / server components: Data from DB/query.

- Feature name: Export CSV
- Short description: Client CSV of current results.
- How it works: Browser download from in-memory/query data.
- Related API routes / server actions / server components: None.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Sequential per-company fetch. No polling.
- Server-side logic: TRACES scrape/script persists fields such as `finyear`, `quarter`, `formtype`, `tokenno`, `dtoffiling`, `status`, `dtofprcng`, `stmnttype`, `rejectionMsg`.
- **Background processes**: None (no queue).

## 4. Portal Support
- Does this page/feature support multiple portals? TRACES only.
- Which portals are supported? TRACES with company TRACES credentials.
- How is portal selection / switching implemented? None.
- Any recent portal-related changes or new portal support? No act selector.
- Portal-specific logic, configurations, or conditional rendering: Quarter encoding uses portal codes `"3"`–`"6"` for Q1–Q4 (differs from RRR/Form140 which use `Q1`–`Q4`). FY sent as start-year strings (e.g. `"2026"`).

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A (export only).
- Expected column structure / headers: Export/display mirrors DB return-status fields listed above.
- Validation rules: Fetch requires company + FY + quarters + form types selections in UI.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: Export-only; quarter codes differ from Extract RRR.
- Error handling for invalid files: N/A.

## 6. Key Files & Components
- Page file path: `src/pages/return-status/index.tsx`
- Important components used: Multi-selects, Table, Modal; Layout.
- Related API routes / server actions: `/api/return-status/fetch`; `getReturnStatus`.
- Shared utilities: `src/scripts/fetchReturnStatus.ts`; TRACES helpers.

## 7. Notes / Observations
- Quarter value mismatch across pages is a common source of confusion when comparing with Extract RRR.
- Credentials must be configured on Companies.
