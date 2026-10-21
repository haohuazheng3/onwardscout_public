/*
 * Google Forms (CH2). A public form page carries its whole structure in a JavaScript array,
 * `var FB_PUBLIC_LOAD_DATA_ = [...]`: questions, entry ids, options, required flags, page
 * breaks. We read it as data (never execute it), turn it into ordered fields, and submit with
 * one urlencoded POST to the form's `formResponse` URL — the same request the page makes.
 *
 * Layout of the array (stable for years; every access below is defensive):
 *   data[1][0]  description          data[1][1]  items           data[1][8]  title
 *   data[3]     document title        data[1][10][6]  email collection (1 off, 2 verified, 3 responder input)
 *   item = [itemId, title, help, typeId, entries[], …]
 *   entry = [entryId, options[[label, …, …, …, isOther]], required (0|1), rowLabels|scaleLabels, …]
 *   typeId: 0 short answer · 1 paragraph · 2 multiple choice · 3 dropdown · 4 checkboxes ·
 *           5 linear scale · 6 text block · 7 grid · 8 section break · 9 date · 10 time ·
 *           11 image · 12 video · 13 file upload (needs sign-in) · 18 rating
 * Pure — no I/O.
 */
import type { FormField } from "@/lib/core/types";
import { cleanLabel, fieldSemantics, isLongQuestion, plainText } from "./detect";
import { splitMulti } from "./handoff";
import { choiceValue } from "./html-form";
import type { FieldRequirement } from "./types";

export interface GoogleFormField {
  /** `entry.<id>` (or `emailAddress`). */
  name: string;
  entryId: string | null;
  label: string;
  type: FormField["type"];
  /** Google's own question type id. */
  gtype: number;
  required: boolean;
  options?: { value: string; label: string }[];
  /** "Other: ___" is offered. */
  hasOther?: boolean;
  help?: string;
  page: number;
}

export interface GoogleForm {
  title: string;
  description: string;
  fields: GoogleFormField[];
  pages: number;
  /** Absolute formResponse URL. */
  action: string;
  fbzx: string | null;
  /** Verified email collection or file uploads: Google requires the person to sign in. */
  requiresLogin: boolean;
  loginReasons: string[];
}

/** Extracts the JSON array literal assigned to `FB_PUBLIC_LOAD_DATA_`, or null. */
export function extractLoadData(html: string): unknown[] | null {
  const m = /FB_PUBLIC_LOAD_DATA_\s*=\s*/.exec(html);
  if (!m) return null;
  const start = m.index + m[0].length;
  if (html[start] !== "[") return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < html.length; i++) {
    const c = html[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "[") depth++;
    else if (c === "]") {
      depth--;
      if (depth === 0) {
        try {
          const parsed = JSON.parse(html.slice(start, i + 1)) as unknown;
          return Array.isArray(parsed) ? parsed : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
function str(v: unknown): string {
  return typeof v === "string" ? v : "";
}

/** The formResponse URL for a viewform URL (`…/viewform?usp=sf_link` → `…/formResponse`). */
export function formResponseUrl(viewUrl: string): string {
  try {
    const u = new URL(viewUrl);
    u.search = "";
    u.hash = "";
    u.pathname = u.pathname.replace(/\/(viewform|edit|prefill)\/?$/, "/formResponse");
    if (!u.pathname.endsWith("/formResponse")) u.pathname = `${u.pathname.replace(/\/$/, "")}/formResponse`;
    return u.toString();
  } catch {
    return viewUrl;
  }
}

const TYPE_MAP: Record<number, FormField["type"] | null> = {
  0: "text",
  1: "textarea",
  2: "select",
  3: "select",
  4: "multiselect",
  5: "select",
  6: null,
  7: "select",
  8: null,
  9: "date",
  10: "text",
  11: null,
  12: null,
  13: "file",
  18: "select",
};

/** Parses a public Google Form page. Returns null when the page carries no form data. */
export function parseGoogleForm(html: string, pageUrl: string): GoogleForm | null {
  const data = extractLoadData(html);
  if (!data) return null;
  const body = arr(data[1]);
  const items = arr(body[1]);
  const fields: GoogleFormField[] = [];
  const loginReasons: string[] = [];
  let page = 0;

  const emailMode = Number(arr(body[10])[6] ?? 0);
  if (emailMode === 3) {
    fields.push({ name: "emailAddress", entryId: null, label: "Email", type: "email", gtype: -1, required: true, page: 0 });
  } else if (emailMode === 2) {
    loginReasons.push("verified_email");
  }

  for (const raw of items) {
    const item = arr(raw);
    const gtype = Number(item[3]);
    const title = cleanLabel(str(item[1]));
    const help = plainText(str(item[2]), 400) || undefined;
    if (gtype === 8) {
      page++;
      continue;
    }
    const type = TYPE_MAP[gtype];
    if (type === undefined || type === null) continue;
    const entries = arr(item[4]);
    if (gtype === 13) loginReasons.push("file_upload");
    for (const rawEntry of entries) {
      const entry = arr(rawEntry);
      const entryId = entry[0] === null || entry[0] === undefined ? null : String(entry[0]);
      if (!entryId) continue;
      const required = entry[2] === 1 || entry[2] === true;
      const optionRows = arr(entry[1]).map(arr);
      const hasOther = optionRows.some((o) => o[4] === 1 && !str(o[0]));
      let options = optionRows.map((o) => str(o[0])).filter(Boolean).map((l) => ({ value: l, label: l }));
      let label = title || "Question";
      if (gtype === 7) {
        const row = str(arr(entry[3])[0]);
        if (row) label = `${label} — ${row}`;
      }
      if (gtype === 5 || gtype === 18) {
        if (!options.length && gtype === 18) options = Array.from({ length: 5 }, (_, i) => ({ value: String(i + 1), label: String(i + 1) }));
      }
      fields.push({
        name: `entry.${entryId}`,
        entryId,
        label,
        type: gtype === 7 && entry[11] && arr(entry[11])[0] === 1 ? "multiselect" : type,
        gtype,
        required,
        ...(options.length ? { options } : {}),
        ...(hasOther ? { hasOther: true } : {}),
        ...(help ? { help } : {}),
        page,
      });
    }
  }

  const markup = html.replace(/<!--[\s\S]*?-->/g, "");
  const actionMatch = /<form[^>]+action="([^"]*formResponse[^"]*)"/i.exec(markup);
  let action = formResponseUrl(pageUrl);
  if (actionMatch) {
    try {
      action = new URL(actionMatch[1].replace(/&amp;/g, "&"), pageUrl).toString();
    } catch {
      /* keep the derived URL */
    }
  }
  const fbzx = /name="fbzx"\s+value="([^"]+)"/.exec(markup)?.[1] ?? /"fbzx"\s*:\s*"([^"]+)"/.exec(markup)?.[1] ?? null;

  return {
    title: cleanLabel(str(data[3]) || str(body[8])) || "Google Form",
    description: plainText(str(body[0]), 600),
    fields,
    pages: page + 1,
    action,
    fbzx,
    requiresLogin: loginReasons.length > 0,
    loginReasons,
  };
}

/** Whether a fetched page is Google's sign-in wall instead of the form. */
export function isGoogleSignInPage(finalUrl: string, html: string): boolean {
  try {
    if (new URL(finalUrl).hostname === "accounts.google.com") return true;
  } catch {
    /* fall through */
  }
  return !html.includes("FB_PUBLIC_LOAD_DATA_") && /accounts\.google\.com\/(v3\/signin|ServiceLogin)/.test(html);
}

/** Ordered `FieldRequirement`s for P3a. */
export function googleFormRequirements(form: GoogleForm): FieldRequirement[] {
  return form.fields.map((f) => {
    const sem = fieldSemantics(f.name === "emailAddress" ? "email" : f.name, f.label, f.type);
    const req: FieldRequirement = {
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required,
      ...(f.options ? { options: f.options.map((o) => o.label), choices: f.options } : {}),
      ...(sem.profilePath ? { profilePath: sem.profilePath } : {}),
      ...(sem.key ? { key: sem.key } : {}),
      ...(sem.userOnly ? { userOnly: true } : {}),
      ...(f.help ? { help: f.help } : {}),
      ...(form.pages > 1 ? { section: `Page ${f.page + 1}` } : {}),
    };
    if (isLongQuestion(req)) req.question = true;
    return req;
  });
}

export interface GooglePayload {
  body: string;
  missing: string[];
  unmatched: string[];
}

function dateParts(v: string): { year: string; month: string; day: string } | null {
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v.trim()) ?? null;
  if (m) return { year: m[1], month: String(Number(m[2])), day: String(Number(m[3])) };
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return { year: String(d.getUTCFullYear()), month: String(d.getUTCMonth() + 1), day: String(d.getUTCDate()) };
}

/** The urlencoded body Google's own page would send for these answers. */
export function buildGooglePayload(form: GoogleForm, answers: Record<string, string>): GooglePayload {
  const p = new URLSearchParams();
  const missing: string[] = [];
  const unmatched: string[] = [];
  for (const f of form.fields) {
    const answer = (answers[f.name] ?? answers[f.label] ?? (f.entryId ? answers[f.entryId] : undefined) ?? "").trim();
    if (!answer) {
      if (f.required) missing.push(f.label);
      continue;
    }
    if (f.type === "file") {
      missing.push(f.label);
      continue;
    }
    if (f.gtype === 9) {
      const d = dateParts(answer);
      if (!d) {
        unmatched.push(f.label);
        continue;
      }
      p.append(`${f.name}_year`, d.year);
      p.append(`${f.name}_month`, d.month);
      p.append(`${f.name}_day`, d.day);
      continue;
    }
    if (f.gtype === 10) {
      const t = /^(\d{1,2}):(\d{2})/.exec(answer);
      if (!t) {
        unmatched.push(f.label);
        continue;
      }
      p.append(`${f.name}_hour`, String(Number(t[1])));
      p.append(`${f.name}_minute`, t[2]);
      continue;
    }
    if (f.options && (f.type === "select" || f.type === "multiselect")) {
      const parts = f.type === "multiselect" ? splitMulti(answer) : [answer];
      let matched = 0;
      for (const part of parts) {
        const v = choiceValue(f.options, part);
        if (v !== null) {
          p.append(f.name, v);
          matched++;
        } else if (f.hasOther) {
          p.append(f.name, "__other_option__");
          p.append(`${f.name}.other_option_response`, part);
          matched++;
        } else if (!unmatched.includes(f.label)) unmatched.push(f.label);
      }
      if (!matched && f.required && !unmatched.includes(f.label)) missing.push(f.label);
      continue;
    }
    p.append(f.name, answer);
  }
  p.append("fvv", "1");
  p.append("pageHistory", Array.from({ length: form.pages }, (_, i) => i).join(","));
  if (form.fbzx) {
    p.append("fbzx", form.fbzx);
    p.append("partialResponse", JSON.stringify([null, null, form.fbzx]));
  }
  return { body: p.toString(), missing, unmatched };
}

/** Google's confirmation page ("Your response has been recorded." or the owner's own message). */
export function readGoogleConfirmation(html: string): { confirmed: boolean; text: string | null } {
  const own =
    /<div[^>]+class="[^"]*(?:vHW8K|freebirdFormviewerViewResponseConfirmationMessage)[^"]*"[^>]*>([\s\S]*?)<\/div>/i.exec(html)?.[1] ?? null;
  const text = own ? plainText(own, 400) : null;
  const confirmed = Boolean(text) || /response has been recorded|回复已记录|已记录您的回复|您的回复已记录/i.test(html);
  return { confirmed, text: text || (confirmed ? "Your response has been recorded." : null) };
}
