/**
 * Multi-process Form 16A PDF generator — the "max out the machine" bulk runner.
 *
 * The MASTER process shards the zip files across N worker processes; each worker
 * launches its own Chromium and renders a pool of pages in parallel.
 *
 *     Total parallelism = processes  x  pages-per-process
 *
 * -------------------------------------------------------------------------------
 * SINGLE MACHINE, MAXIMUM SPEED:
 *
 *   node -r esbuild-register src/scripts/generateForm16PdfsCluster.ts \
 *     --source "/absolute/path/to/folder-of-zips" \
 *     --tan AAAA00000A \
 *     --company "ACME LLP" \
 *     --fy 2025-26 --quarter Q2 --formType 26Q \
 *     --max --pages 2
 *
 * Re-runs skip PDFs that already exist. To overwrite everything:
 *     ... --force-regenerate
 *
 * (or via npm script:  yarn form16a:bulk --source ... --tan ... --max --pages 2)
 *
 * -------------------------------------------------------------------------------
 * MULTIPLE MACHINES (split the same shared folder across machines):
 *
 *   # Machine 0 of 3
 *   ... --machines 3 --machine-index 0 --max --pages 2
 *   # Machine 1 of 3
 *   ... --machines 3 --machine-index 1 --max --pages 2
 *   # Machine 2 of 3
 *   ... --machines 3 --machine-index 2 --max --pages 2
 *
 * Each machine must be able to read the same --source folder (or hold an identical
 * copy with the SAME file names so the round-robin sharding lines up).
 * -------------------------------------------------------------------------------
 */

import os from "os"
import fs from "fs"
import { fork } from "child_process"
import { generatePdfsFromZipFolder } from "../utils/processZipsForForm16"

interface WorkerParams {
  sourceFolder: string
  companyName: string
  tan: string
  financialYear: string
  quarter: string
  formType: string
  form16Type: "form16" | "form16a"
  shardIndex: number
  shardCount: number
  pageConcurrency: number
  skipExisting: boolean
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const args: Record<string, string | boolean> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (!a || !a.startsWith("--")) continue
    const key = a.slice(2)
    const next = argv[i + 1]
    if (next === undefined || next.startsWith("--")) {
      args[key] = true
    } else {
      args[key] = next
      i++
    }
  }
  return args
}

function fmt(n: number): string {
  return Math.round(n).toLocaleString("en-IN")
}

// ----------------------------------------------------------------------------
// WORKER
// ----------------------------------------------------------------------------
async function runWorker(): Promise<void> {
  const params: WorkerParams = JSON.parse(process.argv[2] || "{}")
  let success = 0
  let skipped = 0
  let failed = 0
  let lastSent = 0

  const sendProgress = (force = false) => {
    const now = Date.now()
    if (!force && now - lastSent < 400) return
    lastSent = now
    process.send?.({ type: "progress", shard: params.shardIndex, success, skipped, failed })
  }

  const result = await generatePdfsFromZipFolder({
    sourceFolder: params.sourceFolder,
    companyName: params.companyName,
    tan: params.tan,
    financialYear: params.financialYear,
    quarter: params.quarter,
    formType: params.formType,
    form16Type: params.form16Type,
    pageConcurrency: params.pageConcurrency,
    shardIndex: params.shardIndex,
    shardCount: params.shardCount,
    skipExisting: params.skipExisting,
    onPdf: (info) => {
      if (info.skipped) skipped++
      else if (info.ok) success++
      else failed++
      sendProgress()
    },
    // Only surface notable lines to the master to keep its output readable.
    logger: (msg: string) => {
      if (/❌|⚠|Shard|Failed|error/i.test(msg)) {
        process.send?.({ type: "log", shard: params.shardIndex, msg })
      }
    },
  })

  sendProgress(true)
  // generatePdfsFromZipFolder closes the shared browser in its finally block.
  process.send?.({ type: "done", shard: params.shardIndex, result }, () => {
    try {
      process.disconnect?.()
    } catch {
      // ignore
    }
  })
  setTimeout(() => process.exit(0), 5000).unref()
}

// ----------------------------------------------------------------------------
// MASTER
// ----------------------------------------------------------------------------
async function runMaster(): Promise<void> {
  const args = parseArgs(process.argv.slice(2))

  const sourceFolder = String(args.source || args.sourceFolder || "")
  const tan = String(args.tan || "")
  const companyName = String(args.company || args.companyName || "BulkRun")
  const financialYear = String(args.fy || args.financialYear || "")
  const quarter = String(args.quarter || "")
  const formType = String(args.formType || args.form || "")
  const form16Type = String(args.form16Type || "form16a") as "form16" | "form16a"

  const missing: string[] = []
  if (!sourceFolder) missing.push("--source")
  if (!tan) missing.push("--tan")
  if (!financialYear) missing.push("--fy")
  if (!quarter) missing.push("--quarter")
  if (!formType) missing.push("--formType")
  if (missing.length > 0) {
    console.error(`Missing required args: ${missing.join(", ")}`)
    console.error(
      "Usage: --source <folder> --tan <TAN> --fy <2025-26> --quarter <Q2> --formType <26Q> " +
        "[--company <name>] [--max | --processes <n>] [--pages <n>] [--machines <n>] [--machine-index <i>] [--force-regenerate]"
    )
    process.exit(1)
  }
  if (!fs.existsSync(sourceFolder)) {
    console.error(`Source folder does not exist: ${sourceFolder}`)
    process.exit(1)
  }

  const cores = os.cpus().length || 4
  const procArg = String(args.processes ?? args.p ?? "")
  let processCount: number
  if (args.max || procArg === "max") {
    processCount = cores
  } else if (procArg === "") {
    processCount = Math.max(1, Math.floor(cores * 0.75)) // leave a little headroom by default
  } else {
    processCount = Math.max(1, parseInt(procArg, 10) || 1)
  }
  const pageConcurrency = Math.max(1, parseInt(String(args.pages ?? "2"), 10) || 2)
  const machines = Math.max(1, parseInt(String(args.machines ?? "1"), 10) || 1)
  const machineIndex = Math.max(0, parseInt(String(args["machine-index"] ?? "0"), 10) || 0)
  const skipExisting = !(args["force-regenerate"] || args.force)

  const zipTotal = fs.readdirSync(sourceFolder).filter((f) => f.toLowerCase().endsWith(".zip")).length
  const globalShardCount = processCount * machines

  const line = "=".repeat(64)
  console.log(line)
  console.log("Form 16A PDF Bulk Generator (multi-process)")
  console.log(line)
  console.log(`Source folder   : ${sourceFolder}`)
  console.log(`Zip files       : ${fmt(zipTotal)}`)
  console.log(`CPU cores       : ${cores}`)
  console.log(`Machines        : ${machines} (this is machine #${machineIndex})`)
  console.log(`Processes (here): ${processCount}`)
  console.log(`Pages / process : ${pageConcurrency}`)
  console.log(`Skip existing   : ${skipExisting ? "yes (use --force-regenerate to overwrite)" : "no"}`)
  console.log(
    `Parallel PDFs   : ${processCount * pageConcurrency} on this machine` +
      (machines > 1 ? `, ${globalShardCount * pageConcurrency} across all machines` : "")
  )
  console.log(line)

  if (processCount * pageConcurrency > cores * 2) {
    console.log(
      `⚠ Parallelism (${processCount * pageConcurrency}) exceeds 2x cores (${cores}). ` +
        `If the machine thrashes or runs out of RAM, lower --pages or --processes.`
    )
  }
  if (zipTotal < globalShardCount) {
    console.log(
      `⚠ Only ${zipTotal} zip(s) for ${globalShardCount} shard(s) — some workers will be idle. ` +
        `Fewer/larger zips parallelize best when sharded by file.`
    )
  }

  // Reuse the same node loader (e.g. esbuild-register) the master was started with,
  // so forked workers can run this .ts file directly.
  const isTs = __filename.endsWith(".ts")
  const hasLoader = process.execArgv.some((a) => a.includes("register") || a.includes("ts-node"))
  const execArgv = isTs && !hasLoader ? [...process.execArgv, "-r", "esbuild-register"] : process.execArgv

  const started = Date.now()
  const stats = new Map<number, { success: number; skipped: number; failed: number; done: boolean }>()

  const spawnWorker = (localIndex: number) => {
    const globalShard = machineIndex * processCount + localIndex
    const wp: WorkerParams = {
      sourceFolder,
      companyName,
      tan,
      financialYear,
      quarter,
      formType,
      form16Type,
      shardIndex: globalShard,
      shardCount: globalShardCount,
      pageConcurrency,
      skipExisting,
    }
    stats.set(globalShard, { success: 0, skipped: 0, failed: 0, done: false })

    const child = fork(__filename, [JSON.stringify(wp)], {
      env: { ...process.env, FORM16A_WORKER: "1" },
      execArgv,
    })

    child.on("message", (m: any) => {
      if (!m || typeof m !== "object") return
      const s = stats.get(m.shard)
      if (m.type === "progress" && s) {
        s.success = m.success
        s.skipped = m.skipped ?? 0
        s.failed = m.failed
      } else if (m.type === "done" && s) {
        s.done = true
      } else if (m.type === "log") {
        process.stdout.write("\n")
        console.log(`  [worker ${m.shard}] ${m.msg}`)
      }
    })
    child.on("exit", (code) => {
      const s = stats.get(globalShard)
      if (s) s.done = true
      if (code && code !== 0) {
        process.stdout.write("\n")
        console.log(`  [worker ${globalShard}] exited with code ${code}`)
      }
    })
    return child
  }

  const children = Array.from({ length: processCount }, (_, i) => spawnWorker(i))

  const printer = setInterval(() => {
    let success = 0
    let skipped = 0
    let failed = 0
    let doneWorkers = 0
    stats.forEach((s) => {
      success += s.success
      skipped += s.skipped
      failed += s.failed
      if (s.done) doneWorkers++
    })
    const secs = (Date.now() - started) / 1000
    const rate = success / Math.max(secs, 0.001)
    process.stdout.write(
      `\r⏱  ${fmt(success)} new | ${fmt(skipped)} skipped | ${fmt(failed)} failed | ${rate.toFixed(1)}/s ` +
        `(${fmt(rate * 60)}/min) | ${secs.toFixed(0)}s | workers ${doneWorkers}/${processCount} done   `
    )
  }, 1000)

  await new Promise<void>((resolve) => {
    let exited = 0
    for (const c of children) {
      c.on("exit", () => {
        exited++
        if (exited === children.length) resolve()
      })
    }
  })

  clearInterval(printer)

  let success = 0
  let skipped = 0
  let failed = 0
  stats.forEach((s) => {
    success += s.success
    skipped += s.skipped
    failed += s.failed
  })
  const secs = (Date.now() - started) / 1000
  const rate = success / Math.max(secs, 0.001)
  console.log("\n" + line)
  console.log(`Done in ${secs.toFixed(1)}s`)
  console.log(`  PDFs generated : ${fmt(success)}`)
  console.log(`  Skipped (exist): ${fmt(skipped)}`)
  console.log(`  Failed         : ${fmt(failed)}`)
  console.log(`  Throughput     : ${rate.toFixed(1)}/s  (${fmt(rate * 60)}/min new PDFs)`)
  console.log(line)
  process.exit(failed > 0 && success === 0 && skipped === 0 ? 1 : 0)
}

// ----------------------------------------------------------------------------
// ENTRY
// ----------------------------------------------------------------------------
if (process.env.FORM16A_WORKER === "1") {
  runWorker().catch((err) => {
    console.error("Worker fatal:", err)
    process.exit(1)
  })
} else {
  runMaster().catch((err) => {
    console.error("Master fatal:", err)
    process.exit(1)
  })
}
