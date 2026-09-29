# Feature Audit Index — traces-app

> **Structure:** See [`docs/ARCHITECTURE.md`](../ARCHITECTURE.md) and [`REFACTOR-LOG.md`](REFACTOR-LOG.md) for Phases 1–5 (shared layer, domain splits, cleanup, consistency).

Comprehensive page-wise audit of the Blitz/Next.js **Pages Router** application (`src/pages/`). There is no App Router. Framework shells `_app.tsx` / `_document.tsx` are not audited as pages.

## Architecture snapshot

| Topic | Summary |
|-------|---------|
| Router | Pages Router under `src/pages/` |
| RPC | Blitz RPC via `/api/rpc/[[...blitz]]` |
| Auth | Operational + master pages use `Page.authenticate`. Middleware license JWT **disabled**. |
| License | JWT in `.env.production`; configure at `/configure`; expired UX at `/auth/license-expired` |
| Default landing | `/` and post-login → `/conso-files` |
| Queues | In-process `better-queue` via `src/shared/jobs/createNoticeQueue` → `src/jobs/queues/*` → `src/jobs/workers/*` |
| Shared | `src/shared/{excel,jobs,portals,http,ui,types}` |
| Cron | Removed unused `node-cron` / `react-js-cron` deps (Phase 3) |

## Cross-cutting: portals

There is **no global portal switcher**. Features wire credentials and backends independently.

| System | Credentials (Company) | Notes |
|--------|----------------------|-------|
| Income Tax e-Portal (`eportal.incometax.gov.in`) | `tan` + `it_password` | Challan create/e-Pay, Form140/RRR extract, Form16/Conso send helpers |
| TRACES 6.1 (`traces61.tdscpc.gov.in`) | `user_id` + `password` + `tan` | Puppeteer flows; new SPA URLs rewritten to traces61 |
| TRACES REST (`traces-app.tdscpc.gov.in`) | same TRACES creds → Bearer via `loginTraces()` | Justification API; New Act TLDC child-cert APIs |

**Old Act / New Act** (`O`/`N`, Income-tax Act 1961 vs 2025) is a tax-regime choice on the IT portal (and TLDC New Act REST), not a separate product portal. Explicit UI: [TLDC](tldc.md), [Challan Management](challan-management.md). Auto rules also exist (FY ≥ 2026-27, deposit date after 30-Apr-2026).

Key modules: `src/utils/incomeTaxPortalAuth.ts`, `src/jobs/traces/*`, `src/challan/utils/incomeTaxAct.ts`, `src/jobs/traces/justificationApi.ts`, `src/scripts/fetchTldcDataNewAct.ts`.

## Cross-cutting: Excel / CSV

| Pattern | Formats | Headers / notes | Pages |
|---------|---------|-----------------|-------|
| Company credentials (5-col) | `.xlsx`/`.xls` (Companies also `.csv`) | `Company Name`, `Tan`, `IT Password`, `User ID`, `Password` — shared: `src/shared/excel/companyCredentials.ts` | Companies, Conso, Form16, Justification, Challan Status |
| Deductee masters | `.xlsx`/`.xls` | `PAN`, `Email`, optional `Name` — `src/shared/excel/deducteeMasters.ts` | Deductee Masters |
| Challan batch CSV | `.csv` | Meta + dynamic section columns (`parseChallanCsv.ts`) | Challan Management |
| Flexible Form140 companies | `.csv`/`.xlsx`/`.xls` | Aliased name/TAN/IT password | Extract Form 140 |
| Company picker Excel | `.xlsx`/`.xls` | Any columns → match saved cos | Challan Status |
| Payment/unconsumed Excel | `.xlsx`/`.xls` | TAN + Deposit Date (+ optional amount/name) | Challan Management |

Parser: **SheetJS (`xlsx`)** almost everywhere; challan CSV uses custom comma-split. Generic `/api/file/upload` exists but is not wired to UI pages. Periods helper: `src/shared/excel/periods.ts`.

## Cross-cutting: background jobs

| Queue file | Worker | Triggered from |
|------------|--------|----------------|
| `src/jobs/queues/queue-form16.ts` (re-export `src/jobs/queue-form16.ts`) | `jobs/workers/NoticeDownloader-form16` | `/form-16`; retry on `/logs` |
| `src/jobs/queues/queue-conso.ts` | `jobs/workers/NoticeDownloader-conso` | `/conso-files` |
| `src/jobs/queues/queue-justification.ts` | `jobs/workers/NoticeDownloader-justification` | `/justification-report` (+ in-page retry) |
| `src/jobs/queues/queue-challanStatus.ts` | `jobs/workers/NoticeDownloader-challanStatus` | `/challan-status`, `/payment-history-gaps` |

Shared factory: `src/shared/jobs/createNoticeQueue.ts` + batch orchestrator `createBatchFromCompanies.ts`. Workers live under `src/jobs/workers/` (legacy `src/jobs/NoticeDownloader-*` re-export).

**Client polling:** Justification progress 2s; Logs 10s. Most other pages block on sync APIs or use manual refresh.

**CLI / `.bat`:** challan status batch, payment gaps, missing PDFs, create-download-generated, TLDC new-act, TRACES child-cert download batches — see page audits and `package.json` scripts.

---

## Pages

### Core / auth

| Route | Summary | Audit |
|-------|---------|-------|
| `/` | Redirects to `/conso-files` | [home.md](home.md) |
| `/404` | Not-found page | [404.md](404.md) |
| `/auth/login` | Email/password login; optional `?next=` | [auth-login.md](auth-login.md) |
| `/auth/license-expired` | License expired notice → configure | [auth-license-expired.md](auth-license-expired.md) |
| `/configure` | Machine ID + LICENSE JWT (SSR) | [configure.md](configure.md) |

### Master data (sidebar)

| Route | Summary | Audit |
|-------|---------|-------|
| `/companies` | Company CRUD + IT/TRACES credentials Excel/CSV | [companies.md](companies.md) |
| `/deductee-masters` | Deductee PAN/email CRUD + Excel bulk | [deductee-masters.md](deductee-masters.md) |
| `/smtp-configs` | SMTP CRUD + connection test | [smtp-configs.md](smtp-configs.md) |

### TRACES downloads & processing (sidebar)

| Route | Summary | Audit |
|-------|---------|-------|
| `/conso-files` | Conso send/download queue jobs | [conso-files.md](conso-files.md) |
| `/justification-report` | Justification REST jobs + live progress/retry | [justification-report.md](justification-report.md) |
| `/form-16` | Form16/16A queue, DSC, ZIP→PDF, email | [form-16.md](form-16.md) |
| `/challan-status` | Unconsumed/status queue + PDF-from-Excel API | [challan-status.md](challan-status.md) |
| `/tldc` | TLDC CRUD + Old/New Act portal fetch/update | [tldc.md](tldc.md) |
| `/ldc-utilisation` | LDC utilisation (limit/consumed/%) + Excel/PDF export | [ldc-utilisation.md](ldc-utilisation.md) |
| `/logs` | TaskBatch monitor; Form16 retry; 10s poll | [logs.md](logs.md) |

### Income Tax portal tools (sidebar unless noted)

| Route | Summary | Audit |
|-------|---------|-------|
| `/challan-management` | Create challans, e-Pay downloads, CSV/Excel batches, Old/New Act | [challan-management.md](challan-management.md) |
| `/outstanding-demand` | Fetch/display TRACES outstanding demand | [outstanding-demand.md](outstanding-demand.md) |
| `/return-status` | Fetch/display TRACES return status | [return-status.md](return-status.md) |
| `/clause-34b` | Form 3CD clause 34(b) working paper from TRACES Statement Filed Status | [clause-34b.md](clause-34b.md) |
| `/extract-rrr` | IT portal RRR extract (saved companies) | [extract-rrr.md](extract-rrr.md) |
| `/extract-form140` | IT portal Form140 extract (CSV/Excel or saved) | [extract-form140.md](extract-form140.md) |
| `/payment-history-gaps` | Missing payment PDF analysis (not in sidebar) | [payment-history-gaps.md](payment-history-gaps.md) |

### Documents & utilities

| Route | Summary | Audit |
|-------|---------|-------|
| `/document` | Browse downloaded PDF/Excel folders | [document.md](document.md) |
| `/api-docs` | Swagger UI for REST OpenAPI (not in sidebar) | [api-docs.md](api-docs.md) |
| `/test-form16` | Dev Form16A test page; API may be missing | [test-form16.md](test-form16.md) |

---

## Related API routes (appendix)

Grouped by domain. Full page-style audits live on the UI pages that call them.

### Challan / payment
- `/api/challan/create`
- `/api/challan/download`
- `/api/challan/download-payment`
- `/api/challan/download-generated-challans`
- `/api/challan/download-csi`
- `/api/challan/download-missing-payment-pdfs`
- `/api/challan/download-pdfs-from-unconsumed-excel`
- `/api/challan/download-pdfs-from-uploaded-excels`
- `/api/challan/fetch-payment-history`
- `/api/challan/payment-history-gaps`
- `/api/challan/batch-companies`
- `/api/challan/run-challan-status` (exists; not wired from main UI)

### TLDC
- `/api/tldc/fetch-data`
- `/api/tldc/fetch-data-new-act`
- `/api/tldc/update-data`
- `/api/tldc/update-data-new-act`

### Exports
- `/api/export/[feature]` — `tldc` | `ldc-utilisation` | `outstanding-demand` | `return-status` | `rrr` | `form140` | `deductee-masters`

### IT extracts & TRACES status
- `/api/form140/extract`
- `/api/rrr/extract`
- `/api/outstanding-demand/fetch`
- `/api/return-status/fetch`

### Platform
- `/api/rpc/[[...blitz]]` — Blitz mutations/queries
- `/api/file/[...slug]` — serve public files
- `/api/file/upload` — multer upload (unused by pages)
- `/api/env/license` — license verification
- `/api/smtp-test` — SMTP verify

---

## Sidebar coverage (`src/core/layouts/Layout.tsx`)

In nav: Companies, Deductee Masters, Conso Files, Justification Report, form-16, Challan Status, TLDC, LDC Utilisation, Challan Management, Outstanding Demand, Return Status, Clause 34(b), Extract RRR, Extract Form 140, Logs, Documents, SMTP Configs.

Not in nav (direct URL): `/payment-history-gaps`, `/configure`, `/api-docs`, `/test-form16`, auth routes, `/`, `/404`.
