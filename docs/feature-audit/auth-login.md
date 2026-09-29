# Page Audit: /auth/login

## 1. Overview
- Full route path: `/auth/login`
- Purpose of the page: User authentication (email/password) into the Blitz session.
- Access control / authentication requirements (if any): Public. `LoginPage.authenticate` is not set (no forced redirect away if already logged in).
- Whether it is client-side only, server-rendered, or hybrid: Client-side form; login mutation creates server session.

## 2. Features
- Feature name: Login form
- Short description: Collects email and password; establishes session on success.
- How it works (UI + backend flow): `LoginForm` calls Blitz `login` mutation → `ctx.session.$create` → stores public session data in `localStorage` → `onSuccess` redirects.
- Related API routes / server actions / server components: Blitz RPC `src/auth/mutations/login` via `/api/rpc`.

- Feature name: Post-login redirect
- Short description: Respects `?next=` query param or defaults to Conso Files.
- How it works: Decodes `router.query.next` if present; otherwise pushes `/conso-files`.
- Related API routes / server actions / server components: None.

## 3. Scripts & Background Processes
- Client-side scripts / hooks / effects: Router query read for `next`; form submit handler.
- Server-side logic: Login mutation validates credentials and creates session (no `resolver.authorize()`).
- **Background processes**: None.

## 4. Portal Support
- Does this page/feature support multiple portals? No — this is app-user auth, not government portal login.
- Which portals are supported? N/A.
- How is portal selection / switching implemented? N/A.
- Any recent portal-related changes or new portal support? N/A.
- Portal-specific logic, configurations, or conditional rendering: None. (Commented sample portal credentials exist in the page file; not used by UI.)

## 5. File Input Support (Excel / CSV)
- Does the page accept file uploads? No.
- Accepted formats: N/A.
- Expected column structure / headers: N/A.
- Validation rules: Client: email required (type email), password required. Server: Zod `Login` schema.
- Parsing library used: N/A.
- Differences compared to other pages that also accept Excel/CSV: N/A.
- Error handling for invalid files: N/A. Invalid credentials show “Sorry, those credentials are invalid”.

## 6. Key Files & Components
- Page file path: `src/pages/auth/login.tsx`
- Important components used: `src/auth/components/LoginForm.tsx`
- Related API routes / server actions: Blitz RPC login mutation.
- Shared utilities: `LOCALSTORAGE_PUBLIC_DATA_TOKEN` for client session public data.

## 7. Notes / Observations
- Does not wrap app `Layout` (no sidebar).
- Other pages redirect here via `authenticate = { redirectTo: "/auth/login" }` or after RPC `AuthenticationError`.
