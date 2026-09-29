# pdf-signer

Signs Form 16A / Form 131 certificate PDFs with a DSC from the Windows certificate store.

The built binary lives in `../pdf-signer/`; this folder is its source. Rebuild with:

```bash
yarn dsc:build-signer
```

That needs the .NET **SDK** (`winget install Microsoft.DotNet.SDK.10`). Running the signer needs
only the Desktop Runtime.

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
* A supplied PIN is pushed into the key handle and then used for one throwaway signature. That
  makes the token cache it for the Windows session and turns a wrong PIN into an immediate,
  clear error rather than a dialog nobody is watching. Wrong PINs are never retried — tokens
  lock after a few attempts.
* If the provider supports neither CNG nor CSP PIN injection, the run continues and the token's
  own dialog asks for the PIN, exactly as before.
