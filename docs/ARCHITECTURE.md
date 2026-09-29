# Architecture — traces-app

Blitz 2 + Next.js **Pages Router** desktop-style automation for TRACES / Income Tax portal workflows.

## High-level layout

```text
src/
  pages/                 # Routes only (UI + pages/api/*). Prefer thin pages.
  shared/                # Cross-feature, non-RPC code
    excel/               # Credentials, periods, challan CSV, deductee, payment/unconsumed
    jobs/                # better-queue factory, batch orchestrator, upload-history helpers
      workers/           # Shared NoticeDownloader helpers (task messages, folder match)
    portals/             # Facades: incomeTax, traces, Old/New Act
    http/                # API auth + axios cookie-client facades
    ui/                  # Upload, BatchJobControls, UploadHistoryTable, progress
    types/               # Shared TypeScript types (credentials, …)
  companies/             # Company master Blitz RPC
  conso/                 # Conso batch RPC (processExcelUpload)
  form16/                # Form16 batch RPC
  justification/         # Justification batch RPC
  challan/               # Challan domain RPC + utils
  tldc/, outstanding-demand/, return-status/, …
  jobs/
    queues/              # better-queue instances (thin)
    workers/             # NoticeDownloader-* implementations + barrel
    traces/              # TRACES REST + Puppeteer session
    helper.ts            # Cookie jar / axios (also via shared/http)
    NoticeDownloader-*   # Thin re-exports → jobs/workers/*
  scripts/               # CLI entrypoints — call shared/domain code
  core/                  # Layout, Form primitives
  mailer/                # Outbound email (Form16 etc.)
  mailers/               # Blitz forgot-password mailer stub (root)
  auth/, users/, tasks/, utils/
```

## Key patterns

### Excel / CSV uploads

| Pattern | Module | Consumers |
|---------|--------|-----------|
| 5-col company credentials | `shared/excel/companyCredentials` + `shared/ui/CompanyCredentialsUpload` | Companies, Conso, Form16, Justification, Challan Status |
| Flexible IT-portal companies | `parseFlexibleCompanyRows` + `toAssessmentYearRef` | Extract Form 140 |
| FY × quarter × form periods | `shared/excel/periods` | Batch mutations |
| Challan batch CSV (quoted fields) | `challan/utils/parseChallanCsv` | Challan Management |
| Payment / unconsumed Excel | `shared/excel/paymentUnconsumed` | Challan Management + APIs |

### Background jobs

```text
UI → Blitz mutation (processExcelUpload)
   → createBatchFromCompanies (TaskBatch + Task + UploadHistory)
   → createNoticeQueue worker
   → jobs/workers/NoticeDownloader-*.process()
```

- Factory: `src/shared/jobs/createNoticeQueue.ts`
- Orchestrator: `src/shared/jobs/createBatchFromCompanies.ts`
- History UI: `UploadHistoryTable` / `BatchProgressPoller` (Justification is reference UX)

### Portals & HTTP

| Concern | Import from | Implementation |
|---------|-------------|----------------|
| Income Tax e-Portal | `src/shared/portals/incomeTax` | `utils/incomeTaxPortalAuth.ts` |
| TRACES | `src/shared/portals/traces` | `jobs/traces/*` |
| Old / New Act | `src/shared/portals/act` | `incomeTaxAct` + `paymentHistoryFiles` |
| REST API auth | `src/shared/http` (`withApiAuth`) | `utils/apiAuth.ts` |

### Auth

- Operational pages: `Page.authenticate = { redirectTo: "/auth/login" }`
- Masters (Companies, Deductee, SMTP, Documents) also enforce page auth
- Middleware license JWT check is **disabled** (early `NextResponse.next()`); restore from git when needed

## Where to put new code

| Change | Location |
|--------|----------|
| Page UI | `src/pages/<route>/` — thin; use `src/shared/ui` |
| Blitz RPC | Domain `*/mutations` / `*/queries` |
| Excel parse | `src/shared/excel/` |
| Queue/batch | `src/shared/jobs/` |
| Portal / HTTP | `src/shared/portals/` or `src/shared/http/` |
| Workers | `src/jobs/workers/` + helpers in `src/shared/jobs/workers/` |
| CLI | Thin `src/scripts/*.ts` |
| REST | Thin `src/pages/api/**` via `withApiAuth` from `shared/http` |

## Orphan / intentional leftovers

Kept on purpose (CLI / external / product decision):

- `/api/challan/run-challan-status`, `/api/file/upload`, `/api/challan/download`
- Justification Puppeteer fallback paths (REST is primary)
- Hidden routes: `/payment-history-gaps`, `/api-docs`, `/configure`

## Related docs

- Feature audits: [`docs/feature-audit/00-INDEX.md`](feature-audit/00-INDEX.md)
- Refactor log: [`docs/feature-audit/REFACTOR-LOG.md`](feature-audit/REFACTOR-LOG.md)
- Scripts: [`src/scripts/README.md`](../src/scripts/README.md)
