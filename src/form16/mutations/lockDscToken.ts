import { resolver } from "@blitzjs/rpc"
import { forgetDscPin } from "src/form16/utils/dscPinVault"
import { stopSignerDaemon } from "src/form16/utils/dscSignerDaemon"

/**
 * Forget the PIN held for this server process.
 *
 * This drops the PIN and ends the long-lived signer process, which closes the token session —
 * so the next run prompts again. Use it when the operator walks away, or when the PIN changes.
 */
export default resolver.pipe(resolver.authorize(), async () => {
  forgetDscPin()
  // Ending the signer process closes the token session, so the next run asks for the PIN again.
  stopSignerDaemon()
  return { ok: true as const }
})
