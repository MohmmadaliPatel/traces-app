import db from "db"
import * as fs from "fs"
import * as path from "path"

export type WorkerLogger = { log: (msg: string) => void }

/** Append a unique message line onto Task.message (used by all NoticeDownloader workers). */
export async function addMessageToTask(taskId: number, msg: string) {
  const task = await db.task.findUnique({
    where: { id: taskId },
    select: { message: true },
  })

  if (task?.message?.includes(msg)) {
    return
  }

  const updatedMessage = task?.message ? `${task.message}\n${msg}` : msg

  return db.task.update({
    where: { id: taskId },
    data: {
      message: { set: updatedMessage },
    },
  })
}

/** Normalize company / folder names for fuzzy matching (Pvt Ltd variants, whitespace). */
export function normalizeCompanyFolderName(name: string): string {
  return (name || "")
    .toLowerCase()
    .replace(/private limited/gi, "pvt ltd")
    .replace(/pvt\./gi, "pvt")
    .replace(/ltd\./gi, "ltd")
    .replace(/\s+/g, " ")
    .trim()
}

/** Directories that are never a company folder and are not worth descending into. */
const SKIP_DIR_NAMES = new Set(["__macosx", "node_modules"])

function isSkippableDir(name: string): boolean {
  return name.startsWith(".") || SKIP_DIR_NAMES.has(name.toLowerCase())
}

/** Upper bound on directories inspected by a single search. */
const MAX_DIRS_SCANNED = 5000

/**
 * Generic wrapper folders that group company folders without naming a company, such as the
 * `output` in `<fy>/Q1/output/<company>` that the download / extract steps write into.
 */
const CONTAINER_DIR_NAMES = new Set([
  "output",
  "outputs",
  "input",
  "inputs",
  "file",
  "files",
  "extract",
  "extracted",
  "download",
  "downloads",
  "result",
  "results",
  "archive",
  "zip",
  "unzip",
  "temp",
  "tmp",
  "data",
  "company",
  "companies",
])

/**
 * Folder names that are structural (quarter / form type / year / wrapper buckets) rather
 * than company names, e.g. "Q1", "Quarter 2", "26Q", "F24Q", "2025-26", "202526", "output".
 */
export function isStructuralFolderName(name: string): boolean {
  const n = (name || "").trim()
  return (
    CONTAINER_DIR_NAMES.has(n.toLowerCase()) ||
    /^(?:q|qtr|quarter)[\s_.-]*[1-4]$/i.test(n) ||
    /^f?\d{2}(e)?q\d?$/i.test(n) ||
    /^\d{4}[-_]?\d{2,4}$/.test(n) ||
    /^(original|correction|regular|revised|fvu|conso|form\s*16a?|justification)$/i.test(n)
  )
}

/** Score how well a folder name matches the wanted company name (higher is better, 0 = no match). */
function scoreFolderMatch(normalizedFolder: string, normalizedTarget: string): number {
  if (!normalizedFolder || !normalizedTarget) return 0
  if (normalizedFolder === normalizedTarget) return 1000
  // Substring matches only count when the shorter side is specific enough to be a name.
  const shorter = Math.min(normalizedFolder.length, normalizedTarget.length)
  if (shorter < 4) return 0
  if (normalizedFolder.includes(normalizedTarget) || normalizedTarget.includes(normalizedFolder)) {
    return shorter
  }
  return 0
}

/**
 * Find the folder for a company underneath baseFolder.
 *
 * The layout under a financial-year folder is not fixed: the company folder may sit
 * directly in it (`<fy>/<company>`) or behind any nesting of structural folders such as
 * quarter / form-type buckets or wrapper folders written by the download steps
 * (`<fy>/Q1/<company>`, `<fy>/26Q/Q1/<company>`, `<fy>/Q1/output/<company>`, ...).
 * An exactly-named folder always beats a fuzzy one, and shallower matches win among equals;
 * unrecognised wrappers are covered by the deep-scan fallback below.
 */
export function findMatchingCompanyFolder(
  companyName: string,
  baseFolder: string,
  maxDepth = 4
): string | null {
  try {
    if (!fs.existsSync(baseFolder)) {
      return null
    }

    const normalizedTarget = normalizeCompanyFolderName(companyName)

    let level = [baseFolder]
    let visited = 0
    let bestFuzzy: { path: string; score: number } | null = null

    for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
      const next: string[] = []
      let levelBest: { path: string; score: number } | null = null

      for (const dir of level) {
        // Exact path first (Conso / Form16 / Justification write folders verbatim).
        const exactPath = path.join(dir, companyName)
        if (fs.existsSync(exactPath)) {
          return exactPath
        }

        let entries: fs.Dirent[]
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true })
        } catch {
          continue
        }

        for (const entry of entries) {
          if (!entry.isDirectory() || isSkippableDir(entry.name)) continue
          if (++visited > MAX_DIRS_SCANNED) return bestFuzzy ? bestFuzzy.path : null

          const full = path.join(dir, entry.name)
          const normalizedFolder = normalizeCompanyFolderName(entry.name)

          if (normalizedFolder === normalizedTarget) {
            return full
          }

          const score = scoreFolderMatch(normalizedFolder, normalizedTarget)
          if (score > 0 && (!levelBest || score > levelBest.score)) {
            levelBest = { path: full, score }
          }

          // Only structural buckets are worth descending through; descending into a
          // different company's folder would risk matching the wrong entity.
          if (score === 0 && isStructuralFolderName(entry.name)) {
            next.push(full)
          }
        }
      }

      // Keep the shallowest fuzzy match, but keep looking for an exact one further down.
      if (!bestFuzzy && levelBest) {
        bestFuzzy = levelBest
      }

      level = next
    }

    if (bestFuzzy) {
      return bestFuzzy.path
    }

    // Nothing recognisable on the way down: fall back to scanning every folder.
    return deepScanForCompanyFolder(companyName, baseFolder, maxDepth)
  } catch {
    // Base folder doesn't exist or can't be read
  }

  return null
}

/**
 * Last-resort walk, used only when the structural search above found nothing: descend
 * through every folder under baseFolder regardless of how it is named, so company folders
 * behind unexpected wrappers (`<fy>/Q1/conso files/<company>`) are still found. A folder
 * named exactly like the company wins anywhere in the tree; a fuzzy match is accepted only
 * when no exact one exists, and the shallowest fuzzy match wins.
 */
function deepScanForCompanyFolder(
  companyName: string,
  baseFolder: string,
  maxDepth: number
): string | null {
  const normalizedTarget = normalizeCompanyFolderName(companyName)

  let level = [baseFolder]
  let visited = 0
  let bestFuzzy: { path: string; score: number } | null = null

  for (let depth = 0; depth < maxDepth && level.length > 0; depth++) {
    const next: string[] = []
    let levelBest: { path: string; score: number } | null = null

    for (const dir of level) {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        continue
      }

      for (const entry of entries) {
        if (!entry.isDirectory() || isSkippableDir(entry.name)) continue
        if (++visited > MAX_DIRS_SCANNED) return bestFuzzy ? bestFuzzy.path : null

        const full = path.join(dir, entry.name)
        const normalizedFolder = normalizeCompanyFolderName(entry.name)

        if (normalizedFolder === normalizedTarget) {
          return full
        }

        const score = scoreFolderMatch(normalizedFolder, normalizedTarget)
        if (score > 0 && (!levelBest || score > levelBest.score)) {
          levelBest = { path: full, score }
        }

        next.push(full)
      }
    }

    // Keep the shallowest fuzzy match, but keep looking for an exact one further down.
    if (!bestFuzzy && levelBest) {
      bestFuzzy = levelBest
    }

    level = next
  }

  return bestFuzzy ? bestFuzzy.path : null
}

/** Recursively collect .txt files under a directory. */
export function findTxtFilesRecursively(dir: string): string[] {
  const results: string[] = []
  if (!fs.existsSync(dir)) return results

  const entries = fs.readdirSync(dir, { withFileTypes: true })
  for (const entry of entries) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      results.push(...findTxtFilesRecursively(full))
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".txt")) {
      results.push(full)
    }
  }
  return results
}
