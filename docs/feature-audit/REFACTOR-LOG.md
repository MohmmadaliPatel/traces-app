# Refactor log — structure & shared modules

Incremental refactor executed from the Phase 1 architecture plan. Behavior preserved; structure and duplication reduced.

## Modules completed

### 1. Shared Excel + periods

- Added `src/shared/excel/` (`companyCredentials`, `periods`, `challanCsv` re-export, `deducteeMasters`)
- Added `src/shared/types/companyCredentials.ts`
- Batch mutations now use `generateAllPeriods` / `resolvePeriods` / `CompanyCredentialsSchema`

### 2. Queue factory + batch orchestrator

- Added `src/shared/jobs/` (`createNoticeQueue`, `createBatchFromCompanies`, `uploadHistory`, `upsertCompanyFromCredentials`)
- Thin wrappers: `src/jobs/queues/queue-*.ts` (legacy `src/jobs/queue-*.ts` re-export)
- `processExcelUpload*` mutations call `createBatchFromCompanies`

### 3. Shared UI

- Added `src/shared/ui/` (credentials file reader, upload component, status tag, batch progress)
- Wired Companies, Justification, Conso, Form16, Challan Status credential uploads

### 4. Portal facades

- Added `src/shared/portals/` (`incomeTax`, `traces`, `act`)
- Scripts (Form140, RRR, payment history, create challan) import income-tax helpers from the facade

### 5. Blitz domain split

- `src/conso/mutations/processExcelUpload.ts`
- `src/form16/mutations/processExcelUpload.ts`
- `src/justification/mutations/processExcelUpload.ts`
- `src/challan/mutations/processExcelUploadChallanStatus.ts`
- Compatibility re-exports remain under `src/companies/mutations/processExcelUpload*`

### 6. Worker helpers

- `src/shared/jobs/workers/taskHelpers.ts` (task messages, company folder match, txt scan)
- `NoticeDownloader-challanStatus` delegates to helpers
- `src/jobs/workers/index.ts` barrel for downloaders

### 7. CLI / API convention

- Documented in `src/scripts/README.md`
- Key scripts switched to `src/shared/portals/*`

### 8. Cleanup

**Removed (safe dead/scratch):**

- `src/scripts/downloadChallanPayment.ts.testtmp.ts`
- `src/pages/test-form16.tsx` (API missing)
- Root scratch: `.api_token_trial.tmp`, `test.json`, `Untitled-2.txt`, `test-form16a-pdf.ts`
- `public/companies-template (2).csv`
- Empty stubs: `mailers/`, `integrations/`

**Restored after mistaken delete:**

- `mailers/forgotPasswordMailer.ts` (required by `forgotPassword` mutation)

**Not removed (kept intentionally):**

- License middleware early-return / dead branch (needs product decision to re-enable)
- Unwired APIs (`run-challan-status`, `file/upload`) — may be used by CLI/external clients
- Cron deps in package.json
- Justification legacy Puppeteer path (REST is primary; confirm before delete)
- Binaries, `.env`, `dist/`, `build/`, `queue.db`, live logs/pdf outputs

**Consistency:**

- Added `Page.authenticate` to Companies, Deductee Masters, SMTP Configs, Documents
- Removed debug `console.log` from deductee bulk upload path

## Follow-ups (optional next passes)

1. ~~Extract shared helpers into remaining NoticeDownloader classes~~ (done in Phase 2)
2. ~~Adopt `CompanyCredentialsUpload` on Justification~~ — still optional on Conso/Form16/Challan Status pages
3. Unify Form140 flexible parser with shared excel aliases carefully (tax-year shape differs)
4. Wire or delete orphan APIs; sync OpenAPI
5. Align progress/retry UX on Conso / Challan Status with Justification (`UploadHistoryTable` + poller)

---

## Phase 2 — Structural improvements

### Excel

- Added `src/shared/excel/paymentUnconsumed.ts`; wired Challan Management + download-pdfs API
- Hardened `parseCsvFileText` / `splitCsvLine` for quoted commas in challan CSV

### Shared UI shells

- Added `BatchJobControls`, `UploadHistoryTable`
- Justification Report adopts credentials upload, job controls, and history table

### HTTP facade

- Added `src/shared/http` (re-exports `apiAuth` + `jobs/helper` axios client)
- Form140 / RRR / download-pdfs-from-uploaded-excels import `withApiAuth` from shared

### Workers folder move

- Moved all `NoticeDownloader-*` into `src/jobs/workers/`
- Legacy `src/jobs/NoticeDownloader-*.ts` remain as re-exports
- Queues import from `../workers/…`

### Worker helper adoption

- Enhanced `findMatchingCompanyFolder` (exact path → normalized equality → fuzzy includes)
- Conso / Form16 / Justification / ChallanStatus all use shared `addMessageToTask` + folder match

---

## Phase 3 — Cleanup

**Removed / cleaned**

- Dead `handleDownloadChallans` + unused `downloadLoading` on Challan Management
- Unused Blitz mutation `companies/mutations/downloadProceedings.ts`
- Unreachable license middleware body (left disabled early-return + comment)
- Unused deps: `node-cron`, `react-js-cron`
- Broken npm scripts `try` / `pup`; deleted `src/test.js`
- Debug `console.log` / hardcoded `batchId: 16` path fixed in `getUploadHistory`
- Dead history column code after adopting `UploadHistoryTable` on Conso / Form16 / Challan Status

**Kept intentionally**

- Unwired APIs (`run-challan-status`, `file/upload`, `/api/challan/download`) — CLI / external
- Justification Puppeteer fallback (REST primary)
- `mailers/forgotPasswordMailer.ts`
- Binaries, `.env`, build artifacts, live logs/pdf

---

## Phase 4 — Consistency & quality

**Standardization**

- All `pages/api/*` use `withApiAuth` from `src/shared/http`
- Conso / Form16 / Challan Status / Justification use `CompanyCredentialsUpload` + `UploadHistoryTable`
- Extract Form 140 uses `parseFlexibleCompanyRows` + `toAssessmentYearRef`
- Payment History Gaps: Old/New Act radio (no longer hardcodes Old Act)

**Bugfixes**

- `getUploadHistory`: respects real `batchId` / optional `status` (was hardcoding batch `16` + Failed)
- `updateSmtpConfig`: persists `isActive`
- Form16 `sign_pdf`: uses `form16` vs `form16a` folder from `form16Type`

---

## Phase 5 — Documentation

- Updated `docs/ARCHITECTURE.md` (current structure + patterns + leftovers)
- Updated this log and `docs/feature-audit/00-INDEX.md`
- Touched page audits for structural path notes where relevant
