/**
 * One-off: link certificate PDFs already on disk to TldcData.pdfPath.
 *
 * New Act PDFs are saved as public/pdf/child-certificates/{Company}/{reqId}.pdf, so each
 * PDF is parsed for its certificate number. Old Act PDFs kept by fetchTldcData live at
 * public/pdf/tldc-downloads/certificates/{certNumber}.pdf.
 *
 * Usage: npx tsx src/scripts/backfillTldcPdfPaths.ts [--dry-run] [--all]
 *   --all  also re-link rows that already have a pdfPath
 */
import fs from "fs"
import path from "path"
import { parseChildCertificatePdfFile, safeFolderName } from "./fetchTldcDataNewAct"
import { toPublicPath } from "../tldc/pdfPath"

async function main() {
  const dotenv = await import("dotenv")
  dotenv.config()
  const db = (await import("db")).default

  const dryRun = process.argv.includes("--dry-run")
  const all = process.argv.includes("--all")

  const rows = await db.tldcData.findMany({
    where: all ? {} : { pdfPath: null },
    select: { id: true, certNumber: true, company: { select: { id: true, name: true } } },
  })
  console.log(`${rows.length} TLDC row(s) to check${dryRun ? " (dry run)" : ""}`)

  // Parse each company's new-Act folder once: certNumber → public path
  const byCompany = new Map<number, Map<string, string>>()
  async function newActPdfs(companyId: number, companyName: string) {
    if (byCompany.has(companyId)) return byCompany.get(companyId)!
    const map = new Map<string, string>()
    const dir = path.join(process.cwd(), "public", "pdf", "child-certificates", safeFolderName(companyName))
    if (fs.existsSync(dir)) {
      for (const f of fs.readdirSync(dir).filter((n) => n.toLowerCase().endsWith(".pdf"))) {
        try {
          const parsed = await parseChildCertificatePdfFile(path.join(dir, f))
          const rel = toPublicPath(parsed.pdfPath)
          if (parsed.certNumber && rel) map.set(parsed.certNumber.toUpperCase(), rel)
        } catch (err: any) {
          console.warn(`  could not parse ${f}: ${err?.message || err}`)
        }
      }
    }
    byCompany.set(companyId, map)
    return map
  }

  const oldActDir = path.join(process.cwd(), "public", "pdf", "tldc-downloads", "certificates")
  let linked = 0
  for (const row of rows) {
    const cert = row.certNumber.toUpperCase()
    const oldActFile = path.join(oldActDir, `${cert.replace(/[^A-Z0-9]/g, "")}.pdf`)
    const pdfPath =
      (await newActPdfs(row.company.id, row.company.name)).get(cert) ||
      (fs.existsSync(oldActFile) ? toPublicPath(oldActFile) : null)

    if (!pdfPath) {
      console.log(`  - ${cert} (${row.company.name}): no PDF found`)
      continue
    }
    console.log(`  ✓ ${cert} → ${pdfPath}`)
    if (!dryRun) await db.tldcData.update({ where: { id: row.id }, data: { pdfPath } })
    linked++
  }

  console.log(`${dryRun ? "Would link" : "Linked"} ${linked} of ${rows.length}`)
  await db.$disconnect()
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
