/*
 * ATS-aware parsing (CH1): Greenhouse, Lever and Ashby hosted postings. The public posting APIs
 * (no key needed) give the posting and — for Greenhouse — every application question with its
 * options, so all answers are prepared without a browser. Lever's custom questions are read
 * from the structured card templates on its public apply page; Ashby publishes no form
 * definition, so we list its standard fields and say so honestly.
 *
 * We never claim to use employer submission APIs (they need the employer's key). Pure — the
 * fetching lives in ch1-ats.ts.
 */
import { load } from "cheerio";
import type { FormField } from "@/lib/core/types";
import { cleanLabel, detectBlockers, fieldSemantics, isLongQuestion, plainText } from "./detect";
import { humanizeName } from "./html-form";
import type { FieldRequirement } from "./types";

export type AtsProvider = "greenhouse" | "lever" | "ashby";

export interface AtsCoords {
  provider: AtsProvider;
  board: string;
  postingId: string;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]{1,120}$/;

/** Posting coordinates from a hosted-posting URL, or null. */
export function atsFromUrl(raw: string | null | undefined): AtsCoords | null {
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split("/").filter(Boolean);
  if (host === "boards.greenhouse.io" || host === "job-boards.greenhouse.io" || host === "job-boards.eu.greenhouse.io" || host === "boards.eu.greenhouse.io") {
    if (parts[0] === "embed") {
      const board = u.searchParams.get("for");
      const id = u.searchParams.get("token");
      return board && id && SAFE_SEGMENT.test(board) && /^\d+$/.test(id) ? { provider: "greenhouse", board, postingId: id } : null;
    }
    const [board, jobs, id] = parts;
    if (board && jobs === "jobs" && id && SAFE_SEGMENT.test(board) && /^\d+$/.test(id)) return { provider: "greenhouse", board, postingId: id };
    const gh = u.searchParams.get("gh_jid");
    if (board && gh && /^\d+$/.test(gh) && SAFE_SEGMENT.test(board)) return { provider: "greenhouse", board, postingId: gh };
    return null;
  }
  if (host === "jobs.lever.co" || host === "jobs.eu.lever.co") {
    const [board, id] = parts;
    return board && id && SAFE_SEGMENT.test(board) && /^[0-9a-f-]{36}$/i.test(id) ? { provider: "lever", board, postingId: id } : null;
  }
  if (host === "jobs.ashbyhq.com") {
    const [board, id] = parts;
    return board && id && /^[0-9a-f-]{36}$/i.test(id) ? { provider: "ashby", board: decodeURIComponent(board), postingId: id } : null;
  }
  return null;
}

/** Posting coordinates of an opportunity: `apply.ats`, else recognised from its URLs. */
export function coordsOf(opp: { apply: { ats?: { provider: AtsProvider; board: string; postingId: string } | null; url?: string | null }; url?: string | null }): AtsCoords | null {
  const a = opp.apply.ats;
  if (a) return { provider: a.provider, board: a.board, postingId: a.postingId };
  return atsFromUrl(opp.apply.url) ?? atsFromUrl(opp.url);
}

/** The public posting API URL (GET, no key). */
export function atsApiUrl(c: AtsCoords): string {
  const b = encodeURIComponent(c.board);
  const id = encodeURIComponent(c.postingId);
  switch (c.provider) {
    case "greenhouse":
      return `https://boards-api.greenhouse.io/v1/boards/${b}/jobs/${id}?questions=true`;
    case "lever":
      return `https://api.lever.co/v0/postings/${b}/${id}`;
    case "ashby":
      return `https://api.ashbyhq.com/posting-api/job-board/${b}?includeCompensation=false`;
  }
}

/** The employer's hosted application form (what a person — or CH3 — fills). */
export function atsHostedFormUrl(c: AtsCoords): string {
  const b = encodeURIComponent(c.board);
  const id = encodeURIComponent(c.postingId);
  switch (c.provider) {
    case "greenhouse":
      return `https://job-boards.greenhouse.io/${b}/jobs/${id}`;
    case "lever":
      return `https://jobs.lever.co/${b}/${id}/apply`;
    case "ashby":
      return `https://jobs.ashbyhq.com/${b}/${id}/application`;
  }
}

export interface AtsPosting {
  title: string | null;
  company: string | null;
  location: string | null;
  deadline: string | null;
  fields: FieldRequirement[];
  notes: string[];
  captchaLikely: boolean;
}

function requirement(input: {
  name: string;
  label: string;
  type: FormField["type"];
  required: boolean;
  choices?: { value: string; label: string }[];
  help?: string;
  section?: string;
  userOnly?: boolean;
  custom?: boolean;
  accept?: string;
}): FieldRequirement {
  const sem = fieldSemantics(input.name, input.label, input.type);
  let type = input.type;
  if (type === "text" && sem.key === "email") type = "email";
  else if (type === "text" && sem.key === "phone") type = "tel";
  else if (type === "text" && sem.key && /_url$/.test(sem.key)) type = "url";
  const userOnly = Boolean(input.userOnly || sem.userOnly);
  const req: FieldRequirement = {
    name: input.name,
    label: input.label,
    type,
    required: input.required,
    ...(input.choices?.length ? { options: input.choices.map((c) => c.label), choices: input.choices } : {}),
    ...(sem.profilePath ? { profilePath: sem.profilePath } : {}),
    ...(sem.key ? { key: sem.key } : {}),
    ...(userOnly ? { userOnly: true } : {}),
    ...(input.help ? { help: input.help } : {}),
    ...(input.section ? { section: input.section } : {}),
    ...(input.accept ? { accept: input.accept } : {}),
  };
  if (input.custom && !userOnly) req.question = true;
  else if (isLongQuestion(req)) req.question = true;
  return req;
}

/* ------------------------------------------------------------------ Greenhouse */

interface GhField {
  name?: unknown;
  type?: unknown;
  values?: unknown;
}
interface GhQuestion {
  label?: unknown;
  description?: unknown;
  required?: unknown;
  fields?: unknown;
}

const GH_TYPES: Record<string, FormField["type"]> = {
  input_text: "text",
  textarea: "textarea",
  input_file: "file",
  multi_value_single_select: "select",
  multi_value_multi_select: "multiselect",
};

function ghQuestion(q: GhQuestion, opts: { section?: string; userOnly?: boolean } = {}): FieldRequirement | null {
  const fields = (Array.isArray(q.fields) ? (q.fields as GhField[]) : []).filter((f) => typeof f.name === "string" && f.type !== "input_hidden");
  const primary = fields[0];
  if (!primary) return null;
  const name = String(primary.name);
  const type = GH_TYPES[String(primary.type)] ?? "text";
  const values = Array.isArray(primary.values) ? (primary.values as { label?: unknown; value?: unknown }[]) : [];
  const choices = values.filter((v) => typeof v.label === "string").map((v) => ({ value: String(v.value), label: String(v.label).trim() }));
  const rawLabel = typeof q.label === "string" ? q.label : name;
  // Compliance questions come with machine labels ("VeteranStatus").
  const label = cleanLabel(/^[A-Za-z]+$/.test(rawLabel) ? rawLabel.replace(/([a-z])([A-Z])/g, "$1 $2") : rawLabel) || humanizeName(name);
  const helpParts = [plainText(typeof q.description === "string" ? q.description : "", 400)];
  const alt = fields.find((f) => f.type === "textarea" && f !== primary);
  if (type === "file" && alt) helpParts.push("You can attach a file or paste the text instead.");
  const help = helpParts.filter(Boolean).join(" ") || undefined;
  return requirement({
    name,
    label,
    type,
    required: q.required === true,
    choices,
    help,
    section: opts.section,
    userOnly: opts.userOnly,
    custom: /^question_/.test(name),
    accept: type === "file" ? ".pdf,.doc,.docx,.txt,.rtf" : undefined,
  });
}

/** Fields of a Greenhouse posting (`GET …/jobs/{id}?questions=true`), in form order. */
export function parseGreenhousePosting(json: unknown): AtsPosting {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const fields: FieldRequirement[] = [];
  const seen = new Set<string>();
  const push = (f: FieldRequirement | null) => {
    if (f && !seen.has(f.name)) {
      seen.add(f.name);
      fields.push(f);
    }
  };
  for (const q of Array.isArray(j.questions) ? (j.questions as GhQuestion[]) : []) push(ghQuestion(q));
  for (const q of Array.isArray(j.location_questions) ? (j.location_questions as GhQuestion[]) : []) push(ghQuestion(q));

  // Voluntary self-identification (U.S. EEO, disability, veteran status): the person's alone.
  const eeoSection = "Voluntary self-identification";
  for (const c of Array.isArray(j.compliance) ? (j.compliance as { questions?: unknown }[]) : []) {
    for (const q of Array.isArray(c.questions) ? (c.questions as GhQuestion[]) : []) push(ghQuestion(q, { section: eeoSection, userOnly: true }));
  }
  const demo = j.demographic_questions as { questions?: unknown } | null | undefined;
  for (const q of demo && Array.isArray(demo.questions) ? (demo.questions as Record<string, unknown>[]) : []) {
    const id = q.id === undefined ? null : String(q.id);
    const label = cleanLabel(typeof q.label === "string" ? q.label : "");
    if (!id || !label) continue;
    const opts = Array.isArray(q.answer_options) ? (q.answer_options as { id?: unknown; label?: unknown }[]) : [];
    push(
      requirement({
        name: `demographic_${id}`,
        label,
        type: String(q.type ?? "").includes("multi") ? "multiselect" : opts.length ? "select" : "text",
        required: q.required === true,
        choices: opts.filter((o) => typeof o.label === "string").map((o) => ({ value: String(o.id), label: String(o.label) })),
        section: eeoSection,
        userOnly: true,
      }),
    );
  }
  const gdpr = (Array.isArray(j.data_compliance) ? (j.data_compliance as Record<string, unknown>[]) : []).find((d) => d.type === "gdpr");
  if (gdpr && (gdpr.requires_consent === true || gdpr.requires_processing_consent === true)) {
    push(requirement({ name: "gdpr_processing_consent", label: "I consent to the processing of my personal data for this application", type: "checkbox", required: true, userOnly: true }));
  }

  const notes = ["Greenhouse protects this form with a CAPTCHA, so you press Submit yourself — every answer below is ready to copy."];
  const location = (j.location as { name?: unknown } | undefined)?.name;
  return {
    title: typeof j.title === "string" ? j.title : null,
    company: typeof j.company_name === "string" ? j.company_name : null,
    location: typeof location === "string" ? location : null,
    deadline: typeof j.application_deadline === "string" ? j.application_deadline : null,
    fields,
    notes,
    captchaLikely: true,
  };
}

/* ------------------------------------------------------------------ Lever */

/** Lever's standard application fields, as its hosted form shows them (in that order). */
export const LEVER_STANDARD: { name: string; label: string; type: FormField["type"]; required: boolean }[] = [
  { name: "resume", label: "Resume/CV", type: "file", required: true },
  { name: "name", label: "Full name", type: "text", required: true },
  { name: "email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "tel", required: false },
  { name: "location", label: "Current location", type: "text", required: false },
  { name: "org", label: "Current company", type: "text", required: false },
  { name: "urls[LinkedIn]", label: "LinkedIn URL", type: "url", required: false },
  { name: "urls[Twitter]", label: "Twitter URL", type: "url", required: false },
  { name: "urls[GitHub]", label: "GitHub URL", type: "url", required: false },
  { name: "urls[Portfolio]", label: "Portfolio URL", type: "url", required: false },
  { name: "urls[Other]", label: "Other website", type: "url", required: false },
  { name: "comments", label: "Additional information", type: "textarea", required: false },
];

const LEVER_CARD_TYPES: Record<string, FormField["type"]> = {
  "multiple-choice": "select",
  dropdown: "select",
  "multiple-select": "multiselect",
  text: "text",
  textarea: "textarea",
  "file-upload": "file",
};

interface LeverCardField {
  type?: unknown;
  text?: unknown;
  description?: unknown;
  required?: unknown;
  options?: unknown;
}

/** Lever custom questions from the `cards[<id>][baseTemplate]` JSON on the public apply page. */
export function parseLeverCards(applyHtml: string): FieldRequirement[] {
  const $ = load(applyHtml);
  const out: FieldRequirement[] = [];
  for (const el of $('input[name$="[baseTemplate]"]').toArray()) {
    const name = $(el).attr("name") ?? "";
    const cardId = /^cards\[([^\]]+)\]\[baseTemplate\]$/.exec(name)?.[1];
    const raw = $(el).attr("value");
    if (!cardId || !raw) continue;
    let tpl: { text?: unknown; fields?: unknown };
    try {
      tpl = JSON.parse(raw) as { text?: unknown; fields?: unknown };
    } catch {
      continue;
    }
    const section = typeof tpl.text === "string" && tpl.text.trim() ? tpl.text.trim() : undefined;
    (Array.isArray(tpl.fields) ? (tpl.fields as LeverCardField[]) : []).forEach((f, i) => {
      const label = cleanLabel(typeof f.text === "string" ? f.text : "");
      if (!label) return;
      const options = (Array.isArray(f.options) ? (f.options as { text?: unknown }[]) : []).map((o) => String(o.text ?? "")).filter(Boolean);
      out.push(
        requirement({
          name: `cards[${cardId}][field${i}]`,
          label,
          type: LEVER_CARD_TYPES[String(f.type)] ?? "text",
          required: f.required === true,
          choices: options.map((o) => ({ value: o, label: o })),
          help: plainText(typeof f.description === "string" ? f.description : "", 300) || undefined,
          section,
          custom: true,
        }),
      );
    });
  }
  return out;
}

/** Lever posting (`GET api.lever.co/v0/postings/{company}/{id}`) + optional apply page HTML. */
export function parseLeverPosting(json: unknown, applyHtml?: string | null): AtsPosting {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const present = applyHtml ? (name: string) => applyHtml.includes(`name="${name}"`) : () => true;
  const fields = LEVER_STANDARD.filter((f) => f.name === "resume" || f.name === "name" || f.name === "email" || present(f.name)).map((f) =>
    requirement({ ...f, accept: f.type === "file" ? ".pdf,.doc,.docx,.txt,.rtf" : undefined }),
  );
  const cards = applyHtml ? parseLeverCards(applyHtml) : [];
  // Custom questions sit between the contact block and "Additional information" on the page.
  const commentsAt = fields.findIndex((f) => f.name === "comments");
  if (commentsAt >= 0) fields.splice(commentsAt, 0, ...cards);
  else fields.push(...cards);
  if (applyHtml) {
    const $ = load(applyHtml);
    for (const el of $('select[name^="eeo["]').toArray()) {
      const name = $(el).attr("name") ?? "";
      const options = $(el)
        .find("option")
        .toArray()
        .map((o) => ({ value: $(o).attr("value") ?? "", label: $(o).text().trim() }))
        .filter((o) => o.value);
      fields.push(requirement({ name, label: humanizeName(name), type: "select", required: false, choices: options, section: "Voluntary self-identification", userOnly: true }));
    }
  }
  const captcha = applyHtml ? detectBlockers(applyHtml).captcha : true;
  const categories = (j.categories ?? {}) as { location?: unknown };
  const notes = [
    captcha
      ? "Lever protects this form with a CAPTCHA, so you press Submit yourself — every answer below is ready to copy."
      : "Lever's form has no CAPTCHA right now; it can be filled for you after you confirm.",
  ];
  if (!applyHtml) notes.push("We couldn't read this employer's extra questions in advance; if the page shows any, answer them there.");
  return {
    title: typeof j.text === "string" ? j.text : null,
    company: null,
    location: typeof categories.location === "string" ? categories.location : null,
    deadline: null,
    fields,
    notes,
    captchaLikely: captcha,
  };
}

/* ------------------------------------------------------------------ Ashby */

/** Ashby's standard application fields (its public API publishes no form definition). */
export const ASHBY_STANDARD: { name: string; label: string; type: FormField["type"]; required: boolean }[] = [
  { name: "_systemfield_name", label: "Name", type: "text", required: true },
  { name: "_systemfield_email", label: "Email", type: "email", required: true },
  { name: "phone", label: "Phone", type: "tel", required: false },
  { name: "_systemfield_resume", label: "Resume", type: "file", required: true },
  { name: "linkedin", label: "LinkedIn", type: "url", required: false },
];

/** Ashby job board JSON (`GET posting-api/job-board/{board}`) → the posting with that id. */
export function parseAshbyPosting(json: unknown, postingId: string): AtsPosting | null {
  const j = (json && typeof json === "object" ? json : {}) as { jobs?: unknown };
  const job = (Array.isArray(j.jobs) ? (j.jobs as Record<string, unknown>[]) : []).find((x) => x.id === postingId);
  if (!job) return null;
  const fields = ASHBY_STANDARD.map((f) => requirement({ ...f, accept: f.type === "file" ? ".pdf,.doc,.docx" : undefined }));
  return {
    title: typeof job.title === "string" ? job.title : null,
    company: null,
    location: typeof job.location === "string" ? job.location : null,
    deadline: null,
    fields,
    notes: [
      "Ashby protects this form with a CAPTCHA, so you press Submit yourself.",
      "Ashby doesn't publish employers' extra questions in advance; if the page shows any, answer them there.",
    ],
    captchaLikely: true,
  };
}
