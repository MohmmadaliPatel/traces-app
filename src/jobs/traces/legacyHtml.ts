/**
 * HTML helpers for the TRACES legacy (old) portal pages.
 *
 * The legacy pages are server-rendered MyFaces XHTML, so a quote-aware tag scanner is
 * enough to read forms, controls and links without a DOM. Attribute values are
 * entity-decoded. Nothing here does I/O — see `legacyForms.ts` for the HTTP side.
 */

/** Attribute run of a start tag, quote-aware so `>` inside a value (onclick="a>b") does not end it. */
const ATTRS = `((?:[^>"']|"[^"]*"|'[^']*')*)`

export type HtmlTag = {
  tag: string
  attrs: Record<string, string>
  /** Inner HTML for paired tags read by this module (form, select, textarea, button, a). */
  inner?: string
}

export type HtmlForm = {
  /** `id` attribute, falling back to `name`. MyFaces renders both with the same value. */
  key: string
  id: string
  name: string
  action: string
  inner: string
}

export type HtmlSelectOption = { value: string; text: string; selected: boolean }

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, code: string) => {
    const c = code.toLowerCase()
    if (c === "amp") return "&"
    if (c === "lt") return "<"
    if (c === "gt") return ">"
    if (c === "quot") return '"'
    if (c === "apos") return "'"
    if (c === "nbsp") return " "
    const n = c.startsWith("#x") ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10)
    return Number.isFinite(n) && n >= 0 && n <= 0x10ffff ? String.fromCodePoint(n) : match
  })
}

/** Parse the attribute run of a start tag. Keys are lower-cased; values are entity-decoded. */
export function parseHtmlAttributes(text: string): Record<string, string> {
  const attrs: Record<string, string> = {}
  const re = /([^\s"'=<>/`]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    const key = m[1]!.toLowerCase()
    if (key in attrs) continue
    attrs[key] = decodeHtmlEntities(m[2] ?? m[3] ?? m[4] ?? "")
  }
  return attrs
}

/** Visible text of an HTML fragment (scripts/styles dropped, whitespace collapsed). */
export function htmlToText(html: string): string {
  return decodeHtmlEntities(
    String(html ?? "")
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")
      .replace(/<[^>]+>/g, " ")
  )
    .replace(/[\s ]+/g, " ")
    .trim()
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

/** Every `<form>` on the page, in document order. */
export function listHtmlForms(html: string): HtmlForm[] {
  const forms: HtmlForm[] = []
  const re = new RegExp(`<form\\b${ATTRS}>([\\s\\S]*?)<\\/form\\s*>`, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = parseHtmlAttributes(m[1] ?? "")
    const id = attrs.id ?? ""
    const name = attrs.name ?? ""
    forms.push({ key: id || name, id, name, action: attrs.action ?? "", inner: m[2] ?? "" })
  }
  return forms
}

export function findHtmlForm(html: string, formIdOrName: string): HtmlForm | null {
  return listHtmlForms(html).find((f) => f.id === formIdOrName || f.name === formIdOrName) ?? null
}

/** First element with the given `id` (or, failing that, `name`) in an HTML fragment. */
export function findHtmlElement(html: string, idOrName: string): HtmlTag | null {
  const escaped = escapeRegExp(idOrName)
  for (const attr of ["id", "name"]) {
    const re = new RegExp(
      `<([a-zA-Z][\\w:-]*)\\b((?:[^>"']|"[^"]*"|'[^']*')*?\\s${attr}\\s*=\\s*(?:"${escaped}"|'${escaped}')(?:[^>"']|"[^"]*"|'[^']*')*)>`,
      "i"
    )
    const m = re.exec(html)
    if (!m) continue
    const tag = m[1]!.toLowerCase()
    const element: HtmlTag = { tag, attrs: parseHtmlAttributes(m[2] ?? "") }
    if (["select", "textarea", "button", "a"].includes(tag)) {
      const rest = html.slice(m.index + m[0].length)
      const close = new RegExp(`<\\/${tag}\\s*>`, "i").exec(rest)
      element.inner = close ? rest.slice(0, close.index) : ""
    }
    return element
  }
  return null
}

export function htmlHasElementId(html: string, id: string): boolean {
  const escaped = escapeRegExp(id)
  return new RegExp(`\\sid\\s*=\\s*(?:"${escaped}"|'${escaped}')`, "i").test(html)
}

/** The form that contains an element with the given id (or name). */
export function findFormContainingElement(
  html: string,
  idOrName: string
): { form: HtmlForm; element: HtmlTag } | null {
  for (const form of listHtmlForms(html)) {
    const element = findHtmlElement(form.inner, idOrName)
    if (element) return { form, element }
  }
  return null
}

/** Options of a `<select>` found by id or name. */
export function listSelectOptions(html: string, selectIdOrName: string): HtmlSelectOption[] | null {
  const select = findHtmlElement(html, selectIdOrName)
  if (!select || select.tag !== "select") return null
  return parseOptions(select.inner ?? "")
}

function parseOptions(selectInner: string): HtmlSelectOption[] {
  const options: HtmlSelectOption[] = []
  const re = new RegExp(`<option\\b${ATTRS}>([\\s\\S]*?)<\\/option\\s*>`, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(selectInner))) {
    const attrs = parseHtmlAttributes(m[1] ?? "")
    const text = htmlToText(m[2] ?? "")
    options.push({ value: attrs.value ?? text, text, selected: "selected" in attrs })
  }
  return options
}

/**
 * Pick the option matching `wanted` the way the Puppeteer flows did: exact value, exact
 * text, case-insensitive text/value, then text containing `wanted`. Placeholder options
 * with an empty value never match.
 */
export function matchSelectOption(
  options: HtmlSelectOption[],
  wanted: string
): HtmlSelectOption | null {
  const w = String(wanted ?? "").trim()
  if (!w) return null
  const real = options.filter((o) => o.value !== "")
  return (
    real.find((o) => o.value === w) ||
    real.find((o) => o.text === w) ||
    real.find((o) => o.text.toUpperCase() === w.toUpperCase()) ||
    real.find((o) => o.value.toUpperCase() === w.toUpperCase()) ||
    real.find((o) => o.text.toUpperCase().includes(w.toUpperCase())) ||
    null
  )
}

export type HtmlFormControl = {
  tag: "input" | "select" | "textarea" | "button"
  type: string
  id: string
  name: string
  attrs: Record<string, string>
  /** Values a browser would submit for this control if it is "successful". */
  values: string[]
}

/** All named controls of a form body, in document order. */
export function listFormControls(formInner: string): HtmlFormControl[] {
  const found: Array<{ index: number; control: HtmlFormControl }> = []
  const push = (index: number, control: HtmlFormControl) => found.push({ index, control })

  const inputRe = new RegExp(`<input\\b${ATTRS}>`, "gi")
  let m: RegExpExecArray | null
  while ((m = inputRe.exec(formInner))) {
    const attrs = parseHtmlAttributes(m[1] ?? "")
    const type = (attrs.type ?? "text").toLowerCase()
    push(m.index, {
      tag: "input",
      type,
      id: attrs.id ?? "",
      name: attrs.name ?? "",
      attrs,
      values: [attrs.value ?? (type === "checkbox" || type === "radio" ? "on" : "")],
    })
  }

  const selectRe = new RegExp(`<select\\b${ATTRS}>([\\s\\S]*?)<\\/select\\s*>`, "gi")
  while ((m = selectRe.exec(formInner))) {
    const attrs = parseHtmlAttributes(m[1] ?? "")
    const options = parseOptions(m[2] ?? "")
    const multiple = "multiple" in attrs
    let values = options.filter((o) => o.selected).map((o) => o.value)
    if (!multiple) values = values.slice(-1)
    if (!multiple && values.length === 0 && options[0]) values = [options[0].value]
    push(m.index, {
      tag: "select",
      type: multiple ? "select-multiple" : "select-one",
      id: attrs.id ?? "",
      name: attrs.name ?? "",
      attrs,
      values,
    })
  }

  const textareaRe = new RegExp(`<textarea\\b${ATTRS}>([\\s\\S]*?)<\\/textarea\\s*>`, "gi")
  while ((m = textareaRe.exec(formInner))) {
    const attrs = parseHtmlAttributes(m[1] ?? "")
    push(m.index, {
      tag: "textarea",
      type: "textarea",
      id: attrs.id ?? "",
      name: attrs.name ?? "",
      attrs,
      values: [decodeHtmlEntities((m[2] ?? "").replace(/^\r?\n/, ""))],
    })
  }

  const buttonRe = new RegExp(`<button\\b${ATTRS}>([\\s\\S]*?)<\\/button\\s*>`, "gi")
  while ((m = buttonRe.exec(formInner))) {
    const attrs = parseHtmlAttributes(m[1] ?? "")
    push(m.index, {
      tag: "button",
      type: (attrs.type ?? "submit").toLowerCase(),
      id: attrs.id ?? "",
      name: attrs.name ?? "",
      attrs,
      values: [attrs.value ?? htmlToText(m[2] ?? "")],
    })
  }

  return found.sort((a, b) => a.index - b.index).map((f) => f.control)
}

const NEVER_SUBMITTED_INPUT_TYPES = new Set(["submit", "button", "reset", "image", "file"])

/**
 * The name/value pairs a browser submits for a form *before* any button is clicked:
 * buttons are excluded (only the clicked one is sent), unchecked checkboxes/radios and
 * disabled controls are skipped.
 */
export function successfulFormEntries(formInner: string): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  for (const control of listFormControls(formInner)) {
    if (!control.name || "disabled" in control.attrs) continue
    if (control.tag === "button") continue
    if (control.tag === "input") {
      if (NEVER_SUBMITTED_INPUT_TYPES.has(control.type)) continue
      if ((control.type === "checkbox" || control.type === "radio") && !("checked" in control.attrs)) {
        continue
      }
    }
    for (const value of control.values) entries.push([control.name, value])
  }
  return entries
}

/** `javax.faces.ViewState` from a page or form fragment (first one found). */
export function extractViewStateFromHtml(html: string): string {
  const re = new RegExp(`<input\\b${ATTRS}>`, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(html))) {
    const attrs = parseHtmlAttributes(m[1] ?? "")
    if (attrs.name === "javax.faces.ViewState") return attrs.value ?? ""
  }
  return ""
}

/**
 * MyFaces commandLink call from an onclick handler:
 * `myfaces.oam.submitForm('form','form:link',null,[['k','v']])` (MyFaces 2) or
 * `oamSubmitForm('form','form:link')` (MyFaces 1), also when wrapped in `jsf.util.chain`.
 */
export function parseMyFacesSubmitCall(
  onclick: string
): { formName: string; linkId: string; params: Array<[string, string]> } | null {
  const src = String(onclick ?? "").replace(/\\(['"])/g, "$1")
  const m = /(?:myfaces\.oam\.submitForm|oamSubmitForm)\s*\(\s*(['"])([^'"]*)\1\s*,\s*(['"])([^'"]*)\3/.exec(src)
  if (!m) return null
  const params: Array<[string, string]> = []
  const rest = src.slice(m.index + m[0].length)
  const close = rest.indexOf(")")
  const argTail = close >= 0 ? rest.slice(0, close) : rest
  const pairRe = /\[\s*(['"])([^'"]*)\1\s*,\s*(['"])([^'"]*)\3\s*\]/g
  let p: RegExpExecArray | null
  while ((p = pairRe.exec(argTail))) params.push([p[2]!, p[4]!])
  return { formName: m[2]!, linkId: m[4]!, params }
}

/**
 * Hidden-field assignments an onclick handler makes before submitting, e.g.
 * `document.getElementById('renderPage').value='1'` or `form.elements['x'].value='y'`.
 * Returns `[idOrName, value]` pairs.
 */
export function parseOnclickFieldAssignments(onclick: string): Array<[string, string]> {
  const src = String(onclick ?? "").replace(/\\(['"])/g, "$1")
  const out: Array<[string, string]> = []
  const re =
    /(?:getElementById\(\s*(['"])([^'"]+)\1\s*\)|elements\[\s*(['"])([^'"]+)\3\s*\])\s*\.value\s*=\s*(['"])([^'"]*)\5/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src))) out.push([m[2] ?? m[4]!, m[6]!])
  return out
}

/**
 * True when the page shows a captcha challenge — the same signals the Puppeteer flows
 * waited for: a captcha input, a captcha image, or `#captcha`.
 */
export function htmlHasCaptcha(html: string): boolean {
  return (
    new RegExp(`<input\\b(?:[^>"']|"[^"]*"|'[^']*')*\\s(?:name|id)\\s*=\\s*["'][^"']*captcha`, "i").test(html) ||
    new RegExp(`<img\\b(?:[^>"']|"[^"]*"|'[^']*')*\\ssrc\\s*=\\s*["'][^"']*captcha`, "i").test(html) ||
    htmlHasElementId(html, "captcha")
  )
}

/** The TRACES "Requested resource could not be found" dead-end page. */
export function htmlIsResourceNotFound(html: string): boolean {
  return /requested resource could not be found/i.test(html)
}

/**
 * Error / info messages the page shows (JSF messages, TRACES `infoMsg` spans, …).
 * Used to explain a failed step; never as a success signal.
 */
export function extractHtmlMessages(html: string, max = 5): string[] {
  const out: string[] = []
  const re = new RegExp(`<(span|div|li|p|td|label|font|h[1-6])\\b${ATTRS}>([\\s\\S]*?)<\\/\\1\\s*>`, "gi")
  let m: RegExpExecArray | null
  while ((m = re.exec(html)) && out.length < max) {
    const attrs = parseHtmlAttributes(m[2] ?? "")
    const marker = `${attrs.class ?? ""} ${attrs.id ?? ""}`
    if (!/error|infomsg|ui-message|fieldlevelinfo|alert/i.test(marker)) {
      // Not a message element — keep scanning inside it (messages sit in wrapper divs).
      re.lastIndex = m.index + m[1]!.length + (m[2] ?? "").length + 2
      continue
    }
    const text = htmlToText(m[3] ?? "").slice(0, 300)
    if (text && !out.includes(text)) out.push(text)
  }
  return out
}

/** A TRACES request number in a confirmation page ("Request Number : 123456789"), if any. */
export function extractRequestNumber(html: string): string | null {
  const m = /request\s*(?:no\.?|number|id)\s*(?:is)?\s*[:\-]?\s*(\d{5,})/i.exec(htmlToText(html))
  return m?.[1] ?? null
}
