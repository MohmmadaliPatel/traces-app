#!/usr/bin/env node
/**
 * Cross-platform runner for the Form 131 DSC diagnostic (src/scripts/testDscForm131.ts).
 *
 * Registers a TypeScript loader plus the "src/*" and "db" path aliases the app relies on,
 * then runs the diagnostic. Works on Windows, macOS and Linux:
 *
 *   yarn dsc:test [flags]
 *   npm run dsc:test -- [flags]
 *   node scripts/dsc-test.js [flags]
 *
 * Loader preference: ts-node → esbuild-register (both ship with the app's dependencies).
 * Alias resolution: tsconfig-paths when available, otherwise a small built-in resolver,
 * so the script still runs on a machine with a slimmer node_modules.
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

// --- TypeScript loader ------------------------------------------------------
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
      "[dsc:test] No TypeScript loader available.\n" +
        `  ts-node:          ${tsNodeErr.message}\n` +
        `  esbuild-register: ${esbuildErr.message}\n` +
        "  Fix: run `yarn install` in the project, or `yarn add -D ts-node`."
    )
    process.exit(1)
  }
}

// --- Path aliases -----------------------------------------------------------
try {
  require("tsconfig-paths").register({ baseUrl, paths: aliasPaths })
  loader += " + tsconfig-paths"
} catch {
  // Minimal stand-in: resolve "db", "db/*" and "src/*" against the project root.
  const originalResolve = Module._resolveFilename
  Module._resolveFilename = function (request, ...rest) {
    let candidate = null
    if (request === "db") candidate = path.join(baseUrl, "db", "index.ts")
    else if (request.startsWith("db/")) candidate = path.join(baseUrl, request)
    else if (request.startsWith("src/")) candidate = path.join(baseUrl, request)

    if (candidate) {
      for (const p of [candidate, `${candidate}.ts`, `${candidate}.tsx`, `${candidate}.js`, path.join(candidate, "index.ts")]) {
        if (fs.existsSync(p) && fs.statSync(p).isFile()) return originalResolve.call(this, p, ...rest)
      }
    }
    return originalResolve.call(this, request, ...rest)
  }
  loader += " + built-in alias resolver"
}

process.env.DSC_TEST_LOADER = loader

require(path.join(baseUrl, "src", "scripts", "testDscForm131.ts"))
