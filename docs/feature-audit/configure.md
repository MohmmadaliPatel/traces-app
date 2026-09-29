# Page Audit: /configure

## 1. Overview
- Full route path: `/configure`
- Purpose of the page: Enter/save product license key bound to the machine ID (reads/writes `.env.production`).
- Access control / authentication requirements (if any): No Blitz `authenticate` on page; typically reached when license is missing/expired.
- Whether it is client-side only, server-rendered, or hybrid: Hybrid — `getServerSideProps` loads machine ID and existing LICENSE; client form saves via mutation.

## 2. Features
- Feature name: Display Machine ID
- Short description: Shows read-only machine identifier for license binding.
- How it works: SSR via `getMachineIdWithFallack()`; form field disabled/read-only.
- Related API routes / server actions / server components: `getServerSideProps` in page file.

- Feature name: License key entry & validation feedback
- Short description: JWT license input with live expiry/validity messaging.
- How it works: Client `jwt_decode` on input; shows expired/valid/invalid token messages using `dayjs`.
- Related API routes / server actions / server components: None for decode (client-only).

- Feature name: Save configuration
- Short description: Persists LICENSE and MACHINE_ID.
- How it works: Form submit → Blitz `saveConfig` mutation → success/error toast.
- Related API routes / server actions / server components: `src/auth/mutations/saveConfig`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: `useMemo` for JWT decode and token message; form submit handler.
- Server-side logic: `getServerSideProps` parses `.env.production` with `dotenv` and reads machine ID.
- **Background processes**: None.

## 4. Portal Support
- Does this page/feature support multiple portals? No — application license only.
- Which portals are supported? N/A.
- How is portal selection / switching implemented? N/A.
- Any recent portal-related changes or new portal support? N/A.
- Portal-specific logic, configurations, or conditional rendering: None.

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A.
- Expected column structure / headers: N/A.
- Validation rules: Machine ID and LICENSE KEY required.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: N/A.
- Error handling for invalid files: N/A. Invalid JWT shows “Invalid Token” / expiry message.

## 6. Key Files & Components
- Page file path: `src/pages/configure/index.tsx`
- Important components used: Ant Design Form/Card/Input.
- Related API routes / server actions: `src/auth/mutations/saveConfig`; related license API `src/pages/api/env/license.ts`.
- Shared utilities: `src/utils/machineid`, `jwt-decode`, `dayjs`.

## 7. Notes / Observations
- Not in sidebar; linked from `/auth/license-expired`.
- Title typo in UI: “Configuation”.
- Depends on writable `.env.production` on the host machine.
