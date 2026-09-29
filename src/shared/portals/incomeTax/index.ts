/**
 * Income Tax e-Portal facade.
 * Implementation lives in `src/utils/incomeTaxPortalAuth.ts`; import from here for new code.
 */
export {
  createIncomeTaxAxiosClient,
  loginIncomeTaxPortal,
  saveIncomeTaxUserProfile,
  buildPaymentHistoryRequestBody,
  viewFiledFormsRequestHeaders,
  buildViewFiledFormsPayload,
  INCOME_TAX_ORIGIN,
  INCOME_TAX_REFERER,
} from "src/utils/incomeTaxPortalAuth"
