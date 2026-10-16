# pdf-signer

Signs Form 16A / Form 131 certificate PDFs with a DSC from the Windows certificate store.

The built binary lives in `../pdf-signer/`; this folder is its source. Rebuild with:

```bash
yarn dsc:build-signer
```

That needs the .NET **SDK** (`winget install Microsoft.DotNet.SDK.10`, or any OS — the build
cross-publishes to `win-x64`). The output is **self-contained**: it bundles the .NET runtime, so
running the signer needs no .NET install. Keep trimming off — Spire relies on reflection.

## Self-test and logs

`diagnose.cmd` (shipped next to the exe) runs `pdf-signer.exe --diagnose ["CERT NAME"] [--pin]`:
certificate, key, PIN, one signature, one signed test PDF, each step reported as OK or FAILED,
with `RESULT: PASS/FAIL` at the end. Its log is `logs\diagnose-*.log`.

Every other run appends to `logs\pdf-signer-<date>.log` next to the exe (or `%TEMP%\pdf-signer-logs`
if that folder is read-only). stderr carries the same lines with a `pdf-signer: ` prefix; stdout
stays reserved for serve mode's JSON results. The PIN is never written anywhere.

## Input

One JSON job, read from the file named as the first argument, or from stdin when that argument
is `-`. The app always uses stdin, because a job may carry a PIN and a temp file holding a token
PIN could outlive the process.

```json
{
  "CertificateName": "HARDIK HEMCHAND SAVLA",
  "Pin": "optional token PIN",
  "Reason": "optional",
  "Location": "optional",
  "Pdfs": [
    {
      "InputPath": "C:\\pdf\\cert.pdf",
      "OutputPath": "C:\\pdf\\cert.pdf",
      "Page": 1,
      "X": 303.75,
      "Y": 231.0,
      "Width": 261.0,
      "Height": 26.25
    }
  ]
}
```

`Page` is 0-based. `X`/`Y`/`Width`/`Height` are points with a **top-left** origin, which is what
Spire's signature bounds expect. Omit them and the stamp falls back to the bottom-right of the
last page. They are produced by `src/form16/utils/dscSignatureBox.ts`, which measures the
form's signature cell when the PDF is generated.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | Every PDF signed |
| 1 | Unexpected failure (details on stderr) |
| 2 | Malformed job — no certificate name, or no PDFs |
| 3 | No certificate in the store matched `CertificateName` |
| 4 | At least one PDF failed to sign; the rest were signed |

## Notes

* Certificate matching tries thumbprint, then exact CN, then a substring of the subject, and
  only ever considers certificates that have a usable private key.
* The token is driven the way the TRACES PDF Utility drives it (`TokenKey.cs`): one key handle
  from `CryptAcquireCertificatePrivateKey`, the PIN dialog parented to our window, and a single
  SHA-256 digest signed with PKCS#1 v1.5 per PDF. Spire never sees the private key — the PKCS#7
  is built by `SignedCms` (`CmsFormatter.cs`) and handed to Spire's `PdfMDPSignatureMaker`.
* A supplied PIN is pushed into that handle and then used for one throwaway signature. That
  makes the token cache it for the Windows session and turns a wrong PIN into an immediate,
  clear error rather than a dialog nobody is watching. Wrong PINs are never retried — tokens
  lock after a few attempts.
* If the driver will not take the PIN that way, the run continues and the token's own dialog
  asks for it, which is all the TRACES utility ever does.
* Each PDF is saved to `<output>.signing` and moved over the output only once the signature is
  in, so a token failure never leaves a generated certificate truncated. The save is a full
  rewrite: Spire's incremental save leaves the signature unlinked from the catalog, and readers
  that start from the catalog (pdfium, which is Chrome's viewer, and pypdf) see no signature.
