# Page Audit: /smtp-configs

## 1. Overview
- Full route path: `/smtp-configs`
- Purpose of the page: Configure outbound SMTP for Form 16 (and related) email delivery; mark one config as active.
- Access control / authentication requirements (if any): No page-level `Page.authenticate`. CRUD RPCs use `resolver.authorize()`. Test endpoint uses `withApiAuth`. Listed in sidebar.
- Whether it is client-side only, server-rendered, or hybrid: Client-side Blitz page + REST test call; embeds `<Layout>` as JSX.

## 2. Features
- Feature name: List SMTP configurations
- Short description: Table of name, host, port, secure, from email, active status.
- How it works: `useQuery(getSmtpConfigs)`; client search; banner when an active config exists.
- Related API routes / server actions / server components: `src/smtp-configs/queries/getSmtpConfigs.ts`.

- Feature name: Add / Edit / Delete config
- Short description: Modal form for SMTP settings; only one active config intended.
- How it works: `createSmtpConfig` / `updateSmtpConfig` / `deleteSmtpConfig`. On create/update with `isActive: true`, other configs deactivated via `updateMany`.
- Related API routes / server actions / server components: mutations under `src/smtp-configs/mutations/`.

- Feature name: Test SMTP connection
- Short description: Verify host credentials without sending a message.
- How it works: Per-row “Test” → `POST /api/smtp-test` with `{ host, port, secure, user, password }` → `nodemailer` `verify()`.
- Related API routes / server actions / server components: `src/pages/api/smtp-test.ts`.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Form/modal state; `fetch` for test. No polling.
- Server-side logic: Active-flag exclusivity; Nodemailer verify on test API.
- **Background processes**: None (no queue). Email sending is triggered from Form 16 page, not here.

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
- Validation rules: Form fields — name, host, port (1–65535, default 587), secure switch (default true), user, password, fromEmail (email), isActive switch.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: N/A.
- Error handling for invalid files: N/A. Test failures return `{ success, message }` and toast errors.

## 6. Key Files & Components
- Page file path: `src/pages/smtp-configs/index.tsx`
- Important components used: Ant Design Table, Modal, Form, Switch; app `Layout`.
- Related API routes / server actions: `/api/smtp-test`; Blitz SMTP CRUD RPCs.
- Shared utilities: `nodemailer` (API route).

## 7. Notes / Observations
- Suspected bug: `updateSmtpConfig` may destructure `isActive` out of update payload so toggling active on edit may not persist on the target row.
- Test action shares global `loading` state with the whole table.
- Consumer dependency: Form 16 “Manual Email Trigger”.

## Post-refactor notes (Phases 1–5)
- Page auth: `SmtpConfigsPage.authenticate` added.
- Fixed: `updateSmtpConfig` persists `isActive`.
- SMTP test API uses `withApiAuth` from `src/shared/http`.
