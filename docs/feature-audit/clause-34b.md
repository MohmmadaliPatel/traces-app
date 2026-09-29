# Page Audit: /clause-34b

## 1. Overview
- Full route path: `/clause-34b`
- Purpose: build the Form 3CD **clause 34(b)** working paper — details of TDS/TCS statements
  furnished — from TRACES, and reconcile it against a previously prepared workbook. Also carries
  **clause 34(c)** (interest under s.201(1A) / 206C(7)) forward from that workbook, re-verifying
  it against any conso file still held.
- Access control: `Clause34bPage.authenticate = { redirectTo: "/auth/login" }`. Both APIs use
  `withApiAuth`. Listed in the sidebar via `getITItems()` in `src/core/layouts/Layout.tsx`.
- Rendering: client page driving two APIs; the server writes the .xlsx to disk.

## 2. Features
- **Fetch from TRACES** — loops the selected entities, one request each, showing progress and a
  per-entity log. One company per request because a login plus 16 servlet calls takes ~1 minute.
  `POST /api/clause-34b/fetch` → `src/clause34/fetchStatementStatus.ts`.
- **Build workbook** — reconciles the persisted records into clause 34(b) rows, loads the 34(c)
  data, and regenerates the 24-sheet workbook. `POST /api/clause-34b/build` →
  `buildClause34Rows` + `buildClause34cRows` + `writeClause34Workbook`.
- **Clause 34(c) panel** — per entity: liable?, interest payable/paid, the reference recomputation,
  the difference (flagged where the computed figure is higher and TRACES may demand it), and how
  many challan rows could not be re-verified.
- **Review table** — one row per (TAN, form, quarter) with the portal date, the previous
  workbook's date, timeliness and a `vs workbook` verdict.
- **Download** — served by the existing `/api/file/[...slug]` route.

## 3. Scripts & Background Processes
- No `better-queue` worker. The page drives a sequential loop (the `/return-status` pattern).
- CLI equivalents:
  - `src/scripts/fetchClause34StatementStatus.ts` — batch pull for the whole group.
  - `src/scripts/clause34Compare.ts` — reconciliation CSV + Markdown report.
  - `src/scripts/buildClause34Workbook.ts` — regenerate the workbook.
  - `src/scripts/crawlTracesPages.ts` — two-pass discovery crawl of the legacy portal.
  - `src/scripts/probeStmtStatus.ts` — capture the servlet contract for one combination.
  - `src/scripts/importClause34Companies.ts` — upsert entities from a credentials workbook.

## 4. Portal Support
- **TRACES 6.1** (`traces61.tdscpc.gov.in`) only, via `user_id` + `password` + `tan`.
- The page is `/app/ded/stmtstatus.xhtml` ("Statement Filed Status"). Its jqGrid is fed by

  ```
  POST /app/ded/srv/DedStmtStatusServlet?financialYear=<startYear>&quarter=<3..6>&formType=<24Q|26Q|27Q|27EQ>&reqType=1
  body: _search=false&nd=<ts>&rows=100&page=<n>&sidx=&sord=asc
  ```

  answering `{ totalpages, page, rowCount, rows: [{ finyear, quarter, formtype, tokenno,
  dtoffiling, status, dtofprcng, stmnttype, remarks?, reason? }] }`.

  We load the page once per company and call the servlet directly with
  `credentials: "same-origin"`, rather than driving three selects and Go 16 times.
- **Quarter encoding**: the *request* uses the portal codes `Q1=3, Q2=4, Q3=5, Q4=6` (same as
  `qToPortalQuarter()` in `src/shared/excel/periods.ts`); the *response* is already normalised
  to `Q1`–`Q4` and `2025-26`, so persisted `ReturnStatus` rows need no translation.
- An **e-filing cross-check** (`eportal.incometax.gov.in` "View Filed Forms", which reports
  `filingTypeCd` Original/Correction plus `ackDt`) is available through the existing
  `src/scripts/fetchRrrNumbers.ts` and wrapped by `src/scripts/fetchClause34EfilingRrr.ts`.
  It is **not currently usable for this group**: the IT password on file is rejected with
  `EF00027`. Supply working credentials and re-run to enable two-source verification.

## 5. File Input / Output
- Input: none through the UI. `importClause34Companies.ts` accepts the canonical 5-column
  credentials workbook (`Company Name, Tan, IT Password, User ID, Password`).
- Output: `public/pdf/clause34/Clause 34(b) and 34(c) - <group> - FY <fy> (verified).xlsx`,
  **24 sheets** — Summary, Due Dates, `34(c) Challans`, `34(c) Workings`, one per entity.
- Raw portal JSON per entity: `public/pdf/clause34/statement-status/<TAN>_<fy>.json`.
- Reconciliation report: `public/pdf/clause34/reconciliation/`.
- Crawl artefacts: `public/pdf/clause34/traces-crawl/`.
- **Excel library**: `exceljs` (added for this feature). SheetJS, used everywhere else in the
  repo, cannot write cell styles, and this workbook's fills/fonts/number formats carry meaning.
  SheetJS is still used for *reading* the previous workbook.

## 6. Key Files & Components
- Page: `src/pages/clause-34b/index.tsx`
- APIs: `src/pages/api/clause-34b/{fetch,build}.ts`
- Domain: `src/clause34/`
  - `continuumGroup.ts` — the entity roster (TAN, PAN, sheet name)
  - `workbookStyle.ts` — style tokens read out of the client's own workbook
  - `originalWorkbook34c.ts` — reader for the 34(c) sheets, with tie-out assertions
  - `build34cRows.ts` — 34(c) rows + re-verification against local conso files
  - `consoTdsParser.ts` — conso `.tds` challan parser
  - `clause34cSheets.ts` — the two 34(c) sheets and the per-company 34(c) block
  - `dueDates.ts` — Rule 31A(2) due dates, portal date parsing
  - `fetchStatementStatus.ts` — the TRACES extractor + `ReturnStatus` persistence
  - `originalWorkbook.ts` — reader for the previously prepared workbook
  - `buildClause34Rows.ts` — reconciliation
  - `clause34Workbook.ts` — ExcelJS generator
- Reused: `src/jobs/traces/*` (`loginWithTracesApiAndPreauth`, `traces61DedUrl`,
  `attachTraces61RedirectGuard`), `ReturnStatus` model in `db/schema.prisma`.

## 7. Notes / Observations
- **Column (d) must be the *original* statement's date.** TRACES returns one record per
  statement tagged `stmnttype` `Regular` / `Correction`; the Regular record answers clause
  34(b)(d). A conso file header cannot, because once a correction exists it carries only the
  latest correction's date — which is why 24 rows of the previous working paper were estimated
  or blank.
- **Conso header dates are not filing dates.** For FY 2025-26 Q4, entities with no corrections
  all carried an identical `05-06-2026` in the conso header while Statement Filed Status
  reported distinct dates per entity (25–28 May 2026). An identical date across independent
  entities cannot be a per-statement furnishing date.
- **Tokens are masked** by the portal as first-4 + `X…` + last-4. `tokenMatches()` compares a
  masked token to a full one, and the generator restores the full token from the previous
  workbook when the two are consistent.
- **Sessions expire mid-sweep**, answering `410 Gone`. The extractor escalates reload → re-login,
  and spends one throwaway "warm-up" call after login because the first servlet call after the
  preauth cookie bridge usually fails.
- **A failed combination is never reported as "no statement filed"** — the two are tracked
  separately (`emptyCombinations` vs `failedCombinations`), because conflating them would
  understate a disclosure.
- Form 27EQ (TCS) follows Rule 31AA, not Rule 31A(2), so it is excluded from the Due Dates table.
- Captcha solving depends on `${SERVER_URL}/captcha/decode`; rapid repeat logins make it miss, so
  the batch spaces logins out.

## 8. Clause 34(c)

### Method
Columns (2) *interest payable* and (3) *amount paid* are both the interest shown against each
challan **in the TDS return**; column (4) is that challan's date. One reported row per challan.
An entity is "liable" where its returns show interest.

### Provenance
34(c) is **carried forward** from the prepared workbook, which is the extraction of record — the
conso files behind it are only partly still available. `originalWorkbook34c.ts` tie-checks the
totals on every load (₹1,70,373 as per returns, ₹2,17,096 recomputed) and throws on drift, so a
changed source workbook fails the build rather than reaching a disclosure. Where a conso file
*is* held, `build34cRows.ts` re-parses the challan and compares every field; each row is marked
verified or carried-forward, and the workbook says which.

### The conso `.tds` challan record — two corrections
`NoticeDownloader-conso.ts` (and its three copies) get this wrong in two ways, which is why
`consoTdsParser.ts` exists:

1. It collapses `^^+` into one `^` before splitting. That destroys empty fields, and since
   records carry different numbers of empties, it shifts columns by a **different amount per
   record** — some challans parse as garbage (a BSR code landing in the challan-number column).
2. It maps `Interest` to field 12 of the collapsed record, which is not interest.

Correct offsets on the raw (uncollapsed) record, verified against 13 challans whose values are
independently known, and against 300 challans whose components sum to the stated total:

```
[1]  "CD"                     [21] tax           [24] interest charged on the challan
[3]  challan serial           [22] surcharge     [25] fee u/s 234E
[11] challan number (CSN)     [23] cess          [26] total deposited (= 21+22+23+24+25)
[15] BSR code                                    [33] interest allocated in the TDS return
[17] challan date DDMMYYYY
```

`[24]` vs `[33]` is the distinction clause 34(c) turns on: what the challan carries, versus what
the return actually claimed against it. They differ when a deductor pays interest without
claiming it, or claims interest out of an older challan's balance.

### Not covered
Interest on **short deduction** is outside the returns-based method. That needs the TRACES
Justification Report, which this repo downloads but has never parsed (the existing code applies
the conso `CD`/`DD` parser to it and silently returns zero rows). `viewdemandsum.xhtml`
("Default Summary", FY + quarter filtered, reachable, unused by any code) is the better next
candidate. See `docs/clause34/CLAUSE-34-DATA-STATUS.md`.
