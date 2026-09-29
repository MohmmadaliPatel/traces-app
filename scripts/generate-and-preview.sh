#!/usr/bin/env bash
# Visual PDF matching loop — generate Form 131, rasterize pages for side-by-side review.
#
# Stack (detected in this repo):
#   - Puppeteer: HTML → PDF (form131PdfGeneratorExact / form16APdfGeneratorExact)
#   - pdf-lib: merge page-1 (no repeating header) with pages 2+
#   - pdfmake / html2pdf.js: used elsewhere; not used for Form 131
#
# Loop:
#   1. Put the official reference PDF in docs/pdf-reference/
#   2. Run: yarn pdf:preview   (or npm run pdf:preview)
#   3. Open tmp/pdf-generated/page-*.png next to the reference pages
#   4. Tweak CSS/HTML in src/utils/form131PdfGeneratorExact.ts
#   5. Repeat until pages match
#
# Requires: pdftoppm (from poppler). If missing:
#   brew install poppler

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

OUT_DIR="$ROOT/tmp/pdf-generated"
REF_DIR="$ROOT/docs/pdf-reference"
GENERATED_PDF="${GENERATED_PDF:-$OUT_DIR/preview.pdf}"
DPI="${PDF_PREVIEW_DPI:-250}"

SAMPLE_TXT="${SAMPLE_TXT:-$ROOT/docs/pdf-reference/fusion-form131-sample.txt}"
PAN_FILTER="${PAN_FILTER:-AAECC1568J}"

mkdir -p "$OUT_DIR" "$REF_DIR"

resolve_pdftoppm() {
  if command -v pdftoppm >/dev/null 2>&1; then
    command -v pdftoppm
    return 0
  fi
  for candidate in \
    /opt/homebrew/bin/pdftoppm \
    /usr/local/bin/pdftoppm \
    /opt/homebrew/opt/poppler/bin/pdftoppm; do
    if [[ -x "$candidate" ]]; then
      echo "$candidate"
      return 0
    fi
  done
  return 1
}

if ! PDFTOPPM="$(resolve_pdftoppm)"; then
  echo "error: pdftoppm not found."
  echo "Install poppler with Homebrew:"
  echo "  brew install poppler"
  exit 1
fi

if [[ ! -f "$SAMPLE_TXT" ]]; then
  echo "error: sample Form 131 text not found:"
  echo "  $SAMPLE_TXT"
  echo "Set SAMPLE_TXT=/path/to/FORM131.txt to override."
  exit 1
fi

echo "==> Generating Form 131 PDF (Puppeteer + pdf-lib)…"
echo "    sample: $SAMPLE_TXT"
echo "    output: $GENERATED_PDF"

export SAMPLE_TXT GENERATED_PDF PAN_FILTER
node -r esbuild-register <<'EOF'
const fs = require("fs")
const path = require("path")
const { parseForm131File } = require("./src/utils/form131ParserExact")
const {
  generateForm131Pdf,
  closeForm131Browser,
} = require("./src/utils/form131PdfGeneratorExact")

;(async () => {
  const sampleTxt = process.env.SAMPLE_TXT
  const out = process.env.GENERATED_PDF
  const pan = process.env.PAN_FILTER || ""
  const txt = fs.readFileSync(sampleTxt, "utf8")
  const all = parseForm131File(txt)
  if (!all.length) throw new Error("No Form 131 records parsed from sample")
  const target = all.find((r) => r.deducteeData.pan === pan) || all[0]
  // Match reference PDF declaration date for visual comparison
  if (process.env.VERIFICATION_DATE) {
    target.footer.verificationDate = process.env.VERIFICATION_DATE
  } else if (sampleTxt.includes("fusion-form131-sample")) {
    target.footer.verificationDate = "24/Aug/2026"
  }
  fs.mkdirSync(path.dirname(out), { recursive: true })
  await generateForm131Pdf({ outputPath: out, data: target }, { skipExisting: false })
  console.log("generated", out, "pan", target.deducteeData.pan, "cert", target.deducteeData.certificateNumber)
  await closeForm131Browser()
})().catch((err) => {
  console.error(err)
  process.exit(1)
})
EOF

echo "==> Rasterizing PDF → PNG @ ${DPI} DPI…"
find "$OUT_DIR" -maxdepth 1 -type f -name 'page-*.png' -delete

"$PDFTOPPM" -png -r "$DPI" "$GENERATED_PDF" "$OUT_DIR/page"

shopt -s nullglob
pages=("$OUT_DIR"/page-*.png)
if [[ ${#pages[@]} -eq 0 ]]; then
  echo "error: no page-*.png written under $OUT_DIR"
  exit 1
fi

echo ""
echo "Done. Generated preview pages:"
for f in "${pages[@]}"; do
  echo "  $f"
done
echo ""
echo "Reference PDF: $REF_DIR/"
echo "Compare tmp/pdf-generated/page-*.png against docs/pdf-reference/ (open both side by side)."
echo "Then edit src/utils/form131PdfGeneratorExact.ts and re-run: yarn pdf:preview"
