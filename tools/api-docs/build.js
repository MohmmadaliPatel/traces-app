/**
 * Generates the client API pack from catalog.js:
 *   - OpenAPI 3.0.3 (YAML + JSON), also copied to docs/openapi.yaml and public/docs/openapi.yaml (served at /api-docs)
 *   - standalone swagger.html
 *   - Postman v2.1 collection + environment
 *   - API-Endpoint-Reference.xlsx (endpoints, request fields, response fields)
 *
 * Usage: node tools/api-docs/build.js [outDir]   (default docs/client-response)
 */
const fs = require("fs")
const path = require("path")
const yaml = require("js-yaml")
const ExcelJS = require("exceljs")
const { schemas } = require("./schemas")
const { catalog, RPC_NOTE } = require("./catalog")

const ROOT = path.resolve(__dirname, "..", "..")
const OUT = path.resolve(ROOT, process.argv[2] || "docs/client-response")
const clean = (v) => JSON.parse(JSON.stringify(v)) // drop undefined
const MODE_LABEL = { sync: "Synchronous (portal call)", async: "Asynchronous (returns batchId)", read: "Database read", stream: "Server-Sent Events stream", binary: "File download" }

// ───────────────────────────── helpers ─────────────────────────────
const usedIds = new Set()
function operationId(name) {
  let id = name.replace(/[^A-Za-z0-9]+(.)?/g, (_, c) => (c ? c.toUpperCase() : "")).replace(/^./, (c) => c.toLowerCase())
  while (usedIds.has(id)) id += "_"
  usedIds.add(id)
  return id
}
const rpcSuccess = (result) => ({
  type: "object", required: ["result", "error"],
  properties: { result, error: { type: "object", nullable: true, description: "null on success", example: null }, meta: { type: "object", description: "Serializer metadata; ignore" } },
})
const requestExamplesOf = (ep) => {
  if (ep.rpc) {
    const list = ep.paramsExamples || [{ name: ep.name, params: ep.paramsExample || {} }]
    return list.map((e) => ({ name: e.name, body: { params: e.params, meta: {} }, folder: e.folder }))
  }
  return ep.examples || [{ name: ep.name }]
}
const responsesOf = (ep) => {
  if (!ep.rpc) return ep.responses
  const out = [
    { status: 200, description: "Success: result holds the data", schema: rpcSuccess(ep.result), example: { result: ep.resultExample, error: null }, exampleName: "Success" },
    { status: 200, description: "Resolver error (still HTTP 200): result is null and error describes it", schema: { $ref: "#/components/schemas/RpcErrorEnvelope" }, example: { result: null, error: ep.rpcErrorExample || { name: "AuthenticationError", message: "You must be logged in to access this", code: null, statusCode: 401, meta: null, url: null } }, exampleName: "Error" },
  ]
  if (!ep.noBearer) out.push({ status: 401, description: "Invalid or expired API token", schema: { $ref: "#/components/schemas/Unauthorized" }, example: { error: "Unauthorized" } })
  out.push({ status: 403, description: "Request blocked by the input-safety filter (script / HTML / CRLF patterns in the body)", schema: { $ref: "#/components/schemas/FileError" }, example: { message: "Invalid request body detected" } })
  return out
}
const fullDescription = (ep) => [ep.summary ? `**${ep.summary}**` : "", `Mode: ${MODE_LABEL[ep.mode] || ep.mode}.`, ep.description || "", ep.rpc ? RPC_NOTE : ""].filter(Boolean).join("\n\n")

// ───────────────────────────── OpenAPI ─────────────────────────────
function buildOpenApi() {
  const paths = {}
  const tagsSeen = []
  for (const ep of catalog) {
    const key = ep.method.toLowerCase()
    paths[ep.path] = paths[ep.path] || {}
    if (paths[ep.path][key]) throw new Error(`Duplicate ${ep.method} ${ep.path}`)
    for (const t of ep.tags || []) if (!tagsSeen.includes(t)) tagsSeen.push(t)

    const op = { tags: ep.tags, summary: ep.name, description: fullDescription(ep), operationId: operationId(ep.name) }
    if (ep.noBearer) op.security = []
    const params = []
    for (const p of ep.pathParams || []) params.push({ name: p.name, in: "path", required: true, description: p.description, schema: p.schema, ...(p.name === "slug" ? { allowReserved: true } : {}) })
    for (const q of ep.query || []) params.push({ name: q.name, in: "query", required: !!q.required, description: q.description, schema: q.schema })
    if (params.length) op.parameters = params

    const reqExamples = requestExamplesOf(ep).filter((e) => e.body)
    const bodySchema = ep.rpc ? { type: "object", required: ["params"], properties: { params: ep.params, meta: { type: "object", description: "Send {}", example: {} } } } : ep.body
    if (bodySchema) {
      op.requestBody = { required: true, content: { "application/json": { schema: bodySchema } } }
      if (reqExamples.length) op.requestBody.content["application/json"].examples = Object.fromEntries(reqExamples.map((e, i) => [`example${i + 1}`, { summary: e.name, value: e.body }]))
    }

    const byStatus = new Map()
    for (const r of responsesOf(ep)) {
      if (!byStatus.has(r.status)) byStatus.set(r.status, [])
      byStatus.get(r.status).push(r)
    }
    op.responses = {}
    for (const [status, list] of byStatus) {
      const first = list[0]
      if (first.binary) {
        op.responses[status] = { description: first.description, content: { [first.contentType || "application/octet-stream"]: { schema: { type: "string", format: "binary" } } } }
        continue
      }
      const ct = first.contentType || "application/json"
      const schema = list.length === 1 ? first.schema : { oneOf: list.map((r) => r.schema) }
      const examples = Object.fromEntries(list.map((r, i) => [r.exampleName ? r.exampleName.toLowerCase() : `example${i + 1}`, { summary: r.exampleName || r.description, value: r.example }]))
      op.responses[status] = { description: list.map((r) => r.description).join(" | "), content: { [ct]: { schema, examples } } }
    }
    paths[ep.path][key] = op
  }

  return clean({
    openapi: "3.0.3",
    info: {
      title: "Taxteck TRACES / Income Tax Portal API",
      version: "1.1.0",
      description: [
        "APIs for LDC (lower deduction certificates) and TDS on Expense: challans, unconsumed challans, Form 16 / 16A, conso, justification, statement status, demand and certificate extraction.",
        "",
        "**Authentication:** every call needs `Authorization: Bearer <api token>` (create one with Login + Create API token). Do not keep a cookie jar for API calls.",
        "",
        "**Two call styles:** REST endpoints take plain JSON. RPC endpoints (`/api/rpc/*`) take `{ \"params\": {...}, \"meta\": {} }` and answer `{ \"result\": ..., \"error\": null }`; resolver errors come back with HTTP 200 and an `error` object.",
        "",
        "**Modes:** synchronous portal calls stay open until done (allow at least 15 minutes); asynchronous calls return a `batchId` to poll; database reads return in under a second.",
        "",
        "**LDC errors:** `{ success: false, errorCode, message, retryable }`.",
      ].join("\n"),
    },
    servers: [{ url: "http://localhost:3000", description: "Local / on-premise server (replace with your host)" }],
    security: [{ bearerAuth: [] }],
    tags: tagsSeen.map((name) => ({ name })),
    paths,
    components: {
      securitySchemes: { bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "tt_<32 hex>", description: "API token from Create API token" } },
      schemas,
    },
  })
}

// ───────────────────────────── Postman ─────────────────────────────
const VAR_BY_KEY = { companyId: "{{companyId}}", batchId: "{{batchId}}", companyName: "{{companyName}}" }
function postmanize(value, parentKey) {
  if (Array.isArray(value)) return value.map((v) => postmanize(v, parentKey))
  if (value && typeof value === "object") {
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (parentKey === "credentials") out[k] = { userId: "{{tracesUserId}}", password: "{{tracesPassword}}", tan: "{{tan}}" }[k] ?? v
      else if (parentKey === "companies") out[k] = { name: "{{companyName}}", tan: "{{tan}}", it_password: "{{itPassword}}", user_id: "{{tracesUserId}}", password: "{{tracesPassword}}" }[k] ?? v
      else if (k === "tan" && typeof v === "string") out[k] = "{{tan}}"
      else if (VAR_BY_KEY[k] && (typeof v === "number" || typeof v === "string")) out[k] = VAR_BY_KEY[k]
      else out[k] = postmanize(v, k)
    }
    return out
  }
  return value
}
const unquoteNumbers = (raw) => raw.replace(/"\{\{(companyId|batchId)\}\}"/g, "{{$1}}")

function buildPostman() {
  const root = { item: [] }
  const folderNode = (folderPath) => {
    let node = root
    for (const name of folderPath) {
      let next = node.item.find((i) => i.name === name && i.item)
      if (!next) { next = { name, item: [] }; node.item.push(next) }
      node = next
    }
    return node
  }
  let count = 0
  for (const ep of catalog) {
    for (const ex of requestExamplesOf(ep)) {
      let urlPath = ep.path
      for (const [k, v] of Object.entries(ex.path || {})) urlPath = urlPath.replace(`{${k}}`, v)
      const query = ex.query ? Object.entries(ex.query).map(([key, value]) => ({ key, value: key === "companyId" ? "{{companyId}}" : key === "batchId" ? "{{batchId}}" : String(value) })) : undefined
      const rawUrl = `{{baseUrl}}${urlPath}${query ? "?" + query.map((q) => `${q.key}=${q.value}`).join("&") : ""}`
      const headers = [...(ex.body ? [{ key: "Content-Type", value: "application/json" }] : []), ...((ep.postman && ep.postman.headers) || [])]
      const request = {
        method: ep.method,
        header: headers,
        url: { raw: rawUrl, host: ["{{baseUrl}}"], path: urlPath.replace(/^\//, "").split("/"), ...(query ? { query } : {}) },
        description: fullDescription(ep),
      }
      if (ex.body) request.body = { mode: "raw", raw: unquoteNumbers(JSON.stringify(postmanize(ex.body), null, 2)), options: { raw: { language: "json" } } }
      if (ep.postman && ep.postman.noauth) request.auth = { type: "noauth" }
      const item = {
        name: ex.name, request,
        protocolProfileBehavior: { disableCookies: !(ep.postman && ep.postman.cookies) },
        response: responsesOf(ep).map((r) => ({
          name: `${r.status} ${r.exampleName || r.description}`.slice(0, 120),
          originalRequest: request,
          status: r.description.slice(0, 60),
          code: r.status,
          _postman_previewlanguage: r.binary ? "text" : "json",
          header: [{ key: "Content-Type", value: r.contentType || "application/json" }],
          body: r.binary ? "" : r.rawExample || JSON.stringify(r.example, null, 2),
        })),
      }
      if (ep.postman && ep.postman.test) item.event = [{ listen: "test", script: { type: "text/javascript", exec: ep.postman.test } }]
      folderNode(ex.folder || ep.folder).item.push(item)
      count++
    }
  }
  const collection = clean({
    info: {
      name: "Taxteck TRACES / IT Portal APIs - LDC & TDS on Expense",
      description: [
        "Every request here is also in the OpenAPI / Swagger spec, with the same request body and response examples (generated from one catalog).",
        "",
        "Setup:",
        "1. Import Taxteck.postman_environment.json and select it.",
        "2. Set baseUrl, appEmail, appPassword. Run 0. Auth > Login (session), then Create API token: the token is saved to apiToken automatically.",
        "3. Fill companyId, companyName, tan and the TRACES / IT credentials (secret variables).",
        "",
        "Notes:",
        "- Cookies are disabled on every request except Login and Create API token. Keep it that way: a session cookie on an API call makes the server ask for a CSRF token.",
        "- RPC requests (/api/rpc/*) return HTTP 200 even for errors; check the error field. Each RPC request has a saved Success and Error example.",
        "- Synchronous portal requests can take several minutes: set Settings > Request timeout to 0 (no timeout) or at least 900000 ms.",
      ].join("\n"),
      schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    auth: { type: "bearer", bearer: [{ key: "token", value: "{{apiToken}}", type: "string" }] },
    item: root.item,
  })
  const environment = {
    name: "Taxteck - client",
    values: [
      ["baseUrl", "http://localhost:3000", "default"], ["appEmail", "", "default"], ["appPassword", "", "secret"],
      ["apiToken", "", "secret"], ["antiCsrf", "", "secret"], ["companyId", "1", "default"],
      ["companyName", "Example Deductor Pvt Ltd", "default"], ["tan", "MUMB12345E", "default"],
      ["tracesUserId", "", "default"], ["tracesPassword", "", "secret"], ["itPassword", "", "secret"], ["batchId", "1", "default"],
    ].map(([key, value, type]) => ({ key, value, type, enabled: true })),
    _postman_variable_scope: "environment",
  }
  return { collection, environment, count }
}

// ───────────────────────────── Excel reference ─────────────────────────────
function resolve(schema) {
  let s = schema
  while (s && s.$ref) s = schemas[s.$ref.split("/").pop()]
  return s || {}
}
function typeOf(schema) {
  const s = resolve(schema)
  if (s.oneOf) return s.oneOf.map(typeOf).join(" | ")
  if (s.allOf) return "object"
  if (s.type === "array") return `array of ${typeOf(s.items || {})}`
  if (s.type === "string" && s.format === "binary") return "file"
  return (s.type || "object") + (s.enum ? ` (${s.enum.join(" / ")})` : "") + (s.nullable ? " | null" : "")
}
function flatten(schema, prefix, rows, depth = 0, required = []) {
  const s = resolve(schema)
  if (depth > 6) return
  if (s.allOf) { for (const part of s.allOf) flatten(part, prefix, rows, depth, required); return }
  if (s.oneOf && s.oneOf.every((o) => resolve(o).type === "object" || resolve(o).properties)) { s.oneOf.forEach((o) => flatten(o, prefix, rows, depth, required)); return }
  if (s.type === "array" && s.items) {
    const it = resolve(s.items)
    if (it.properties || it.allOf) flatten(s.items, `${prefix}[]`, rows, depth + 1)
    return
  }
  for (const [name, child] of Object.entries(s.properties || {})) {
    const c = resolve(child)
    const field = prefix ? `${prefix}.${name}` : name
    if (!rows.some((r) => r.field === field)) {
      rows.push({ field, type: typeOf(child), required: (s.required || []).includes(name) ? "Yes" : "No", description: c.description || "", example: c.example === undefined ? "" : typeof c.example === "object" ? JSON.stringify(c.example) : String(c.example) })
    }
    if (c.properties || c.allOf || (c.type === "array" && c.items && (resolve(c.items).properties || resolve(c.items).allOf))) flatten(child, field, rows, depth + 1)
  }
}
async function buildExcel(file) {
  const wb = new ExcelJS.Workbook()
  const style = (ws, widths) => {
    ws.columns = widths.map((w) => ({ width: w }))
    ws.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } }
    ws.getRow(1).eachCell((c) => (c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F4E78" } }))
    ws.views = [{ state: "frozen", ySplit: 1 }]
    ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: widths.length } }
    ws.eachRow((r) => r.eachCell((c) => (c.alignment = { wrapText: true, vertical: "top" })))
  }
  const eps = wb.addWorksheet("Endpoints")
  eps.addRow(["#", "Folder", "Name", "Method", "Path", "Style", "Mode", "Summary"])
  catalog.forEach((ep, i) => eps.addRow([i + 1, ep.folder.join(" / "), ep.name, ep.method, ep.path, ep.rpc ? "RPC" : "REST", MODE_LABEL[ep.mode], ep.summary]))
  style(eps, [5, 34, 34, 8, 44, 7, 26, 70])

  const req = wb.addWorksheet("Request fields")
  req.addRow(["Endpoint", "Path", "In", "Field", "Type", "Required", "Description", "Example"])
  for (const ep of catalog) {
    for (const p of ep.pathParams || []) req.addRow([ep.name, ep.path, "path", p.name, typeOf(p.schema), "Yes", p.description, p.schema.example ?? ""])
    for (const q of ep.query || []) req.addRow([ep.name, ep.path, "query", q.name, typeOf(q.schema), q.required ? "Yes" : "No", q.description, q.schema.example ?? ""])
    const rows = []
    if (ep.rpc) { rows.push({ field: "params", type: "object", required: "Yes", description: "Operation input (fields below)", example: "" }); flatten(ep.params, "params", rows); rows.push({ field: "meta", type: "object", required: "No", description: "Send {}", example: "{}" }) }
    else if (ep.body) flatten(ep.body, "", rows)
    for (const r of rows) req.addRow([ep.name, ep.path, "body", r.field, r.type, r.required, r.description, r.example])
  }
  style(req, [32, 40, 7, 40, 26, 9, 60, 30])

  const res = wb.addWorksheet("Response fields")
  res.addRow(["Endpoint", "Path", "HTTP status", "Case", "Field", "Type", "Description", "Example"])
  for (const ep of catalog) {
    for (const r of responsesOf(ep)) {
      if (r.binary) { res.addRow([ep.name, ep.path, r.status, r.description, "(file)", "binary", r.contentType || "", ""]); continue }
      const rows = []
      flatten(r.schema, "", rows)
      if (!rows.length) rows.push({ field: "(body)", type: typeOf(r.schema), description: "", example: "" })
      rows.forEach((f, i) => res.addRow([ep.name, ep.path, r.status, i === 0 ? r.exampleName || r.description : "", f.field, f.type, f.description, f.example]))
    }
  }
  style(res, [32, 40, 8, 36, 44, 26, 60, 30])
  await wb.xlsx.writeFile(file)
}

// ───────────────────────────── write ─────────────────────────────
;(async () => {
  const dirs = { postman: path.join(OUT, "01-Postman"), openapi: path.join(OUT, "02-OpenAPI-Swagger"), ref: path.join(OUT, "03-API-Reference") }
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }))

  const spec = buildOpenApi()
  const specYaml = "# Generated by tools/api-docs/build.js from tools/api-docs/catalog.js - do not edit by hand\n" + yaml.dump(spec, { lineWidth: 140, noRefs: true })
  fs.writeFileSync(path.join(dirs.openapi, "openapi.yaml"), specYaml)
  fs.writeFileSync(path.join(dirs.openapi, "openapi.json"), JSON.stringify(spec, null, 2) + "\n")
  fs.writeFileSync(path.join(ROOT, "docs", "openapi.yaml"), specYaml)
  fs.writeFileSync(path.join(ROOT, "public", "docs", "openapi.yaml"), specYaml)
  fs.writeFileSync(
    path.join(dirs.openapi, "swagger.html"),
    `<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Taxteck API - Swagger</title>\n<link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui.css"></head>\n<body><div id="swagger-ui"></div>\n<script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5.17.14/swagger-ui-bundle.js"></script>\n<script>const spec = ${JSON.stringify(spec)};\nwindow.ui = SwaggerUIBundle({ spec, dom_id: "#swagger-ui", deepLinking: true, docExpansion: "none", defaultModelsExpandDepth: 0 });</script>\n</body></html>\n`
  )

  const { collection, environment, count } = buildPostman()
  fs.writeFileSync(path.join(dirs.postman, "Taxteck-TDS-APIs.postman_collection.json"), JSON.stringify(collection, null, 2) + "\n")
  fs.writeFileSync(path.join(dirs.postman, "Taxteck.postman_environment.json"), JSON.stringify(environment, null, 2) + "\n")

  await buildExcel(path.join(dirs.ref, "API-Endpoint-Reference.xlsx"))
  console.log(`endpoints: ${catalog.length}, OpenAPI operations: ${Object.values(spec.paths).reduce((n, p) => n + Object.keys(p).length, 0)}, Postman requests: ${count}`)
})().catch((e) => { console.error(e); process.exit(1) })
