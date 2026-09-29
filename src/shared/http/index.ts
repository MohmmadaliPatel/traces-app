/**
 * Shared HTTP / auth helpers used by API routes and portal clients.
 * Implementations remain in `src/utils/apiAuth.ts` and `src/jobs/helper.ts`;
 * import from here for new code.
 */

export {
  withApiAuth,
  authenticateRequest,
  authenticateBearerToken,
  authenticateSession,
  generateApiTokenValue,
  isPublicRpcPath,
  PUBLIC_RPC_PATHS,
  type AuthenticatedUser,
  type ApiAuthContext,
} from "src/utils/apiAuth"

export {
  getAxiostClient,
  setOn401Handler,
  httpAgent,
  httpsAgent,
} from "src/jobs/helper"
