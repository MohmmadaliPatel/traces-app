# Page Audit: /ldc-utilisation

## 1. Overview
- Full route path: `/ldc-utilisation`
- Purpose of the page: Show Lower Deduction Certificate utilisation (limit vs consumed vs remaining / %) from stored TLDC data; export Excel/CSV/PDF.
- Access control: `LdcUtilisationPage.authenticate = { redirectTo: "/auth/login" }`. Listed in sidebar next to TLDC.
- Client Blitz page; data via `getLdcUtilisation` RPC; exports via `POST /api/export/ldc-utilisation`.

## 2. Features
- Feature name: Utilisation table
- Short description: Per-certificate amount limit, consumed, remaining, utilisation %.
- How it works: Reads `TldcData`; computes remaining = limit − consumed; utilisationPct = consumed / limit (0 if limit is 0).
- Related: `src/tldc/queries/getLdcUtilisation.ts`.

- Feature name: Filters
- Short description: Company, FY, text search (cert / PAN / name / section).
- How it works: Passed into RPC `where` / `search`.

- Feature name: Export Excel / PDF / CSV
- Short description: Shared export buttons.
- How it works: `ExportButtons` → `POST /api/export/ldc-utilisation`.

## 3. Scripts & Background Processes
- No queue. Refresh of underlying amounts is done on `/tldc` (portal fetch/update).

## 4. Portal Support
- Does not call portals directly. Relies on TLDC Old/New Act fetch already persisted in DB.

## 5. File Input Support
- Export only (no upload).

## 6. Key Files
- Page: `src/pages/ldc-utilisation/index.tsx`
- Query: `src/tldc/queries/getLdcUtilisation.ts`
- Export: `src/shared/export/buildFeatureTable.ts` (`ldc-utilisation`), `src/pages/api/export/[feature].ts`
- Nav: `src/core/layouts/Layout.tsx`

## 7. Notes
- No new Prisma model — derived view of `TldcData`.
