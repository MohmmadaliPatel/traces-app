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

1. **Windows (x64)**, logged in as the account that owns the DSC, with the token plugged in.
2. The **whole** `pdf-signer/` folder, copied as-is and **not blocked** by Windows. The signer is
   published **self-contained**: the folder bundles the .NET 10 runtime (`hostfxr.dll`,
   `coreclr.dll` and ~190 framework DLLs next to `pdf-signer.exe`), so the machine needs **no
   .NET install**. Copying only `pdf-signer.exe` and a few DLLs breaks it. Files that arrive in a
   ZIP carry a Mark-of-the-Web and silently refuse to run:
   ```bash
   powershell -Command "Get-ChildItem 'pdf-signer' -Recurse | Unblock-File"
   ```
3. The app / job worker running in that same interactive session — **not** as a Windows service
   or a scheduled task set to "run whether user is logged on or not".

Only rebuilding the signer needs more: the .NET **SDK** (`winget install Microsoft.DotNet.SDK.10`)
and `yarn dsc:build-signer`, which publishes self-contained for `win-x64` (from any OS). Do not
enable trimming — Spire relies on reflection.

Builds from before the switch to self-contained were framework-dependent and needed the .NET 10
x64 runtime installed separately. On a machine without it such a build exits immediately with
code `2147516547` (`0x80008083`, "You must install .NET to run this application"); the app now
reports that as "the .NET 10 x64 runtime is missing". Replace `pdf-signer/` with the current
build, or install the runtime:

```bash
winget install Microsoft.DotNet.DesktopRuntime.10
```

## Quick self-test on a client machine

With the token plugged in and the app closed, double-click **`pdf-signer\diagnose.cmd`**, or run
it from PowerShell in the app folder:

```powershell
.\pdf-signer\diagnose.cmd "VIREN MAHESH SHAH"
```

It walks the app's exact path in seven steps: environment, certificates in the store, choosing
the certificate, opening its key, PIN, signing a test digest, and signing a test PDF. At the end it
prints `RESULT: PASS` or `RESULT: FAIL` with the failing step. Without a name it picks the only
certificate, or asks which one. Add `--pin` to type the PIN in the console instead of the token's
dialog.

If a step fails, it also tries the other ways of reaching the key (legacy CSP handle, .NET's own
key, private-key export) and logs which ones the driver accepts. Those can raise more PIN dialogs,
so they are skipped after a wrong or cancelled PIN.

Everything goes to `pdf-signer\logs\diagnose-<date>-<time>.log` — **that file is the one to send**.
The signed test PDF lands next to it. The PIN is never logged.

Normal signing logs too: every run of the signer appends to `pdf-signer\logs\pdf-signer-<date>.log`
(build, certificate, key handle, PIN status, each PDF's page and box, timings, and any failure with
its HRESULT). When signing fails in the app, its error message ends with the path of that file.

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
several attempts to get right. The signer opens the private key once, pushes the PIN into that
handle (`NCRYPT_PIN_PROPERTY`, or `PP_SIGNATURE_PIN` on a legacy CSP) and signs every PDF through
that same handle. Spire never opens the key itself — see "How the signer uses the token" below.

So the app keeps **one signer process alive** (`pdf-signer.exe --serve`) and feeds every job to
it over stdin. The first job of a session may raise a dialog; every job after it signs through
the session that is already open. Combined with the held PIN, a run is silent from the unlock
onwards.

Set `DSC_SIGNER_DAEMON=0` to go back to one process per batch (and one dialog per company).
Pressing **Forget PIN** ends the process, which closes the token session.

The signer's diagnostics — every `pdf-signer:` line on its stderr: certificate used, key handle
type, PIN status, `FAILED` reasons — always go to the **server console**, whichever caller
started the process. The job in flight (download task, unlock, `yarn dsc:sign`) gets them in its
own log too, except the per-PDF `signed` lines. When an unlock or a batch fails, read those lines
first.

### How the signer uses the token

The signer talks to the token exactly the way the official TRACES PDF Utility does (its
`certificate_handler_plugin_plugin.dll` was decompiled to get the calls right), because some
drivers reject anything else. The HyperPKI HYP2003 driver, for one, answered the old Spire-based
signer with "An internal error occurred." on a token the utility signs with fine.

- **Key:** `CryptAcquireCertificatePrivateKey` with flags `0x50004`, then `0x50000`. The console
  window (or the foreground window) is set as the parent of the PIN dialog.
- **Signature:** one SHA-256 digest, PKCS#1 v1.5 — `NCryptSignHash(BCRYPT_PAD_PKCS1, "SHA256")`,
  or `CryptCreateHash(CALG_SHA_256)` + `CryptSignHash` on a legacy CSP handle. A "silent context"
  failure re-opens the key and retries once with the dialog allowed.
- **PDF:** .NET's `SignedCms` builds the detached PKCS#7 (`adbe.pkcs7.detached`), and Spire only
  places it, through `IPdfSignatureFormatter` + `PdfMDPSignatureMaker` (certifying, no changes
  allowed). Spire's own signer is not used: it tries to export the private key first.
- **Save:** always a full rewrite. Spire's incremental save never updates the catalog, so the
  signature field, `/AcroForm` and the DocMDP `/Perms` it adds are not linked. Readers that start
  from the catalog — pdfium (Chrome's viewer) and pypdf — then report no signature at all;
  Poppler still finds it by scanning the pages.



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
| `pdf-signer\diagnose.cmd` | Self-test on any machine, dist build included (no Node or yarn needed). See "Quick self-test". |

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
| "the .NET 10 x64 runtime is missing on this machine" (exit `2147516547` / `0x80008083`, or `2147516566` / `0x80008096`) | An old, framework-dependent `pdf-signer/` build on a machine without .NET 10 | Copy the current (self-contained) `pdf-signer/` folder over it, or `winget install Microsoft.DotNet.DesktopRuntime.10` |
| Signer produces no output at all and exits non-zero | Binary blocked (Mark-of-the-Web), antivirus, or only part of `pdf-signer/` was copied | `Get-ChildItem 'pdf-signer' -Recurse \| Unblock-File`; make sure `hostfxr.dll` and `coreclr.dll` sit next to `pdf-signer.exe` |
| Unlock or a batch fails and the UI shows only a short message | The detail is in the signer's own log | Open `pdf-signer\logs\pdf-signer-<date>.log` (its path ends the error message), or the `pdf-signer:` lines in the **server console**. Then run `diagnose.cmd` and send its log |
| Log says "no DSC configured" | Nothing resolved | Set `DSC_CERTIFICATE_NAME`, or `Company.dscCertificateName` |
| A PIN dialog appears for every company | Unlocked without typing a PIN, or the PIN was forgotten / expired | Unlock again **with** the PIN in the box; check `DSC_PIN_TTL_MIN` |
| Run times out after the PIN timeout | PIN dialog never answered, or session 0 | Unlock with `yarn dsc:unlock` from the desktop session; verify the app is not running as a service |
| PIN dialog appears but rejects the correct PIN | The certificate belongs to a **different** token than the one plugged in | Compare the Provider / Key Container in `yarn dsc:test --no-sign` section 3 with the inserted token. Stop retrying — tokens lock after a few wrong attempts |
| "0 certificates in the store" | Wrong Windows user, token not inserted, or middleware missing | Log in as the DSC owner; install the token driver |
| Signed but "the PDF looks unchanged" | Chrome's PDF viewer ignores signature banners | Look in the signature cell of the declaration block; open in Adobe Reader to see the signature banner too |
| Stamp is at the bottom-right of the last page, not in the cell | The PDF was generated before the signature box existed | Regenerate it, or accept the fallback position — the signature itself is equally valid |
| "the token rejected the PIN" | Wrong PIN | Stop and check it. Tokens lock after a few wrong attempts, so nothing retries automatically |
| "An internal error occurred." (`0x80090020`) from an old signer build | The driver rejected Spire's key handling (HyperPKI HYP2003 does) | Ship the current `pdf-signer/` build, which signs the way the TRACES utility does. Errors now name the failing call and its code, e.g. `NCryptSignHash failed (0x80090020)` |
| `certutil -store` says "Could not verify certificate public key against private key" | certutil's own self-test, which some token drivers fail | Not a fault by itself — if the TRACES PDF Utility signs with the token, so does this signer |

## Related

- Signer source: `pdf-signer-src/` (`Program.cs`, `TokenKey.cs`, `TokenRsa.cs`, `CmsFormatter.cs`, `SignatureWriter.cs`, `Placement.cs`, `Appearance.cs`, `CertificateStore.cs`, `Log.cs`, `Diagnose.cs`, `SignedPdfCheck.cs`, `diagnose.cmd`)
- Signature-cell locator: `src/form16/utils/dscSignatureBox.ts`
- Certificate picker: `src/form16/components/DscCertificatePicker.tsx`
- Diagnostic script: `src/scripts/testDscForm131.ts` (portable copy: `scripts/dsc-test-standalone.js`)
- Signing entry point: `src/form16/utils/signForm16Pdfs.ts`
- Token session + lock: `src/form16/utils/dscSession.ts`
- Signature verification: `src/form16/utils/pdfSignatureInfo.ts`
