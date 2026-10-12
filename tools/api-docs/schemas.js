/**
 * Reusable OpenAPI component schemas for the client-facing API catalog.
 * Shapes are taken from the route / resolver code (see catalog.js for the endpoint list).
 */
const str = (description, example, extra = {}) => ({ type: "string", description, example, ...extra })
const int = (description, example, extra = {}) => ({ type: "integer", description, example, ...extra })
const num = (description, example, extra = {}) => ({ type: "number", description, example, ...extra })
const bool = (description, example, extra = {}) => ({ type: "boolean", description, example, ...extra })
const arr = (items, description, extra = {}) => ({ type: "array", items, description, ...extra })
const obj = (properties, required, description, extra = {}) => ({
  type: "object",
  ...(description ? { description } : {}),
  ...(required && required.length ? { required } : {}),
  properties,
  ...extra,
})
const ref = (name) => ({ $ref: `#/components/schemas/${name}` })
const nullable = (schema) => ({ ...schema, nullable: true })

const schemas = {
  // ── Common errors ──────────────────────────────────────────────
  Unauthorized: obj({ error: str("Always \"Unauthorized\"", "Unauthorized") }, ["error"], "Missing, invalid, expired or revoked API token."),
  ErrorMessage: obj({ error: str("Error description", "Missing company ID") }, ["error"]),
  SuccessFalseError: obj({ success: bool("Always false", false), error: str("Error description", "Failed to run challan status") }, ["success", "error"]),
  SuccessFalseMessage: obj({ success: bool("Always false", false), message: str("Error description", "Missing required parameters") }, ["success", "message"]),
  FileError: obj({ message: str("Error description", "File not found") }, ["message"]),

  // ── Credentials ────────────────────────────────────────────────
  PortalCredentials: obj(
    {
      userId: str("TRACES user ID of the deductor", "MUMB12345E"),
      password: str("TRACES password", "********", { format: "password" }),
      tan: str("TAN (10 characters)", "MUMB12345E"),
    },
    ["userId", "password", "tan"],
    "TRACES login of the deductor. All three fields are required and must be non-empty."
  ),
  CompanyCredentials: obj(
    {
      name: str("Deductor / company name (used for output folder names)", "Example Deductor Pvt Ltd"),
      tan: str("TAN; the company is created or updated by TAN", "MUMB12345E"),
      it_password: str("Income Tax e-filing portal password", "********", { format: "password" }),
      user_id: str("TRACES user ID", "MUMB12345E"),
      password: str("TRACES password", "********", { format: "password" }),
    },
    ["name", "tan", "it_password", "user_id", "password"],
    "Company row used by the batch (async) jobs. A company not yet in the system is created; an existing one has its name and credentials updated."
  ),

  // ── RPC envelope ───────────────────────────────────────────────
  RpcError: obj(
    {
      name: str("Error class", "AuthenticationError", { enum: ["AuthenticationError", "NotFoundError", "ZodError", "PaginationArgumentError", "Error"] }),
      message: str("Error message. For ZodError this is a JSON string of the validation issues.", "You must be logged in to access this"),
      code: nullable(str("Prisma error code when applicable", null)),
      statusCode: int("Logical status (the HTTP status of the response is still 200)", 401),
      meta: nullable({ type: "object", description: "Extra error data (e.g. Prisma target)" }),
      url: nullable(str("Unused", null)),
    },
    ["name", "message", "statusCode"],
    "Error thrown inside an RPC resolver. Returned with HTTP 200 inside the RPC envelope."
  ),
  RpcErrorEnvelope: obj(
    {
      result: nullable({ type: "object", description: "Always null on error", example: null }),
      error: ref("RpcError"),
      meta: { type: "object", description: "Serializer metadata; ignore" },
    },
    ["result", "error"],
    "RPC failure. HTTP status is 200; check `error`."
  ),

  // ── LDC ────────────────────────────────────────────────────────
  TldcRecord: obj(
    {
      id: int("Internal row id", 11),
      companyId: int("Deductor company id", 1),
      act: str("Income-tax Act: old = 1961 (FY up to 2025-26), new = 2025 (tax year 2026-27 onwards)", "new", { enum: ["old", "new"] }),
      fy: str("Financial / tax year", "2026-27"),
      certNumber: str("Certificate number (update key with companyId + fy)", "4AD0426ILB4A140"),
      din: str("Old Act: DIN in the 197 inbox. New Act: parent certificate number. Reference only.", "4AD0426ILB"),
      pan: str("Deductee PAN", "ABCDE1234F"),
      panName: str("Deductee name", "EXAMPLE VENDOR LLP"),
      section: str("Section code as returned by TRACES (old e.g. 94J, new e.g. 1027)", "1027"),
      sectionDesc: nullable(str("Statutory section for the code", "393(1) [Table: Sl. No. 6(iii).D(b)]")),
      natureOfPayment: str("Nature of payment as shown on TRACES (not taken from the PDF)", "Any sum by way of (a) fees for professional services ..."),
      tdsRate: num("TDS rate % as per certificate", 3),
      tdsAmountLimit: num("Certificate limit (INR)", 900000),
      tdsAmountConsumed: num("Amount consumed as per TRACES (INR)", 0),
      tdsAmountBalance: num("limit - consumed, minimum 0 (INR)", 900000),
      issueDate: nullable(str("Date of issue, DD-MM-YYYY (IST)", "20-03-2026")),
      validFrom: nullable(str("Valid from, DD-MM-YYYY (IST)", "24-04-2026")),
      validTo: nullable(str("Valid to, DD-MM-YYYY (IST)", "31-03-2027")),
      cancelDate: nullable(str("Cancellation (valid-till) date, DD-MM-YYYY (IST). Old Act only; null for new Act.", null)),
      isActive: bool("false = cancelled on TRACES", true),
      pdfUrl: nullable(str("GET this path with the same Bearer token to download the certificate PDF; null until TRACES has prepared it", "/api/file/pdf/child-certificates/Example%20Deductor%20Pvt%20Ltd/298942.pdf")),
      lastSyncedAt: str("When the row was last written from TRACES (ISO-8601 UTC)", "2026-07-30T11:05:36.144Z", { format: "date-time" }),
    },
    ["id", "companyId", "act", "fy", "certNumber", "pan", "section", "isActive"],
    "LDC certificate in the client field set."
  ),
  TldcWarning: obj(
    {
      certNumber: str("Certificate concerned", "4AD0426ILB4A141"),
      errorCode: str("Warning code", "LDC_CERT_DETAIL_FAILED", { enum: ["LDC_CERT_NOT_FOUND", "LDC_CERT_DETAIL_FAILED"] }),
      message: str("Details", "Certificate detail unavailable; saved from search results only"),
    },
    ["certNumber", "errorCode", "message"],
    "Per-certificate problem in an otherwise successful run."
  ),
  TldcError: obj(
    {
      success: bool("Always false", false),
      errorCode: str("Error code (see LDC error catalogue)", "LDC_AUTH_INVALID", {
        enum: [
          "LDC_INVALID_INPUT", "LDC_COMPANY_NOT_FOUND", "LDC_AUTH_INVALID", "LDC_CAPTCHA_FAILED",
          "LDC_CAPTCHA_SERVICE_UNAVAILABLE", "LDC_SESSION_EXPIRED", "LDC_PORTAL_UNAVAILABLE",
          "LDC_TIMEOUT", "LDC_PDF_DOWNLOAD_FAILED", "LDC_INTERNAL_ERROR",
        ],
      }),
      message: str("Human-readable message", "TRACES login failed (non-retryable): ... Invalid User ID / Password"),
      retryable: bool("true if the same call can succeed later without changes", false),
    },
    ["success", "errorCode", "message", "retryable"],
    "Error returned by every LDC endpoint (HTTP 400/401/404/5xx)."
  ),

  // ── Batch jobs ─────────────────────────────────────────────────
  BatchCreated: obj(
    {
      message: str("Confirmation", "Companies added to queue successfully"),
      batchId: int("Batch id; use with the job-monitoring calls", 42),
      companyCount: int("Companies in the request", 1),
      taskCount: int("Tasks queued (companies x periods)", 2),
    },
    ["message", "batchId", "companyCount", "taskCount"]
  ),
  BatchProgressItem: obj(
    {
      taskId: int("Task id", 101),
      status: str("Task status", "Finished", { enum: ["Queued", "Started/In-Progress", "Finished", "Failed", "Cancelled", "Removed"] }),
      companyName: str("Company", "Example Deductor Pvt Ltd"),
      tan: str("TAN", "MUMB12345E"),
      financialYear: str("FY of this task, or N/A", "2025-26"),
      quarter: str("Quarter of this task, or N/A", "Q1"),
      formType: str("Form type of this task, or N/A", "26Q"),
      errorMessage: nullable(str("Failure reason", null)),
      updatedAt: str("Last update (ISO)", "2026-10-12T08:03:11.000Z", { format: "date-time" }),
    },
    ["taskId", "status", "companyName", "tan"]
  ),
  BatchProgress: obj(
    {
      batchId: int("Batch id", 42),
      createdAt: nullable(str("Batch creation time (ISO); null if the batch does not exist", "2026-10-12T08:00:00.000Z", { format: "date-time" })),
      actionType: nullable(str("send_request / download_file / sign_pdf", "send_request")),
      counts: obj(
        {
          total: int("All tasks", 4), queued: int("Queued", 1), inProgress: int("Running", 1),
          finished: int("Finished", 1), failed: int("Failed", 1), other: int("Cancelled / removed", 0),
        },
        ["total", "queued", "inProgress", "finished", "failed", "other"]
      ),
      percent: int("(finished + failed) / total x 100, rounded", 50),
      isComplete: bool("true when every task is finished or failed", false),
      items: arr(ref("BatchProgressItem"), "One entry per task, ordered by taskId"),
    },
    ["batchId", "counts", "percent", "isComplete", "items"],
    "Progress of an async batch. An unknown batchId returns zero counts and an empty items list."
  ),
  RetryResult: obj(
    {
      success: bool("Always true", true),
      retriedCount: int("Tasks re-queued", 1),
      taskIds: arr({ type: "integer" }, "Re-queued task ids", { example: [102] }),
      actionType: nullable(str("Batch action (conso / justification only)", "send_request")),
      message: str("Summary", "Queued 1 failed task(s) for retry"),
    },
    ["success", "retriedCount", "taskIds", "message"]
  ),

  // ── Challans / payment history ─────────────────────────────────
  ChallanCreateResult: obj(
    {
      sectionCode: str("Section code sent", "94C"),
      sectionDesc: str("Section number from the code table (empty on old-Act failure)", "194C"),
      amount: str("Amount sent", "25000"),
      success: bool("Challan created for this section", true),
      pymntRefNum: str("Payment reference number (PRN), when created", "26041500012345"),
      error: str("Failure reason, when not created", undefined),
    },
    ["sectionCode", "amount", "success"]
  ),
  PaymentHistoryRow: obj(
    {
      cin: str("Challan identification number", "26060700012345ABCD"),
      brnNum: str("Bank reference number", "12345"),
      assessmentYear: str("Assessment / tax year", "2027-28"),
      paymentType: str("Payment type", "TDS/TCS Payable by Taxpayer(200)"),
      minorHead: str("Minor head", "200"),
      minorDesc: str("Minor head description", "TDS/TCS Payable by Taxpayer"),
      amount: num("Amount (INR)", 25000),
      paymentTime: str("Payment time as shown on e-Pay", "07-Jun-2026 16:48:27"),
      crn: str("Challan reference number", "26041500012345"),
      tileId: str("Portal tile id", "TDS"),
      actType: str("O = Income-tax Act 1961, N = Income-tax Act 2025", "N", { enum: ["O", "N"] }),
    },
    ["cin"],
    "Payment-history row as returned by the e-Pay portal (extra portal keys may appear)."
  ),
  PaymentHistoryRowWithPdf: {
    allOf: [
      ref("PaymentHistoryRow"),
      obj({
        pdfExists: bool("Receipt PDF already downloaded", false),
        expectedPdfPath: str("Server path of the receipt PDF", ".../PaymentHistory/26060700012345ABCD_ChallanReceipt.pdf"),
        challanStatusInExcel: nullable(bool("Present in the TRACES challan-status Excel (payment-history-gaps only)", null)),
      }),
    ],
  },
  PaymentHistoryGaps: obj(
    {
      summary: obj({
        totalPayments: int("Payments", 12), pdfsPresent: int("Receipts present", 10), pdfsMissing: int("Receipts missing", 2),
        companyName: str("Company", "Example Deductor Pvt Ltd"), paymentHistoryDir: str("Server folder", ".../PaymentHistory"),
      }),
      present: arr(ref("PaymentHistoryRowWithPdf"), "Payments whose receipt is present"),
      missing: arr(ref("PaymentHistoryRowWithPdf"), "Payments whose receipt is missing"),
      all: arr(ref("PaymentHistoryRowWithPdf"), "All payments"),
      fetchedAt: str("When the cache was written (cached reads only)", "2026-10-10T09:12:00.000Z"),
      financialYears: arr({ type: "string" }, "FY filter used (cached reads only)", { example: ["2026-27"] }),
    },
    ["summary", "present", "missing"]
  ),
  DownloadStats: obj(
    {
      totalSeen: int("Rows seen on the portal", 48), skipped: int("Already downloaded", 40),
      downloaded: int("Downloaded now", 8), pages: int("Grid pages read", 1),
    },
    ["totalSeen", "skipped", "downloaded", "pages"]
  ),
  TargetedDownloadStats: {
    allOf: [
      ref("DownloadStats"),
      obj({ matched: int("Targets matched", 2), notFound: int("Targets not found", 1), failed: int("Downloads failed", 0) }),
    ],
  },
  MissingPdfResult: {
    allOf: [
      ref("DownloadStats"),
      obj({
        dateRangesProcessed: int("0 or 1", 1),
        stillMissing: int("Receipts still missing", 0),
        dayGroups: arr(obj({ dayKey: str("Date range", "06-Jun-2026_to_08-Jul-2026"), count: int("Receipts", 4) }), "Date ranges used"),
        downloadedCins: arr({ type: "string" }, "CINs downloaded in this run", { example: ["26060700012345ABCD"] }),
      }),
    ],
  },
  CoverageReport: obj(
    {
      companyName: str("Company", "Example Deductor Pvt Ltd"),
      excelPath: str("Challan-status Excel path", ".../challan_status_results/Example Deductor Pvt Ltd_challan_status.xlsx"),
      excelExists: bool("Excel present", true),
      excelRowCount: int("Rows in Excel", 30),
      totalPdfsParsed: int("Receipts parsed", 10),
      inExcel: int("Receipts found in Excel", 9),
      notInExcel: int("Receipts not in Excel", 1),
      checkedAt: str("When checked (ISO)", "2026-10-10T09:15:00.000Z"),
      items: arr(
        obj({
          cin: str("CIN", "26060700012345ABCD"), bsr: str("BSR code", "0510308"), csn: str("Challan serial no.", "05488"),
          challanAmount: num("Amount", 25000), date: str("Deposit date", "07-Jun-2026"),
          pdfFileName: str("Receipt file", "26060700012345ABCD_ChallanReceipt.pdf"), pdfPath: str("Server path", "..."),
          inChallanStatusExcel: bool("Found in Excel", true),
        }),
        "One entry per parsed receipt"
      ),
    },
    ["companyName", "inExcel", "notInExcel"]
  ),

  // ── TRACES statements / demand ─────────────────────────────────
  ReturnStatusRow: obj(
    {
      finyear: str("Financial year as shown on TRACES", "2025-26"),
      quarter: str("Quarter as shown on TRACES", "Q1"),
      formtype: str("Form", "26Q"),
      tokenno: str("Token / RRR number (masked by TRACES)", "7700XXXXXXX8491"),
      dtoffiling: str("Date of filing", "31-Jul-2025"),
      status: str("Statement status", "Processed with Defaults"),
      dtofprcng: str("Date of processing", "05-Aug-2025"),
      stmnttype: str("Regular or Correction", "Regular"),
      remarks: nullable(str("Remarks", null)),
      reason: nullable(str("Reason", null)),
      rejectionMsg: str("Rejection reason (rejected statements only)", undefined),
    },
    ["finyear", "quarter", "formtype", "tokenno", "dtoffiling", "status"]
  ),
  DemandRow: obj(
    {
      finYr: str("Financial year", "2025-26"),
      fin: int("Financial year start", 2025),
      aodmnd: str("Demand raised by Assessing Officer (INR)", "0.00"),
      cpcdmd: str("Demand raised by CPC-TDS (INR)", "1250.00"),
    },
    ["finYr", "aodmnd", "cpcdmd"]
  ),
}

module.exports = { schemas, str, int, num, bool, arr, obj, ref, nullable }
