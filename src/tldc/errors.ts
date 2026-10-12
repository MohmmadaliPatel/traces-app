import type { NextApiResponse } from "next"

/**
 * Error catalogue for the TLDC (Lower Deduction Certificate) API routes.
 *
 * Every failed TLDC response is `{ success: false, errorCode, message, retryable }`.
 * Per-certificate problems inside an otherwise successful run are reported in
 * `warnings[]` with the `LDC_CERT_*` codes and do not fail the call.
 */

export type TldcErrorCode =
  | "LDC_INVALID_INPUT"
  | "LDC_COMPANY_NOT_FOUND"
  | "LDC_AUTH_INVALID"
  | "LDC_CAPTCHA_FAILED"
  | "LDC_CAPTCHA_SERVICE_UNAVAILABLE"
  | "LDC_SESSION_EXPIRED"
  | "LDC_PORTAL_UNAVAILABLE"
  | "LDC_TIMEOUT"
  | "LDC_PDF_DOWNLOAD_FAILED"
  | "LDC_CERT_NOT_FOUND"
  | "LDC_CERT_DETAIL_FAILED"
  | "LDC_INTERNAL_ERROR"

export type TldcErrorDef = {
  httpStatus: number
  retryable: boolean
  description: string
}

export const TLDC_ERRORS: Record<TldcErrorCode, TldcErrorDef> = {
  LDC_INVALID_INPUT: {
    httpStatus: 400,
    retryable: false,
    description: "A required field is missing or malformed (tan, fy/year, companyId, credentials).",
  },
  LDC_COMPANY_NOT_FOUND: {
    httpStatus: 404,
    retryable: false,
    description: "No company matches the given companyId / TAN.",
  },
  LDC_AUTH_INVALID: {
    httpStatus: 401,
    retryable: false,
    description:
      "TRACES rejected the login (wrong user ID / password / TAN, or account locked). Fix credentials before retrying.",
  },
  LDC_CAPTCHA_FAILED: {
    httpStatus: 502,
    retryable: true,
    description: "TRACES captcha could not be solved after 5 automatic attempts.",
  },
  LDC_CAPTCHA_SERVICE_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    description: "The captcha decoding service is not configured or not reachable.",
  },
  LDC_SESSION_EXPIRED: {
    httpStatus: 502,
    retryable: true,
    description: "TRACES ended the session mid-run (HTTP 401/403 from the portal). Re-run the call.",
  },
  LDC_PORTAL_UNAVAILABLE: {
    httpStatus: 503,
    retryable: true,
    description: "TRACES is down, slow or returned a server error (5xx / network failure).",
  },
  LDC_TIMEOUT: {
    httpStatus: 504,
    retryable: true,
    description: "A TRACES page or request did not respond in time.",
  },
  LDC_PDF_DOWNLOAD_FAILED: {
    httpStatus: 502,
    retryable: true,
    description: "Certificate PDF download from TRACES failed or returned an invalid file.",
  },
  LDC_CERT_NOT_FOUND: {
    httpStatus: 200,
    retryable: false,
    description:
      "Warning: a certificate number returned no row on the TRACES 197 verification page.",
  },
  LDC_CERT_DETAIL_FAILED: {
    httpStatus: 200,
    retryable: true,
    description:
      "Warning: certificate detail call failed; the row was saved from search results only (rate, nature of payment, consumed amount may be blank).",
  },
  LDC_INTERNAL_ERROR: {
    httpStatus: 500,
    retryable: true,
    description: "Unexpected server error. See server logs for the request.",
  },
}

export type TldcWarning = { certNumber: string; errorCode: TldcErrorCode; message: string }

/** Map a thrown error (TRACES login, axios, Puppeteer) to a catalogue code. */
export function classifyTldcError(error: unknown): TldcErrorCode {
  const msg = error instanceof Error ? `${error.name} ${error.message}` : String(error)

  if (/SERVER_URL is required|captcha\/decode|resolveCaptcha/i.test(msg)) {
    return "LDC_CAPTCHA_SERVICE_UNAVAILABLE"
  }
  if (/login failed after \d+ attempts/i.test(msg)) {
    // Only captcha mismatches and transient portal errors are retried, so exhausting
    // the attempts means one of those two.
    return /CPT40[013]|captcha/i.test(msg) ? "LDC_CAPTCHA_FAILED" : "LDC_PORTAL_UNAVAILABLE"
  }
  if (/login failed/i.test(msg)) return "LDC_AUTH_INVALID"
  if (/TimeoutError|timed? ?out|ETIMEDOUT/i.test(msg)) return "LDC_TIMEOUT"
  if (/download HTTP|missing base64|not a valid PDF/i.test(msg)) return "LDC_PDF_DOWNLOAD_FAILED"
  if (/HTTP 40[13]\b|status code 40[13]\b|session.*(expired|invalid)/i.test(msg)) {
    return "LDC_SESSION_EXPIRED"
  }
  if (/HTTP 5\d\d|status code 5\d\d|ECONNRESET|ECONNREFUSED|ENOTFOUND|EAI_AGAIN|net::ERR_/i.test(msg)) {
    return "LDC_PORTAL_UNAVAILABLE"
  }
  return "LDC_INTERNAL_ERROR"
}

export function tldcErrorBody(code: TldcErrorCode, message?: string) {
  const def = TLDC_ERRORS[code]
  return {
    success: false as const,
    errorCode: code,
    message: message || def.description,
    retryable: def.retryable,
  }
}

/** Send a catalogue error from an API route. */
export function sendTldcError(res: NextApiResponse, code: TldcErrorCode, message?: string): void {
  res.status(TLDC_ERRORS[code].httpStatus).json(tldcErrorBody(code, message))
}

/** Classify a thrown error and send it. */
export function sendTldcException(res: NextApiResponse, error: unknown): void {
  const code = classifyTldcError(error)
  sendTldcError(res, code, error instanceof Error ? error.message : String(error))
}
