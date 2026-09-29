# Page Audit: /auth/license-expired

## 1. Overview
- Full route path: `/auth/license-expired`
- Purpose of the page: Inform the user that the product license JWT has expired and point them to license configuration.
- Access control / authentication requirements (if any): None on the page itself.
- Whether it is client-side only, server-rendered, or hybrid: Client-rendered Ant Design card.

## 2. Features
- Feature name: License expired message
- Short description: Static message with link to configure a new license key.
- How it works (UI + backend flow): Renders Card + Link/Button to `/configure`.
- Related API routes / server actions / server components: None on this page (license checks occur elsewhere via env/JWT).

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: None.
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
- Page file path: `src/pages/auth/license-expired.tsx`
- Important components used: Ant Design `Layout`, `Card`, `Button`; Next `Link`.
- Related API routes / server actions: Related flow continues on `/configure` and `src/auth/mutations/saveConfig`.
- Shared utilities: None.

## 7. Notes / Observations
- Uses bare Ant Design `Layout`, not the app sidebar `src/core/layouts/Layout.tsx`.
- Pair with `/configure` for machine ID + LICENSE JWT entry.
