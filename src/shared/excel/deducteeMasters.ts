export type DeducteeMasterRow = {
  pan: string
  email: string
  name?: string
}

function pickField(row: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const val = row[key]
    if (val != null && String(val).trim() !== "") return String(val).trim()
  }
  const lowerMap = new Map(
    Object.keys(row).map((k) => [k.toLowerCase(), row[k]] as const)
  )
  for (const key of keys) {
    const val = lowerMap.get(key.toLowerCase())
    if (val != null && String(val).trim() !== "") return String(val).trim()
  }
  return ""
}

/** Parse SheetJS rows for deductee master bulk upload (PAN, Email, optional Name). */
export function parseDeducteeMasterRows(
  rows: Record<string, unknown>[]
): DeducteeMasterRow[] {
  const out: DeducteeMasterRow[] = []
  for (const row of rows) {
    const pan = pickField(row, ["PAN", "Pan", "pan"]).toUpperCase()
    const email = pickField(row, ["Email", "email", "E-mail", "E-Mail"])
    const name = pickField(row, ["Name", "name", "Deductee Name"]) || undefined
    if (!pan || !email) continue
    out.push({ pan, email, name })
  }
  return out
}
