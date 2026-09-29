/**
 * Keeps ONE pdf-signer.exe alive and feeds every signing job to it.
 *
 * The token's login is tied to the process that opened it. Signing each company in a fresh
 * process therefore means a fresh PIN dialog every time — no matter how the PIN is supplied,
 * because this provider rejects every documented way of attaching a PIN to the handle the
 * signing library ends up using. Keeping one process alive sidesteps the whole problem: the
 * operator answers at most one dialog, at unlock time, and every later batch signs through the
 * session that is already open.
 *
 * The process is deliberately long-lived — it holds the token session open, which is the point.
 * It is replaced automatically if it exits, and can be stopped explicitly when the operator
 * locks the token.
 */
import { spawn, execFile, type ChildProcess } from "child_process"
import readline from "readline"

export type SignerJobResult = { signed: number; error?: string | null }

type Daemon = {
  child: ChildProcess
  /** Set while a job is in flight; the lockfile already keeps callers one-at-a-time. */
  pending: {
    resolve: (result: SignerJobResult) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  } | null
}

// Next bundles each entry point separately, so a module-level singleton would give the unlock
// route and the download worker a signer process each — two processes, two dialogs. One
// well-known global key keeps them on the same one.
const DAEMON_KEY = Symbol.for("traces-app.dsc.signer-daemon")

type Holder = { [DAEMON_KEY]?: Daemon | null }

function holder(): Holder {
  return globalThis as unknown as Holder
}

export function signerDaemonEnabled(): boolean {
  return process.env.DSC_SIGNER_DAEMON !== "0"
}

function kill(child: ChildProcess) {
  // A soft kill does not land on a process blocked in a modal PIN dialog.
  if (process.platform === "win32" && child.pid) {
    execFile("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], () => {})
  } else {
    try {
      child.kill()
    } catch {
      /* already gone */
    }
  }
}

/** Drop the current process, failing anything in flight. */
function discard(reason: string) {
  const daemon = holder()[DAEMON_KEY]
  if (!daemon) return
  holder()[DAEMON_KEY] = null

  if (daemon.pending) {
    clearTimeout(daemon.pending.timer)
    daemon.pending.reject(new Error(reason))
    daemon.pending = null
  }
  kill(daemon.child)
}

/** Stop the signer, releasing the token session. Safe to call when nothing is running. */
export function stopSignerDaemon(): void {
  discard("signer stopped")
}

function start(exePath: string, log: (msg: string) => void): Daemon {
  const child = spawn(exePath, ["--serve"], {
    cwd: process.cwd(),
    // Must stay false: if a PIN dialog does appear, hiding the window makes it look like a hang.
    windowsHide: false,
    stdio: ["pipe", "pipe", "pipe"],
  })

  const daemon: Daemon = { child, pending: null }
  holder()[DAEMON_KEY] = daemon

  // stdout carries exactly one JSON result per job.
  const lines = readline.createInterface({ input: child.stdout! })
  lines.on("line", (line) => {
    const text = line.trim()
    if (!text) return

    const current = holder()[DAEMON_KEY]
    if (!current?.pending) return

    const { resolve, reject, timer } = current.pending
    current.pending = null
    clearTimeout(timer)

    try {
      const parsed = JSON.parse(text) as { Signed?: number; Error?: string | null }
      resolve({ signed: parsed.Signed ?? 0, error: parsed.Error ?? null })
    } catch {
      reject(new Error(`could not parse the signer's response: ${text.slice(0, 200)}`))
    }
  })

  child.stderr?.on("data", (data) => log(String(data).trimEnd()))

  child.on("error", (err) => discard(`signer process error: ${err.message}`))
  child.on("close", (code) => discard(`signer process exited with code ${code}`))

  return daemon
}

/**
 * Send one job to the signer, starting it if necessary.
 *
 * `timeoutMs` covers the whole job; when it expires the process is killed, because a signer
 * blocked on an unanswered dialog will never return on its own.
 */
export function signViaDaemon(
  exePath: string,
  job: unknown,
  timeoutMs: number,
  log: (msg: string) => void
): Promise<SignerJobResult> {
  return new Promise((resolve, reject) => {
    let daemon = holder()[DAEMON_KEY] ?? null

    if (daemon && (daemon.child.killed || daemon.child.exitCode !== null)) {
      discard("signer process was no longer running")
      daemon = null
    }

    if (!daemon) {
      try {
        daemon = start(exePath, log)
      } catch (err: any) {
        reject(err)
        return
      }
    }

    if (daemon.pending) {
      reject(new Error("the signer is already handling another job"))
      return
    }

    const timer = setTimeout(() => {
      discard(
        `PDF signer timed out after ${Math.round(timeoutMs / 1000)}s. The DSC token is most ` +
          `likely waiting on an unanswered PIN dialog, or is locked.`
      )
    }, timeoutMs)

    daemon.pending = { resolve, reject, timer }

    try {
      daemon.child.stdin!.write(JSON.stringify(job) + "\n")
    } catch (err: any) {
      clearTimeout(timer)
      discard(`could not send the job to the signer: ${err.message}`)
      reject(err)
    }
  })
}
