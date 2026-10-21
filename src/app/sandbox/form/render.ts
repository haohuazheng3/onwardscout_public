/*
 * The practice application form (/sandbox/form): field definitions, validation and the
 * self-contained HTML. Pure (no I/O) so the route stays small and the form can be exercised
 * by the channel adapters (CH2 plain-HTML forms, CH3 browser agent) and by tests exactly like
 * a real third-party form, without anything ever leaving Onward Scout.
 */
import { randomString } from "@/lib/ids";

/** Largest résumé accepted. Vercel caps a function's request body at 4.5 MB, so the form says 4 MB. */
export const MAX_RESUME_BYTES = 4 * 1024 * 1024;

export const AVAILABILITY = [
  { value: "immediately", label: "Immediately" },
  { value: "2-weeks", label: "Within 2 weeks" },
  { value: "1-month", label: "Within a month" },
  { value: "1-3-months", label: "In 1 to 3 months" },
  { value: "later", label: "Later than 3 months" },
] as const;

const RESUME_TYPES: Record<string, string[]> = {
  pdf: ["application/pdf", "application/x-pdf"],
  docx: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
};

export type FieldName =
  | "full_name"
  | "email"
  | "phone"
  | "location"
  | "profile_url"
  | "resume"
  | "motivation"
  | "proud_project"
  | "availability"
  | "consent";

/** Text values as submitted (trimmed); the file is reported separately as metadata only. */
export type SandboxValues = Partial<Record<Exclude<FieldName, "resume">, string>> & { application_id?: string };

export interface SandboxFile {
  field: "resume";
  name: string;
  size: number;
  type: string;
}

export type ValidationResult =
  | { ok: true; fields: Record<string, string>; files: SandboxFile[] }
  | { ok: false; errors: Partial<Record<FieldName, string>>; values: SandboxValues };

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;
const PHONE = /^[+()\-.\s\d]{7,25}$/;
export const APPLICATION_ID = /^app_[0-9a-hjkmnp-tv-z]{6,40}$/;

function str(form: FormData, name: string): string {
  const v = form.get(name);
  return typeof v === "string" ? v.replace(/\r\n/g, "\n").trim() : "";
}

function isFile(v: FormDataEntryValue | null): v is File {
  return typeof v === "object" && v !== null && typeof (v as File).arrayBuffer === "function" && typeof (v as File).size === "number";
}

function fileExtension(name: string): string {
  const m = /\.([a-z0-9]{1,8})$/i.exec(name.trim());
  return m ? m[1].toLowerCase() : "";
}

/**
 * Validates a submission the way a careful real form would, with one human sentence per problem.
 * `requireFile: false` is for application/x-www-form-urlencoded posts (the encoding plain HTML
 * form adapters use), which cannot carry a file at all: the résumé is then optional, and a file
 * that does arrive is still checked.
 */
export function validateSubmission(form: FormData, opts: { requireFile?: boolean } = {}): ValidationResult {
  const requireFile = opts.requireFile ?? true;
  const values: SandboxValues = {
    full_name: str(form, "full_name"),
    email: str(form, "email"),
    phone: str(form, "phone"),
    location: str(form, "location"),
    profile_url: str(form, "profile_url"),
    motivation: str(form, "motivation"),
    proud_project: str(form, "proud_project"),
    availability: str(form, "availability"),
    consent: str(form, "consent"),
  };
  const appId = str(form, "application_id");
  if (APPLICATION_ID.test(appId)) values.application_id = appId;

  const errors: Partial<Record<FieldName, string>> = {};
  const name = values.full_name ?? "";
  if (name.length < 2) errors.full_name = "Enter your full name.";
  else if (name.length > 120) errors.full_name = "Your name can be at most 120 characters.";

  const email = values.email ?? "";
  if (!email) errors.email = "Enter your email address.";
  else if (email.length > 254 || !EMAIL.test(email)) errors.email = "Enter an email address like name@example.com.";

  const phone = values.phone ?? "";
  if (phone && !PHONE.test(phone)) errors.phone = "Enter a phone number with digits, spaces, +, ( ) or -, or leave it empty.";

  const location = values.location ?? "";
  if (location.length < 2) errors.location = "Enter the city and country you live in.";
  else if (location.length > 120) errors.location = "Location can be at most 120 characters.";

  const url = values.profile_url ?? "";
  if (url) {
    let valid = false;
    try {
      const u = new URL(url);
      valid = (u.protocol === "https:" || u.protocol === "http:") && Boolean(u.hostname.includes(".")) && url.length <= 300;
    } catch {
      valid = false;
    }
    if (!valid) errors.profile_url = "Enter a full link starting with https://, or leave it empty.";
  }

  const files: SandboxFile[] = [];
  const resume = form.get("resume");
  if (!isFile(resume) || resume.size === 0 || !resume.name) {
    if (requireFile) errors.resume = "Attach your résumé or CV as a PDF or DOCX file.";
  } else {
    const ext = fileExtension(resume.name);
    const declared = (resume.type || "").toLowerCase();
    if (!(ext in RESUME_TYPES)) errors.resume = "Your résumé must be a PDF or DOCX file.";
    else if (declared && declared !== "application/octet-stream" && !RESUME_TYPES[ext].includes(declared)) {
      errors.resume = `The file is named .${ext} but its type is ${declared.slice(0, 80)}. Export it again as PDF or DOCX.`;
    } else if (resume.size > MAX_RESUME_BYTES) errors.resume = "Your résumé is larger than 4 MB. Please attach a smaller file.";
    else files.push({ field: "resume", name: resume.name.replace(/[\x00-\x1f\x7f]/g, "").slice(0, 200), size: resume.size, type: declared || "application/octet-stream" });
  }

  const motivation = values.motivation ?? "";
  if (motivation.length < 20) errors.motivation = "Tell us in at least 20 characters why this opportunity fits you.";
  else if (motivation.length > 3000) errors.motivation = "Keep this answer under 3,000 characters.";

  const project = values.proud_project ?? "";
  if (project.length < 20) errors.proud_project = "Describe the project in at least 20 characters.";
  else if (project.length > 3000) errors.proud_project = "Keep this answer under 3,000 characters.";

  if (!AVAILABILITY.some((a) => a.value === values.availability)) errors.availability = "Choose when you could start.";
  if (values.consent !== "yes") errors.consent = "Confirm that your answers are accurate to submit the application.";

  if (Object.keys(errors).length) return { ok: false, errors, values };
  const fields: Record<string, string> = {};
  for (const [k, v] of Object.entries(values)) if (v) fields[k] = v;
  return { ok: true, fields, files };
}

/** A confirmation reference such as `SBX-7KQ2M9`. */
export function newSandboxRef(): string {
  return `SBX-${randomString(6).toUpperCase()}`;
}

export const SANDBOX_REF = /^SBX-[0-9A-HJKMNP-TV-Z]{6}$/;

/* ------------------------------------------------------------------ HTML */

export function escapeHtml(v: string): string {
  return v.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const LOGO = `<svg class="logo" viewBox="0 0 32 32" width="28" height="28" aria-hidden="true" focusable="false"><path d="M9 7 L19 16 L9 25" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/><circle cx="26" cy="16" r="3" class="dot"/></svg>`;

const STYLE = `
:root{color-scheme:light dark;--void:#F5F4F0;--pane:#FFFFFF;--pane-2:#F8F7F3;--line:rgba(18,22,20,.08);--line-2:rgba(18,22,20,.14);--ink:#121614;--ink-2:#3E4541;--ink-3:#626A65;--accent:#E4572E;--accent-ink:#FFF6F2;--accent-text:#B8411F;--accent-soft:rgba(228,87,46,.12);--pine:#1E5A48;--pine-soft:rgba(30,90,72,.12);--bad:#B23A0A;--ok:#1F7A4D}
@media (prefers-color-scheme:dark){:root{--void:#0E1210;--pane:#161B18;--pane-2:#1C221E;--line:rgba(242,244,241,.1);--line-2:rgba(242,244,241,.18);--ink:#F2F4F1;--ink-2:#C9CFCB;--ink-3:#A3ABA6;--accent:#FF7A50;--accent-ink:#1A0C06;--accent-text:#FF9A78;--accent-soft:rgba(255,122,80,.14);--pine:#5FC2A0;--pine-soft:rgba(95,194,160,.14);--bad:#FF8A5C;--ok:#5FC2A0}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;min-height:100vh;background:var(--void);color:var(--ink);font:16px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,"PingFang SC","Hiragino Sans GB","Noto Sans SC","Microsoft YaHei",sans-serif}
.wrap{max-width:720px;margin:0 auto;padding:24px 16px 64px}
.brand{display:flex;align-items:center;gap:10px;color:var(--ink);font-weight:650;letter-spacing:-.01em;margin:8px 4px 20px}
.logo{color:var(--ink)}.logo .dot{fill:var(--pine)}
.pane{background:var(--pane);border:1px solid var(--line);border-radius:28px;box-shadow:0 1px 2px rgba(18,22,20,.04),0 12px 32px -12px rgba(18,22,20,.14),0 32px 64px -32px rgba(18,22,20,.18);padding:28px 20px}
@media (min-width:640px){.pane{padding:40px}}
.notice{background:var(--pine-soft);color:var(--ink-2);border-radius:20px;padding:14px 16px;font-size:15px;margin:0 0 28px}
.eyebrow{font-size:13px;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--accent-text);margin:0 0 6px}
h1{font-size:clamp(28px,6vw,38px);line-height:1.12;letter-spacing:-.02em;margin:0 0 10px}
.lede{color:var(--ink-3);margin:0 0 24px}
fieldset{border:0;margin:0 0 8px;padding:0}
legend{font-size:18px;font-weight:650;margin:0 0 14px;padding:0}
.field{margin:0 0 20px}
label,.label{display:block;font-weight:600;margin:0 0 6px}
.req{color:var(--accent-text);margin-left:2px}
.opt{color:var(--ink-3);font-weight:400}
.hint{color:var(--ink-3);font-size:14px;margin:-2px 0 8px}
input[type=text],input[type=email],input[type=tel],input[type=url],select,textarea{width:100%;font:inherit;font-size:16px;color:var(--ink);background:var(--pane-2);border:1px solid var(--line-2);border-radius:16px;padding:12px 14px;min-height:48px}
textarea{min-height:132px;resize:vertical}
input[type=file]{width:100%;font:inherit;font-size:15px;color:var(--ink-2);background:var(--pane-2);border:1px dashed var(--line-2);border-radius:16px;padding:14px}
input:focus-visible,select:focus-visible,textarea:focus-visible,button:focus-visible,a:focus-visible{outline:3px solid var(--pine);outline-offset:2px}
[aria-invalid=true]{border-color:var(--bad)!important}
.error{color:var(--bad);font-size:14px;font-weight:600;margin:6px 0 0}
.check{display:flex;gap:12px;align-items:flex-start;font-weight:400}
.check input{width:22px;height:22px;margin:2px 0 0;accent-color:var(--accent);flex:none}
.summary{border:1px solid var(--bad);border-radius:20px;padding:14px 18px;margin:0 0 24px;background:var(--accent-soft)}
.summary h2{font-size:17px;margin:0 0 6px}.summary ul{margin:0;padding-left:20px}.summary a{color:var(--ink)}
button{appearance:none;border:0;border-radius:999px;background:var(--accent);color:var(--accent-ink);font:inherit;font-weight:650;font-size:16px;min-height:52px;padding:0 28px;cursor:pointer;transition:transform .08s ease}
button:active{transform:scale(.97)}
.actions{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin-top:8px}
.small{font-size:14px;color:var(--ink-3)}
.ref{font:700 clamp(28px,7vw,40px)/1.1 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;letter-spacing:.04em;color:var(--ink);background:var(--pane-2);border:1px solid var(--line-2);border-radius:20px;padding:16px 20px;display:inline-block;margin:6px 0 18px}
.okmark{width:48px;height:48px;border-radius:999px;background:var(--pine-soft);color:var(--ok);display:grid;place-items:center;margin-bottom:14px}
a{color:var(--accent-text)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
`;

function page(title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<div class="wrap">
<div class="brand">${LOGO}<span>Onward Scout Sandbox</span></div>
<main class="pane">
${body}
</main>
<p class="small" style="margin-top:18px;text-align:center">What this form stores and for how long: <a href="/privacy#what-we-collect">privacy policy</a> · <a href="/terms">terms</a></p>
</div>
</body>
</html>`;
}

const NOTICE = `<p class="notice" role="note"><strong>Practice form.</strong> This is Onward Scout's own sandbox. It behaves like a real application form, but submissions stay inside Onward Scout and no program receives them.</p>`;

const LABELS: Record<FieldName, string> = {
  full_name: "Full name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  profile_url: "LinkedIn or portfolio URL",
  resume: "Résumé / CV",
  motivation: "Why this opportunity?",
  proud_project: "Tell us about a project you are proud of",
  availability: "When could you start?",
  consent: "Confirmation",
};

const ORDER: FieldName[] = ["full_name", "email", "phone", "location", "profile_url", "resume", "motivation", "proud_project", "availability", "consent"];

function describedBy(name: FieldName, hasHint: boolean, error?: string): string {
  const ids = [hasHint ? `${name}-hint` : "", error ? `${name}-error` : ""].filter(Boolean);
  return ids.length ? ` aria-describedby="${ids.join(" ")}"` : "";
}

function errorLine(name: FieldName, error?: string): string {
  return error ? `<p class="error" id="${name}-error">${escapeHtml(error)}</p>` : "";
}

function textField(
  name: FieldName,
  type: "text" | "email" | "tel" | "url",
  opts: { required: boolean; value?: string; error?: string; hint?: string; autocomplete?: string; maxlength: number; placeholder?: string },
): string {
  const hint = opts.hint ? `<p class="hint" id="${name}-hint">${escapeHtml(opts.hint)}</p>` : "";
  return `<div class="field">
<label for="${name}">${LABELS[name]}${opts.required ? `<span class="req" aria-hidden="true">*</span>` : ` <span class="opt">(optional)</span>`}</label>
${hint}<input id="${name}" name="${name}" type="${type}"${opts.required ? " required" : ""}${opts.autocomplete ? ` autocomplete="${opts.autocomplete}"` : ""} maxlength="${opts.maxlength}"${opts.placeholder ? ` placeholder="${escapeHtml(opts.placeholder)}"` : ""} value="${escapeHtml(opts.value ?? "")}"${opts.error ? ` aria-invalid="true"` : ""}${describedBy(name, Boolean(opts.hint), opts.error)}>
${errorLine(name, opts.error)}</div>`;
}

function textArea(name: FieldName, opts: { value?: string; error?: string; hint: string }): string {
  return `<div class="field">
<label for="${name}">${LABELS[name]}<span class="req" aria-hidden="true">*</span></label>
<p class="hint" id="${name}-hint">${escapeHtml(opts.hint)}</p>
<textarea id="${name}" name="${name}" required minlength="20" maxlength="3000" rows="6"${opts.error ? ` aria-invalid="true"` : ""}${describedBy(name, true, opts.error)}>${escapeHtml(opts.value ?? "")}</textarea>
${errorLine(name, opts.error)}</div>`;
}

/** The form itself; `values`/`errors` re-render it after a failed submission. */
export function renderForm(input: { values?: SandboxValues; errors?: Partial<Record<FieldName, string>>; applicationId?: string } = {}): string {
  const v = input.values ?? {};
  const e = input.errors ?? {};
  const appId = input.applicationId ?? v.application_id;
  const errorNames = ORDER.filter((n) => e[n]);
  const summary = errorNames.length
    ? `<div class="summary" role="alert" aria-labelledby="summary-title" tabindex="-1">
<h2 id="summary-title">Please fix ${errorNames.length === 1 ? "this" : `these ${errorNames.length}`} before submitting</h2>
<ul>${errorNames.map((n) => `<li><a href="#${n}">${escapeHtml(e[n] ?? "")}</a></li>`).join("")}</ul>
</div>`
    : "";
  const availability = AVAILABILITY.map(
    (a) => `<option value="${a.value}"${v.availability === a.value ? " selected" : ""}>${escapeHtml(a.label)}</option>`,
  ).join("");
  const body = `${NOTICE}
<p class="eyebrow">Practice Fellowship · 2026 cohort</p>
<h1>Application form</h1>
<p class="lede">Fields marked <span class="req">*</span> are required. It takes about five minutes.</p>
${summary}
<form method="post" action="/sandbox/form" enctype="multipart/form-data" novalidate>
${appId && APPLICATION_ID.test(appId) ? `<input type="hidden" name="application_id" value="${escapeHtml(appId)}">` : ""}
<fieldset>
<legend>About you</legend>
${textField("full_name", "text", { required: true, value: v.full_name, error: e.full_name, autocomplete: "name", maxlength: 120 })}
${textField("email", "email", { required: true, value: v.email, error: e.email, autocomplete: "email", maxlength: 254 })}
${textField("phone", "tel", { required: false, value: v.phone, error: e.phone, autocomplete: "tel", maxlength: 25, hint: "Include your country code, for example +1 415 555 0134." })}
${textField("location", "text", { required: true, value: v.location, error: e.location, maxlength: 120, hint: "City and country, for example Toronto, Canada." })}
${textField("profile_url", "url", { required: false, value: v.profile_url, error: e.profile_url, autocomplete: "url", maxlength: 300, placeholder: "https://" })}
</fieldset>
<fieldset>
<legend>Your materials</legend>
<div class="field">
<label for="resume">${LABELS.resume}<span class="req" aria-hidden="true">*</span></label>
<p class="hint" id="resume-hint">PDF or DOCX, up to 4 MB.</p>
<input id="resume" name="resume" type="file" required accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"${e.resume ? ` aria-invalid="true"` : ""}${describedBy("resume", true, e.resume)}>
${errorLine("resume", e.resume)}</div>
</fieldset>
<fieldset>
<legend>Your answers</legend>
${textArea("motivation", { value: v.motivation, error: e.motivation, hint: "What draws you to this program and what you hope to get out of it. 20 to 3,000 characters." })}
${textArea("proud_project", { value: v.proud_project, error: e.proud_project, hint: "What you built or did, your part in it, and the result. 20 to 3,000 characters." })}
<div class="field">
<label for="availability">${LABELS.availability}<span class="req" aria-hidden="true">*</span></label>
<select id="availability" name="availability" required${e.availability ? ` aria-invalid="true"` : ""}${describedBy("availability", false, e.availability)}>
<option value=""${v.availability ? "" : " selected"}>Choose one</option>
${availability}
</select>
${errorLine("availability", e.availability)}</div>
</fieldset>
<div class="field">
<label class="check" for="consent"><input id="consent" name="consent" type="checkbox" value="yes" required${v.consent === "yes" ? " checked" : ""}${e.consent ? ` aria-invalid="true"` : ""}${describedBy("consent", false, e.consent)}><span>I confirm that the information in this application is accurate and that I wrote or approved every answer.<span class="req" aria-hidden="true">*</span></span></label>
${errorLine("consent", e.consent)}</div>
<div class="actions">
<button type="submit">Submit application</button>
<span class="small">You'll get a confirmation reference on the next page.</span>
</div>
</form>`;
  return page("Practice Fellowship application · Onward Scout Sandbox", body);
}

/** The confirmation page; the reference is in `#confirmation-ref` for adapters and tests. */
export function renderConfirmation(input: { ref: string; name: string; email: string }): string {
  const first = input.name.split(/\s+/)[0] ?? "";
  const body = `${NOTICE}
<div class="okmark" aria-hidden="true"><svg viewBox="0 0 24 24" width="26" height="26"><path d="M5 12.5 10 17.5 19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
<p class="eyebrow">Practice Fellowship · 2026 cohort</p>
<h1>Application received</h1>
<p class="lede">Thank you${first ? `, ${escapeHtml(first)}` : ""}. Your application was submitted. Keep this reference for your records:</p>
<p class="ref" id="confirmation-ref" data-ref="${escapeHtml(input.ref)}">${escapeHtml(input.ref)}</p>
<p>A confirmation would normally be emailed to <strong>${escapeHtml(input.email)}</strong>. This practice form sends no email.</p>
<p class="small"><a href="/sandbox/form">Submit another practice application</a></p>`;
  return page(`Application received (${input.ref}) · Onward Scout Sandbox`, body);
}

/** A short page for refusals (rate limit, oversized body). */
export function renderMessage(title: string, text: string): string {
  return page(`${title} · Onward Scout Sandbox`, `${NOTICE}<h1>${escapeHtml(title)}</h1><p class="lede">${escapeHtml(text)}</p><p><a href="/sandbox/form">Back to the form</a></p>`);
}

/** Field order and labels, for adapters that want to map answers onto this form. */
export const SANDBOX_FIELD_LABELS = LABELS;
export const SANDBOX_FIELD_ORDER = ORDER;
