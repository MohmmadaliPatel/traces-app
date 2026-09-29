/**
 * Upsert the companies listed in a 5-column credentials workbook
 * (`Company Name | Tan | IT Password | User ID | Password`) into the `Company` table.
 *
 *   node scripts/run-ts.js src/scripts/importClause34Companies.ts [path/to/workbook.xlsx]
 *
 * Defaults to the Continuum credentials sheet. Rows are marked non-temporary so they
 * survive the temp-company cleanup that batch jobs perform.
 */
import path from "path"
import XLSX from "xlsx"
import { parseCompanyCredentialRows } from "src/shared/excel/companyCredentials"
import { upsertCompanyFromCredentials } from "src/shared/jobs/upsertCompanyFromCredentials"

const DEFAULT_WORKBOOK = path.join(
  process.cwd(),
  "public",
  "pdf",
  "clause34",
  "Continuum Traces details.xlsx"
)

async function main() {
  const file = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_WORKBOOK
  console.log(`[import] reading ${file}`)

  const workbook = XLSX.readFile(file)
  const sheetName = workbook.SheetNames[0]
  if (!sheetName) throw new Error(`No sheets in ${file}`)
  const sheet = workbook.Sheets[sheetName]
  if (!sheet) throw new Error(`Sheet "${sheetName}" is empty`)

  const raw = XLSX.utils.sheet_to_json(sheet) as Record<string, unknown>[]
  const rows = parseCompanyCredentialRows(raw)
  console.log(`[import] ${rows.length} credential row(s) parsed from "${sheetName}"`)

  let created = 0
  let updated = 0
  for (const row of rows) {
    const tan = row.tan.trim().toUpperCase()
    const db = (await import("db")).default
    const before = await db.company.findUnique({ where: { tan } })
    await upsertCompanyFromCredentials(row, { isTemporary: false })
    if (before) {
      updated++
      console.log(`[import] updated ${tan} — ${row.name}`)
    } else {
      created++
      console.log(`[import] CREATED ${tan} — ${row.name}`)
    }
  }

  console.log(`[import] done: ${created} created, ${updated} updated, ${rows.length} total`)
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[import] failed:", err)
    process.exit(1)
  })
