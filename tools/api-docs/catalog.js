/**
 * Single source for the client API pack: Postman collection, OpenAPI/Swagger spec and the
 * endpoint reference workbook are all generated from this list (see build.js).
 *
 * Each endpoint: folder (Postman path), method, path, summary, description, mode,
 * request (query / path / body schema + named examples) and every documented response.
 * RPC endpoints (`rpc: true`) declare `params` and `result`; build.js wraps them in the
 * Blitz envelope ({ params, meta } → { result, error, meta }).
 */
const { str, int, num, bool, arr, obj, ref, nullable } = require("./schemas")

const CREDS = { userId: "MUMB12345E", password: "********", tan: "MUMB12345E" }
const COMPANY = { name: "Example Deductor Pvt Ltd", tan: "MUMB12345E", it_password: "********", user_id: "MUMB12345E", password: "********" }

const unauthorized = { status: 401, description: "Missing or invalid API token", schema: ref("Unauthorized"), example: { error: "Unauthorized" } }
const methodNotAllowed = { status: 405, description: "Wrong HTTP method", schema: ref("ErrorMessage"), example: { error: "Method not allowed" } }
const companyNotFound = { status: 404, description: "Unknown companyId", schema: ref("ErrorMessage"), example: { error: "Company not found" } }
const missingCompany = { status: 400, description: "companyId missing", schema: ref("ErrorMessage"), example: { error: "Missing company ID" } }
const portal500 = (msg) => ({ status: 500, description: "Portal automation or server failure", schema: ref("SuccessFalseError"), example: { success: false, error: msg } })
const plain500 = (msg) => ({ status: 500, description: "Portal automation or server failure", schema: ref("ErrorMessage"), example: { error: msg } })

const tldcErr = (status, code, message, retryable, description) => ({
  status, description, schema: ref("TldcError"), example: { success: false, errorCode: code, message, retryable },
})
const tldcErrors = [
  tldcErr(400, "LDC_INVALID_INPUT", "Missing required parameters (tan, fy, companyId, credentials)", false, "Invalid input"),
  tldcErr(401, "LDC_AUTH_INVALID", "TRACES login failed (non-retryable): ... Invalid User ID / Password", false, "TRACES rejected the credentials (an invalid API token returns { error: \"Unauthorized\" } instead)"),
  tldcErr(502, "LDC_CAPTCHA_FAILED", "TRACES login failed after 5 attempts: CPT403 ...", true, "Captcha not solved in 5 attempts, TRACES session ended (LDC_SESSION_EXPIRED) or PDF download failed (LDC_PDF_DOWNLOAD_FAILED)"),
  tldcErr(503, "LDC_PORTAL_UNAVAILABLE", "searchDeductor HTTP 503: ...", true, "TRACES or captcha service unavailable (LDC_PORTAL_UNAVAILABLE / LDC_CAPTCHA_SERVICE_UNAVAILABLE)"),
  tldcErr(504, "LDC_TIMEOUT", "TimeoutError: Navigation timeout of 30000 ms exceeded", true, "TRACES did not respond in time"),
  tldcErr(500, "LDC_INTERNAL_ERROR", "Unexpected error", true, "Unexpected server error"),
]
const tldcRecordExample = {
  id: 11, companyId: 1, act: "new", fy: "2026-27", certNumber: "4AD0426ILB4A140", din: "4AD0426ILB",
  pan: "ABCDE1234F", panName: "EXAMPLE VENDOR LLP", section: "1027", sectionDesc: "393(1) [Table: Sl. No. 6(iii).D(b)]",
  natureOfPayment: "Any sum by way of (a) fees for professional services; or (b) any sum referred to in section 26(2)(h) - other than Specified person",
  tdsRate: 3, tdsAmountLimit: 900000, tdsAmountConsumed: 0, tdsAmountBalance: 900000,
  issueDate: "20-03-2026", validFrom: "24-04-2026", validTo: "31-03-2027", cancelDate: null, isActive: true,
  pdfUrl: "/api/file/pdf/child-certificates/Example%20Deductor%20Pvt%20Ltd/298942.pdf", lastSyncedAt: "2026-07-30T11:05:36.144Z",
}
const tldcOldRecordExample = {
  ...tldcRecordExample, id: 7, act: "old", fy: "2024-25", certNumber: "1234567890ABC", din: "DIN0001",
  section: "94J", sectionDesc: "194J", natureOfPayment: "Fees for professional or technical services", tdsRate: 2,
  tdsAmountLimit: 500000, tdsAmountConsumed: 125000, tdsAmountBalance: 375000,
  issueDate: "15-04-2024", validFrom: "15-04-2024", validTo: "31-03-2025",
  pdfUrl: "/api/file/pdf/tldc-downloads/certificates/1234567890ABC.pdf", lastSyncedAt: "2024-05-02T09:12:44.000Z",
}

const progressExample = {
  batchId: 42, createdAt: "2026-10-12T08:00:00.000Z", actionType: "send_request",
  counts: { total: 4, queued: 1, inProgress: 1, finished: 1, failed: 1, other: 0 }, percent: 50, isComplete: false,
  items: [
    { taskId: 101, status: "Finished", companyName: "Example Deductor Pvt Ltd", tan: "MUMB12345E", financialYear: "2025-26", quarter: "Q1", formType: "26Q", errorMessage: null, updatedAt: "2026-10-12T08:03:11.000Z" },
    { taskId: 102, status: "Failed", companyName: "Example Deductor Pvt Ltd", tan: "MUMB12345E", financialYear: "2025-26", quarter: "Q2", formType: "26Q", errorMessage: "TRACES login failed", updatedAt: "2026-10-12T08:04:02.000Z" },
  ],
}
const batchCreated = { message: "Companies added to queue successfully", batchId: 42, companyCount: 1, taskCount: 2 }

const SYNC = "Synchronous: the HTTP call stays open until the portal work finishes (typically 1-10 minutes). Use a client timeout of at least 15 minutes."
const ASYNC = "Asynchronous: returns a batchId immediately. Poll the Job monitoring calls (or the conso progress stream) until every task is Finished or Failed, then download files with GET /api/file/{path}."
const RPC_NOTE = "RPC call: body is { \"params\": {...}, \"meta\": {} }. Success is { \"result\": ..., \"error\": null }. Resolver errors (validation, not found, not logged in) also return HTTP 200 with \"result\": null and an \"error\" object; check \"error\" on every response."

const exportFeatureEnum = ["tldc", "ldc-utilisation", "outstanding-demand", "return-status", "rrr", "form140", "deductee-masters"]

const catalog = [
  // ═══════════════════════════════ 0. AUTH ═══════════════════════════════
  {
    folder: ["0. Auth"], name: "Login (session)", method: "POST", path: "/api/rpc/login", tags: ["Auth"], rpc: true, mode: "read",
    summary: "Log in with application email and password (one-time, to create an API token)",
    description: "Public. Creates a browser session (cookies) and returns an `anti-csrf` response header. The session is only needed to call createApiToken; use the API token for everything else. Wrong email or password returns an AuthenticationError in the RPC envelope.",
    params: obj({ email: str("Application user email", "user@example.com", { format: "email" }), password: str("Application password", "********", { format: "password" }) }, ["email", "password"]),
    paramsExample: { email: "user@example.com", password: "********" },
    result: obj({
      user: obj({ id: int("User id", 1), createdAt: str("ISO", "2025-01-02T10:00:00.000Z"), updatedAt: str("ISO", "2026-10-01T10:00:00.000Z"), name: nullable(str("Name", "Example User")), email: str("Email", "user@example.com"), role: str("Role", "USER", { enum: ["USER", "ADMIN"] }) }),
      publicData: obj({ userId: int("User id", 1), role: str("Role", "USER") }),
    }, ["user", "publicData"]),
    resultExample: { user: { id: 1, createdAt: "2025-01-02T10:00:00.000Z", updatedAt: "2026-10-01T10:00:00.000Z", name: "Example User", email: "user@example.com", role: "USER" }, publicData: { userId: 1, role: "USER" } },
    rpcErrorExample: { name: "AuthenticationError", message: "You must be logged in to access this", code: null, statusCode: 401, meta: null, url: null },
    postman: { noauth: true, cookies: true, test: ["const t = pm.response.headers.get('anti-csrf');", "if (t) { pm.environment.set('antiCsrf', t); }"] },
    noBearer: true,
  },
  {
    folder: ["0. Auth"], name: "Create API token", method: "POST", path: "/api/rpc/createApiToken", tags: ["Auth"], rpc: true, mode: "read",
    summary: "Create a long-lived API token (shown once)",
    description: "Needs the session from Login (cookie + `anti-csrf` header) or an existing API token. The token value is returned only in this response; only its hash is stored. Omit expiresInDays for a token that never expires.",
    params: obj({ name: str("Label, 1-100 characters", "TOE integration"), expiresInDays: int("Days until expiry (optional)", 365, { minimum: 1 }) }, ["name"]),
    paramsExample: { name: "TOE integration", expiresInDays: 365 },
    result: obj({ id: int("Token id", 3), name: str("Label", "TOE integration"), prefix: str("First 11 characters, for identification", "tt_9f2c1a7b"), token: str("API token. Store securely; it is not shown again.", "tt_9f2c1a7b0d3e4f5a6b7c8d9e0f1a2b3c"), expiresAt: nullable(str("Expiry (ISO)", "2027-10-12T08:00:00.000Z")), createdAt: str("ISO", "2026-10-12T08:00:00.000Z") }, ["id", "name", "prefix", "token"]),
    resultExample: { id: 3, name: "TOE integration", prefix: "tt_9f2c1a7b", token: "tt_9f2c1a7b0d3e4f5a6b7c8d9e0f1a2b3c", expiresAt: "2027-10-12T08:00:00.000Z", createdAt: "2026-10-12T08:00:00.000Z" },
    postman: { noauth: true, cookies: true, headers: [{ key: "anti-csrf", value: "{{antiCsrf}}" }], test: ["const r = pm.response.json();", "if (r.result && r.result.token) { pm.environment.set('apiToken', r.result.token); }"] },
  },
  {
    folder: ["0. Auth"], name: "List API tokens", method: "POST", path: "/api/rpc/getApiTokens", tags: ["Auth"], rpc: true, mode: "read",
    summary: "List the current user's API tokens", description: "The secret value is never returned again.",
    params: obj({}), paramsExample: {},
    result: obj({ tokens: arr(obj({ id: int("Id", 3), name: str("Label", "TOE integration"), prefix: str("Prefix", "tt_9f2c1a7b"), expiresAt: nullable(str("ISO", "2027-10-12T08:00:00.000Z")), lastUsedAt: nullable(str("ISO", "2026-10-12T09:30:00.000Z")), createdAt: str("ISO", "2026-10-12T08:00:00.000Z") }), "Newest first") }, ["tokens"]),
    resultExample: { tokens: [{ id: 3, name: "TOE integration", prefix: "tt_9f2c1a7b", expiresAt: "2027-10-12T08:00:00.000Z", lastUsedAt: "2026-10-12T09:30:00.000Z", createdAt: "2026-10-12T08:00:00.000Z" }] },
  },
  {
    folder: ["0. Auth"], name: "Revoke API token", method: "POST", path: "/api/rpc/revokeApiToken", tags: ["Auth"], rpc: true, mode: "read",
    summary: "Revoke (delete) an API token", description: "Token id from List API tokens. A token of another user returns NotFoundError.",
    params: obj({ id: int("Token id", 3, { minimum: 1 }) }, ["id"]), paramsExample: { id: 3 },
    result: obj({ success: bool("Always true", true) }, ["success"]), resultExample: { success: true },
    rpcErrorExample: { name: "NotFoundError", message: "This could not be found", code: null, statusCode: 404, meta: null, url: null },
  },

  // ═══════════════════════════════ 1. LDC ═══════════════════════════════
  {
    folder: ["1. LDC - Lower Deduction Certificates"], name: "Fetch certificates - New Act", method: "POST", path: "/api/tldc/fetch-data-new-act", tags: ["LDC"], mode: "sync",
    summary: "Fetch LDC certificates from TRACES (Income-tax Act 2025, tax year 2026-27 onwards)",
    description: `${SYNC}\n\nSteps: TRACES login (captcha solved automatically) → search certificates → download ready PDFs → raise download requests for missing PDFs → read certificate details → save. Certificates whose PDF TRACES has not prepared yet are listed in data.missingCertNumbers (their rows are still saved; call again later to collect the PDFs). Saved on (companyId, certNumber, fy), so repeat calls never duplicate.`,
    body: obj({
      tan: str("Deductor TAN", "MUMB12345E"),
      fy: str("Tax year: \"2026-27\", \"2026\" or \"2026-2027\"", "2026-27"),
      companyId: int("Deductor company id", 1),
      credentials: ref("PortalCredentials"),
      companyName: str("Optional; folder name for PDFs (defaults to the company name)", "Example Deductor Pvt Ltd"),
      initiateIfNoRequest: bool("Raise TRACES download requests only when none exist (default true)", true),
      forceInitiate: bool("Raise download requests for all certificates (default false)", false),
    }, ["tan", "fy", "companyId", "credentials"]),
    examples: [{ name: "Fetch certificates - New Act", body: { tan: "MUMB12345E", fy: "2026-27", companyId: 1, initiateIfNoRequest: true, forceInitiate: false, credentials: CREDS } }],
    responses: [
      { status: 200, description: "Fetched and saved", schema: obj({
        success: bool("true", true), message: str("Summary", "New Act TLDC: 1 created, 0 updated, 0 missing in PDFs"),
        data: obj({
          created: int("Rows created", 1), updated: int("Rows updated", 0), searchCount: int("Certificates found on TRACES", 1),
          downloadedPdfs: int("PDFs downloaded", 1),
          parsedPdfs: arr(obj({ pdfPath: str("Server path", "..."), reqId: str("TRACES request id", "298942"), certNumber: nullable(str("Cert no. read from PDF", "4AD0426ILB4A140")), pan: nullable(str("PAN", "ABCDE1234F")), panName: nullable(str("Name", "EXAMPLE VENDOR LLP")) }), "PDFs read in this run"),
          missingCertNumbers: arr({ type: "string" }, "Certificates whose PDF is not ready yet"),
          initiated: arr(obj({ childCertNum: str("Cert no.", "4AD0426ILB4A141"), requestId: str("TRACES request id", "299001"), status: str("Status", "Submitted"), error: str("Error", undefined) }), "Download requests raised"),
          pdfDir: str("Server folder of the PDFs", ".../child-certificates/Example Deductor Pvt Ltd"),
          records: arr(ref("TldcRecord"), "Certificates saved in this run"),
          warnings: arr(ref("TldcWarning"), "Per-certificate problems"),
        }),
      }, ["success", "message", "data"]), example: { success: true, message: "New Act TLDC: 1 created, 0 updated, 0 missing in PDFs", data: { created: 1, updated: 0, searchCount: 1, downloadedPdfs: 1, parsedPdfs: [{ pdfPath: "/srv/app/public/pdf/child-certificates/Example Deductor Pvt Ltd/298942.pdf", reqId: "298942", certNumber: "4AD0426ILB4A140", pan: "ABCDE1234F", panName: "EXAMPLE VENDOR LLP" }], missingCertNumbers: [], initiated: [], pdfDir: "/srv/app/public/pdf/child-certificates/Example Deductor Pvt Ltd", records: [tldcRecordExample], warnings: [] } } },
      ...tldcErrors, unauthorized,
    ],
  },
  {
    folder: ["1. LDC - Lower Deduction Certificates"], name: "Refresh certificates - New Act", method: "POST", path: "/api/tldc/update-data-new-act", tags: ["LDC"], mode: "sync",
    summary: "Refresh stored new-Act certificates (consumed amount, dates, active flag, PDF link)",
    description: `${SYNC}\n\nRe-reads every stored certificate for the company/FY (or one recordId) from TRACES. Picks up only certificates already stored; use Fetch to find new ones. Always pass companyId (without companyId, fy or recordId it refreshes every company's certificates).`,
    body: obj({
      tan: str("Deductor TAN", "MUMB12345E"), credentials: ref("PortalCredentials"),
      companyId: int("Company id (recommended)", 1), fy: str("Tax year, exact stored value e.g. \"2026-27\"", "2026-27"),
      recordId: int("Refresh one row only", undefined), companyName: str("Optional PDF folder name", undefined),
    }, ["tan", "credentials"]),
    examples: [{ name: "Refresh certificates - New Act", body: { tan: "MUMB12345E", fy: "2026-27", companyId: 1, credentials: CREDS } }],
    responses: [
      { status: 200, description: "Refreshed", schema: obj({ success: bool("true", true), message: str("Summary", "New Act TLDC updated 1 record(s)"), data: obj({ updated: int("Rows updated", 1), fetched: int("Details read from TRACES", 1), records: arr(ref("TldcRecord"), "All selected certificates after refresh"), warnings: arr(ref("TldcWarning"), "Certificates TRACES did not return") }) }, ["success", "message", "data"]),
        example: { success: true, message: "New Act TLDC updated 1 record(s)", data: { updated: 1, fetched: 1, records: [tldcRecordExample], warnings: [] } } },
      ...tldcErrors.map((e) => (e.status === 400 ? { ...e, example: { ...e.example, message: "Missing required parameters (tan, credentials)" } } : e)), unauthorized,
    ],
  },
  {
    folder: ["1. LDC - Lower Deduction Certificates"], name: "Fetch certificates - Old Act", method: "POST", path: "/api/tldc/fetch-data", tags: ["LDC"], mode: "sync",
    summary: "Fetch LDC certificates from TRACES (Income-tax Act 1961, FY up to 2025-26)",
    description: `${SYNC}\n\nReads the TRACES 197 inbox, downloads each new certificate PDF (kept as certificates/{certNumber}.pdf), then verifies every certificate on the 197 certificate verification page (section, nature, rate, limit, consumed, dates, cancellation). A certificate with a cancel date is saved with isActive=false. Certificates already stored for the company and FY are not downloaded again.`,
    body: obj({ tan: str("Deductor TAN", "MUMB12345E"), year: str("FY start year: \"2024\" for 2024-25", "2024"), companyId: int("Company id", 1), credentials: ref("PortalCredentials") }, ["tan", "year", "companyId", "credentials"]),
    examples: [{ name: "Fetch certificates - Old Act", body: { tan: "MUMB12345E", year: "2024", companyId: 1, credentials: CREDS } }],
    responses: [
      { status: 200, description: "Fetched and saved", schema: obj({
        success: bool("true", true),
        data: obj({ success: bool("Download step completed", true), totalDownloaded: int("Certificates processed", 1), totalPages: int("Inbox pages read", 1), partialDownload: bool("Present when the run stopped early", undefined), errorMessage: str("Present with partialDownload", undefined),
          extractedData: arr(obj({ certNumber: str("Cert no.", "1234567890ABC"), pan: str("PAN", "ABCDE1234F"), din: str("DIN", "DIN0001"), fy: str("FY", "2024-25"), pdfPath: nullable(str("Kept PDF (relative to public/)", "pdf/tldc-downloads/certificates/1234567890ABC.pdf")) }), "Raw rows read from the 197 inbox") }, null, "Raw download result"),
        cached: bool("Always false", false), records: arr(ref("TldcRecord"), "Certificates saved in this run"), warnings: arr(ref("TldcWarning"), "Per-certificate problems"), message: str("Summary", "Successfully fetched TLDC data"),
      }, ["success", "records", "warnings", "message"]), example: { success: true, data: { success: true, totalDownloaded: 1, totalPages: 1, extractedData: [{ certNumber: "1234567890ABC", pan: "ABCDE1234F", din: "DIN0001", fy: "2024-25", pdfPath: "pdf/tldc-downloads/certificates/1234567890ABC.pdf" }] }, cached: false, records: [tldcOldRecordExample], warnings: [], message: "Successfully fetched TLDC data" } },
      ...tldcErrors.map((e) => (e.status === 400 ? { ...e, example: { ...e.example, message: "Missing required parameters (tan, year, companyId, credentials)" } } : e)), unauthorized,
    ],
  },
  {
    folder: ["1. LDC - Lower Deduction Certificates"], name: "Refresh certificates - Old Act", method: "POST", path: "/api/tldc/update-data", tags: ["LDC"], mode: "sync",
    summary: "Re-verify stored old-Act certificates on the TRACES 197 verification page",
    description: `${SYNC}\n\nWith recordId: refreshes that certificate. Without it: refreshes stored certificates not yet enriched (no deductee name). year accepts "2024" or "2024-25". A cancel date on TRACES sets isActive=false.`,
    body: obj({ tan: str("Deductor TAN", "MUMB12345E"), year: str("\"2024\" or \"2024-25\"", "2024-25"), companyId: int("Company id", 1), recordId: int("Refresh one row only (optional)", 7), credentials: ref("PortalCredentials") }, ["tan", "year", "companyId", "credentials"]),
    examples: [{ name: "Refresh certificates - Old Act", body: { tan: "MUMB12345E", year: "2024-25", companyId: 1, recordId: 7, credentials: CREDS } }],
    responses: [
      { status: 200, description: "Refreshed", schema: obj({
        success: bool("true", true),
        data: arr(obj({ certNumber: str("Cert no.", "1234567890ABC"), pan: str("PAN", "ABCDE1234F"), panName: str("Name", "EXAMPLE VENDOR LLP"), fy: str("FY", "2024-25"), validFrom: str("As on TRACES", "15-Apr-2024"), validTo: str("As on TRACES", "31-Mar-2025"), cancelDate: str("As on TRACES, '-' if none", "-"), section: str("Section", "194J"), NatureOfPayment: str("Nature", "Fees for professional or technical services"), tdsRate: str("Rate", "2"), tdsAmountLimit: str("Limit", "500000"), tdsAmountConsumed: str("Consumed", "125000"), issueDate: str("Date of issue", "15-Apr-2024"), error: str("Present when TRACES returned no row", undefined) }), "Raw rows read from the 197 verification page"),
        cached: bool("Always false", false), records: arr(ref("TldcRecord"), "Refreshed certificates"), warnings: arr(ref("TldcWarning"), "Certificates not found on TRACES"), message: str("Summary", "Successfully fetched TLDC data"),
      }, ["success", "records", "warnings"]), example: { success: true, data: [{ certNumber: "1234567890ABC", pan: "ABCDE1234F", panName: "EXAMPLE VENDOR LLP", fy: "2024-25", validFrom: "15-Apr-2024", validTo: "31-Mar-2025", cancelDate: "-", section: "194J", NatureOfPayment: "Fees for professional or technical services", tdsRate: "2", tdsAmountLimit: "500000", tdsAmountConsumed: "125000", issueDate: "15-Apr-2024" }], cached: false, records: [tldcOldRecordExample], warnings: [], message: "Successfully fetched TLDC data" } },
      ...tldcErrors.map((e) => (e.status === 400 ? { ...e, example: { ...e.example, message: "Missing required parameters (tan, year, companyId, credentials)" } } : e)), unauthorized,
    ],
  },
  {
    folder: ["1. LDC - Lower Deduction Certificates"], name: "List stored certificates", method: "POST", path: "/api/tldc/list", tags: ["LDC"], mode: "read",
    summary: "List stored LDC certificates (database only, no TRACES call)",
    description: "Fast read for TOE screens; no TRACES login or captcha. Provide companyId or tan. Ordered by FY (newest first) then certificate number. Each record carries pdfUrl for its PDF.",
    body: obj({
      companyId: int("Company id (takes precedence over tan)", 1), tan: str("TAN, instead of companyId", undefined),
      fy: str("\"2026-27\" or \"2026\"", "2026-27"), act: str("old or new", "new", { enum: ["old", "new"] }),
      certNumber: str("Exact certificate number", undefined), pan: str("Exact deductee PAN", undefined),
      isActive: bool("true = active, false = cancelled", true), skip: int("Paging offset", 0, { minimum: 0 }), take: int("Page size (max 5000)", 1000, { minimum: 1, maximum: 5000 }),
    }),
    examples: [
      { name: "List stored certificates", body: { companyId: 1, fy: "2026-27", act: "new", isActive: true, skip: 0, take: 1000 } },
      { name: "List stored certificates by TAN", body: { tan: "MUMB12345E" } },
    ],
    responses: [
      { status: 200, description: "Certificates", schema: obj({ success: bool("true", true), company: obj({ id: int("Id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E") }), count: int("Total matching (before paging)", 1), skip: int("Offset", 0), take: int("Page size", 1000), records: arr(ref("TldcRecord"), "Certificates") }, ["success", "company", "count", "records"]),
        example: { success: true, company: { id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E" }, count: 1, skip: 0, take: 1000, records: [tldcRecordExample] } },
      tldcErr(400, "LDC_INVALID_INPUT", "Provide companyId or tan", false, "Invalid input (also: act must be \"old\" or \"new\")"),
      tldcErr(404, "LDC_COMPANY_NOT_FOUND", "No company matches the given companyId / TAN.", false, "Unknown company"),
      tldcErr(500, "LDC_INTERNAL_ERROR", "Unexpected error", true, "Unexpected server error"),
      unauthorized, { status: 405, description: "Wrong HTTP method", schema: ref("ErrorMessage"), example: { error: "Method not allowed" } },
    ],
  },
  {
    folder: ["1. LDC - Lower Deduction Certificates"], name: "Stored certificates (RPC, raw rows)", method: "POST", path: "/api/rpc/getTldcData", tags: ["LDC"], rpc: true, mode: "read",
    summary: "Raw stored certificate rows (UI shape); prefer /api/tldc/list for integration",
    description: "Dates are ISO timestamps and amounts are strings in this raw shape. search matches certificate number, PAN, name, section or nature (case-sensitive).",
    params: obj({ where: { type: "object", description: "Prisma filter, e.g. { \"companyId\": 1, \"fy\": \"2026-27\" }" }, orderBy: { type: "object", description: "Default { \"updatedAt\": \"desc\" }" }, skip: int("Offset", 0), take: int("Page size", 100), search: str("Text search", "ABCDE1234F") }),
    paramsExample: { where: { companyId: 1, fy: "2026-27" }, skip: 0, take: 100 },
    result: obj({
      tldcData: arr(obj({ id: int("Id", 11), companyId: int("Company", 1), certNumber: str("Cert", "4AD0426ILB4A140"), din: str("DIN", "4AD0426ILB"), fy: str("FY", "2026-27"), pan: str("PAN", "ABCDE1234F"), panName: str("Name", "EXAMPLE VENDOR LLP"), section: str("Section", "1027"), NatureOfPayment: str("Nature", "..."), tdsAmountLimit: str("Limit", "900000"), tdsAmountConsumed: str("Consumed", "0"), tdsRate: str("Rate", "3"), validFrom: str("ISO", "2026-04-23T18:30:00.000Z"), validTo: str("ISO", "2027-03-30T18:30:00.000Z"), issueDate: nullable(str("ISO", "2026-03-19T18:30:00.000Z")), cancelDate: nullable(str("ISO", null)), pdfPath: nullable(str("Relative to public/", "pdf/child-certificates/Example Deductor Pvt Ltd/298942.pdf")), isActive: bool("Active", true), createdAt: str("ISO", "2026-07-30T11:05:36.144Z"), updatedAt: str("ISO", "2026-07-30T11:05:36.144Z"), company: obj({ id: int("Id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E") }) }), "Rows"),
      nextPage: nullable(obj({ take: int("take", 100), skip: int("skip", 100) })), hasMore: bool("More pages", false), count: int("Total", 1),
    }, ["tldcData", "hasMore", "count"]),
    resultExample: { tldcData: [{ id: 11, companyId: 1, certNumber: "4AD0426ILB4A140", din: "4AD0426ILB", fy: "2026-27", pan: "ABCDE1234F", panName: "EXAMPLE VENDOR LLP", section: "1027", NatureOfPayment: "Any sum by way of (a) fees for professional services ...", tdsAmountLimit: "900000", tdsAmountConsumed: "0", tdsRate: "3", validFrom: "2026-04-23T18:30:00.000Z", validTo: "2027-03-30T18:30:00.000Z", issueDate: "2026-03-19T18:30:00.000Z", cancelDate: null, pdfPath: "pdf/child-certificates/Example Deductor Pvt Ltd/298942.pdf", isActive: true, createdAt: "2026-07-30T11:05:36.144Z", updatedAt: "2026-07-30T11:05:36.144Z", company: { id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E" } }], nextPage: null, hasMore: false, count: 1 },
  },
  {
    folder: ["1. LDC - Lower Deduction Certificates"], name: "Utilisation (RPC)", method: "POST", path: "/api/rpc/getLdcUtilisation", tags: ["LDC"], rpc: true, mode: "read",
    summary: "Limit vs consumed vs remaining per certificate",
    description: "Same filters as getTldcData. Refresh certificates first for current consumption.",
    params: obj({ where: { type: "object", description: "Prisma filter, e.g. { \"companyId\": 1 }" }, orderBy: { type: "object" }, skip: int("Offset", 0), take: int("Page size", 100), search: str("Text search", undefined) }),
    paramsExample: { where: { companyId: 1, fy: "2026-27" }, skip: 0, take: 50 },
    result: obj({
      rows: arr(obj({ id: int("Id", 11), companyId: int("Company", 1), company: obj({ id: int("Id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E") }), certNumber: str("Cert", "4AD0426ILB4A140"), din: str("DIN", "4AD0426ILB"), fy: str("FY", "2026-27"), pan: str("PAN", "ABCDE1234F"), panName: str("Name", "EXAMPLE VENDOR LLP"), section: str("Section", "1027"), NatureOfPayment: str("Nature", "..."), tdsRate: str("Rate", "3"), amountLimit: num("Limit", 900000), amountConsumed: num("Consumed", 225000), amountRemaining: num("Remaining", 675000), utilisationPct: num("Utilisation % (2 dp)", 25), validFrom: str("ISO", "2026-04-23T18:30:00.000Z"), validTo: str("ISO", "2027-03-30T18:30:00.000Z"), cancelDate: nullable(str("ISO", null)), isActive: bool("Active", true), updatedAt: str("ISO", "2026-07-30T11:05:36.144Z") }), "Rows"),
      nextPage: nullable(obj({ take: int("take", 50), skip: int("skip", 50) })), hasMore: bool("More pages", false), count: int("Total", 1),
    }, ["rows", "hasMore", "count"]),
    resultExample: { rows: [{ id: 11, companyId: 1, company: { id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E" }, certNumber: "4AD0426ILB4A140", din: "4AD0426ILB", fy: "2026-27", pan: "ABCDE1234F", panName: "EXAMPLE VENDOR LLP", section: "1027", NatureOfPayment: "Any sum by way of (a) fees for professional services ...", tdsRate: "3", amountLimit: 900000, amountConsumed: 225000, amountRemaining: 675000, utilisationPct: 25, validFrom: "2026-04-23T18:30:00.000Z", validTo: "2027-03-30T18:30:00.000Z", cancelDate: null, isActive: true, updatedAt: "2026-07-30T11:05:36.144Z" }], nextPage: null, hasMore: false, count: 1 },
  },

  // ═══════════════════════════════ 2.1 CHALLAN PAYMENT ═══════════════════════════════
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Create challans", method: "POST", path: "/api/challan/create", tags: ["Challan payment"], mode: "sync",
    summary: "Create ITNS 281 challans on the Income Tax e-Pay portal and return the PRN per section",
    description: `${SYNC}\n\nsectionCode is the code from the section list (old Act e.g. 92B, 94C, 94J; new Act e.g. 1001, 1027 with actType "new"). New-Act sections are combined into one challan by default. Payment itself is completed by the user against the PRN (net banking / bank). HTTP 200 is returned even when some sections fail; check each result.`,
    body: obj({
      companyId: int("Company id", 1), assessmentYear: str("Assessment / tax year", "2027-28"),
      sections: arr(obj({ sectionCode: str("Section code from the section list", "94C"), amount: str("Amount (INR)", "25000"), actType: str("old (default) or new", "old", { enum: ["old", "new"] }) }, ["sectionCode", "amount"]), "One entry per section", { minItems: 1 }),
      newRegimeChallanMode: str("combined (default): one challan for all new-Act sections; separate: one per section", "combined", { enum: ["combined", "separate"] }),
      skipDownload: bool("false (default) downloads the created challan PDFs afterwards", true),
    }, ["companyId", "assessmentYear", "sections"]),
    examples: [{ name: "Create challans", body: { companyId: 1, assessmentYear: "2027-28", skipDownload: true, sections: [{ sectionCode: "94C", amount: "25000", actType: "old" }, { sectionCode: "1027", amount: "50000", actType: "new" }] } }],
    responses: [
      { status: 200, description: "Per-section results (new-Act results first)", schema: obj({ success: bool("true", true), results: arr(ref("ChallanCreateResult"), "Per section") }, ["success", "results"]),
        example: { success: true, results: [{ sectionCode: "1027", sectionDesc: "393(1) [Table: Sl. No. 6(iii).D(b)]", amount: "50000", success: true, pymntRefNum: "26041500012346" }, { sectionCode: "94C", sectionDesc: "194C", amount: "25000", success: true, pymntRefNum: "26041500012345" }] } },
      { status: 400, description: "Missing fields, or duplicate new-Act section in combined mode", schema: ref("ErrorMessage"), example: { error: "Missing required fields" } },
      companyNotFound, methodNotAllowed, unauthorized, plain500("Login failed: invalid credentials"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Download generated challans", method: "POST", path: "/api/challan/download", tags: ["Challan payment"], mode: "sync",
    summary: "Download the PDFs of challans created through this API",
    description: `${SYNC}\n\nDownloads as many of the newest generated challans as there are stored PRNs for the company. Files: public/pdf/challans/{Company}/GeneratedChallans/. The response has no file list; use the filtered download or the file API.`,
    body: obj({ companyId: int("Company id", 1) }, ["companyId"]), examples: [{ name: "Download generated challans", body: { companyId: 1 } }],
    responses: [{ status: 200, description: "Downloaded", schema: obj({ success: bool("true", true) }, ["success"]), example: { success: true } }, missingCompany, companyNotFound, methodNotAllowed, unauthorized, plain500("Failed to download challans")],
  },
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Download generated challans (filtered)", method: "POST", path: "/api/challan/download-generated-challans", tags: ["Challan payment"], mode: "sync",
    summary: "Download generated (unpaid) challans by date range, year or specific rows",
    description: `${SYNC}\n\nDates use the e-Pay format DD-Mon-YYYY (e.g. "01-Apr-2026"). With rowDownloadTargets, rows are matched on tax year + amount and the date filter is skipped. Files: public/pdf/challans/{Company}/GeneratedChallansFiltered/ plus an Excel summary.`,
    body: obj({
      companyId: int("Company id", 1), fromDate: str("From date DD-Mon-YYYY (used with toDate)", "01-Apr-2026"), toDate: str("To date DD-Mon-YYYY", "31-Mar-2027"),
      assessmentYear: str("Year filter", "2027-28"), paymentType: str("Payment type filter", "TDS/TCS Payable by Taxpayer(200)"),
      incomeTaxAct: str("old (default) or new", "new", { enum: ["old", "new"] }),
      rowDownloadTargets: arr(obj({ assessmentYear: str("Year", "2027-28"), amount: num("Amount", 25000) }, ["assessmentYear", "amount"]), "Download only these rows (optional)"),
    }, ["companyId"]),
    examples: [{ name: "Download generated challans (filtered)", body: { companyId: 1, fromDate: "01-Apr-2026", toDate: "31-Mar-2027", assessmentYear: "2027-28", paymentType: "TDS/TCS Payable by Taxpayer(200)", incomeTaxAct: "new" } }],
    responses: [
      { status: 200, description: "Downloaded. result is present only when rowDownloadTargets were given.", schema: obj({ success: bool("true", true), result: ref("TargetedDownloadStats") }, ["success"]), example: { success: true, result: { totalSeen: 20, skipped: 0, downloaded: 2, pages: 2, matched: 2, notFound: 1, failed: 0 } } },
      missingCompany, companyNotFound, methodNotAllowed, unauthorized, plain500("Invalid payment date: 2026-04-01"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Fetch payment history", method: "POST", path: "/api/challan/fetch-payment-history", tags: ["Challan payment"], mode: "sync",
    summary: "List paid challans (CIN, amount, date) and report receipts not yet downloaded",
    description: `${SYNC} (no browser; usually seconds)\n\nfinancialYears omitted = last two FYs; [] = no FY filter. acts: O = 1961 Act, N = 2025 Act (default both). Also caches the result for payment-history-gaps.`,
    body: obj({ companyId: int("Company id", 1), financialYears: arr({ type: "string" }, "FYs like \"2026-27\"", { example: ["2026-27"] }), acts: arr({ type: "string", enum: ["O", "N"] }, "Acts to read (default both)", { example: ["O", "N"] }), actType: str("Single act when acts is not given", undefined, { enum: ["O", "N"] }) }, ["companyId"]),
    examples: [{ name: "Fetch payment history", body: { companyId: 1, financialYears: ["2026-27"], acts: ["O", "N"] } }],
    responses: [
      { status: 200, description: "Payment history", schema: obj({ success: bool("true", true), companyName: str("Company", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"), financialYears: arr({ type: "string" }, "FYs used"), payments: arr(ref("PaymentHistoryRow"), "Payments (deduplicated by CIN)"), gaps: ref("PaymentHistoryGaps"), contentJsonPath: str("Server cache file", "..."), gapsJsonPath: str("Server cache file", "...") }, ["success", "payments", "gaps"]),
        example: { success: true, companyName: "Example Deductor Pvt Ltd", tan: "MUMB12345E", financialYears: ["2026-27"], payments: [{ cin: "26060700012345ABCD", brnNum: "12345", assessmentYear: "2027-28", paymentType: "TDS/TCS Payable by Taxpayer(200)", minorHead: "200", amount: 25000, paymentTime: "07-Jun-2026 16:48:27", crn: "26041500012345", actType: "N" }], gaps: { summary: { totalPayments: 1, pdfsPresent: 0, pdfsMissing: 1, companyName: "Example Deductor Pvt Ltd", paymentHistoryDir: "/srv/app/public/pdf/challans/Example Deductor Pvt Ltd/PaymentHistory" }, present: [], missing: [{ cin: "26060700012345ABCD", amount: 25000, paymentTime: "07-Jun-2026 16:48:27", actType: "N", pdfExists: false, expectedPdfPath: "/srv/app/public/pdf/challans/Example Deductor Pvt Ltd/PaymentHistory/26060700012345ABCD_ChallanReceipt.pdf" }], all: [] }, contentJsonPath: "/srv/app/public/pdf/challans/Example Deductor Pvt Ltd/payment_history_content.json", gapsJsonPath: "/srv/app/public/pdf/challans/Example Deductor Pvt Ltd/payment_history_gaps.json" } },
      missingCompany, companyNotFound, methodNotAllowed, unauthorized, portal500("Invalid credentials"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Download payment receipts", method: "POST", path: "/api/challan/download-payment", tags: ["Challan payment"], mode: "sync",
    summary: "Download paid-challan receipts (PDF) by payment date range",
    description: `${SYNC}\n\nDates use DD-Mon-YYYY. Only receipts not already downloaded are fetched; files are named {CIN}_ChallanReceipt.pdf under public/pdf/challans/{Company}/PaymentHistory/.`,
    body: obj({ companyId: int("Company id", 1), fromDate: str("From payment date DD-Mon-YYYY", "01-Apr-2026"), toDate: str("To payment date DD-Mon-YYYY", "31-Mar-2027"), assessmentYear: str("Year filter", "2027-28"), paymentType: str("Payment type filter", "TDS/TCS Payable by Taxpayer(200)"), incomeTaxAct: str("old (default) or new", "new", { enum: ["old", "new"] }), rowDownloadTargets: arr(obj({ assessmentYear: str("Year", "2027-28"), amount: num("Amount", 25000) }), "Download only these rows (optional)") }, ["companyId"]),
    examples: [{ name: "Download payment receipts", body: { companyId: 1, fromDate: "01-Apr-2026", toDate: "31-Mar-2027", assessmentYear: "2027-28", paymentType: "TDS/TCS Payable by Taxpayer(200)", incomeTaxAct: "new" } }],
    responses: [
      { status: 200, description: "Downloaded (with rowDownloadTargets, result also has matched / notFound / failed)", schema: obj({ success: bool("true", true), result: ref("DownloadStats") }, ["success", "result"]), example: { success: true, result: { totalSeen: 48, skipped: 40, downloaded: 8, pages: 1 } } },
      missingCompany, companyNotFound, methodNotAllowed, unauthorized, plain500("Failed to download challan payments"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Download missing payment receipts", method: "POST", path: "/api/challan/download-missing-payment-pdfs", tags: ["Challan payment"], mode: "sync",
    summary: "Download only the receipts reported missing by Fetch payment history",
    description: `${SYNC}\n\nOld Act: uses the missing list from the last Fetch payment history (or the missing array you send). New Act: downloads every receipt not yet present. Also refreshes the challan-status coverage check.`,
    body: obj({ companyId: int("Company id", 1), incomeTaxAct: str("old (default) or new", "old", { enum: ["old", "new"] }), missing: arr(obj({ cin: str("CIN", "26060700012345ABCD"), paymentTime: str("e.g. 07-Jun-2026 16:48:27", "07-Jun-2026 16:48:27"), assessmentYear: str("Year", "2027-28"), paymentType: str("Type", undefined), actType: str("O / N", undefined) }, ["cin"]), "Optional explicit list (old Act)") }, ["companyId"]),
    examples: [{ name: "Download missing payment receipts", body: { companyId: 1, incomeTaxAct: "old" } }],
    responses: [
      { status: 200, description: "Downloaded", schema: obj({ success: bool("true", true), companyName: str("Company", "Example Deductor Pvt Ltd"), incomeTaxAct: str("Act used", "old"), result: ref("MissingPdfResult"), gapsRefreshed: bool("Always true", true), challanStatusCoverage: ref("CoverageReport") }, ["success", "result"]),
        example: { success: true, companyName: "Example Deductor Pvt Ltd", incomeTaxAct: "old", result: { totalSeen: 14, skipped: 10, downloaded: 4, pages: 1, dateRangesProcessed: 1, stillMissing: 0, dayGroups: [{ dayKey: "06-Jun-2025_to_08-Jul-2025", count: 4 }], downloadedCins: ["25060700012345ABCD"] }, gapsRefreshed: true, challanStatusCoverage: { companyName: "Example Deductor Pvt Ltd", excelPath: "/srv/app/public/pdf/challan_status_results/Example Deductor Pvt Ltd_challan_status.xlsx", excelExists: true, excelRowCount: 30, totalPdfsParsed: 10, inExcel: 9, notInExcel: 1, checkedAt: "2026-10-10T09:15:00.000Z", items: [] } } },
      missingCompany, companyNotFound, methodNotAllowed, unauthorized, portal500("Missing rows have no usable paymentTime for date range"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Payment history gaps (cached)", method: "GET", path: "/api/challan/payment-history-gaps", tags: ["Challan payment"], mode: "read",
    summary: "Read the last payment-history result and missing receipts without calling the portal",
    description: "Reads the cache written by Fetch payment history. refreshCoverage=true re-checks downloaded receipts against the TRACES challan-status Excel.",
    query: [{ name: "companyId", required: true, schema: int("Company id", 1), description: "Company id" }, { name: "refreshCoverage", required: false, schema: str("\"true\" to re-check coverage", "false", { enum: ["true", "false"] }), description: "Re-check coverage" }],
    examples: [{ name: "Payment history gaps (cached)", query: { companyId: 1, refreshCoverage: "false" } }],
    responses: [
      { status: 200, description: "Cached data (cached:false with an empty list when Fetch payment history has not run)", schema: obj({ success: bool("true", true), cached: bool("Cache found", true), companyName: str("Company", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"), fetchedAt: str("ISO", "2026-10-10T09:12:00.000Z"), message: str("Present when cached is false", undefined), payments: arr(ref("PaymentHistoryRow"), "Payments"), gaps: nullable(ref("PaymentHistoryGaps")), challanStatusCoverage: nullable(ref("CoverageReport")) }, ["success", "cached", "payments"]),
        example: { success: true, cached: true, companyName: "Example Deductor Pvt Ltd", tan: "MUMB12345E", fetchedAt: "2026-10-10T09:12:00.000Z", payments: [{ cin: "26060700012345ABCD", amount: 25000, paymentTime: "07-Jun-2026 16:48:27", actType: "N" }], gaps: { fetchedAt: "2026-10-10T09:12:00.000Z", financialYears: ["2026-27"], summary: { totalPayments: 1, pdfsPresent: 1, pdfsMissing: 0, companyName: "Example Deductor Pvt Ltd", paymentHistoryDir: "/srv/app/public/pdf/challans/Example Deductor Pvt Ltd/PaymentHistory" }, missing: [], present: [{ cin: "26060700012345ABCD", amount: 25000, pdfExists: true, expectedPdfPath: "/srv/app/public/pdf/challans/Example Deductor Pvt Ltd/PaymentHistory/26060700012345ABCD_ChallanReceipt.pdf", challanStatusInExcel: true }], all: [] }, challanStatusCoverage: null } },
      { status: 400, description: "companyId missing", schema: ref("ErrorMessage"), example: { error: "Missing companyId query parameter" } },
      companyNotFound, methodNotAllowed, unauthorized, portal500("Unexpected error"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.1 Challan payment (IT e-Pay)"], name: "Companies", method: "GET", path: "/api/challan/batch-companies", tags: ["Companies"], mode: "read",
    summary: "List companies (id, name, TAN) to find companyId values",
    description: "Database read. Temporary companies are excluded.",
    examples: [{ name: "Companies" }],
    responses: [
      { status: 200, description: "Companies", schema: obj({ success: bool("true", true), count: int("Count", 1), companies: arr(obj({ id: int("Company id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E") }), "Ordered by name") }, ["success", "count", "companies"]), example: { success: true, count: 1, companies: [{ id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E" }] } },
      methodNotAllowed, unauthorized, portal500("Unexpected error"),
    ],
  },

  // ═══════════════════════════════ 2.2 IMPORT CHALLANS ═══════════════════════════════
  {
    folder: ["2. TDS on Expense", "2.2 Import challans incl. unconsumed balance (TRACES)"], name: "Unconsumed challans", method: "POST", path: "/api/challan/run-challan-status", tags: ["Import challans"], mode: "sync",
    summary: "Read TRACES unconsumed challans for one company (list, or full with unconsumed amounts)",
    description: `${SYNC}\n\nmode "list": reads the TRACES unconsumed-challan grid into an Excel. mode "full" (default): also reveals each unconsumed amount ("View Amount") and builds the challan-status Excel. Uses the TRACES credentials stored on the company. financialYears filters by deposit date FY ("2025-26").`,
    body: obj({ companyId: int("Company id", 1), mode: str("list or full (default)", "list", { enum: ["list", "full"] }), financialYears: arr({ type: "string" }, "Deposit-date FYs (default all)", { example: ["2025-26"] }), onlyPaymentPdfNotInExcel: bool("full mode: only challans not already in the Excel (default true)", true) }, ["companyId"]),
    examples: [
      { name: "Unconsumed challans - list", body: { companyId: 1, mode: "list", financialYears: ["2025-26"] } },
      { name: "Unconsumed challans - full (with amounts)", body: { companyId: 1, mode: "full", onlyPaymentPdfNotInExcel: true, financialYears: ["2025-26"] } },
    ],
    responses: [
      { status: 200, description: "Completed. details shape depends on mode.", schema: obj({
        success: bool("true when completed", true), status: str("Completed / Failed", "Completed", { enum: ["Completed", "Failed"] }), companyName: str("Company", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"),
        details: { oneOf: [
          obj({ success: bool("true", true), mode: str("list", "list"), company: str("Company", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"), rowsProcessed: int("Rows read", 43), skippedOutsideFy: int("Outside FY filter", 12), newRecords: int("Rows kept", 31), portalTotal: nullable(int("Rows on TRACES", 43)), complete: nullable(bool("All rows read", true)), excelPath: nullable(str("Excel written", "...")) }, ["mode", "rowsProcessed", "newRecords"], "mode = list"),
          obj({ success: bool("true", true), company: str("Company", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"), totalChallans: int("Challans known from receipts", 25), skippedAlreadyInExcel: int("Already in Excel", 5), skippedOutsideFy: int("Outside FY", 12), unmatchedAmount: int("Amount not matched", 2), queriedOnTraces: int("Amounts revealed", 18), totalRecords: int("Rows in Excel", 30), newRecords: int("New rows", 16), unmatchedRecords: int("Unmatched rows", 2), coverage: obj({ totalPdfsParsed: int("Receipts", 24), inExcel: int("In Excel", 22), notInExcel: int("Not in Excel", 2) }) }, ["totalChallans", "queriedOnTraces", "totalRecords"], "mode = full"),
        ] },
      }, ["success", "status", "details"]),
        example: { success: true, status: "Completed", companyName: "Example Deductor Pvt Ltd", tan: "MUMB12345E", details: { success: true, mode: "list", company: "Example Deductor Pvt Ltd", tan: "MUMB12345E", rowsProcessed: 43, skippedOutsideFy: 12, newRecords: 31, portalTotal: 43, complete: true, excelPath: "/srv/app/public/pdf/unconsumed_challan_results/Example Deductor Pvt Ltd_unconsumed_list.xlsx" } } },
      { status: 400, description: "companyId missing, or company has no TRACES credentials", schema: obj({ success: bool("false", false), status: str("Failed", "Failed"), error: str("Reason", "Company missing TRACES credentials (user_id / password)") }), example: { success: false, status: "Failed", error: "Company missing TRACES credentials (user_id / password)" } },
      companyNotFound, methodNotAllowed, unauthorized,
      { status: 500, description: "Portal automation failure", schema: obj({ success: bool("false", false), status: str("Failed", "Failed"), error: str("Reason", "Failed to run challan status") }), example: { success: false, status: "Failed", error: "Failed to run challan status" } },
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.2 Import challans incl. unconsumed balance (TRACES)"], name: "Unconsumed challans - batch", method: "POST", path: "/api/rpc/processExcelUploadChallanStatus", tags: ["Import challans"], rpc: true, mode: "async",
    summary: "Queue unconsumed-challan reads for many companies",
    description: `${ASYNC} One task per company.`,
    params: obj({ companies: arr(ref("CompanyCredentials"), "Companies"), financialYear: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Deposit-date FY(s); \"\" = all", example: "" }, quarter: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Required but not used; send \"\"", example: "" }, actionType: str("Send download_file", "download_file", { enum: ["send_request", "download_file"] }), jobTypes: arr({ type: "string" }, "Send [\"DownloadChallanStatus\"]", { example: ["DownloadChallanStatus"] }), challanStatusType: str("Always challan_status", "challan_status", { enum: ["challan_status"] }), onlyPaymentPdfNotInExcel: bool("Only challans not already in the Excel", true), mode: str("list or full (default)", "list", { enum: ["list", "full"] }) }, ["companies", "financialYear", "quarter", "actionType", "jobTypes"]),
    paramsExample: { companies: [COMPANY], financialYear: "", quarter: "", actionType: "download_file", jobTypes: ["DownloadChallanStatus"], challanStatusType: "challan_status", onlyPaymentPdfNotInExcel: true, mode: "list" },
    result: ref("BatchCreated"), resultExample: { ...batchCreated, taskCount: 1 },
  },
  {
    folder: ["2. TDS on Expense", "2.2 Import challans incl. unconsumed balance (TRACES)"], name: "Download receipts for unconsumed challans", method: "POST", path: "/api/challan/download-pdfs-from-unconsumed-excel", tags: ["Import challans"], mode: "sync",
    summary: "Download payment receipts for the challans in the unconsumed-challan list",
    description: `${SYNC}\n\nNeeds the list from "Unconsumed challans - list" first. Matches each unconsumed challan to the e-Pay payment history (date + amount) and downloads missing receipts for both Acts.`,
    body: obj({ companyId: int("Company id", 1), financialYears: arr({ type: "string" }, "At least one FY", { example: ["2025-26"], minItems: 1 }) }, ["companyId", "financialYears"]),
    examples: [{ name: "Download receipts for unconsumed challans", body: { companyId: 1, financialYears: ["2025-26"] } }],
    responses: [
      { status: 200, description: "Done", schema: obj({ success: bool("true", true), companyName: str("Company", "Example Deductor Pvt Ltd"), financialYears: arr({ type: "string" }, "FYs"), excelRows: int("Unconsumed rows in FYs", 31), matchedPayments: int("Matched to payment history", 29), missingPdfs: int("Receipts missing before run", 3), oldActMissing: int("Old Act", 3), newActMissing: int("New Act", 0), downloaded: obj({ old: nullable(ref("MissingPdfResult")), new: nullable(ref("MissingPdfResult")) }), listExcelPath: str("List Excel used", "..."), message: str("Present when no rows in FYs", undefined) }, ["success"]),
        example: { success: true, companyName: "Example Deductor Pvt Ltd", financialYears: ["2025-26"], excelRows: 31, matchedPayments: 29, missingPdfs: 3, oldActMissing: 3, newActMissing: 0, downloaded: { old: { totalSeen: 20, skipped: 17, downloaded: 3, pages: 1, dateRangesProcessed: 1, stillMissing: 0, dayGroups: [{ dayKey: "04-May-2025_to_08-Jan-2026", count: 3 }], downloadedCins: ["25050400012345ABCD"] }, new: null }, listExcelPath: "/srv/app/public/pdf/unconsumed_challan_results/Example Deductor Pvt Ltd_unconsumed_list.xlsx" } },
      { status: 400, description: "companyId / financialYears missing, or the unconsumed list has not been fetched", schema: obj({ error: str("Reason", "Select at least one financial year"), listExcelPath: str("Expected Excel (list missing)", undefined) }, ["error"]), example: { error: "Select at least one financial year" } },
      companyNotFound, methodNotAllowed, unauthorized, portal500("Unexpected error"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.2 Import challans incl. unconsumed balance (TRACES)"], name: "Download receipts for uploaded rows", method: "POST", path: "/api/challan/download-pdfs-from-uploaded-excels", tags: ["Import challans"], mode: "sync",
    summary: "Download payment receipts for rows (TAN + deposit date) taken from your own Excel",
    description: `${SYNC}\n\nRows are grouped by TAN; each TAN's date range (min-1 to max+1 day) is downloaded per Act. HTTP 200 even if every TAN fails; check results.`,
    body: obj({ rows: arr(obj({ tan: str("TAN of a company in the system", "MUMB12345E"), dateOfDeposit: str("DD-Mon-YYYY", "07-Jun-2025"), challanAmount: { oneOf: [{ type: "string" }, { type: "number" }], description: "Not used", example: 25000 }, companyName: str("Used in error messages", "Example Deductor Pvt Ltd") }, ["tan", "dateOfDeposit"]), "Rows", { minItems: 1 }) }, ["rows"]),
    examples: [{ name: "Download receipts for uploaded rows", body: { rows: [{ tan: "MUMB12345E", dateOfDeposit: "07-Jun-2025", challanAmount: 25000, companyName: "Example Deductor Pvt Ltd" }] } }],
    responses: [
      { status: 200, description: "Per-TAN results", schema: obj({ success: bool("true if at least one TAN succeeded", true), companies: int("Distinct TANs", 1), successCount: int("Succeeded", 1), failedCount: int("Failed", 0), results: arr(obj({ tan: str("TAN", "MUMB12345E"), companyName: str("Company", "Example Deductor Pvt Ltd"), success: bool("Succeeded", true), error: str("Failure reason", undefined), rowCount: int("Rows", 1), fromDate: str("Range from", "06-Jun-2025 00:00:00"), toDate: str("Range to", "08-Jun-2025 23:59:59"), acts: arr({ type: "string" }, "Acts processed"), downloaded: arr(obj({ act: str("old/new", "old"), fromDate: str("From", "06-Jun-2025 00:00:00"), toDate: str("To", "08-Jun-2025 23:59:59"), rowCount: int("Rows", 1), downloaded: ref("DownloadStats") }), "Per Act") }), "Per TAN") }, ["success", "results"]),
        example: { success: true, companies: 1, successCount: 1, failedCount: 0, results: [{ tan: "MUMB12345E", companyName: "Example Deductor Pvt Ltd", success: true, rowCount: 1, fromDate: "06-Jun-2025 00:00:00", toDate: "08-Jun-2025 23:59:59", acts: ["old"], downloaded: [{ act: "old", fromDate: "06-Jun-2025 00:00:00", toDate: "08-Jun-2025 23:59:59", rowCount: 1, downloaded: { totalSeen: 3, skipped: 2, downloaded: 1, pages: 1 } }] }] } },
      { status: 400, description: "No usable rows", schema: ref("ErrorMessage"), example: { error: "No valid rows with TAN and Date of Deposit found" } },
      methodNotAllowed, unauthorized, portal500("Unexpected error"),
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.2 Import challans incl. unconsumed balance (TRACES)"], name: "Stored challans (RPC)", method: "POST", path: "/api/rpc/getChallanData", tags: ["Import challans"], rpc: true, mode: "read",
    summary: "Challans created through the API (PRN, amount, status)",
    description: "Database read.",
    params: obj({ where: obj({ companyId: { oneOf: [{ type: "integer" }, obj({ in: arr({ type: "integer" }, "Ids") })], description: "Company id or { in: [...] }", example: 1 }, assessmentYear: str("Year", "2027-28"), sectionCode: str("Section code", "94C"), status: str("draft / created / paid / downloaded", "created") }), orderBy: obj({ updatedAt: str("asc / desc", "desc", { enum: ["asc", "desc"] }) }), skip: int("Offset", 0), take: int("Page size", 100) }),
    paramsExample: { where: { companyId: 1 }, skip: 0, take: 100 },
    result: obj({ challanData: arr(obj({ id: int("Id", 5), companyId: int("Company", 1), assessmentYear: str("Year", "2027-28"), sectionCode: str("Code", "94C"), sectionDesc: str("Section", "194C"), amount: str("Amount", "25000"), pymntRefNum: nullable(str("PRN", "26041500012345")), status: str("Status", "created"), filePath: nullable(str("PDF", null)), createdAt: str("ISO", "2026-04-15T10:00:00.000Z"), updatedAt: str("ISO", "2026-04-15T10:00:00.000Z"), company: obj({ id: int("Id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"), user_id: str("TRACES user", "MUMB12345E") }) }), "Rows"), count: int("Total", 1) }, ["challanData", "count"]),
    resultExample: { challanData: [{ id: 5, companyId: 1, assessmentYear: "2027-28", sectionCode: "94C", sectionDesc: "194C", amount: "25000", pymntRefNum: "26041500012345", status: "created", filePath: null, createdAt: "2026-04-15T10:00:00.000Z", updatedAt: "2026-04-15T10:00:00.000Z", company: { id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E", user_id: "MUMB12345E" } }], count: 1 },
  },

  // ═══════════════════════════════ 2.3 FORMS / CONSO / JUSTIFICATION ═══════════════════════════════
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)"], name: "Form 16 / 16A", method: "POST", path: "/api/rpc/processExcelUploadForm16", tags: ["Form 16 / 16A"], rpc: true, mode: "async",
    summary: "Raise or download Form 16 / 16A on TRACES (and optionally sign Form 16A PDFs)",
    description: `${ASYNC}\n\nTwo steps: actionType send_request raises the request on TRACES; TRACES prepares the file (minutes to hours); actionType download_file downloads every ready ZIP. form16Type: form16 or form16a. Form 16A new Act (form types 130/131/133) uses portalMode "new". actionType sign_pdf signs already generated Form 16A PDFs with the DSC on the server and returns the list of signed files instead of a batch.`,
    params: obj({
      companies: arr(ref("CompanyCredentials"), "Companies"),
      financialYear: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "FY(s) like \"2025-26\"; \"\" for download_file", example: "2025-26" },
      quarter: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Q1-Q4; \"\" for download_file", example: "Q4" },
      formType: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "24Q / 26Q / 27Q / 27EQ (old Act) or 130 / 131 / 133 (new Act)", example: "24Q" },
      actionType: str("What to do", "send_request", { enum: ["send_request", "download_file", "sign_pdf"] }),
      jobTypes: arr({ type: "string" }, "[\"SendRequest\"] or [\"DownloadFile\"]", { example: ["SendRequest"] }),
      sendToAllPeriods: bool("Queue every FY x quarter x form", false),
      form16Type: str("form16 (default) or form16a", "form16", { enum: ["form16", "form16a"] }),
      portalMode: str("Form 16A only: new (default) = TRACES REST, old = TRACES pages", "new", { enum: ["new", "old"] }),
      certificateName: str("DSC certificate name (sign_pdf); send \"\" otherwise", ""),
    }, ["companies", "financialYear", "quarter", "actionType", "jobTypes", "certificateName"]),
    paramsExamples: [
      { name: "Form 16 - send request", params: { companies: [COMPANY], financialYear: "2025-26", quarter: "Q4", formType: "24Q", actionType: "send_request", jobTypes: ["SendRequest"], form16Type: "form16", sendToAllPeriods: false, certificateName: "" } },
      { name: "Form 16A - send request (new Act)", params: { companies: [COMPANY], financialYear: "2026-27", quarter: "Q1", formType: "131", actionType: "send_request", jobTypes: ["SendRequest"], form16Type: "form16a", portalMode: "new", sendToAllPeriods: false, certificateName: "" } },
      { name: "Form 16 / 16A - download ready files", params: { companies: [COMPANY], financialYear: "", quarter: "", actionType: "download_file", jobTypes: ["DownloadFile"], form16Type: "form16a", certificateName: "" } },
      { name: "Form 16A - sign PDFs (DSC)", params: { companies: [COMPANY], financialYear: "", quarter: "", actionType: "sign_pdf", jobTypes: ["SignPdf"], form16Type: "form16a", certificateName: "Example DSC Certificate" } },
    ],
    result: { oneOf: [ref("BatchCreated"), arr({ type: "string" }, "sign_pdf: paths of signed PDFs")] }, resultExample: batchCreated,
  },
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)"], name: "Conso file", method: "POST", path: "/api/rpc/processExcelUploadConso", tags: ["Conso file"], rpc: true, mode: "async",
    summary: "Raise or download conso files on TRACES",
    description: `${ASYNC}\n\nsend_request raises a request per FY x quarter x form (arrays allowed; sendToAllPeriods queues all). download_file downloads every ready conso ZIP and writes a parsed Excel (sheets Challan Details and Deductee Details) to public/pdf/traces_excel/{Company}/. Note: send one FY / quarter / form per request for now; arrays in a single request are not split correctly per task.`,
    params: obj({ companies: arr(ref("CompanyCredentials"), "Companies"), financialYear: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "FY(s); \"\" for download_file", example: "2026-27" }, quarter: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Quarter(s); \"\" for download_file", example: "Q1" }, formType: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "24Q / 26Q / 27Q / 27EQ", example: "26Q" }, actionType: str("send_request or download_file", "send_request", { enum: ["send_request", "download_file"] }), jobTypes: arr({ type: "string" }, "[\"SendRequest\"] or [\"DownloadFile\"]", { example: ["SendRequest"] }), sendToAllPeriods: bool("Queue every period", false) }, ["companies", "financialYear", "quarter", "actionType", "jobTypes"]),
    paramsExamples: [
      { name: "Conso file - send request", params: { companies: [COMPANY], financialYear: "2026-27", quarter: "Q1", formType: "26Q", actionType: "send_request", jobTypes: ["SendRequest"], sendToAllPeriods: false } },
      { name: "Conso file - download ready files", params: { companies: [COMPANY], financialYear: "", quarter: "", actionType: "download_file", jobTypes: ["DownloadFile"] } },
    ],
    result: ref("BatchCreated"), resultExample: batchCreated,
  },
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)"], name: "Justification report", method: "POST", path: "/api/rpc/processExcelUploadJustification", tags: ["Justification report"], rpc: true, mode: "async",
    summary: "Raise or download justification reports on TRACES",
    description: `${ASYNC}\n\nTasks run one at a time. Form types also include 140 (new Act).`,
    params: obj({ companies: arr(ref("CompanyCredentials"), "Companies"), financialYear: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "FY(s)", example: "2026-27" }, quarter: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "Quarter(s)", example: "Q1" }, formType: { oneOf: [{ type: "string" }, { type: "array", items: { type: "string" } }], description: "24Q / 26Q / 27Q / 27EQ / 140", example: "26Q" }, actionType: str("send_request or download_file", "send_request", { enum: ["send_request", "download_file"] }), jobTypes: arr({ type: "string" }, "[\"SendRequest\"] or [\"DownloadFile\"]", { example: ["SendRequest"] }), sendToAllPeriods: bool("Queue every period", false) }, ["companies", "financialYear", "quarter", "actionType", "jobTypes"]),
    paramsExamples: [
      { name: "Justification report - send request", params: { companies: [COMPANY], financialYear: "2026-27", quarter: "Q1", formType: "26Q", actionType: "send_request", jobTypes: ["SendRequest"], sendToAllPeriods: false } },
      { name: "Justification report - download ready files", params: { companies: [COMPANY], financialYear: "", quarter: "", actionType: "download_file", jobTypes: ["DownloadFile"] } },
    ],
    result: obj({ message: str("Confirmation", "Companies added to queue successfully (sequential)"), batchId: int("Batch id", 43), companyCount: int("Companies", 1), taskCount: int("Tasks", 1), concurrency: int("Always 1", 1) }, ["message", "batchId", "taskCount"]),
    resultExample: { message: "Companies added to queue successfully (sequential)", batchId: 43, companyCount: 1, taskCount: 1, concurrency: 1 },
  },
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)", "Job monitoring"], name: "Batches and task status", method: "POST", path: "/api/rpc/getTaskBatch", tags: ["Job monitoring"], rpc: true, mode: "read",
    summary: "Recent batches with per-company task status",
    description: "Task status: Queued → Started/In-Progress → Finished | Failed (message holds the reason).",
    params: obj({ skip: int("Batch offset", 0), take: int("Batches", 10), orderBy: { type: "object", description: "Default { \"id\": \"desc\" }" }, taskSkip: int("Task offset", 0), taskTake: int("Tasks per batch", 10), taskOrderBy: { type: "object" }, taskFilters: obj({ status: arr({ type: "string" }, "Status filter"), companyName: arr({ type: "string" }, "Company filter") }) }),
    paramsExample: { skip: 0, take: 10, taskFilters: { status: ["Queued", "Started/In-Progress", "Finished", "Failed"] } },
    result: obj({ tasksBatch: arr(obj({ id: int("Batch id", 42), createdAt: str("ISO", "2026-10-12T08:00:00.000Z"), updatedAt: str("ISO", "2026-10-12T08:05:00.000Z"), jobTypes: nullable(str("JSON string", "[\"SendRequest\"]")), module: nullable(str("Module", "IT")), filters: nullable(str("JSON string of request filters", "{\"actionType\":\"send_request\"}")), _count: obj({ Task: int("Tasks in batch", 2) }), Task: arr(obj({ id: int("Task id", 101), companyId: int("Company", 1), status: str("Status", "Finished"), createdAt: str("ISO", "2026-10-12T08:00:00.000Z"), updatedAt: str("ISO", "2026-10-12T08:03:11.000Z"), BatchID: int("Batch", 42), retryCount: nullable(int("Retries", 0)), jobType: nullable(str("JSON string", "[\"SendRequest\"]")), module: nullable(str("Module", "IT")), message: nullable(str("Failure reason", null)), company: obj({ id: int("Id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"), user_id: str("TRACES user", "MUMB12345E") }) }), "Tasks") }), "Batches"), count: int("Total batches", 17) }, ["tasksBatch", "count"]),
    resultExample: { tasksBatch: [{ id: 42, createdAt: "2026-10-12T08:00:00.000Z", updatedAt: "2026-10-12T08:05:00.000Z", jobTypes: "[\"SendRequest\"]", module: "IT", filters: "{\"actionType\":\"send_request\",\"financialYear\":\"2026-27\",\"quarter\":\"Q1\",\"formType\":\"26Q\"}", _count: { Task: 1 }, Task: [{ id: 101, companyId: 1, status: "Finished", createdAt: "2026-10-12T08:00:00.000Z", updatedAt: "2026-10-12T08:03:11.000Z", BatchID: 42, retryCount: 0, jobType: "[\"SendRequest\"]", module: "IT", message: null, company: { id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E", user_id: "MUMB12345E" } }] }], count: 17 },
  },
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)", "Job monitoring"], name: "Task ids in a batch", method: "POST", path: "/api/rpc/getTaskBatchTaskIds", tags: ["Job monitoring"], rpc: true, mode: "read",
    summary: "Task ids (e.g. failed ones) in a batch, for retry", description: "",
    params: obj({ batchId: int("Batch id", 42), statusFilter: arr({ type: "string" }, "e.g. [\"Failed\"]", { example: ["Failed"] }), companyNameFilter: arr({ type: "string" }, "Company names") }, ["batchId"]),
    paramsExample: { batchId: 42, statusFilter: ["Failed"] },
    result: obj({ taskIds: arr({ type: "integer" }, "Task ids"), companyIds: arr({ type: "integer" }, "Company of each task (same order)") }, ["taskIds", "companyIds"]), resultExample: { taskIds: [102], companyIds: [1] },
  },
  ...[
    ["Conso batch progress", "getConsoBatchProgress", "Progress of a conso batch with FY / quarter / form per task."],
    ["Form 16 batch progress", "getForm16BatchProgress", "Progress of a Form 16 / 16A batch."],
    ["Justification batch progress", "getJustificationBatchProgress", "Progress of a justification batch."],
  ].map(([name, op, desc]) => ({
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)", "Job monitoring"], name, method: "POST", path: `/api/rpc/${op}`, tags: ["Job monitoring"], rpc: true, mode: "read",
    summary: name, description: `${desc} Poll every 30-60 s until isComplete is true.`,
    params: obj({ batchId: int("Batch id", 42, { minimum: 1 }) }, ["batchId"]), paramsExample: { batchId: 42 },
    result: ref("BatchProgress"), resultExample: progressExample,
  })),
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)", "Job monitoring"], name: "Batch progress (live stream)", method: "GET", path: "/api/conso/batch-progress", tags: ["Job monitoring"], mode: "stream",
    summary: "Server-Sent Events stream of batch progress",
    description: "Each event is `data: <BatchProgress JSON>` followed by a blank line; the first event is sent immediately, then one on every task change. A `: keepalive` comment is sent every 25 s. The server never closes the stream: close it when isComplete is true. FY / quarter / form are filled for conso batches (N/A for others).",
    query: [{ name: "batchId", required: true, schema: int("Batch id", 42, { minimum: 1 }), description: "Batch id" }],
    examples: [{ name: "Batch progress (live stream)", query: { batchId: 42 } }],
    responses: [
      { status: 200, description: "text/event-stream; each data line is a BatchProgress object", contentType: "text/event-stream", schema: ref("BatchProgress"), example: progressExample, rawExample: `data: ${JSON.stringify(progressExample)}\n\n: keepalive\n\n` },
      { status: 400, description: "batchId missing or not a positive integer", schema: ref("ErrorMessage"), example: { error: "Invalid batchId" } },
      methodNotAllowed, unauthorized,
    ],
  },
  ...[
    ["Retry failed tasks - conso", "retryFailedConsoBatchTasks", true],
    ["Retry failed tasks - Form 16", "retryFailedForm16BatchTasks", false],
    ["Retry failed tasks - justification", "retryFailedJustificationBatchTasks", true],
  ].map(([name, op, hasAction]) => ({
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)", "Job monitoring"], name, method: "POST", path: `/api/rpc/${op}`, tags: ["Job monitoring"], rpc: true, mode: "async",
    summary: name, description: "Re-queues only Failed tasks of the batch (or the given taskIds). Finished tasks are never re-run. Unknown batch returns an Error \"Batch #<id> not found\".",
    params: obj({ batchId: int("Batch id", 42, { minimum: 1 }), taskIds: arr({ type: "integer" }, "Limit to these tasks (optional)", { example: [102] }) }, ["batchId"]), paramsExample: { batchId: 42 },
    result: ref("RetryResult"), resultExample: { success: true, retriedCount: 1, taskIds: [102], ...(hasAction ? { actionType: "send_request", message: "Queued 1 failed task(s) for retry" } : { message: "Queued 1 failed task(s) for retry with the same batch configuration" }) },
    rpcErrorExample: { name: "Error", message: "Batch #999 not found", code: null, statusCode: 500, meta: null, url: null },
  })),
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)", "Job monitoring"], name: "Request history", method: "POST", path: "/api/rpc/getUploadHistory", tags: ["Job monitoring"], rpc: true, mode: "read",
    summary: "One row per company and batch with status and per-period details", description: "errorMessage is a JSON string with the action and per-period (combination) status.",
    params: obj({ skip: int("Offset", 0), take: int("Page size", 100), type: str("Job type", "conso", { enum: ["conso", "form16", "form16a", "challan_status", "justification"] }), batchId: int("Batch id", 42), status: str("Processing / Success / Failed", "Processing") }),
    paramsExample: { skip: 0, take: 50, type: "conso", batchId: 42 },
    result: obj({ uploadHistory: arr(obj({ id: int("Id", 9), companyName: str("Company", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E"), status: str("Processing / Success / Failed", "Success"), filePath: nullable(str("File", null)), financialYear: str("FY", "2026-27"), quarter: str("Quarter", "Q1"), errorMessage: nullable(str("JSON string with combinations", "{\"action\":\"Send Request\",\"combinations\":[...]}")), type: nullable(str("Type", "conso")), createdAt: str("ISO", "2026-10-12T08:00:00.000Z"), updatedAt: str("ISO", "2026-10-12T08:03:11.000Z"), batchId: nullable(int("Batch", 42)) }), "Rows (newest first)"), count: int("Total", 1), hasMore: bool("More pages", false) }, ["uploadHistory", "count", "hasMore"]),
    resultExample: { uploadHistory: [{ id: 9, companyName: "Example Deductor Pvt Ltd", tan: "MUMB12345E", status: "Success", filePath: null, financialYear: "2026-27", quarter: "Q1", errorMessage: "{\"action\":\"Send Request\",\"combinations\":[{\"taskId\":101,\"financialYear\":\"2026-27\",\"quarter\":\"Q1\",\"formType\":\"26Q\",\"status\":\"Success\",\"errorMessage\":null}]}", type: "conso", createdAt: "2026-10-12T08:00:00.000Z", updatedAt: "2026-10-12T08:03:11.000Z", batchId: 42 }], count: 1, hasMore: false },
  },
  {
    folder: ["2. TDS on Expense", "2.3 Form 16 / 16A, conso, justification (request & download)"], name: "Download file (ZIP / PDF / Excel)", method: "GET", path: "/api/file/{slug}", tags: ["Files"], mode: "binary",
    summary: "Download any file produced by the APIs (path relative to public/)",
    description: "slug is the file path under public/, e.g. pdf/traces/{Company}/{file}.zip. URL-encode spaces. Folders: conso & justification ZIPs pdf/traces/{Company}/, conso Excel pdf/traces_excel/{Company}/, Form 16 pdf/form16-download/, Form 16A pdf/form16a-download/ and pdf/form16a/{Company}/, LDC certificates: use records[].pdfUrl, challan receipts pdf/challans/{Company}/PaymentHistory/.",
    pathParams: [{ name: "slug", required: true, schema: str("File path under public/", "pdf/traces/Example Deductor Pvt Ltd/MUMB12345E_26Q_Q1_2026-27.zip"), description: "File path under public/ (slashes allowed)" }],
    examples: [
      { name: "Download file (ZIP / PDF / Excel)", path: { slug: "pdf/traces/{{companyName}}/MUMB12345E_26Q_Q1_2026-27.zip" } },
      { name: "Download LDC certificate PDF (records[].pdfUrl)", path: { slug: "pdf/child-certificates/{{companyName}}/298942.pdf" }, folder: ["1. LDC - Lower Deduction Certificates"] },
      { name: "Download parsed conso Excel", path: { slug: "pdf/traces_excel/{{companyName}}/26Q_FY2026-27_Q1.xlsx" }, folder: ["2. TDS on Expense", "2.7 Read conso file"] },
    ],
    responses: [
      { status: 200, description: "File bytes; Content-Type from the file extension (application/pdf, application/zip, Excel, ...)", contentType: "application/octet-stream", binary: true },
      { status: 400, description: "Missing path, or path outside public/", schema: ref("FileError"), example: { message: "Invalid file path" } },
      { status: 404, description: "File not found", schema: ref("FileError"), example: { message: "File not found" } },
      unauthorized,
    ],
  },

  // ═══════════════════════════════ 2.4 CHALLAN VERIFICATION ═══════════════════════════════
  {
    folder: ["2. TDS on Expense", "2.4 Challan verification"], name: "Download CSI file", method: "POST", path: "/api/challan/download-csi", tags: ["Challan verification"], mode: "sync",
    summary: "Download the Challan Status Inquiry (CSI) file from e-Pay",
    description: `${SYNC}\n\nThe CSI file is what the return preparation utility uses to verify challans (BSR code, date, serial number, amount). Dates DD-Mon-YYYY. Saved to public/pdf/challans/{Company}/CSI/.`,
    body: obj({ companyId: int("Company id", 1), fromDate: str("From date DD-Mon-YYYY", "01-Apr-2026"), toDate: str("To date DD-Mon-YYYY", "30-Jun-2026"), incomeTaxAct: str("old (default) or new", "new", { enum: ["old", "new"] }) }, ["companyId", "fromDate", "toDate"]),
    examples: [{ name: "Download CSI file", body: { companyId: 1, fromDate: "01-Apr-2026", toDate: "30-Jun-2026", incomeTaxAct: "new" } }],
    responses: [
      { status: 200, description: "Downloaded", schema: obj({ success: bool("true", true), result: obj({ downloadPath: str("Server folder", "..."), files: arr({ type: "string" }, "CSI file names") }) }, ["success", "result"]), example: { success: true, result: { downloadPath: "/srv/app/public/pdf/challans/Example Deductor Pvt Ltd/CSI", files: ["MUMB12345E_01042026_30062026.csi"] } } },
      { status: 400, description: "companyId or dates missing", schema: ref("ErrorMessage"), example: { error: "From date and to date are required for CSI download" } },
      companyNotFound, methodNotAllowed, unauthorized, plain500("CSI file download did not complete within 60s"),
    ],
  },

  // ═══════════════════════════════ 2.5 RETURN STATUS ═══════════════════════════════
  {
    folder: ["2. TDS on Expense", "2.5 e-TDS return filing status"], name: "Fetch statement status", method: "POST", path: "/api/return-status/fetch", tags: ["Return status"], mode: "sync",
    summary: "Read TRACES Statement Status (token, filing date, status) and save it",
    description: `${SYNC}\n\nEvery financialYears x quarters x formTypes combination is read. financialYears are start years ("2025" = FY 2025-26). quarters are TRACES codes: "3" = Q1, "4" = Q2, "5" = Q3, "6" = Q4. Combinations without a statement are left out. Saved per company + FY + quarter + form + token.`,
    body: obj({ companyId: int("Company id", 1), credentials: ref("PortalCredentials"), financialYears: arr({ type: "string" }, "FY start years", { example: ["2025"] }), quarters: arr({ type: "string", enum: ["3", "4", "5", "6"] }, "3=Q1, 4=Q2, 5=Q3, 6=Q4", { example: ["3", "4"] }), formTypes: arr({ type: "string", enum: ["24Q", "26Q", "27Q", "27EQ"] }, "Forms", { example: ["24Q", "26Q"] }) }, ["companyId", "credentials", "financialYears", "quarters", "formTypes"]),
    examples: [{ name: "Fetch statement status", body: { companyId: 1, credentials: CREDS, financialYears: ["2025"], quarters: ["3", "4"], formTypes: ["24Q", "26Q"] } }],
    responses: [
      { status: 200, description: "Statement status saved", schema: obj({ success: bool("true", true), data: arr(obj({ financialYear: str("Requested FY start year", "2025"), quarter: str("Requested quarter code", "3"), formType: str("Requested form", "26Q"), data: obj({ rows: arr(ref("ReturnStatusRow"), "Statements"), totalPages: int("Pages", 1), totalRecords: int("Records", 1) }) }), "Per combination with statements"), saved: int("Rows inserted", 1), updated: int("Rows updated", 0), errors: int("Rows that failed to save", 0), message: str("Summary", "Successfully fetched and saved return status data. Saved: 1, Updated: 0") }, ["success", "data", "saved", "updated"]),
        example: { success: true, data: [{ financialYear: "2025", quarter: "3", formType: "26Q", data: { rows: [{ finyear: "2025-26", quarter: "Q1", formtype: "26Q", tokenno: "7700XXXXXXX8491", dtoffiling: "31-Jul-2025", status: "Processed with Defaults", dtofprcng: "05-Aug-2025", stmnttype: "Regular", remarks: null, reason: null }], totalPages: 1, totalRecords: 1 } }], saved: 1, updated: 0, errors: 0, message: "Successfully fetched and saved return status data. Saved: 1, Updated: 0" } },
      { status: 400, description: "Missing parameters, or no statement found for any combination", schema: ref("SuccessFalseMessage"), example: { success: false, message: "No data received from portal" } },
      methodNotAllowed, unauthorized, { status: 500, description: "Portal automation failure", schema: ref("SuccessFalseMessage"), example: { success: false, message: "TRACES login failed" } },
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.5 e-TDS return filing status"], name: "Stored statement status (RPC)", method: "POST", path: "/api/rpc/getReturnStatus", tags: ["Return status"], rpc: true, mode: "read",
    summary: "Statement status rows saved by Fetch statement status", description: "Database read.",
    params: obj({ where: { type: "object", description: "Prisma filter, e.g. { \"companyId\": 1, \"finyear\": \"2025-26\" }" }, orderBy: { type: "object" }, skip: int("Offset", 0), take: int("Page size", 100) }),
    paramsExample: { where: { companyId: 1 }, skip: 0, take: 50 },
    result: obj({ returnStatus: arr({ allOf: [ref("ReturnStatusRow"), obj({ id: int("Id", 21), companyId: int("Company", 1), createdAt: str("ISO", "2026-10-12T08:00:00.000Z"), updatedAt: str("ISO", "2026-10-12T08:00:00.000Z"), company: obj({ id: int("Id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E") }) })] }, "Rows"), count: int("Total", 1) }, ["returnStatus", "count"]),
    resultExample: { returnStatus: [{ id: 21, companyId: 1, finyear: "2025-26", quarter: "Q1", formtype: "26Q", tokenno: "7700XXXXXXX8491", dtoffiling: "31-Jul-2025", status: "Processed with Defaults", dtofprcng: "05-Aug-2025", stmnttype: "Regular", remarks: null, reason: null, rejectionMsg: "", createdAt: "2026-10-12T08:00:00.000Z", updatedAt: "2026-10-12T08:00:00.000Z", company: { id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E" } }], count: 1 },
  },
  {
    folder: ["2. TDS on Expense", "2.5 e-TDS return filing status"], name: "Statement status - full year", method: "POST", path: "/api/clause-34b/fetch", tags: ["Return status"], mode: "sync",
    summary: "Read all 16 quarter x form statements of one FY for a company (by TAN) and save them",
    description: `${SYNC} (about 1-3 minutes)\n\nUses the TRACES credentials stored on the company. financialYear is the start year ("2025"). rows in the response is a count; read the saved rows with getReturnStatus. HTTP 200 with success false when some combinations failed or the company is unknown.`,
    body: obj({ tan: str("Company TAN", "MUMB12345E"), financialYear: str("FY start year", "2025") }, ["tan", "financialYear"]),
    examples: [{ name: "Statement status - full year", body: { tan: "MUMB12345E", financialYear: "2025" } }],
    responses: [
      { status: 200, description: "Done (check success and failedCombinations)", schema: obj({ success: bool("false if any combination failed", true), tan: str("TAN", "MUMB12345E"), companyName: str("Company", "Example Deductor Pvt Ltd"), rows: int("Statements saved (count)", 9), originals: int("Regular statements", 7), emptyCombinations: arr({ type: "string" }, "Combinations with no statement", { example: ["24Q Q1"] }), failedCombinations: arr(obj({ combination: str("e.g. 26Q Q2", "26Q Q2"), error: str("Reason", "Timeout") }), "Failed combinations"), error: str("Overall error", undefined) }, ["success", "rows"]),
        example: { success: true, tan: "MUMB12345E", companyName: "Example Deductor Pvt Ltd", rows: 9, originals: 7, emptyCombinations: ["24Q Q1", "27Q Q1", "27EQ Q1"], failedCombinations: [] } },
      { status: 400, description: "tan or financialYear missing", schema: ref("SuccessFalseError"), example: { success: false, error: "tan is required" } },
      { status: 405, description: "Wrong HTTP method", schema: ref("SuccessFalseError"), example: { success: false, error: "Method not allowed" } },
      unauthorized, portal500("No result returned"),
    ],
  },

  // ═══════════════════════════════ 2.6 DEMAND ═══════════════════════════════
  {
    folder: ["2. TDS on Expense", "2.6 Demand / defaults"], name: "Fetch outstanding demand", method: "POST", path: "/api/outstanding-demand/fetch", tags: ["Demand"], mode: "sync",
    summary: "Read TRACES outstanding demand per FY (AO and CPC-TDS) and save it",
    description: `${SYNC}\n\nPrior-year summary rows are expanded into individual years. Saved per company + FY.`,
    body: obj({ companyId: int("Company id", 1), credentials: ref("PortalCredentials") }, ["companyId", "credentials"]),
    examples: [{ name: "Fetch outstanding demand", body: { companyId: 1, credentials: CREDS } }],
    responses: [
      { status: 200, description: "Demand saved", schema: obj({ success: bool("true", true), data: arr(ref("DemandRow"), "Demand per FY"), saved: int("Inserted", 2), updated: int("Updated", 0), errors: int("Failed to save", 0), message: str("Summary", "Successfully fetched and saved outstanding demand data. Saved: 2, Updated: 0") }, ["success", "data"]),
        example: { success: true, data: [{ finYr: "2025-26", fin: 2025, aodmnd: "0.00", cpcdmd: "1250.00" }, { finYr: "2014-15", fin: 2014, aodmnd: "0.00", cpcdmd: "340.00" }], saved: 2, updated: 0, errors: 0, message: "Successfully fetched and saved outstanding demand data. Saved: 2, Updated: 0" } },
      { status: 400, description: "Missing parameters, or no data from TRACES", schema: ref("SuccessFalseMessage"), example: { success: false, message: "Missing required parameters" } },
      methodNotAllowed, unauthorized, { status: 500, description: "Portal automation failure", schema: ref("SuccessFalseMessage"), example: { success: false, message: "TRACES login failed" } },
    ],
  },
  {
    folder: ["2. TDS on Expense", "2.6 Demand / defaults"], name: "Stored outstanding demand (RPC)", method: "POST", path: "/api/rpc/getOutstandingDemand", tags: ["Demand"], rpc: true, mode: "read",
    summary: "Outstanding demand rows saved by Fetch outstanding demand", description: "Database read.",
    params: obj({ where: { type: "object", description: "Prisma filter, e.g. { \"companyId\": 1 }" }, orderBy: { type: "object" }, skip: int("Offset", 0), take: int("Page size", 100) }),
    paramsExample: { where: { companyId: 1 }, skip: 0, take: 50 },
    result: obj({ outstandingDemand: arr(obj({ id: int("Id", 1), companyId: int("Company", 1), finYr: str("FY", "2025-26"), fin: str("FY start", "2025"), aodmnd: str("AO demand", "0.00"), cpcdmd: str("CPC demand", "1250.00"), createdAt: str("ISO", "2026-10-12T08:00:00.000Z"), updatedAt: str("ISO", "2026-10-12T08:00:00.000Z"), company: obj({ id: int("Id", 1), name: str("Name", "Example Deductor Pvt Ltd"), tan: str("TAN", "MUMB12345E") }) }), "Rows"), count: int("Total", 1) }, ["outstandingDemand", "count"]),
    resultExample: { outstandingDemand: [{ id: 1, companyId: 1, finYr: "2025-26", fin: "2025", aodmnd: "0.00", cpcdmd: "1250.00", createdAt: "2026-10-12T08:00:00.000Z", updatedAt: "2026-10-12T08:00:00.000Z", company: { id: 1, name: "Example Deductor Pvt Ltd", tan: "MUMB12345E" } }], count: 1 },
  },

  // ═══════════════════════════════ 2.8 CERTIFICATE EXTRACTION ═══════════════════════════════
  {
    folder: ["2. TDS on Expense", "2.8 TDS certificate extraction (TRACES PDF converter)"], name: "Generate Form 16 / 16A PDFs from ZIPs", method: "POST", path: "/api/rpc/generateForm16PdfsFromZips", tags: ["Certificate extraction"], rpc: true, mode: "sync",
    summary: "Convert TRACES Form 16 / 16A ZIPs into PDFs (TRACES PDF Converter logic)",
    description: `${SYNC}\n\nsourceFolder is a folder on the server holding the TRACES ZIPs (normally the Form 16 / 16A download folder). The ZIP password is the TAN. Writes one PDF per deductee (Form 16A) to public/pdf/form16a/{Company}/{form}_FY{fy}_{quarter}/ plus an Excel to public/pdf/traces_excel/{Company}/. Processing problems come back as success false with errors[] (not an RPC error).`,
    params: obj({ sourceFolder: str("Server folder with the ZIPs", "public/pdf/form16a-download/Example Deductor Pvt Ltd"), companyName: str("Company name", "Example Deductor Pvt Ltd"), tan: str("TAN (ZIP password)", "MUMB12345E"), financialYear: str("FY", "2026-27"), quarter: str("Quarter", "Q1"), formType: str("26Q / 27Q / 130 / 131 / 133 ...", "131"), form16Type: str("form16 or form16a", "form16a", { enum: ["form16", "form16a"] }), skipExisting: bool("Skip PDFs that already exist (default true)", true) }, ["sourceFolder", "companyName", "tan", "financialYear", "quarter", "formType", "form16Type"]),
    paramsExample: { sourceFolder: "public/pdf/form16a-download/Example Deductor Pvt Ltd", companyName: "Example Deductor Pvt Ltd", tan: "MUMB12345E", financialYear: "2026-27", quarter: "Q1", formType: "131", form16Type: "form16a", skipExisting: true },
    result: obj({ success: bool("At least one ZIP processed without error", true), processedZips: int("ZIPs", 2), generatedPdfs: int("PDFs generated", 148), skippedPdfs: int("Existing PDFs skipped", 0), generatedExcel: str("Excel written", "..."), outputDir: str("PDF folder", "..."), errors: arr({ type: "string" }, "Problems per ZIP"), message: str("Summary", "Processed 2 zip(s). Generated 148 PDF(s)."), logs: arr({ type: "string" }, "Processing log") }, ["success", "processedZips", "generatedPdfs", "errors", "message"]),
    resultExample: { success: true, processedZips: 2, generatedPdfs: 148, skippedPdfs: 0, generatedExcel: "/srv/app/public/pdf/traces_excel/Example Deductor Pvt Ltd/MUMB12345E_131_Q1.xlsx", outputDir: "/srv/app/public/pdf/form16a/Example Deductor Pvt Ltd/131_FY2026-27_Q1", errors: [], message: "Processed 2 zip(s). Generated 148 PDF(s).", logs: ["Found 2 zip file(s)"] },
  },

  // ═══════════════════════════════ 3. EXPORTS & OTHER ═══════════════════════════════
  {
    folder: ["3. Exports"], name: "Export (Excel / CSV / PDF)", method: "POST", path: "/api/export/{feature}", tags: ["Exports"], mode: "binary",
    summary: "Download stored data as Excel, CSV or PDF",
    description: "feature: tldc, ldc-utilisation, outstanding-demand, return-status, rrr, form140, deductee-masters. Filters: companyId and fy (tldc, ldc-utilisation, outstanding-demand, return-status), search (tldc, ldc-utilisation, deductee-masters), formTypeCd (form140: T140 or F26Q). Returns the file with Content-Disposition: attachment.",
    pathParams: [{ name: "feature", required: true, schema: str("Data set", "tldc", { enum: exportFeatureEnum }), description: "Data set to export" }],
    body: obj({ format: str("File type", "xlsx", { enum: ["xlsx", "csv", "pdf"] }), companyId: int("Company id (optional)", 1), fy: str("FY exact value (optional)", "2026-27"), search: str("Text search (optional)", undefined), formTypeCd: str("form140 only: T140 (default) or F26Q", undefined, { enum: ["T140", "F26Q"] }) }, ["format"]),
    examples: [
      { name: "Export LDC certificates", path: { feature: "tldc" }, body: { format: "xlsx", companyId: 1, fy: "2026-27" }, folder: ["1. LDC - Lower Deduction Certificates"] },
      { name: "Export LDC utilisation", path: { feature: "ldc-utilisation" }, body: { format: "xlsx", companyId: 1 }, folder: ["1. LDC - Lower Deduction Certificates"] },
      { name: "Export statement status", path: { feature: "return-status" }, body: { format: "xlsx", companyId: 1 }, folder: ["2. TDS on Expense", "2.5 e-TDS return filing status"] },
      { name: "Export outstanding demand", path: { feature: "outstanding-demand" }, body: { format: "xlsx", companyId: 1 }, folder: ["2. TDS on Expense", "2.6 Demand / defaults"] },
      { name: "Export RRR extract", path: { feature: "rrr" }, body: { format: "xlsx" } },
      { name: "Export Form 140 extract", path: { feature: "form140" }, body: { format: "xlsx", formTypeCd: "T140" } },
    ],
    responses: [
      { status: 200, description: "File (xlsx / csv / pdf) with Content-Disposition: attachment; filename=\"tldc-2026-27-2026-10-12.xlsx\"", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", binary: true },
      { status: 400, description: "Unknown feature or invalid format", schema: ref("SuccessFalseError"), example: { success: false, error: "Invalid or missing format. Use \"xlsx\", \"csv\", or \"pdf\"." } },
      { status: 404, description: "No rows for the filters", schema: ref("SuccessFalseError"), example: { success: false, error: "No data to export for the selected filters" } },
      { status: 405, description: "Wrong HTTP method", schema: ref("SuccessFalseError"), example: { success: false, error: "Method not allowed" } },
      unauthorized, portal500("Failed to export data"),
    ],
  },
  {
    folder: ["4. Other extracts (IT portal)"], name: "Extract RRR numbers", method: "POST", path: "/api/rrr/extract", tags: ["Other extracts"], mode: "sync",
    summary: "Read TDS return RRR / acknowledgement numbers from the Income Tax portal",
    description: `${SYNC}\n\nformTypes "24Q" / "26Q" etc. financialYears are start years ("2025"); quarters "Q1".."Q4". Results are merged into public/pdf/return/rrr-extract/rrr_extract.json and .csv.`,
    body: obj({ companyIds: arr({ type: "integer" }, "Company ids", { example: [1] }), companyId: int("Single company (instead of companyIds)", undefined), formTypes: arr({ type: "string" }, "Forms", { example: ["24Q", "26Q"] }), financialYears: arr({ type: "string" }, "FY start years", { example: ["2025"] }), quarters: arr({ type: "string" }, "Q1..Q4", { example: ["Q1"] }), concurrency: int("Parallel companies 1-4 (default 2)", 2, { minimum: 1, maximum: 4 }) }, ["formTypes", "financialYears", "quarters"]),
    examples: [{ name: "Extract RRR numbers", body: { companyIds: [1], formTypes: ["24Q", "26Q"], financialYears: ["2025"], quarters: ["Q1"], concurrency: 2 } }],
    responses: [
      { status: 200, description: "Extracted (success false when some companies failed)", schema: obj({ success: bool("All companies succeeded", true), rows: arr(obj({ "Company Name": str("Company", "Example Deductor Pvt Ltd"), "Financial year": str("FY", "2025"), Quarter: str("Quarter", "Q1"), "Filing Type": str("O = original, C = correction", "O"), returnType: str("Form", "F26Q"), "Date of Tds return": str("Filing date", "31-Jul-2025"), "RRR number": str("RRR / token", "987654321"), "Acknowledgement number": str("Ack no.", "123456789012345") }), "Rows from this run"), results: arr(obj({ companyId: int("Company", 1), companyName: str("Company", "Example Deductor Pvt Ltd"), success: bool("Succeeded", true), rows: arr({ type: "object" }, "Rows"), error: str("Reason", undefined) }), "Per company"), totalRows: int("Rows in the merged file", 88), jsonPath: str("Merged JSON", "/pdf/return/rrr-extract/rrr_extract.json"), csvPath: str("Merged CSV", "/pdf/return/rrr-extract/rrr_extract.csv"), message: str("Summary", "Done in 20.1s. Success: 1, Errors: 0, Rows this run: 1, Total saved: 88") }, ["success", "rows", "results"]),
        example: { success: true, rows: [{ "Company Name": "Example Deductor Pvt Ltd", "Financial year": "2025", Quarter: "Q1", "Filing Type": "O", returnType: "F26Q", "Date of Tds return": "31-Jul-2025", "RRR number": "987654321", "Acknowledgement number": "123456789012345" }], results: [{ companyId: 1, companyName: "Example Deductor Pvt Ltd", success: true, rows: [] }], totalRows: 88, jsonPath: "/pdf/return/rrr-extract/rrr_extract.json", csvPath: "/pdf/return/rrr-extract/rrr_extract.csv", message: "Done in 20.1s. Success: 1, Errors: 0, Rows this run: 1, Total saved: 88" } },
      { status: 400, description: "Missing filters or company", schema: ref("SuccessFalseError"), example: { success: false, error: "formTypes, financialYears, and quarters are required" } },
      { status: 404, description: "No companies found", schema: ref("SuccessFalseError"), example: { success: false, error: "No companies found" } },
      { status: 405, description: "Wrong HTTP method", schema: ref("SuccessFalseError"), example: { success: false, error: "Method not allowed" } },
      unauthorized, portal500("Failed to extract RRR numbers"),
    ],
  },
  {
    folder: ["4. Other extracts (IT portal)"], name: "Extract Form 140 / 26Q acknowledgements", method: "POST", path: "/api/form140/extract", tags: ["Other extracts"], mode: "sync",
    summary: "Download filing acknowledgements (Form 140 or Form 26Q) from the Income Tax portal",
    description: `${SYNC}\n\nformTypeCd T140 (default) or F26Q. Receipt PDFs are saved under public/pdf/Acknowledgement/{form140|form26q}/ and returned as PDF paths in each row; results are merged into {form}_extract.json / .xlsx.`,
    body: obj({ companyIds: arr({ type: "integer" }, "Company ids", { example: [1] }), companyId: int("Single company (instead of companyIds)", undefined), formTypeCd: str("T140 (default) or F26Q", "T140", { enum: ["T140", "F26Q"] }), financialYears: arr({ type: "string" }, "FY start years (default all)", { example: ["2025"] }), quarters: arr({ type: "string" }, "Q1..Q4 (default all)", { example: ["Q1"] }), concurrency: int("Parallel companies 1-4 (default 2)", 2), skipExistingPdfs: bool("Skip receipts already downloaded (default true)", true) }),
    examples: [{ name: "Extract Form 140 / 26Q acknowledgements", body: { companyIds: [1], formTypeCd: "T140", financialYears: ["2025"], quarters: ["Q1"], concurrency: 2 } }],
    responses: [
      { status: 200, description: "Extracted (success false when some companies failed)", schema: obj({ success: bool("All companies succeeded", true), formTypeCd: str("Form", "T140"), rows: arr(obj({ "Company Name": str("Company", "Example Deductor Pvt Ltd"), TAN: str("TAN", "MUMB12345E"), "Form Type": str("T140 / F26Q", "T140"), Status: str("Portal status", "Verified"), "Acknowledgement No": str("Ack", "123456789012345"), "RRR Number": str("RRR", "987654321"), PDF: str("Receipt path ('' if not downloaded)", "/pdf/Acknowledgement/form140/Example_Deductor_Pvt_Ltd/2025-26/Q1/123456789012345_receipt.pdf"), "Financial Year": str("FY", "2025"), Quarter: str("Quarter", "Q1"), "Filing Date": str("Date", "31-Jul-2025") }), "Rows from this run"), results: arr(obj({ companyId: int("Company", 1), companyName: str("Company", "Example Deductor Pvt Ltd"), success: bool("Succeeded", true), rows: arr({ type: "object" }, "Rows"), error: str("Reason", undefined) }), "Per company"), totalRows: int("Rows in merged file", 154), jsonPath: str("Merged JSON", "/pdf/Acknowledgement/form140/form140_extract.json"), xlsxPath: str("Merged Excel", "/pdf/Acknowledgement/form140/form140_extract.xlsx"), message: str("Summary", "Done in 42.3s. Form: T140. Success: 1, Errors: 0") }, ["success", "rows", "results"]),
        example: { success: true, formTypeCd: "T140", rows: [{ "Company Name": "Example Deductor Pvt Ltd", TAN: "MUMB12345E", "Form Type": "T140", Status: "Verified", "Acknowledgement No": "123456789012345", "RRR Number": "987654321", PDF: "/pdf/Acknowledgement/form140/Example_Deductor_Pvt_Ltd/2025-26/Q1/123456789012345_receipt.pdf", "Financial Year": "2025", Quarter: "Q1", "Filing Date": "31-Jul-2025" }], results: [{ companyId: 1, companyName: "Example Deductor Pvt Ltd", success: true, rows: [] }], totalRows: 154, jsonPath: "/pdf/Acknowledgement/form140/form140_extract.json", xlsxPath: "/pdf/Acknowledgement/form140/form140_extract.xlsx", message: "Done in 42.3s. Form: T140. Success: 1, Errors: 0, Rows this run: 1, Total saved: 154" } },
      { status: 400, description: "No company given", schema: ref("SuccessFalseError"), example: { success: false, error: "Upload companies CSV or provide companyId/companyIds" } },
      { status: 404, description: "No companies found", schema: ref("SuccessFalseError"), example: { success: false, error: "No companies found" } },
      { status: 405, description: "Wrong HTTP method", schema: ref("SuccessFalseError"), example: { success: false, error: "Method not allowed" } },
      unauthorized, portal500("Failed to extract acknowledgement receipts"),
    ],
  },
]

module.exports = { catalog, RPC_NOTE }
