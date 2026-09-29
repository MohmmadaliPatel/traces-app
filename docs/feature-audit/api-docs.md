# Page Audit: /api-docs

## 1. Overview
- Full route path: `/api-docs`
- Purpose of the page: Interactive Swagger UI for REST API documentation (`docs/openapi.yaml`).
- Access control / authentication requirements (if any): `ApiDocsPage.authenticate = { redirectTo: "/auth/login" }`. **Not in sidebar**.
- Whether it is client-side only, server-rendered, or hybrid: Client-side Swagger UI (`dynamic` import, SSR disabled).

## 2. Features
- Feature name: Swagger UI
- Short description: Browse/try REST endpoints described in OpenAPI.
- How it works: Loads `/docs/openapi.yaml` into swagger-ui-react (or equivalent) with SSR off.
- Related API routes / server actions / server components: Documents routes under `src/pages/api/**`; points users to `docs/API.md` for Blitz RPC reference.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Dynamic client-only Swagger mount.
- Server-side logic: None on page.
- **Background processes**: None.

## 4. Portal Support
- Does this page/feature support multiple portals? Documentation may describe portal credential shapes (e.g. OpenAPI `PortalCredentials` for TRACES-backed routes).
- Which portals are supported? As documented in OpenAPI (TRACES credential objects for TLDC/outstanding/return-status style APIs; challan IT portal APIs separately).
- How is portal selection / switching implemented? N/A on this page.
- Any recent portal-related changes or new portal support? OpenAPI may lag newer routes (Form140/RRR/new-act TLDC) — verify against live `docs/openapi.yaml`.
- Portal-specific logic, configurations, or conditional rendering: None.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No (docs only). OpenAPI may document `POST /api/file/upload`.
- Accepted formats: N/A.
- Expected column structure / headers: N/A.
- Validation rules: N/A.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: N/A.
- Error handling for invalid files: N/A.

## 6. Key Files & Components
- Page file path: `src/pages/api-docs.tsx`
- Important components used: Swagger UI (dynamic).
- Related API routes / server actions: All REST routes in `src/pages/api/`.
- Shared utilities: `docs/openapi.yaml`, `docs/API.md`.

## 7. Notes / Observations
- No app Layout/sidebar shell (padded bare page).
- Useful for Bearer/`tt_` token REST auth testing alongside session cookies.
