/**
 * One-off: encrypt plain-text Company.password / it_password already in the database.
 * Safe to re-run: values that are already encrypted are skipped. Needs CREDENTIALS_ENCRYPTION_KEY
 * (.env.local). Back up db/db.sqlite first.
 *
 * Usage: npx tsx src/scripts/encryptCompanyCredentials.ts [--dry-run]
 */
import db from "db"
import { isEncryptedSecret } from "../../db/credentialEncryption"

type RawRow = { id: number; tan: string; p: string | null; ip: string | null }

async function rawRows(): Promise<RawRow[]> {
  // Aliased columns so the decrypting middleware leaves the raw values alone
  return db.$queryRaw<RawRow[]>`SELECT id, tan, password AS p, it_password AS ip FROM Company`
}

async function main() {
  const dryRun = process.argv.includes("--dry-run")
  const before = await rawRows()
  const todo = before.filter((r) => (r.p && !isEncryptedSecret(r.p)) || (r.ip && !isEncryptedSecret(r.ip)))
  console.log(`${before.length} companies, ${todo.length} with plain-text credentials${dryRun ? " (dry run)" : ""}`)
  if (dryRun || todo.length === 0) return

  for (const row of todo) {
    // Writing the plain value back goes through the middleware, which encrypts it
    await db.company.update({
      where: { id: row.id },
      data: {
        ...(row.p && !isEncryptedSecret(row.p) ? { password: row.p } : {}),
        ...(row.ip && !isEncryptedSecret(row.ip) ? { it_password: row.ip } : {}),
      },
    })
  }

  // Verify: nothing plain left, and every converted row decrypts to its original value
  const after = await rawRows()
  const stillPlain = after.filter((r) => (r.p && !isEncryptedSecret(r.p)) || (r.ip && !isEncryptedSecret(r.ip)))
  let mismatches = 0
  for (const row of todo) {
    const c = await db.company.findUnique({ where: { id: row.id }, select: { password: true, it_password: true } })
    const expectP = row.p && !isEncryptedSecret(row.p) ? row.p : c?.password
    const expectIp = row.ip && !isEncryptedSecret(row.ip) ? row.ip : c?.it_password
    if (c?.password !== expectP || c?.it_password !== expectIp) mismatches++
  }
  console.log(`Encrypted ${todo.length} companies. Still plain: ${stillPlain.length}. Decrypt mismatches: ${mismatches}.`)
  if (stillPlain.length || mismatches) process.exitCode = 1
}

main()
  .catch((err) => {
    console.error(err)
    process.exitCode = 1
  })
  .finally(() => db.$disconnect())
