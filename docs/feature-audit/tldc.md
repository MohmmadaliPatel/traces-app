# Page Audit: /tldc

## 1. Overview
- Full route path: `/tldc`
- Purpose of the page: Manage Lower Deduction Certificate (TLDC / child certificate) data — fetch/update from TRACES (Old Act Puppeteer or New Act REST), CRUD, and CSV export.
- Access control / authentication requirements (if any): `TldcPage.authenticate = { redirectTo: "/auth/login" }`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client Blitz page calling synchronous TLDC APIs per company; DB via Blitz RPC.

## 2. Features
- Feature name: Batch fetch from portal
- Short description: For selected companies + FY, pull TLDC/child-cert data into local DB.
- How it works: UI loops companies → `TldcService.fetchTldcData` (old) or `fetchTldcDataNewAct` (new) with 3 retries/backoff.
- Related API routes / server actions / server components: `/api/tldc/fetch-data`, `/api/tldc/fetch-data-new-act`; service `src/tldc/services/tldcService.ts`.

- Feature name: Batch update from portal
- Short description: Update existing records from portal PDFs/APIs.
- How it works: `updateTldcData` / `updateTldcDataNewAct` via service wrappers.
- Related API routes / server actions / server components: `/api/tldc/update-data`, `/api/tldc/update-data-new-act`.

- Feature name: Per-record “Update from Portal”
- Short description: Row action that auto-picks Old vs New Act by FY.
- How it works: If FY start ≥ 2026 → New Act REST; else Old Act update API.
- Related API routes / server actions / server components: same update APIs.

- Feature name: Local CRUD + Quick Add
- Short description: Create/edit/delete TLDC rows; quick stub create.
- How it works: `getTldcData`, `upsertTldcData`, `createQuickTldcData`, `deleteTldcData`.
- Related API routes / server actions / server components: Blitz RPCs under `src/tldc/`.

- Feature name: Search / filter / export CSV
- Short description: Client search (cert/PAN/name), company filter, export filtered rows.
- How it works: Query up to large take; client builds CSV download.
- Related API routes / server actions / server components: `getTldcData`.

- Feature name: New Act initiate options
- Short description: Control whether to initiate download requests when none exist / force initiate.
- How it works: Switches `initiateIfNoRequest` (default on), `forceInitiate`.
- Related API routes / server actions / server components: New Act fetch/update APIs + `fetchTldcDataNewAct.ts`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Sequential company loops; loading toasts; retries. No interval polling.
- Server-side logic: Old Act Puppeteer inbox scrape; New Act REST (`searchDeductor`, child-cert download/initiate APIs).
- **Background processes**:
  - No better-queue — work blocks HTTP request
  - Related CLI: `yarn tldc:new-act` → `src/scripts/fetchTldcDataNewAct.ts`
  - Related TRACES child-cert batch CLIs: `traces:download-requests`, `traces:download-child-certs`

## 4. Portal Support
- Does this page/feature support multiple portals? Yes — explicit Old Act vs New Act on TRACES.
- Which portals are supported?
  - Old Act: TRACES 6.1 Puppeteer (inbox / Section 197 verification)
  - New Act: TRACES REST (`childcertgenservice`, `certificateservice`) via traces-app API
- How is portal selection / switching implemented? Batch UI `Radio.Group` `actType` `old` | `new`. Per-record update auto by FY ≥ 2026-27.
- Any recent portal-related changes or new portal support? **Yes** — New Act REST fetch/update routes and `fetchTldcDataNewAct.ts` are recent portal support.
- Portal-specific logic, configurations, or conditional rendering: New Act switches for initiate/force; credentials passed as `{ userId, password, tan }` (TRACES).

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A (export only).
- Expected column structure / headers: Export includes ID, Company, Certificate Number, DIN, Financial Year, PAN, PAN Name, Section, Nature of Payment, TDS Rate, TDS Amount Limit, TDS Amount Consumed, Valid From, Valid To, Cancel Date, Status.
- Validation rules: N/A for upload.
- Parsing library used: N/A (client CSV string for export).
- Differences compared to other pages that also accept Excel/CSV: Export-only; company selection from saved masters only.
- Error handling for invalid files: N/A.

## 6. Key Files & Components
- Page file path: `src/pages/tldc/index.tsx`
- Important components used: Ant Design Table, Radio, Switches, Modals; Layout.
- Related API routes / server actions: `/api/tldc/fetch-data`, `fetch-data-new-act`, `update-data`, `update-data-new-act`; TLDC Blitz RPCs.
- Shared utilities: `tldcService.ts`, `src/scripts/fetchTldcData.ts`, `fetchTldcDataNewAct.ts`, `updateTldcData.ts`, `src/jobs/traces/*`.

## 7. Notes / Observations
- Per-record update paths are mixed (direct `fetch` vs service) between acts.
- Quick Add creates stubs; full enrichment expects portal update.
- Long multi-company batches may time out — CLI useful for bulk New Act.
