/*
 * Plain HTML forms (CH2): parse a page's forms with cheerio into ordered fields (name, label,
 * type, options, required, limits), build the submission entries from prepared answers and
 * files, and read the response page (confirmation reference, success text, validation errors).
 * Pure — the network lives in ch2-forms.ts. Page text is data: we read labels and markers, we
 * never act on what a page says.
 */
import { load, type CheerioAPI } from "cheerio";
import type { AnyNode, Element } from "domhandler"; // types only (cheerio's own DOM types)
import type { FormField } from "@/lib/core/types";
import { pickOption } from "@/lib/llm/local/forms";
import { cleanLabel, fieldSemantics, isLongQuestion, plainText, wordLimitFrom } from "./detect";
import { splitMulti } from "./handoff";
import type { FieldRequirement, LoadedFile } from "./types";

export interface ParsedField {
  name: string;
  label: string;
  type: FormField["type"];
  required: boolean;
  options?: { value: string; label: string }[];
  maxLength?: number;
  accept?: string;
  help?: string;
  section?: string;
  /** For single checkboxes: the value submitted when ticked. */
  checkedValue?: string;
}

export interface ParsedForm {
  /** Absolute URL the form posts to (the page URL when the form has no action). */
  action: string;
  hasAction: boolean;
  method: "GET" | "POST";
  enctype: "application/x-www-form-urlencoded" | "multipart/form-data";
  fields: ParsedField[];
  /** Hidden inputs, submitted as they are. */
  hidden: [string, string][];
  submitLabel: string | null;
  /** Higher = more likely the application form on the page. */
  score: number;
}

const SKIP_INPUT_TYPES = new Set(["submit", "button", "reset", "image", "password", "search"]);

function squash(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function text($: CheerioAPI, el: AnyNode): string {
  return squash($(el).text());
}

function attrSelector(name: string, value: string): string {
  return `[${name}="${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`;
}

/** Label text without "(optional)" markers and trailing asterisks; `starred` = marked required. */
function normalizeLabel(raw: string): { label: string; starred: boolean } {
  const t = raw.trim();
  const starred = /[*✱]\s*$/u.test(t) || /[*✱]\s*\(?required\)?\s*$/iu.test(t);
  const label = cleanLabel(t.replace(/\s*\((optional|required|可选|选填|必填)\)\s*/gi, " "));
  return { label, starred };
}

export function humanizeName(name: string): string {
  const s = name
    .replace(/\[\]$/, "")
    .replace(/^.*\[([^\]]+)\]$/, "$1")
    .replace(/[_\-.]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : name;
}

/** Text of a <label>, without the controls and error messages inside it. */
function labelText($: CheerioAPI, lab: ReturnType<CheerioAPI>): string {
  const clone = lab.clone();
  clone.find("input, select, textarea, .error, [role=alert]").remove();
  return squash(clone.text());
}

function labelFor($: CheerioAPI, el: Element): { label: string; starred: boolean } {
  const id = $(el).attr("id");
  if (id) {
    const lab = $(`label${attrSelector("for", id)}`).first();
    if (lab.length) {
      const t = labelText($, lab);
      if (t) return normalizeLabel(t);
    }
  }
  const wrap = $(el).closest("label");
  if (wrap.length) {
    const t = labelText($, wrap);
    if (t) return normalizeLabel(t);
  }
  const aria = $(el).attr("aria-label");
  if (aria?.trim()) return normalizeLabel(aria);
  const labelledby = $(el).attr("aria-labelledby");
  if (labelledby) {
    const t = squash(
      labelledby
        .split(/\s+/)
        .map((ref) => $(attrSelector("id", ref)).text())
        .join(" "),
    );
    if (t) return normalizeLabel(t);
  }
  // Frameworks that render the question text in a sibling element (".label", ".text", <legend>…).
  let node = $(el).parent();
  for (let depth = 0; depth < 4 && node.length; depth++) {
    const candidate = node
      .children("label, legend, .label, .text, [class*='label'], [class*='question-title'], h3, h4")
      .filter((_, c) => $(c).find("input, select, textarea").length === 0)
      .first();
    if (candidate.length) {
      const t = squash(candidate.text());
      if (t) return normalizeLabel(t);
    }
    node = node.parent();
  }
  const placeholder = $(el).attr("placeholder") ?? $(el).attr("title");
  if (placeholder?.trim()) return normalizeLabel(placeholder);
  return { label: humanizeName($(el).attr("name") ?? ""), starred: false };
}

function helpFor($: CheerioAPI, el: Element): string | undefined {
  const ids = ($(el).attr("aria-describedby") ?? "").split(/\s+/).filter(Boolean);
  const parts = ids
    .map((ref) => $(attrSelector("id", ref)).first())
    .filter((n) => n.length > 0 && !n.is(".error, [role=alert]"))
    .map((n) => squash(n.text()))
    .filter(Boolean);
  const help = parts.join(" ");
  return help ? plainText(help, 400) : undefined;
}

function sectionFor($: CheerioAPI, el: Element): string | undefined {
  const legend = $(el).closest("fieldset").children("legend").first();
  const t = legend.length ? squash(legend.text()) : "";
  return t || undefined;
}

function isRequired($: CheerioAPI, el: Element, starred: boolean): boolean {
  return $(el).is("[required]") || $(el).attr("aria-required") === "true" || starred;
}

function intAttr(v: string | undefined): number | undefined {
  const n = Number(v);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function resolveUrl(raw: string | undefined, base: string): string {
  try {
    return new URL(raw && raw.trim() ? raw.trim() : base, base).toString();
  } catch {
    return base;
  }
}

function inputTypeOf(tag: string, raw: string | undefined): FormField["type"] {
  if (tag === "textarea") return "textarea";
  switch ((raw ?? "text").toLowerCase()) {
    case "email":
      return "email";
    case "tel":
      return "tel";
    case "url":
      return "url";
    case "number":
    case "range":
      return "number";
    case "date":
    case "datetime-local":
    case "month":
    case "week":
      return "date";
    case "file":
      return "file";
    default:
      return "text";
  }
}

function parseOneForm($: CheerioAPI, form: Element | null, baseUrl: string): ParsedForm {
  const scope = form ? $(form) : $("body");
  const actionAttr = form ? $(form).attr("action") : undefined;
  const method = (form ? ($(form).attr("method") ?? "get") : "post").toUpperCase() === "POST" ? "POST" : "GET";
  const enctypeAttr = (form ? ($(form).attr("enctype") ?? "") : "").toLowerCase();
  const hasFile = scope.find("input[type=file]").length > 0;
  const enctype = enctypeAttr === "multipart/form-data" || hasFile ? "multipart/form-data" : "application/x-www-form-urlencoded";

  const fields: ParsedField[] = [];
  const hidden: [string, string][] = [];
  const groups = new Map<string, ParsedField>();
  let score = 0;

  for (const el of scope.find("input, select, textarea").toArray()) {
    const $el = $(el);
    const name = $el.attr("name");
    if (!name || $el.is("[disabled]")) continue;
    const tag = el.tagName.toLowerCase();
    const inputType = (tag === "input" ? ($el.attr("type") ?? "text") : tag).toLowerCase();
    if (inputType === "hidden") {
      hidden.push([name, $el.attr("value") ?? ""]);
      continue;
    }
    if (SKIP_INPUT_TYPES.has(inputType)) continue;

    if (inputType === "radio" || inputType === "checkbox") {
      const value = $el.attr("value") ?? "on";
      const sameName = scope.find(`input${attrSelector("name", name)}`).length;
      const isGroup = inputType === "radio" || sameName > 1 || name.endsWith("[]");
      if (!isGroup) {
        const { label, starred } = labelFor($, el);
        fields.push({
          name,
          label: label || humanizeName(name),
          type: "checkbox",
          required: isRequired($, el, starred),
          checkedValue: value,
          help: helpFor($, el),
          section: sectionFor($, el),
        });
        continue;
      }
      const optLabel = labelFor($, el).label || value;
      let group = groups.get(name);
      if (!group) {
        const fieldset = $el.closest("fieldset");
        const legend = fieldset.length ? squash(fieldset.children("legend").first().text()) : "";
        // The question text sits outside the per-option labels: a legend, or a label-ish
        // element next to the option list.
        let question = legend;
        if (!question) {
          let node = $el.parent();
          for (let depth = 0; depth < 6 && node.length && !question; depth++) {
            const c = node
              .children(".label, .text, [class*='label'], [class*='question'], legend, h3, h4, p")
              .filter((_, x) => $(x).find("input").length === 0)
              .first();
            if (c.length) question = squash(c.text());
            node = node.parent();
          }
        }
        const { label, starred } = normalizeLabel(question || humanizeName(name));
        group = {
          name,
          label: label || humanizeName(name),
          type: inputType === "radio" ? "select" : "multiselect",
          required: isRequired($, el, starred),
          options: [],
          help: helpFor($, el),
          section: legend ? undefined : sectionFor($, el),
        };
        groups.set(name, group);
        fields.push(group);
        score += 1;
      }
      group.options!.push({ value, label: optLabel });
      if ($el.is("[required]")) group.required = true;
      continue;
    }

    const { label, starred } = labelFor($, el);
    const base = { name, label: label || humanizeName(name), required: isRequired($, el, starred), help: helpFor($, el), section: sectionFor($, el) };
    if (tag === "select") {
      const options = $el
        .find("option")
        .toArray()
        .map((o) => ({ value: ($(o).attr("value") ?? text($, o)).trim(), label: text($, o) }))
        .filter((o) => o.value !== "");
      fields.push({ ...base, type: $el.is("[multiple]") ? "multiselect" : "select", options });
      score += 1;
      continue;
    }
    const type = inputTypeOf(tag, inputType);
    if (type === "textarea") score += 3;
    if (type === "file") score += 3;
    if (type === "email") score += 2;
    fields.push({
      ...base,
      type,
      ...(intAttr($el.attr("maxlength")) ? { maxLength: intAttr($el.attr("maxlength")) } : {}),
      ...(type === "file" && $el.attr("accept") ? { accept: $el.attr("accept") } : {}),
    });
  }

  score += fields.length;
  if (form && ($(form).attr("role") === "search" || /\bsearch\b/i.test($(form).attr("class") ?? ""))) score -= 20;
  const submit = scope.find("button[type=submit], button:not([type]), input[type=submit]").first();
  const submitLabel = submit.length ? (submit.is("input") ? (submit.attr("value") ?? "") : squash(submit.text())) || null : null;
  return {
    action: resolveUrl(actionAttr, baseUrl),
    hasAction: Boolean(actionAttr && actionAttr.trim() && !/^javascript:/i.test(actionAttr.trim())),
    method,
    enctype,
    fields,
    hidden,
    submitLabel,
    score,
  };
}

/** Every <form> on the page with real fields (or the loose controls of a form-less page). */
export function parseHtmlForms(html: string, baseUrl: string): ParsedForm[] {
  const $ = load(html);
  const forms = $("form")
    .toArray()
    .map((f) => parseOneForm($, f, baseUrl))
    .filter((f) => f.fields.length > 0);
  if (!forms.length) {
    const loose = parseOneForm($, null, baseUrl);
    if (loose.fields.length >= 2) return [{ ...loose, hasAction: false }];
  }
  return forms;
}

/** The application form on the page: the highest-scoring form with real fields. */
export function pickMainForm(forms: ParsedForm[]): ParsedForm | null {
  return [...forms].sort((a, b) => b.score - a.score)[0] ?? null;
}

const CONSENT_LABEL = /\b(confirm|consent|agree|certify|acknowledge|attest)\b|同意|确认|声明/i;

/** One parsed field as a contract `FieldRequirement` (semantic key, profile path, user-only flag). */
export function toRequirement(f: ParsedField): FieldRequirement {
  const sem = fieldSemantics(f.name, f.label, f.type);
  const userOnly = sem.userOnly || (f.type === "checkbox" && CONSENT_LABEL.test(f.label));
  const req: FieldRequirement = {
    name: f.name,
    label: f.label,
    type: f.type,
    required: f.required,
    ...(f.options ? { options: f.options.map((o) => o.label), choices: f.options } : {}),
    ...(f.maxLength ? { maxLength: f.maxLength } : {}),
    ...(sem.profilePath ? { profilePath: sem.profilePath } : {}),
    ...(sem.key ? { key: sem.key } : {}),
    ...(userOnly ? { userOnly: true } : {}),
    ...(f.help ? { help: f.help } : {}),
    ...(f.accept ? { accept: f.accept } : {}),
    ...(f.section ? { section: f.section } : {}),
  };
  if (isLongQuestion(req)) req.question = true;
  return req;
}

/** Ordered field requirements for P3a (`Requirements.fields`). */
export function formToRequirements(form: Pick<ParsedForm, "fields">): FieldRequirement[] {
  return form.fields.map(toRequirement);
}

/** Long-form prompts to compose (`Requirements.questions`). */
export function questionsOf(fields: FieldRequirement[]): { id: string; prompt: string; maxWords?: number }[] {
  return fields
    .filter((f) => f.question)
    .map((f) => {
      const maxWords = wordLimitFrom(`${f.label} ${f.help ?? ""}`, f.maxLength);
      return { id: f.name, prompt: f.label, ...(maxWords ? { maxWords } : {}) };
    });
}

/* ------------------------------------------------------------------ building the submission */

export type Entry = [name: string, value: string | LoadedFile];

export interface BuiltEntries {
  entries: Entry[];
  /** Labels of required fields with no usable answer. */
  missing: string[];
  /** Labels of answers longer than the form allows. */
  tooLong: string[];
  /** Labels of choice answers that match no option. */
  unmatched: string[];
}

export const TRUE_RE = /^(yes|true|1|on|checked|是|y)$/i;

/** Maps an answer onto a choice field's option value (value, label, then fuzzy). */
export function choiceValue(options: { value: string; label: string }[], answer: string): string | null {
  const a = answer.trim();
  if (!a) return null;
  const exact = options.find((o) => o.value === a) ?? options.find((o) => o.label.trim().toLowerCase() === a.toLowerCase());
  if (exact) return exact.value;
  return pickOption(options, a);
}

function answerFor(field: Pick<ParsedField, "name" | "label">, answers: Record<string, string>): string {
  const v = answers[field.name] ?? answers[field.label];
  return typeof v === "string" ? v.trim() : "";
}

/** Turns prepared answers and files into form entries, in form order (hidden inputs first). */
export function buildFormEntries(form: Pick<ParsedForm, "fields" | "hidden">, answers: Record<string, string>, files: LoadedFile[]): BuiltEntries {
  const entries: Entry[] = form.hidden.map(([n, v]) => [n, v] as Entry);
  const missing: string[] = [];
  const tooLong: string[] = [];
  const unmatched: string[] = [];
  for (const f of form.fields) {
    const answer = answerFor(f, answers);
    if (f.type === "file") {
      const file = files.find((x) => x.field === f.name) ?? files.find((x) => x.field === f.label);
      if (file) entries.push([f.name, file]);
      else if (f.required) missing.push(f.label);
      continue;
    }
    if (f.type === "checkbox") {
      if (TRUE_RE.test(answer)) entries.push([f.name, f.checkedValue ?? "on"]);
      else if (f.required) missing.push(f.label);
      continue;
    }
    if (f.type === "select" || f.type === "multiselect") {
      const opts = f.options ?? [];
      const parts = f.type === "multiselect" ? splitMulti(answer) : answer ? [answer] : [];
      if (!parts.length) {
        if (f.required) missing.push(f.label);
        continue;
      }
      let matched = 0;
      for (const p of parts) {
        const v = opts.length ? choiceValue(opts, p) : p;
        if (v === null) {
          if (!unmatched.includes(f.label)) unmatched.push(f.label);
        } else {
          entries.push([f.name, v]);
          matched++;
        }
      }
      if (!matched && f.required && !unmatched.includes(f.label)) missing.push(f.label);
      continue;
    }
    if (!answer) {
      if (f.required) missing.push(f.label);
      continue;
    }
    if (f.maxLength && answer.length > f.maxLength) {
      tooLong.push(f.label);
      continue;
    }
    entries.push([f.name, answer]);
  }
  return { entries, missing, tooLong, unmatched };
}

/** application/x-www-form-urlencoded body (files are dropped: this encoding cannot carry them). */
export function urlencodedBody(entries: Entry[]): string {
  const p = new URLSearchParams();
  for (const [n, v] of entries) if (typeof v === "string") p.append(n, v);
  return p.toString();
}

/** multipart/form-data body with its Content-Type (boundary included). */
export async function multipartBody(entries: Entry[]): Promise<{ body: Uint8Array; contentType: string }> {
  const fd = new FormData();
  for (const [n, v] of entries) {
    if (typeof v === "string") fd.append(n, v);
    else fd.append(n, new Blob([v.bytes as BlobPart], { type: v.contentType }), v.filename);
  }
  const req = new Request("http://form.invalid/", { method: "POST", body: fd });
  const contentType = req.headers.get("content-type") ?? "multipart/form-data";
  return { body: new Uint8Array(await req.arrayBuffer()), contentType };
}

/* ------------------------------------------------------------------ reading the response */

export const CONFIRM_RE =
  /\b(thank you|thanks for (applying|your application|submitting|your submission)|application (received|submitted|complete)|we('ve| have) received|submission (received|successful)|successfully submitted|response has been recorded|confirmation (number|code))\b|提交成功|已提交|感谢您的申请|我们已收到|回复已记录|已记录您的回复/i;

export interface ResponseReading {
  confirmed: boolean;
  ref: string | null;
  confirmationText: string | null;
  /** Validation errors the page shows (role=alert summaries, field errors). */
  errors: string[];
  /** The page shows the same form again (usually: rejected input). */
  formAgain: boolean;
}

const REF_RE = /\b(?:reference|confirmation|application|submission|ticket|receipt)\s*(?:number|no\.?|code|id|#)?\s*(?:is)?\s*[:#：]?\s*([A-Z0-9][A-Z0-9-]{3,30})\b/i;

/** Reads a form's response page: confirmation reference, success text, errors. */
export function readResponse(html: string, sentFieldNames: string[] = []): ResponseReading {
  const $ = load(html);
  $("script, style, noscript, template").remove();
  const own = $("#confirmation-ref");
  let ref: string | null = own.length ? (own.attr("data-ref") ?? own.text()).trim() || null : null;
  const visible = squash($("body").text());
  if (!ref) {
    const m = REF_RE.exec(visible);
    if (m && /\d/.test(m[1]) && m[1].length >= 4) ref = m[1];
  }
  const errors = $("[role=alert], .error, .errors, .field-error, .invalid-feedback, [aria-live=assertive]")
    .toArray()
    .map((e) => squash($(e).text()))
    .filter((t) => t.length > 1 && t.length < 600);
  const uniqueErrors = [...new Set(errors)].slice(0, 12);
  const present = sentFieldNames.filter((n) => $(attrSelector("name", n)).length > 0).length;
  const formAgain = sentFieldNames.length > 0 && present >= Math.max(1, Math.ceil(sentFieldNames.length * 0.6));
  const confirmedText = CONFIRM_RE.test(visible);
  const heading = squash($("h1").first().text());
  const lede = squash($("h1").first().nextAll("p").first().text());
  let confirmationText: string | null = [heading, lede].filter(Boolean).join(" — ") || null;
  if (!confirmationText && confirmedText) {
    const sentence = /[^.!?。！？]*?(thank you|received|submitted|recorded|已提交|已收到|已记录)[^.!?。！？]*[.!?。！？]?/i.exec(visible);
    confirmationText = sentence ? sentence[0].trim() : null;
  }
  if (confirmationText && confirmationText.length > 400) confirmationText = `${confirmationText.slice(0, 399)}…`;
  const confirmed = Boolean(ref) || (confirmedText && !(formAgain && uniqueErrors.length > 0));
  return { confirmed, ref, confirmationText, errors: uniqueErrors, formAgain };
}
