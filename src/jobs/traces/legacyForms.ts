/**
 * Legacy JSF form helpers for the TRACES old portal (MyFaces).
 *
 * A legacy form submit is what a browser would send: the form's successful controls
 * (hidden fields and `javax.faces.ViewState` included, other buttons and unchecked
 * radios/checkboxes excluded), the changed fields, and only the clicked control —
 * `name=value` for a button, or `<formId>:_idcl=<linkId>` for a MyFaces commandLink.
 * The POST goes to the form's own `action` (the page that rendered it after any
 * redirects), never to a hard-coded page.
 *
 * Redirects are followed manually so Set-Cookie hops are captured, http:// Locations
 * are rewritten to https:// (mirrors the old CDP "https upgrade" guard) and a redirect
 * to the new portal is surfaced instead of followed.
 *
 * Multi-step flows must submit from the *previous response* (its ViewState and form) —
 * pass the returned {@link LegacyPage} to the next step.
 */
import fs from "fs"
import path from "path"
import { AxiosRequestConfig, AxiosResponse } from "axios"
import {
  Traces61ApiSession,
  isRedirectToNewPortal,
  legacyGet,
  traces61Url,
} from "./apiSession"
import { isTransientTracesFailure, tracesRetryDelayMs } from "./auth"
import { rewriteTracesHttpToHttps } from "./constants"
import {
  HtmlForm,
  HtmlTag,
  extractHtmlMessages,
  extractViewStateFromHtml,
  findFormContainingElement,
  findHtmlElement,
  findHtmlForm,
  htmlHasCaptcha,
  htmlHasElementId,
  htmlIsResourceNotFound,
  listSelectOptions,
  matchSelectOption,
  parseMyFacesSubmitCall,
  parseOnclickFieldAssignments,
  successfulFormEntries,
} from "./legacyHtml"

const FILE = "src/jobs/traces/legacyForms.ts"
function log(fn: string, message: string, detail?: string) {
  const extra = detail ? ` ${detail}` : ""
  console.log(`[TRACES] ${FILE} · ${fn} — ${message}${extra}`)
}

export type LegacyPage = {
  status: number
  html: string
  /** URL that produced this response (after redirects) — the base for the next form action. */
  url: string
  /** Redirect Location header (if the final response was a 3xx). */
  location?: string
  /** True when the portal bounced the request to the new SPA portal (dead session). */
  redirectedToNewPortal: boolean
}

export type LegacyFormSubmit = LegacyPage

/** Fields keyed by element id or by input name; ids are resolved to names within the form. */
export type LegacyFields = Record<string, string>

export type LegacySubmitOptions = {
  fields?: LegacyFields
  /** Ids of radio buttons / checkboxes to check (e.g. `search2`). */
  check?: string[]
  /** Ids of radio buttons / checkboxes to uncheck (a page script unticking `search1`). */
  uncheck?: string[]
}

const REDIRECT_STATUSES = [301, 302, 303, 307, 308]

let dumpSeq = 0
/**
 * Debug trail: when `TRACES_LEGACY_DUMP_DIR` is set, every legacy page GET and form POST is
 * written there (`exchanges.jsonl` + the response HTML), so a failed step can be read
 * without another portal run.
 */
function dumpLegacyExchange(kind: "GET" | "POST", requestUrl: string, page: LegacyPage, params?: Array<[string, string]>) {
  const dir = process.env.TRACES_LEGACY_DUMP_DIR
  if (!dir) return
  try {
    fs.mkdirSync(dir, { recursive: true })
    const id = String(++dumpSeq).padStart(4, "0")
    const htmlFile = `${id}-${kind}-${(page.url.split("?")[0] ?? "").split("/").pop() || "page"}.html`
    fs.writeFileSync(path.join(dir, htmlFile), page.html)
    const entry = {
      id,
      kind,
      requestUrl,
      params,
      status: page.status,
      finalUrl: page.url,
      location: page.location,
      redirectedToNewPortal: page.redirectedToNewPortal,
      htmlFile,
    }
    fs.appendFileSync(path.join(dir, "exchanges.jsonl"), JSON.stringify(entry) + "\n")
  } catch (err: any) {
    log("dumpLegacyExchange", "could not write dump", String(err?.message || err))
  }
}

function toLegacyPage(res: AxiosResponse, requestedUrl: string): LegacyPage {
  const html = Buffer.isBuffer(res.data) ? res.data.toString("utf8") : String(res.data ?? "")
  const location = typeof res.headers["location"] === "string" ? res.headers["location"] : undefined
  const url = res.config?.url ? traces61Url(res.config.url) : requestedUrl
  let target: string | undefined
  try {
    target = location ? rewriteTracesHttpToHttps(new URL(location, url).toString()) : undefined
  } catch {
    target = undefined
  }
  return {
    status: res.status,
    html,
    url,
    location: target ?? location,
    redirectedToNewPortal: isRedirectToNewPortal(target),
  }
}

/** GET a legacy page and return its HTML plus redirect diagnostics. */
export async function loadLegacyPage(
  session: Pick<Traces61ApiSession, "client">,
  pathOrUrl: string,
  config: AxiosRequestConfig = {}
): Promise<LegacyPage> {
  const url = traces61Url(pathOrUrl)
  const page = toLegacyPage(await legacyGet(session, url, config), url)
  dumpLegacyExchange("GET", url, page)
  return page
}

/** Extract the `name=value` pairs a browser would submit for one MyFaces form. */
export function extractLegacyFormInputs(
  html: string,
  formIdOrName: string,
  options: { includeViewState?: boolean } = {}
): Record<string, string> {
  const form = findHtmlForm(html, formIdOrName)
  if (!form) return {}
  const inputs: Record<string, string> = {}
  for (const [name, value] of successfulFormEntries(form.inner)) {
    if (name === "javax.faces.ViewState" && options.includeViewState === false) continue
    if (!(name in inputs)) inputs[name] = value
  }
  return inputs
}

/** Id of the form that contains an element with the given id (or name). */
export function formIdContainingInput(html: string, inputId: string): string | null {
  return findFormContainingElement(html, inputId)?.form.key ?? null
}

/** MyFaces commandLink submit param (oamSubmit protocol: hidden input `<formId>:_idcl=<linkId>`). */
export function commandLinkButton(formIdOrName: string, linkId: string): {
  name: string
  value: string
} {
  return { name: `${formIdOrName}:_idcl`, value: linkId }
}

function setEntry(entries: Array<[string, string]>, name: string, value: string): void {
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i]![0] === name) entries.splice(i, 1)
  }
  entries.push([name, value])
}

/** Name of the control with this id inside the form, else the key itself (already a name). */
function resolveFieldName(form: HtmlForm, idOrName: string): string {
  const element = findHtmlElement(form.inner, idOrName)
  return element?.attrs.name || idOrName
}

/** Form entries + ViewState + checked radios + changed fields (no clicked control yet). */
function buildFormEntries(
  pageHtml: string,
  form: HtmlForm,
  options: LegacySubmitOptions
): Array<[string, string]> {
  const entries = successfulFormEntries(form.inner)

  if (!entries.some(([name]) => name === "javax.faces.ViewState")) {
    const viewState = extractViewStateFromHtml(pageHtml)
    if (viewState) entries.push(["javax.faces.ViewState", viewState])
  }

  for (const id of options.uncheck ?? []) {
    const input = findHtmlElement(form.inner, id)
    const name = input?.attrs.name
    if (!name) continue
    const value = input.attrs.value ?? "on"
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i]![0] === name && entries[i]![1] === value) entries.splice(i, 1)
    }
  }

  for (const id of options.check ?? []) {
    const input = findHtmlElement(form.inner, id)
    if (!input || input.tag !== "input" || !input.attrs.name) {
      throw new Error(`[TRACES] ${FILE} · buildFormEntries — #${id} is not a named input in form "${form.key}"`)
    }
    const value = input.attrs.value ?? "on"
    if ((input.attrs.type ?? "").toLowerCase() === "checkbox") {
      if (!entries.some(([n, v]) => n === input.attrs.name && v === value)) entries.push([input.attrs.name, value])
    } else {
      setEntry(entries, input.attrs.name, value)
    }
  }

  for (const [key, value] of Object.entries(options.fields ?? {})) {
    setEntry(entries, resolveFieldName(form, key), value)
  }

  const submitMarker = `${form.key}_SUBMIT`
  if (entries.some(([name]) => name === submitMarker)) setEntry(entries, submitMarker, "1")
  return entries
}

/** The request params a click on `control` adds (button name=value or commandLink _idcl). */
function clickedControlEntries(form: HtmlForm, control: HtmlTag, controlId: string): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const onclick = control.attrs.onclick ?? ""

  for (const [idOrName, value] of parseOnclickFieldAssignments(onclick)) {
    out.push([resolveFieldName(form, idOrName), value])
  }

  const call = parseMyFacesSubmitCall(onclick)
  if (call) {
    out.push([`${call.formName}:_idcl`, call.linkId], ...call.params)
    return out
  }

  const type = (control.attrs.type ?? (control.tag === "button" ? "submit" : "")).toLowerCase()
  if ((control.tag === "input" || control.tag === "button") && control.attrs.name) {
    if (type === "image") {
      out.push([`${control.attrs.name}.x`, "1"], [`${control.attrs.name}.y`, "1"])
    } else {
      out.push([control.attrs.name, control.attrs.value ?? ""])
    }
    return out
  }

  // MyFaces commandLink without a parseable onclick: its id is its client id.
  out.push([`${form.key}:_idcl`, control.attrs.id || controlId])
  return out
}

async function postLegacyFormEntries(
  session: Pick<Traces61ApiSession, "client">,
  form: HtmlForm,
  pageUrl: string,
  entries: Array<[string, string]>
): Promise<LegacyFormSubmit> {
  const base = traces61Url(pageUrl)
  const actionUrl = form.action
    ? rewriteTracesHttpToHttps(new URL(form.action, base).toString())
    : base
  const hasViewState = entries.some(([name, value]) => name === "javax.faces.ViewState" && value)
  log("postLegacyFormEntries", `POST ${actionUrl}`, `form=${form.key} viewState=${hasViewState ? "yes" : "NO"}`)

  const res = await session.client.post(actionUrl, new URLSearchParams(entries).toString(), {
    maxRedirects: 0,
    validateStatus: () => true,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Origin: new URL(actionUrl).origin,
      Referer: base,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Upgrade-Insecure-Requests": "1",
    },
  })
  const page = toLegacyPage(res, actionUrl)
  dumpLegacyExchange("POST", actionUrl, page, entries)
  if (!REDIRECT_STATUSES.includes(res.status) || !page.location || page.redirectedToNewPortal) {
    return page
  }
  // POST → 302 becomes a GET on the target (standard browser behaviour); legacyGet keeps
  // following and captures every Set-Cookie hop.
  return loadLegacyPage(session, page.location)
}

/**
 * POST one MyFaces form from a *provided* HTML response (so that step's ViewState rides
 * along). `pageUrl` is the URL that produced `html`; the form's own action is the target.
 * `fields` are keyed by element id or name.
 */
export async function submitLegacyFormFromHtml(
  session: Pick<Traces61ApiSession, "client">,
  html: string,
  pageUrl: string,
  formIdOrName: string,
  fields: LegacyFields,
  button?: { name: string; value: string },
  options: Pick<LegacySubmitOptions, "check"> = {}
): Promise<LegacyFormSubmit> {
  const form = findHtmlForm(html, formIdOrName)
  if (!form) {
    throw new Error(`[TRACES] ${FILE} · submitLegacyFormFromHtml — form "${formIdOrName}" not found on ${pageUrl}`)
  }
  const entries = buildFormEntries(html, form, { fields, check: options.check })
  if (button) setEntry(entries, button.name, button.value)
  return postLegacyFormEntries(session, form, pageUrl, entries)
}

/**
 * Submit a legacy MyFaces form, fetching the page first for a fresh ViewState.
 * For multi-step flows prefer {@link submitLegacyControl} on the previous response.
 */
export async function submitLegacyForm(
  session: Pick<Traces61ApiSession, "client">,
  pathOrUrl: string,
  formIdOrName: string,
  fields: LegacyFields,
  button?: { name: string; value: string }
): Promise<LegacyFormSubmit> {
  const page = await loadLegacyPage(session, pathOrUrl)
  if (page.redirectedToNewPortal) return page
  return submitLegacyFormFromHtml(session, page.html, page.url, formIdOrName, fields, button)
}

/**
 * "Click" a control on a legacy page: submit the form that contains `controlId` with the
 * given field changes, sending only that control (button `name=value`, or the commandLink
 * `_idcl` + params taken from its own onclick).
 */
export async function submitLegacyControl(
  session: Pick<Traces61ApiSession, "client">,
  page: Pick<LegacyPage, "html" | "url">,
  controlId: string,
  options: LegacySubmitOptions = {}
): Promise<LegacyFormSubmit> {
  const found = findFormContainingElement(page.html, controlId)
  if (!found) {
    throw new Error(`[TRACES] ${FILE} · submitLegacyControl — #${controlId} is not inside a form on ${page.url}`)
  }
  const entries = buildFormEntries(page.html, found.form, options)
  for (const [name, value] of clickedControlEntries(found.form, found.element, controlId)) {
    setEntry(entries, name, value)
  }
  log("submitLegacyControl", `click #${controlId}`, `form=${found.form.key}`)
  return postLegacyFormEntries(session, found.form, page.url, entries)
}

/**
 * Re-submit the form that contains `elementId` without clicking anything — what a
 * select/radio `onchange` postback does (e.g. FY change rebuilding the quarter list).
 */
export async function submitLegacyPostback(
  session: Pick<Traces61ApiSession, "client">,
  page: Pick<LegacyPage, "html" | "url">,
  elementId: string,
  options: LegacySubmitOptions = {}
): Promise<LegacyFormSubmit> {
  const found = findFormContainingElement(page.html, elementId)
  if (!found) {
    throw new Error(`[TRACES] ${FILE} · submitLegacyPostback — #${elementId} is not inside a form on ${page.url}`)
  }
  return postLegacyFormEntries(session, found.form, page.url, buildFormEntries(page.html, found.form, options))
}

/**
 * Resolve the option value for `wanted` in a select. When it is missing (JSF rebuilds a
 * dependent list such as the quarter after the FY changes), post the form back with
 * `dependsOn` set first, the way the browser's onchange does, and look again.
 */
export async function ensureLegacySelectOption(
  session: Pick<Traces61ApiSession, "client">,
  page: LegacyPage,
  selectId: string,
  wanted: string,
  dependsOn: LegacyFields = {}
): Promise<{ page: LegacyPage; value: string }> {
  const pick = (html: string) => {
    const options = listSelectOptions(html, selectId)
    return { options, match: options ? matchSelectOption(options, wanted) : null }
  }
  let current = page
  let { options, match } = pick(current.html)
  if (!match && Object.keys(dependsOn).length > 0) {
    current = await submitLegacyPostback(session, current, Object.keys(dependsOn)[0]!, { fields: dependsOn })
    assertLegacyStep(current, `refreshing #${selectId}`, [selectId])
    ;({ options, match } = pick(current.html))
  }
  if (!match) {
    throw new LegacyFlowError(
      `Could not select #${selectId} value="${wanted}": options=${JSON.stringify(
        (options ?? []).map((o) => `${o.value}:${o.text}`)
      )}`,
      false
    )
  }
  return { page: current, value: match.value }
}

/**
 * A failed step in a state-changing legacy flow. `retryable` says whether running the
 * whole flow again (fresh login) is reasonable; `finalSubmitSent` marks failures after the
 * final transaction POST was sent, which must never be retried (it could file twice).
 */
export class LegacyFlowError extends Error {
  retryable: boolean
  finalSubmitSent: boolean

  constructor(message: string, retryable: boolean, finalSubmitSent = false) {
    super(message)
    this.name = "LegacyFlowError"
    this.retryable = retryable
    this.finalSubmitSent = finalSubmitSent
  }
}

/**
 * Check a step's response and return which of `expectedIds` it rendered. Throws a
 * {@link LegacyFlowError} for a dead session, the "Requested resource could not be found"
 * page, a captcha challenge, or a page without the expected control (with the portal's
 * own messages when it shows any).
 */
export function assertLegacyStep(page: LegacyPage, step: string, expectedIds: string[]): string {
  if (page.redirectedToNewPortal) {
    throw new LegacyFlowError(`TRACES_SESSION_EXPIRED: redirected to the new portal (${step})`, true)
  }
  if (htmlIsResourceNotFound(page.html)) {
    throw new LegacyFlowError(`RESOURCE_NOT_FOUND_ERROR: "Requested resource could not be found" (${step})`, true)
  }
  const found = expectedIds.find((id) => htmlHasElementId(page.html, id))
  if (found) return found
  if (htmlHasCaptcha(page.html)) {
    throw new LegacyFlowError(`CAPTCHA_FAILED_IN_FLOW: captcha presented (${step})`, true)
  }
  const messages = extractHtmlMessages(page.html)
  throw new LegacyFlowError(
    `${step}: expected ${expectedIds.map((id) => `#${id}`).join(" or ")} on ${page.url} (HTTP ${page.status})` +
      (messages.length ? ` — portal says: ${messages.join(" | ")}` : ""),
    // A page that explains itself (validation error) will say the same thing next time.
    page.status >= 500 || messages.length === 0
  )
}

/**
 * Run a state-changing legacy flow with whole-flow retries (fresh login each time), the
 * way the Puppeteer flows retried. A failure after the final submit is never retried.
 */
export async function runLegacyRequestFlow<T>(
  options: { label: string; maxAttempts: number; log: (message: string) => void },
  attemptFlow: (attempt: number) => Promise<T>
): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await attemptFlow(attempt)
    } catch (err: any) {
      const finalSubmitSent = err?.finalSubmitSent === true
      const retryable =
        !finalSubmitSent &&
        attempt < options.maxAttempts &&
        (err instanceof LegacyFlowError ? err.retryable : isTransientTracesFailure(err))
      if (!retryable) throw err
      const waitMs = tracesRetryDelayMs(attempt)
      options.log(
        `${options.label} attempt ${attempt}/${options.maxAttempts} failed — ${err?.message || err} — retrying from login in ${Math.round(waitMs / 1000)}s…`
      )
      await new Promise((resolve) => setTimeout(resolve, waitMs))
    }
  }
}
