/**
 * Locating the "Signature of person responsible for deduction of tax" cell in a generated
 * certificate PDF, so the DSC stamp lands inside it instead of at the bottom of the last page.
 *
 * The cell moves from certificate to certificate — the number of transaction and challan rows
 * decides which page the declaration block ends up on and how far down it sits — so the box
 * cannot be a constant. Instead the generator plants an invisible anchor over the empty part of
 * that cell:
 *
 *   HTML  <a href="https://dsc.local/sigbox"> covering the blank area of the cell
 *     ↓   Chrome emits a Link annotation whose /Rect is the element's exact box, in PDF points
 *   PDF   the merged document is scanned for that annotation
 *     ↓   the rect is recorded, the annotation is deleted (nothing visible is left behind)
 *   Info  /TxDscSigBox "page;x;y;width;height" travels inside the PDF itself
 *
 * Keeping the box in the PDF's Info dictionary rather than a sidecar file means it survives
 * copying, zipping and moving to the Windows signing machine — signing can happen minutes or
 * days after generation, in a different process.
 *
 * Coordinates are stored **top-left origin** (y measured down from the top of the page), which
 * is what the signer's Bounds rectangle expects, not PDF's native bottom-left origin.
 */
import fs from "fs"
import { PDFDocument, PDFName, PDFArray, PDFDict, PDFString, PDFHexString, PDFNumber } from "pdf-lib"

/** Href of the invisible anchor. Never resolved — it exists only to make Chrome emit a rect. */
export const DSC_SIGBOX_HREF = "https://dsc.local/sigbox"

/** Info-dictionary key holding the recovered box. */
const INFO_KEY = "TxDscSigBox"

export type DscSignatureBox = {
  /** 0-based page index in the final merged PDF. */
  page: number
  /** Distance from the left edge of the page, in points. */
  x: number
  /** Distance from the **top** edge of the page, in points. */
  y: number
  width: number
  height: number
}

/**
 * CSS for the anchor. It must occupy the blank part of the signature cell without changing the
 * cell's layout, and must not look like a link.
 */
export const DSC_SIGBOX_CSS = `
  a.dsc-sigbox {
    display: block;
    width: 100%;
    color: inherit;
    text-decoration: none;
    border: 0;
    background: transparent;
  }
`

/**
 * The anchor itself. `heightPt` is the blank space reserved inside the cell for the stamp —
 * the cell already grows to fit it, so this also guarantees the stamp has room.
 */
export function dscSigBoxAnchorHtml(heightPt: number): string {
  return `<a class="dsc-sigbox" href="${DSC_SIGBOX_HREF}" style="height:${heightPt}pt;"></a>`
}

function annotationUri(context: PDFDocument["context"], annot: PDFDict): string | null {
  const action = annot.lookup(PDFName.of("A"))
  if (!(action instanceof PDFDict)) return null
  const uri = action.lookup(PDFName.of("URI"))
  if (uri instanceof PDFString || uri instanceof PDFHexString) return uri.asString()
  return uri ? String(uri) : null
}

/**
 * Find the anchor in a freshly merged document, remove it, and record the box it covered.
 * Returns null when the anchor is absent (an older template, or Chrome dropped the link) —
 * the caller then simply leaves the PDF without box metadata and the signer falls back to its
 * default placement.
 */
export function extractAndStripSigBoxAnchor(doc: PDFDocument): DscSignatureBox | null {
  const pages = doc.getPages()

  for (let pageIndex = 0; pageIndex < pages.length; pageIndex++) {
    const page = pages[pageIndex]!
    const annots = page.node.Annots()
    if (!annots) continue

    const kept: unknown[] = []
    let box: DscSignatureBox | null = null

    for (let i = 0; i < annots.size(); i++) {
      const ref = annots.get(i)
      let annot: PDFDict | undefined
      try {
        annot = doc.context.lookup(ref, PDFDict)
      } catch {
        annot = undefined
      }

      const uri = annot ? annotationUri(doc.context, annot) : null
      if (!annot || uri !== DSC_SIGBOX_HREF) {
        kept.push(ref)
        continue
      }

      const rect = annot.lookup(PDFName.of("Rect"))
      if (rect instanceof PDFArray && rect.size() === 4) {
        const n = (i: number) => {
          const v = rect.lookup(i)
          return v instanceof PDFNumber ? v.asNumber() : Number(String(v))
        }
        const [x0, y0, x1, y1] = [n(0), n(1), n(2), n(3)]
        const left = Math.min(x0, x1)
        const right = Math.max(x0, x1)
        const bottom = Math.min(y0, y1)
        const top = Math.max(y0, y1)
        const { height: pageHeight } = page.getSize()

        box = {
          page: pageIndex,
          x: round2(left),
          // PDF space is bottom-left origin; the signer's Bounds is top-left origin.
          y: round2(pageHeight - top),
          width: round2(right - left),
          height: round2(top - bottom),
        }
      }
      // The anchor is dropped either way — a stray link must never survive into the certificate.
    }

    if (box) {
      page.node.set(PDFName.of("Annots"), doc.context.obj(kept as never))
      return box
    }
  }

  return null
}

function round2(v: number): number {
  return Math.round(v * 100) / 100
}

/** Record the box inside the document so it survives to signing time. */
export function storeSignatureBox(doc: PDFDocument, box: DscSignatureBox): void {
  const value = `${box.page};${box.x};${box.y};${box.width};${box.height}`
  let info: PDFDict | undefined
  try {
    info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict)
  } catch {
    info = undefined
  }
  if (!info) {
    info = doc.context.obj({}) as PDFDict
    doc.context.trailerInfo.Info = doc.context.register(info)
  }
  info.set(PDFName.of(INFO_KEY), PDFString.of(value))
}

function parseBox(value: string): DscSignatureBox | null {
  const parts = value.split(";").map((p) => Number(p.trim()))
  if (parts.length !== 5 || parts.some((p) => !Number.isFinite(p))) return null
  const [page, x, y, width, height] = parts as [number, number, number, number, number]
  if (width <= 0 || height <= 0 || page < 0) return null
  return { page, x, y, width, height }
}

/** Read the box back out of a generated PDF. Returns null when the PDF carries no box. */
export async function readSignatureBox(pdfPath: string): Promise<DscSignatureBox | null> {
  let doc: PDFDocument
  try {
    doc = await PDFDocument.load(fs.readFileSync(pdfPath), { updateMetadata: false })
  } catch {
    return null
  }
  let info: PDFDict | undefined
  try {
    info = doc.context.lookup(doc.context.trailerInfo.Info, PDFDict)
  } catch {
    return null
  }
  if (!info) return null
  const raw = info.lookup(PDFName.of(INFO_KEY))
  if (!(raw instanceof PDFString || raw instanceof PDFHexString)) return null
  return parseBox(raw.asString())
}
