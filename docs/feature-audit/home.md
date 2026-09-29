# Page Audit: /

## 1. Overview
- Full route path: `/`
- Purpose of the page: Landing/home route that immediately redirects users to `/conso-files`. Renders nothing.
- Access control / authentication requirements (if any): None on the page itself; destination `/conso-files` requires login.
- Whether it is client-side only, server-rendered, or hybrid: Client-side redirect via `useEffect` + `router.push`.

## 2. Features
- Feature name: Auto-redirect to Conso Files
- Short description: On mount, navigates to the default operational page.
- How it works (UI + backend flow): `useEffect` calls `router.push("/conso-files")`; component returns `null`.
- Related API routes / server actions / server components: None.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: `useEffect` depending on `router`.
- Server-side logic: None.
- **Background processes**: None.

## 4. Portal Support
- Does this page/feature support multiple portals? No.
- Which portals are supported? N/A.
- How is portal selection / switching implemented? N/A.
- Any recent portal-related changes or new portal support? N/A.
- Portal-specific logic, configurations, or conditional rendering: None.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A.
- Expected column structure / headers: N/A.
- Validation rules: N/A.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: N/A.
- Error handling for invalid files: N/A.

## 6. Key Files & Components
- Page file path: `src/pages/index.tsx`
- Important components used: None (returns null).
- Related API routes / server actions: None.
- Shared utilities: Next.js `useRouter`.

## 7. Notes / Observations
- Default post-login landing is also `/conso-files` (see auth login).
- Not listed in sidebar; users rarely land here except via `/` URL.
