import fs from "fs"
import path from "path"

const PUBLIC_DIR = path.join(process.cwd(), "public")

/** Absolute file path → path relative to public/ with forward slashes (what TldcData.pdfPath stores). */
export function toPublicPath(absPath: string): string | null {
  const rel = path.relative(PUBLIC_DIR, path.resolve(absPath))
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null
  return rel.split(path.sep).join("/")
}

/** Stored pdfPath → `/api/file/...` download URL, or null when the file is no longer on disk. */
export function tldcPdfUrl(pdfPath: string | null | undefined): string | null {
  if (!pdfPath) return null
  if (!fs.existsSync(path.join(PUBLIC_DIR, ...pdfPath.split("/")))) return null
  return `/api/file/${pdfPath.split("/").map(encodeURIComponent).join("/")}`
}
