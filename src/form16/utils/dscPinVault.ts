/**
 * Holds the token PIN for the life of the server process, so one unlock covers a whole run.
 *
 * Why this is needed: every company's certificates are signed by a **separate**
 * `pdf-signer.exe` process. Some token drivers cache the PIN only for the process that entered
 * it, so unlocking once and then signing ten companies still raises ten dialogs — the unlock
 * process has already exited and taken its cached PIN with it. Remembering the PIN here and
 * handing it to each signer invocation makes every one of them unlock itself silently.
 *
 * The rules this follows:
 *   * memory only — never written to disk, never queued (the job queue is in-process), never
 *     logged, and never returned to the browser;
 *   * bound to one certificate — a PIN for token A is never sent to token B, which would burn
 *     an attempt against the wrong token's lockout counter;
 *   * time-limited, and gone the moment the process restarts.
 *
 * The store hangs off globalThis on purpose. Next bundles each RPC endpoint separately, so a
 * plain module-level variable would give the unlock mutation and the download mutation their
 * own private copy — the PIN would be stored in one and read as empty in the other, and every
 * company would prompt again. One well-known key shared across bundles is what makes the unlock
 * actually reach the signer.
 */

type Vault = { pin: string; certificateName: string; expiresAt: number }

const VAULT_KEY = Symbol.for("traces-app.dsc.pin-vault")

type VaultHolder = { [VAULT_KEY]?: Vault | null }

function holder(): VaultHolder {
  return globalThis as unknown as VaultHolder
}

function read(): Vault | null {
  return holder()[VAULT_KEY] ?? null
}

function write(value: Vault | null): void {
  holder()[VAULT_KEY] = value
}

/** How long a remembered PIN stays usable. A working day by default. */
function ttlMs(): number {
  const minutes = Math.max(1, parseInt(process.env.DSC_PIN_TTL_MIN || "", 10) || 720)
  return minutes * 60 * 1000
}

function live(): Vault | null {
  const vault = read()
  if (!vault) return null
  if (Date.now() >= vault.expiresAt) {
    write(null)
    return null
  }
  return vault
}

/** Remember the PIN that just unlocked `certificateName`. */
export function rememberDscPin(pin: string, certificateName: string): void {
  if (!pin) return
  write({ pin, certificateName: certificateName.trim(), expiresAt: Date.now() + ttlMs() })
}

/**
 * The PIN to use for `certificateName`, or "" when nothing applicable is held. A mismatch in
 * certificate returns "" rather than the stored PIN.
 */
export function getRememberedDscPin(certificateName: string): string {
  const current = live()
  if (!current) return ""
  if (current.certificateName.toLowerCase() !== certificateName.trim().toLowerCase()) return ""
  return current.pin
}

/** Drop the PIN — the "lock token" action, and what to call if signing starts failing. */
export function forgetDscPin(): void {
  write(null)
}

/** Status for the UI. Deliberately never includes the PIN itself. */
export function dscPinStatus(): {
  remembered: boolean
  certificateName: string | null
  expiresAt: number | null
} {
  const current = live()
  return {
    remembered: Boolean(current),
    certificateName: current?.certificateName ?? null,
    expiresAt: current?.expiresAt ?? null,
  }
}
