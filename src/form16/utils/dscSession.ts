import fs from "fs"
import os from "os"
import path from "path"

/**
 * Coordination around the DSC hardware token.
 *
 * The PIN is consumed by the token's own crypto provider, so it can be handed to the signer
 * (see dscPinVault) but never extracted. Two things then keep a batch quiet: the driver's
 * "single logon" / PIN caching where the token supports it, and the PIN the app holds for the
 * run where it does not.
 *
 * That imposes two requirements on us:
 *
 *   1. Only ONE pdf-signer.exe may run at a time. Two concurrent signers mean two PIN
 *      dialogs, and they can come from different OS processes (the forked cluster script,
 *      overlapping RPC handlers), so an in-memory mutex is not enough — hence a lockfile.
 *   2. We should know whether the token is likely still unlocked, so a cold run can be
 *      given time for a human to type the PIN and can warn that a dialog is coming.
 */

const TEMP_DIR = () => path.join(process.cwd(), "temp")
const LOCK_PATH = () => path.join(TEMP_DIR(), "dsc-signer.lock")
const SESSION_PATH = () => path.join(TEMP_DIR(), "dsc-session.json")

const LOCK_STALE_SEC = () => Math.max(60, parseInt(process.env.DSC_LOCK_STALE_SEC || "", 10) || 900)

type LockPayload = { pid: number; startedAt: number; host: string }
type SessionMarker = { lastSignedAt: number; bootAt: number; certificateName?: string }

function ensureTempDir() {
  fs.mkdirSync(TEMP_DIR(), { recursive: true })
}

/** Approximate boot time. A marker written before this means the machine has rebooted. */
function bootTime(): number {
  return Date.now() - os.uptime() * 1000
}

function readSession(): SessionMarker | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(SESSION_PATH(), "utf8"))
    if (typeof parsed?.lastSignedAt === "number") return parsed as SessionMarker
  } catch {
    /* no marker yet, or unreadable */
  }
  return null
}

/**
 * Best-effort guess at whether the token is still unlocked from an earlier signature.
 *
 * The real cache lives inside the token driver, so this can only be a heuristic: it is used
 * to size timeouts and to warn the operator that a PIN dialog is coming. It must never be
 * used to skip signing.
 */
export function isTokenLikelyWarm(): boolean {
  const marker = readSession()
  if (!marker) return false
  // A signature recorded before the current boot tells us nothing about this session.
  // Allow 60s of slack: os.uptime() and Date.now() drift slightly.
  return marker.lastSignedAt > bootTime() + 60_000
}

/** Record that a signature just succeeded, so later runs know the token is unlocked. */
export function markSignSucceeded(certificateName: string): void {
  try {
    ensureTempDir()
    const marker: SessionMarker = {
      lastSignedAt: Date.now(),
      bootAt: bootTime(),
      certificateName,
    }
    fs.writeFileSync(SESSION_PATH(), JSON.stringify(marker, null, 2), "utf8")
  } catch {
    /* the marker is an optimisation — never fail signing over it */
  }
}

function readLock(): LockPayload | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(LOCK_PATH(), "utf8"))
    if (typeof parsed?.pid === "number") return parsed as LockPayload
  } catch {
    /* unreadable or malformed */
  }
  return null
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err: any) {
    // EPERM means the process exists but belongs to another user.
    return err?.code === "EPERM"
  }
}

function lockIsStale(lock: LockPayload | null): boolean {
  if (!lock) return true
  if (Date.now() - lock.startedAt > LOCK_STALE_SEC() * 1000) return true
  // A lock from another machine (shared folder) can only be judged by age.
  if (lock.host && lock.host !== os.hostname()) return false
  return !isProcessAlive(lock.pid)
}

function tryAcquire(): boolean {
  ensureTempDir()
  try {
    const payload: LockPayload = { pid: process.pid, startedAt: Date.now(), host: os.hostname() }
    const fd = fs.openSync(LOCK_PATH(), "wx")
    fs.writeSync(fd, JSON.stringify(payload))
    fs.closeSync(fd)
    return true
  } catch (err: any) {
    if (err?.code !== "EEXIST") throw err
    if (lockIsStale(readLock())) {
      try {
        fs.unlinkSync(LOCK_PATH())
      } catch {
        /* someone else cleaned it up first */
      }
      return false // retry on the next poll rather than racing here
    }
    return false
  }
}

function release() {
  try {
    const lock = readLock()
    // Only remove our own lock — a stale-takeover may have handed it to someone else.
    if (!lock || lock.pid === process.pid) fs.unlinkSync(LOCK_PATH())
  } catch {
    /* already gone */
  }
}

/**
 * Run `fn` with exclusive access to the PDF signer, across processes.
 *
 * Waiting is expected and fine: signing a batch takes seconds, and serialising is what
 * keeps the token to a single PIN prompt.
 */
export async function withSignerLock<T>(
  fn: () => Promise<T>,
  opts: { timeoutMs?: number; pollMs?: number; log?: (msg: string) => void } = {}
): Promise<T> {
  const timeoutMs = opts.timeoutMs ?? 15 * 60_000
  const pollMs = opts.pollMs ?? 1000
  const log = opts.log
  const startedAt = Date.now()
  let waited = false

  while (!tryAcquire()) {
    if (Date.now() - startedAt > timeoutMs) {
      const holder = readLock()
      throw new Error(
        `timed out waiting for the PDF signer lock (held by pid ${holder?.pid ?? "?"} since ` +
          `${holder ? new Date(holder.startedAt).toISOString() : "?"}). ` +
          `If no signer is running, delete ${LOCK_PATH()}`
      )
    }
    if (!waited) {
      waited = true
      log?.(`ℹ Waiting for another PDF signing run to finish (only one may run at a time)`)
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs))
  }

  try {
    return await fn()
  } finally {
    release()
  }
}
