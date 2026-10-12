/**
 * Fill GST "Search Taxpayer" details into an Excel list of GSTINs. Captchas are solved
 * automatically through the captcha decode service (needs SERVER_URL in .env).
 *
 *   node scripts/run-ts.js src/scripts/gstSearchTaxpayer.ts --in "GSTINs.xlsx"
 *     [--out "GSTINs - filled.xlsx"] [--retry-errors]
 *
 * - Reads the "GSTIN" column of the first sheet and fills the "Regular / Composition ..." column
 *   (added as "Taxpayer type" if missing), then Status, Legal name, Trade name, Registration
 *   date, Cancellation date and Remarks after the last used column.
 * - Each lookup fetches a captcha, decodes it with the decode service (latest image is saved to
 *   tmp/gst-search/captcha.png) and searches. A wrong captcha just fetches a new one, up to
 *   MAX_CAPTCHA_ATTEMPTS per lookup; GSTINs that still fail are retried once at the end and left
 *   out of the progress file, so re-running the command picks them up.
 * - GSTINs that fail the offline check-digit test are marked Invalid without a lookup.
 * - Results are saved to "<out>.progress.json" after every lookup and to the workbook every
 *   10 lookups and on exit, so Ctrl+C and re-running picks up where you stopped.
 *   --retry-errors looks up again the GSTINs the portal answered with an error.
 */
import ExcelJS from "exceljs"
import dotenv from "dotenv"
import fs from "fs"
import path from "path"
import { GstSearchSession, gstinFormatProblem, TaxpayerDetails } from "src/shared/portals/gst"
import { resolveCaptchaFromImageBase64 } from "src/jobs/traces/captchaDecode"

type Item = { row: number; sr: string; party: string; gstin: string }
type ProgressEntry = { at: string } & (
  | { ok: true; data: TaxpayerDetails }
  | { ok: false; errorCode: string; message: string }
)

const USAGE =
  'Usage: node scripts/run-ts.js src/scripts/gstSearchTaxpayer.ts --in "GSTINs.xlsx" ' +
  '[--out "GSTINs - filled.xlsx"] [--retry-errors]'
const EXTRA_COLUMNS: [title: string, width: number][] = [
  ["Status", 12],
  ["Legal name", 40],
  ["Trade name", 40],
  ["Registration date", 16],
  ["Cancellation date", 16],
  ["Remarks", 60],
]
const WRITE_EVERY = 10
const MAX_CAPTCHA_ATTEMPTS = 5
const PASS_GAP_MS = 1200
const CAPTCHA_PATH = path.join(__dirname, "..", "..", "tmp", "gst-search", "captcha.png")

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

function parseArgs(argv: string[]): Record<string, string | true> {
  const args: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    if (!arg.startsWith("--")) {
      if (!args.in) args.in = arg
      continue
    }
    const next = argv[i + 1]
    if (next !== undefined && !next.startsWith("--")) {
      args[arg.slice(2)] = next
      i++
    } else {
      args[arg.slice(2)] = true
    }
  }
  return args
}

async function main() {
  dotenv.config()
  const args = parseArgs(process.argv.slice(2))
  const inPath = typeof args.in === "string" ? path.resolve(args.in) : ""
  if (!inPath || !fs.existsSync(inPath)) {
    console.error(inPath ? `Input not found: ${inPath}` : USAGE)
    process.exit(1)
  }
  const outPath =
    typeof args.out === "string"
      ? path.resolve(args.out)
      : path.join(
          path.dirname(inPath),
          `${path.basename(inPath, path.extname(inPath))} - filled.xlsx`
        )
  if (outPath === inPath) {
    console.error("--out must differ from --in; the input workbook is left untouched.")
    process.exit(1)
  }
  const progressPath = outPath.replace(/\.xlsx$/i, "") + ".progress.json"

  // ---- Workbook layout ----
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.readFile(inPath)
  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error(`No worksheet in ${inPath}`)
  const header = sheet.getRow(1)
  const findColumn = (pattern: RegExp) => {
    let found = 0
    header.eachCell((cell, col) => {
      if (!found && pattern.test(cell.text.trim())) found = col
    })
    return found
  }
  const gstinCol = findColumn(/^gstin(\s*\/\s*uin)?$/i)
  if (!gstinCol) throw new Error('No column headed "GSTIN" in row 1 of the first sheet')
  const srCol = findColumn(/^s[rl]\.?\s*(no\.?)?$/i)
  const partyCol = findColumn(/party|name/i)
  let lastCol = Math.max(header.cellCount, sheet.columnCount)
  let typeCol = findColumn(/regular|composition/i)
  if (!typeCol) {
    typeCol = ++lastCol
    header.getCell(typeCol).value = "Taxpayer type"
  }
  const extraStart = lastCol + 1
  EXTRA_COLUMNS.forEach(([title, width], i) => {
    const cell = header.getCell(extraStart + i)
    cell.value = title
    cell.style = { ...header.getCell(typeCol).style }
    sheet.getColumn(extraStart + i).width = width
  })

  const items: Item[] = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    const gstin = row.getCell(gstinCol).text.replace(/\s+/g, "").toUpperCase()
    if (!gstin) continue
    items.push({
      row: r,
      gstin,
      sr: srCol ? row.getCell(srCol).text : String(r - 1),
      party: partyCol ? row.getCell(partyCol).text : "",
    })
  }

  // ---- Progress ----
  const progress: Record<string, ProgressEntry> = fs.existsSync(progressPath)
    ? JSON.parse(fs.readFileSync(progressPath, "utf8"))
    : {}
  const saveProgress = () => fs.writeFileSync(progressPath, JSON.stringify(progress, null, 1))

  /** [type, status, legal name, trade name, reg. date, cancel date, remarks], or null if pending. */
  const rowValues = (gstin: string): string[] | null => {
    const problem = gstinFormatProblem(gstin)
    if (problem) return ["Invalid", "", "", "", "", "", problem]
    const entry = progress[gstin]
    if (!entry) return null
    if (entry.ok) {
      const d = entry.data
      return [d.dty, d.sts, d.lgnm, d.tradeNam, d.rgdt, d.cxdt, ""]
    }
    const detail = `GST portal ${entry.errorCode}${entry.message ? `: ${entry.message}` : ""}`
    return ["Invalid", "", "", "", "", "", detail]
  }

  const writeWorkbook = async () => {
    for (const item of items) {
      const values = rowValues(item.gstin)
      if (!values) continue
      const row = sheet.getRow(item.row)
      row.getCell(typeCol).value = values[0] || null
      values.slice(1).forEach((value, i) => (row.getCell(extraStart + i).value = value || null))
    }
    try {
      await workbook.xlsx.writeFile(outPath)
    } catch (e: any) {
      console.warn(
        `Could not write ${outPath} (${e.message}). Is it open in Excel? ` +
          `Results are safe in ${progressPath}.`
      )
    }
  }

  const pending: Item[] = []
  const queued = new Set<string>()
  for (const item of items) {
    if (queued.has(item.gstin) || gstinFormatProblem(item.gstin)) continue
    const entry = progress[item.gstin]
    if (entry && (entry.ok || !args["retry-errors"])) continue
    queued.add(item.gstin)
    pending.push(item)
  }

  await writeWorkbook()
  console.log(`${items.length} GSTINs in ${path.basename(inPath)}, ${pending.length} to look up.`)
  console.log(`Output:   ${outPath}`)
  console.log(`Progress: ${progressPath}`)
  if (!pending.length) {
    console.log("Nothing left to look up.")
    return
  }

  // ---- Automated lookup ----
  let session: GstSearchSession | null = null
  let sinceWrite = 0
  let done = 0

  /** Fetches a fresh captcha, decodes it with the service and returns the text. */
  const newCaptcha = async (): Promise<string> => {
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        if (!session) session = await GstSearchSession.open()
        const png = await session.captcha()
        fs.mkdirSync(path.dirname(CAPTCHA_PATH), { recursive: true })
        fs.writeFileSync(CAPTCHA_PATH, png)
        const text = (await resolveCaptchaFromImageBase64(png.toString("base64"))).trim()
        if (!text) throw new Error("decode service returned an empty captcha")
        return text
      } catch (e: any) {
        session = null
        if (attempt === 2) throw new Error(`Could not fetch/decode a captcha: ${e.message}`)
      }
    }
    return ""
  }

  const lookup = async (item: Item): Promise<ProgressEntry> => {
    let lastError = ""
    for (let attempt = 1; attempt <= MAX_CAPTCHA_ATTEMPTS; attempt++) {
      try {
        const captcha = await newCaptcha()
        const result = await session!.search(item.gstin, captcha)
        if (!result.ok && result.wrongCaptcha) {
          lastError = "decode service read the captcha wrong"
          continue
        }
        return result.ok
          ? { at: new Date().toISOString(), ok: true, data: result.data }
          : {
              at: new Date().toISOString(),
              ok: false,
              errorCode: result.errorCode,
              message: result.message,
            }
      } catch (e: any) {
        session = null
        lastError = e.message
      }
    }
    throw new Error(lastError || "lookup failed")
  }

  const finish = async () => {
    await writeWorkbook()
    console.log(`Done. Wrote ${outPath}`)
  }

  /** Looks up every item; returns the ones that still failed (kept out of progress). */
  const runPass = async (round: Item[], label: string): Promise<Item[]> => {
    const failed: Item[] = []
    for (const item of round) {
      try {
        const entry = await lookup(item)
        progress[item.gstin] = entry
        saveProgress()
        const text = entry.ok
          ? `${item.gstin}  ${entry.data.dty} · ${entry.data.sts} · ${entry.data.lgnm}`
          : `${item.gstin}  Invalid · ${entry.errorCode} ${entry.message}`.trim()
        console.log(`[${++done}/${pending.length}] ${label}Sr ${item.sr}  ${text}`)
        if (++sinceWrite >= WRITE_EVERY) {
          sinceWrite = 0
          await writeWorkbook()
        }
      } catch (e: any) {
        console.warn(
          `[${done + 1}/${pending.length}] ${label}Sr ${item.sr}  ${item.gstin}  skipped: ${e.message}`
        )
        failed.push(item)
      }
      await sleep(PASS_GAP_MS)
    }
    return failed
  }

  process.on("SIGINT", () => {
    console.log("\nSaving workbook before exit...")
    void writeWorkbook().finally(() => process.exit(0))
  })

  console.log(`Captcha decode service: ${process.env.SERVER_URL || "(SERVER_URL not set!)"}`)
  console.log(`Latest captcha image is saved to ${CAPTCHA_PATH}\n`)
  const failed = await runPass(pending, "")
  if (failed.length) {
    console.log(`\nRetrying ${failed.length} GSTIN whose captchas kept failing...`)
    await runPass(failed, "retry · ")
  }
  await finish()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
