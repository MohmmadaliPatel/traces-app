import { resolver } from "@blitzjs/rpc"
import { listDscCertificates, type DscCertificate } from "src/form16/utils/listDscCertificates"
import { isTokenLikelyWarm } from "src/form16/utils/dscSession"
import { dscPinStatus } from "src/form16/utils/dscPinVault"

export type DscCertificatesResult = {
  certificates: DscCertificate[]
  /** False on a development machine — the UI then explains why the list is empty. */
  windows: boolean
  /** True when the token has already been unlocked in this Windows session. */
  tokenWarm: boolean
  /** Certificate the signer would pick with no explicit choice, if configured. */
  envDefault: string | null
  /** Whether a PIN is held for this server process — never the PIN itself. */
  pin: { remembered: boolean; certificateName: string | null; expiresAt: number | null }
}

export default resolver.pipe(resolver.authorize(), async (): Promise<DscCertificatesResult> => {
  const certificates = await listDscCertificates()
  return {
    certificates,
    windows: process.platform === "win32",
    tokenWarm: isTokenLikelyWarm(),
    envDefault: process.env.DSC_CERTIFICATE_NAME?.trim() || null,
    pin: dscPinStatus(),
  }
})
