#!/usr/bin/env node
/**
 * Generic TypeScript entrypoint runner for src/scripts/*.ts, used by the DSC commands.
 *
 *   node scripts/run-ts.js src/scripts/dscUnlock.ts [--flags]
 *
 * Registers a TS loader plus the "src/*" and "db" path aliases the app relies on, then
 * runs the requested script. Same fallback chain as scripts/dsc-test.js so it still works
 * on a Windows install with a slimmer node_modules:
 *   loader   ts-node (transpile-only) -> esbuild-register
 *   aliases  tsconfig-paths           -> built-in Module._resolveFilename hook
 */
const path = require("path")
const fs = require("fs")
const Module = require("module")

const baseUrl = path.join(__dirname, "..")
const aliasPaths = {
  "src/*": ["src/*"],
  db: ["db/index.ts"],
  "db/*": ["db/*"],
}

const target = process.argv[2]
if (!target) {
  console.error("[run-ts] Usage: node scripts/run-ts.js <script.ts> [args...]")
  process.exit(1)
}
// Drop the script path so the target sees its own flags at process.argv.slice(2).
process.argv.splice(2, 1)

let loader = ""
try {
  require("ts-node").register({
    transpileOnly: true,
    compilerOptions: {
      module: "commonjs",
      target: "es2019",
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      skipLibCheck: true,
      baseUrl,
      paths: aliasPaths,
    },
  })
  loader = "ts-node (transpile-only)"
} catch (tsNodeErr) {
  try {
    require("esbuild-register/dist/node").register({ target: "node18" })
    loader = "esbuild-register"
  } catch (esbuildErr) {
    console.error(
      "[run-ts] No TypeScript loader available.\n" +
        `  ts-node:          ${tsNodeErr.message}\n` +
        `  esbuild-register: ${esbuildErr.message}\n` +
        "  Fix: run `yarn install` in the project."
    )
    process.exit(1)
  }
}

try {
  require("tsconfig-paths").register({ baseUrl, paths: aliasPaths })
  loader += " + tsconfig-paths"
} catch {
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    let candidate = null
    if (request === "db") candidate = path.join(baseUrl, "db", "index.ts")
    else if (request.startsWith("db/")) candidate = path.join(baseUrl, request)
    else if (request.startsWith("src/")) candidate = path.join(baseUrl, request)

    if (candidate) {
      const tries = [
        candidate,
        `${candidate}.ts`,
        `${candidate}.tsx`,
        `${candidate}.js`,
        path.join(candidate, "index.ts"),
      ]
      for (const p of tries) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return originalResolve.call(this, p, ...rest)
      }
    }
    return originalResolve.call(this, request, ...rest)
  }
  loader += " + built-in alias resolver"
}

process.env.DSC_TEST_LOADER = loader

require(path.isAbsolute(target) ? target : path.join(baseUrl, target))
