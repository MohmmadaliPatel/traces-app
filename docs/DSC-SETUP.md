# DSC signing setup — traces-app

How Form 16A / Form 131 certificate PDFs get a digital signature attached automatically, and
what an operator has to do to keep it running.

## How it works

After certificate PDFs are generated, `attachDscToForm16aPdfs` (`src/form16/utils/signForm16Pdfs.ts`)
hands every PDF of that batch to `pdf-signer/pdf-signer.exe` in **one** invocation. The signer
loads a certificate from the **Windows certificate store** by subject and signs each file in
place, producing an `adbe.pkcs7.detached` signature plus a visible stamp **inside the form's
"Signature of person responsible for deduction of tax" cell**.

The stamp finds that cell on its own. The generator plants an invisible anchor over the blank
part of the cell, reads back the rectangle Chrome gave it, and stores it in the PDF as
`/TxDscSigBox`; the signer stamps exactly there. Because the rectangle is measured per
certificate, it stays correct however many transaction rows push the declaration down the page.
A PDF generated before this existed simply carries no box, and the signer falls back to the old
bottom-right corner of the last page.

```text
generate PDFs ──▶ attachDscToForm16aPdfs ──▶ [lock] pdf-signer.exe ──▶ verify signature
                        │                          │                        │
                  resolve certificate        Windows cert store        read /ByteRange
                                             + DSC token (PIN)          from the PDF
```

Two constraints follow from the token being a **hardware device**:

| Constraint | Consequence |
|---|---|
| The private key never leaves the token | The PIN is consumed by the token's own provider. The signer can hand a PIN to that provider (CNG `NCRYPT_PIN_PROPERTY`, or a legacy CSP key password) but can never extract or replay the key itself. A PIN is used once, in memory, and is never stored, queued or logged. |
| The certificate store and PIN cache are **per Windows logon session** | The app must run in the same interactive desktop session as the token owner. As a service (session 0) it can neither read the certificate nor show a PIN dialog. |

## Prerequisites

1. **Windows**, logged in as the account that owns the DSC, with the token plugged in.
2. **.NET 10 Desktop Runtime (x64)** — `pdf-signer.exe` targets `net10.0`. Without it the signer
   exits immediately with code `2147516547` and the message "You must install .NET to run this
   application".
   ```bash
   winget install Microsoft.DotNet.DesktopRuntime.10
   ```
3. The `pdf-signer/` folder present and **not blocked** by Windows. Files that arrive in a ZIP
   carry a Mark-of-the-Web and silently refuse to run:
   ```bash
   powershell -Command "Get-ChildItem 'pdf-signer' -Recurse | Unblock-File"
   ```
4. The app / job worker running in that same interactive session — **not** as a Windows service
   or a scheduled task set to "run whether user is logged on or not".

Only rebuilding the signer needs more: the .NET **SDK** (`winget install Microsoft.DotNet.SDK.10`)
and `yarn dsc:build-signer`. Running it needs the runtime alone.

## Configuring the certificate

List the certificates available on the machine:

```bash
yarn dsc:test --no-sign
```

Take the **CN exactly as printed**, without the `CN=` prefix. Resolution order (first hit wins):

| # | Source | Use when |
|---|---|---|
| 1 | `dscCertificateName` passed by the caller | Form 16 page "Attach DSC" action |
| 2 | `pdf-signer/dsc-map.json`, keyed by TAN then company name | A handful of companies use different DSCs |
| 3 | `Company.dscCertificateName` (DB, by TAN then name) | Per-company override, editable on the Companies page |
| 4 | `DSC_CERTIFICATE_NAME` env var | **One DSC signs for every company — the usual setup** |

For the common case, set one line in `.env.production` and restart the app:

```bash
DSC_CERTIFICATE_NAME=HARDIK HEMCHAND SAVLA
```

If nothing resolves, signing is **skipped** (not failed) and the log says so.

## One PIN per session

Signing once unlocks the token for the rest of the Windows logon session, so the aim is to get
that first signature over with deliberately, before a batch starts.

**From the Form 16 page** (the normal way): pick the certificate in the DSC dropdown, type the
token PIN, and press **Unlock token**. That signs a throwaway copy of a sample certificate and
reports the result. Then start the download — it signs unattended.

**From the terminal:**

```bash
yarn dsc:unlock --pin
```

`--pin` asks for the PIN on the terminal without echoing it. (It is a flag, not `--pin=1234`:
anything on a command line shows up in the process list and shell history.) Without the flag,
the token's own dialog asks for the PIN on that machine instead.

### Why one unlock covers every company

The token's login belongs to the **process** that opened it, and this is the part that took
several attempts to get right. Supplying the PIN programmatically is not enough on its own:
`NCRYPT_PIN_PROPERTY` attaches the PIN to the key handle we hold, the signing library then opens
its own handle, and the driver prompts anyway. Binding our unlocked handle to the certificate
(`CopyWithPrivateKey`) is refused by some providers outright.

So the app keeps **one signer process alive** (`pdf-signer.exe --serve`) and feeds every job to
it over stdin. The first job of a session may raise a dialog; every job after it signs through
the session that is already open. Combined with the held PIN, a run is silent from the unlock
onwards.

Set `DSC_SIGNER_DAEMON=0` to go back to one process per batch (and one dialog per company).
Pressing **Forget PIN** ends the process, which closes the token session.



Each company's certificates are signed by a **separate `pdf-signer.exe` process**. Some token
drivers cache the PIN only for the process that entered it, so unlocking and then downloading
ten companies would raise ten dialogs — the unlock process has already exited with its cached
PIN.

So the PIN entered at the unlock is kept in the **app process's memory** and handed to each
signer run. It is never written to disk, never put on the job queue, never logged, and never
sent back to the browser; it is bound to the certificate it unlocked, so it can never be
replayed against a different token; and it is dropped when the app restarts, after
`DSC_PIN_TTL_MIN` minutes (default 720), or when you press **Forget PIN**.

Enabling **single logon / PIN caching** in the token vendor's manager (PantaSign, ePass2003,
WatchData, TrustKey, …) makes the driver itself hold the PIN, which avoids the app holding one
at all. If the driver supports it, prefer it — but the held PIN works either way.

Unlocking **without** typing a PIN still works: the token's own dialog then asks for it, once
per signer process.

**The cache is cleared by:** reboot or shutdown; logging off (locking the screen or
disconnecting RDP/AnyDesk is fine); unplugging and re-plugging the token; and, on some drivers,
an idle timeout. After any of those, run `yarn dsc:unlock` again.

Only one signer runs at a time — a lockfile at `temp/dsc-signer.lock` serialises every caller
(queue tasks, RPC handlers, and the forked bulk generator), so a batch can never trigger several
PIN dialogs at once.

## Commands

| Command | Purpose |
|---|---|
| `yarn dsc:unlock` | The once-per-session PIN entry. Signs a scratch PDF and reports the certificate used. Add `--pin` to type the PIN instead of waiting for the driver dialog. |
| `yarn dsc:sign --check` | Report how many generated PDFs are signed vs unsigned. Signs nothing. |
| `yarn dsc:sign` | Sign every unsigned PDF in one run (one PIN). Filters: `--company=`, `--fy=`, `--quarter=`, `--form=131`. |
| `yarn dsc:test --no-sign` | Full diagnostic: .NET, signer binary, certificate store, resolution. |
| `yarn dsc:test --generate` | End-to-end test: render a Form 131 PDF and sign it. |
| `yarn dsc:build-signer` | Rebuild `pdf-signer.exe` from `pdf-signer-src/`. Needs the .NET SDK. |

## What happens when signing fails

Signing failures are **not** silent — a batch that produces unsigned certificates fails:

- **Download worker** (`NoticeDownloader-form16.ts`) — appends the reason to `Task.message` (visible
  in batch progress and the retry modal) and fails the task once all downloads are processed.
- **ZIP path** (`processZipsForForm16.ts`) — adds the reason to the returned `errors[]`.
- **"Attach DSC" action** — the mutation throws, so the UI shows the error.

The PDFs themselves are kept. Recover without regenerating:

```bash
yarn dsc:unlock
```
```bash
yarn dsc:sign --company="Clean Max Aero Private Limited" --fy=2026-27 --quarter=Q1
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Signer exits `2147516547`, "You must install .NET" | .NET 10 runtime missing | `winget install Microsoft.DotNet.DesktopRuntime.10` |
| Signer produces no output at all and exits non-zero | Binary blocked (Mark-of-the-Web) or antivirus | `Get-ChildItem 'pdf-signer' -Recurse \| Unblock-File` |
| Log says "no DSC configured" | Nothing resolved | Set `DSC_CERTIFICATE_NAME`, or `Company.dscCertificateName` |
| A PIN dialog appears for every company | Unlocked without typing a PIN, or the PIN was forgotten / expired | Unlock again **with** the PIN in the box; check `DSC_PIN_TTL_MIN` |
| Run times out after the PIN timeout | PIN dialog never answered, or session 0 | Unlock with `yarn dsc:unlock` from the desktop session; verify the app is not running as a service |
| PIN dialog appears but rejects the correct PIN | The certificate belongs to a **different** token than the one plugged in | Compare the Provider / Key Container in `yarn dsc:test --no-sign` section 3 with the inserted token. Stop retrying — tokens lock after a few wrong attempts |
| "0 certificates in the store" | Wrong Windows user, token not inserted, or middleware missing | Log in as the DSC owner; install the token driver |
| Signed but "the PDF looks unchanged" | Chrome's PDF viewer ignores signature banners | Look in the signature cell of the declaration block; open in Adobe Reader to see the signature banner too |
| Stamp is at the bottom-right of the last page, not in the cell | The PDF was generated before the signature box existed | Regenerate it, or accept the fallback position — the signature itself is equally valid |
| "the token rejected the PIN" | Wrong PIN | Stop and check it. Tokens lock after a few wrong attempts, so nothing retries automatically |

## Related

- Signer source: `pdf-signer-src/` (`Program.cs`, `Placement.cs`, `Appearance.cs`, `TokenPin.cs`, `CertificateStore.cs`)
- Signature-cell locator: `src/form16/utils/dscSignatureBox.ts`
- Certificate picker: `src/form16/components/DscCertificatePicker.tsx`
- Diagnostic script: `src/scripts/testDscForm131.ts` (portable copy: `scripts/dsc-test-standalone.js`)
- Signing entry point: `src/form16/utils/signForm16Pdfs.ts`
- Token session + lock: `src/form16/utils/dscSession.ts`
- Signature verification: `src/form16/utils/pdfSignatureInfo.ts`
