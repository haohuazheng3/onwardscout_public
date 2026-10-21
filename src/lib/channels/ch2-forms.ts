import "server-only";
import { captureError } from "@/lib/errors";
import type { Opportunity } from "@/lib/db/schema";
import { detectBlockers, forbiddenPlatform, isGoogleFormUrl, jsOnlyFormHost, materialsFor } from "./detect";
import { loadPreparedFile, loadPreparedFiles } from "./files";
import { buildGooglePayload, googleFormRequirements, isGoogleSignInPage, parseGoogleForm, readGoogleConfirmation } from "./gforms";
import { buildHandoff } from "./handoff";
import { channelGet, channelPost, isRetryableNetwork, isTrustedOrigin, localSandboxUrl, networkMessage } from "./http";
import { buildFormEntries, formToRequirements, multipartBody, parseHtmlForms, pickMainForm, questionsOf, readResponse, urlencodedBody } from "./html-form";
import type { Channel, ChannelDeps, LoadedFile, NeedsYouReason, Requirements, SubmitContext, SubmitResult } from "./types";

/*
 * CH2 — form adapters without a browser.
 *  - Google Forms: fields from the public page's data, one urlencoded POST to formResponse,
 *    Google's confirmation page as evidence. Forms that need a Google sign-in (verified email,
 *    file uploads) go to the person.
 *  - Plain HTML forms: fields parsed with cheerio, POSTed urlencoded or multipart with the
 *    prepared files, the response page read for a confirmation/reference (our sandbox prints
 *    #confirmation-ref).
 * CAPTCHA, login and payment markers stop it with a handoff; forms drawn by JavaScript only
 * (no real <form action>, Typeform/Tally/Jotform…) go to the browser agent (CH3) when it is on,
 * otherwise to the handoff.
 */

/* ------------------------------------------------------------------ analyze */

function baseRequirements(opp: Opportunity, url: string | null): Requirements {
  return {
    channel: "CH2",
    fields: [],
    materials: [...opp.requiredMaterials],
    questions: [],
    requiresAccount: opp.apply.requiresAccount,
    requiresPayment: opp.apply.requiresPayment,
    captchaLikely: opp.apply.captchaLikely,
    ...(url ? { submitUrl: url } : {}),
    notes: [],
  };
}

function fallbackFields(opp: Opportunity): Requirements["fields"] {
  return opp.apply.fieldsSchema.map((f) => ({
    name: f.name,
    label: f.label,
    type: f.type,
    required: f.required,
    ...(f.options ? { options: f.options.map((o) => o.label), choices: f.options } : {}),
    ...(f.maxLength ? { maxLength: f.maxLength } : {}),
    ...(f.profilePath ? { profilePath: f.profilePath } : {}),
  }));
}

/** The form URL for this application (the sandbox gets `?app=` so the submission is traceable). */
export function formUrlFor(opp: Pick<Opportunity, "apply" | "url">, applicationId?: string): string | null {
  const stored = opp.apply.url ?? opp.url;
  if (!stored) return null;
  // The practice sandbox is this deployment's own (preview and local runs never write to production).
  const raw = localSandboxUrl(stored);
  try {
    const u = new URL(raw);
    if (applicationId && u.pathname.replace(/\/$/, "") === "/sandbox/form" && isTrustedOrigin(u.toString())) u.searchParams.set("app", applicationId);
    return u.toString();
  } catch {
    return null;
  }
}

async function analyze(opp: Opportunity): Promise<Requirements> {
  const url = formUrlFor(opp);
  const req = baseRequirements(opp, url);
  if (!url) return { ...req, fields: fallbackFields(opp), notes: ["This opportunity has no application link yet."] };
  const jsHost = jsOnlyFormHost(url);
  if (jsHost) {
    return {
      ...req,
      fields: fallbackFields(opp),
      notes: ["This form builder draws its questions with JavaScript; we fill it in a browser (or hand it to you with every answer ready)."],
    };
  }
  try {
    const page = await channelGet(url);
    if (isGoogleFormUrl(url) || isGoogleFormUrl(page.url)) {
      if (isGoogleSignInPage(page.url, page.html)) {
        return { ...req, fields: fallbackFields(opp), requiresAccount: true, notes: ["This Google Form asks you to sign in to Google, so you'll submit it yourself — every answer will be ready to copy."] };
      }
      const form = parseGoogleForm(page.html, page.url);
      if (!form) return { ...req, fields: fallbackFields(opp), notes: ["We couldn't read this Google Form's questions in advance."] };
      const fields = googleFormRequirements(form);
      return {
        ...req,
        fields,
        questions: questionsOf(fields),
        materials: materialsFor(fields, req.materials),
        requiresAccount: req.requiresAccount || form.requiresLogin,
        submitUrl: page.url,
        notes: form.requiresLogin ? ["This Google Form needs you to be signed in to Google (it collects verified emails or files), so you'll press Submit yourself."] : [],
      };
    }
    const blockers = detectBlockers(page.html);
    const form = pickMainForm(parseHtmlForms(page.html, page.url));
    const fields = form ? formToRequirements(form) : fallbackFields(opp);
    const notes: string[] = [];
    if (blockers.captcha) notes.push("This form uses a CAPTCHA, so you'll press Submit yourself — every answer will be ready to copy.");
    if (blockers.login) notes.push("This site asks you to sign in first; that step is yours.");
    if (blockers.payment) notes.push("This form takes a payment; you pay on the official page yourself.");
    if (!form || !form.hasAction) notes.push("This form is drawn by JavaScript; we fill it in a browser (or hand it to you with every answer ready).");
    return {
      ...req,
      fields,
      questions: questionsOf(fields),
      materials: materialsFor(fields, req.materials),
      captchaLikely: req.captchaLikely || blockers.captcha,
      requiresAccount: req.requiresAccount || blockers.login,
      requiresPayment: req.requiresPayment || blockers.payment,
      submitUrl: page.url,
      notes,
    };
  } catch (err) {
    return { ...req, fields: fallbackFields(opp), notes: [`We couldn't read the form in advance: ${networkMessage(err)}`] };
  }
}

/* ------------------------------------------------------------------ submit */

function needsYou(ctx: SubmitContext, req: Requirements, reason: NeedsYouReason, note?: string): SubmitResult {
  const h = buildHandoff(ctx.opportunity, req, ctx.prepared.answers, ctx.prepared.files);
  return { status: "needs_you", reason, handoff: note ? { ...h, notes: [note, ...h.notes] } : h };
}

function problems(b: { missing: string[]; tooLong: string[]; unmatched: string[] }): string | null {
  const parts: string[] = [];
  if (b.missing.length) parts.push(`no answer yet for ${b.missing.join(", ")}`);
  if (b.tooLong.length) parts.push(`answers longer than the form allows: ${b.tooLong.join(", ")}`);
  if (b.unmatched.length) parts.push(`answers that match none of the form's choices: ${b.unmatched.join(", ")}`);
  return parts.length ? `Before we can submit: ${parts.join("; ").replace(/[.。]+$/, "")}.` : null;
}

async function delegateToBrowser(ctx: SubmitContext, url: string, req: Requirements, deps: ChannelDeps | undefined, note: string): Promise<SubmitResult> {
  const { browserAgentEnabled, submitWithBrowser } = await import("./ch3-browser");
  if (!browserAgentEnabled(deps)) return needsYou(ctx, req, "unsupported", note);
  return submitWithBrowser(ctx, url, { ...req, channel: "CH3" }, deps);
}

/** Google Forms: one POST to formResponse. */
async function submitGoogleForm(ctx: SubmitContext, page: { url: string; html: string }, req: Requirements): Promise<SubmitResult> {
  if (isGoogleSignInPage(page.url, page.html)) return needsYou(ctx, { ...req, requiresAccount: true }, "login", "This Google Form asks you to sign in to Google first.");
  const form = parseGoogleForm(page.html, page.url);
  if (!form) return needsYou(ctx, req, "unsupported", "We couldn't read this Google Form's questions.");
  const fields = googleFormRequirements(form);
  const fullReq = { ...req, fields };
  if (form.requiresLogin) return needsYou(ctx, { ...fullReq, requiresAccount: true }, "login", "This Google Form needs you to be signed in to Google (it collects verified emails or files).");
  const payload = buildGooglePayload(form, ctx.prepared.answers);
  const problem = problems({ ...payload, tooLong: [] });
  if (problem) return { status: "failed", error: problem, retryable: false };
  if (ctx.dryRun) {
    return { status: "submitted", evidence: { url: form.action, confirmationText: `Dry run — ${fields.length} questions mapped to the Google Form “${form.title}”. Nothing was submitted.` } };
  }
  const res = await channelPost(form.action, payload.body, "application/x-www-form-urlencoded");
  if (res.status >= 500 || res.status === 429) return { status: "failed", error: `Google Forms answered ${res.status}; we'll try again shortly.`, retryable: true };
  if (isGoogleSignInPage(res.url, res.html)) return needsYou(ctx, { ...fullReq, requiresAccount: true }, "login", "Google asked for a sign-in when we submitted.");
  if (res.status >= 400) return { status: "failed", error: `Google Forms refused the answers (${res.status}). Check the answers against the form's rules.`, retryable: false };
  const done = readGoogleConfirmation(res.html);
  if (!done.confirmed) {
    const again = readResponse(res.html);
    return { status: "failed", error: again.errors.length ? `The form came back with: ${again.errors.slice(0, 3).join(" · ")}` : "Google Forms didn't show its confirmation page, so we can't confirm the submission.", retryable: false };
  }
  return { status: "submitted", evidence: { url: res.url, confirmationText: done.text ?? "Your response has been recorded." } };
}

async function submitHtml(ctx: SubmitContext, page: { url: string; html: string }, req: Requirements, files: LoadedFile[], deps: ChannelDeps | undefined): Promise<SubmitResult> {
  const blockers = detectBlockers(page.html);
  const form = pickMainForm(parseHtmlForms(page.html, page.url));
  const fullReq: Requirements = { ...req, fields: form ? formToRequirements(form) : req.fields, captchaLikely: req.captchaLikely || blockers.captcha };
  if (blockers.captcha) return needsYou(ctx, fullReq, "captcha", "The form has a CAPTCHA; only you can solve it.");
  if (blockers.login) return needsYou(ctx, { ...fullReq, requiresAccount: true }, "login");
  if (blockers.payment) return needsYou(ctx, { ...fullReq, requiresPayment: true }, "payment");
  if (!form || !form.hasAction || form.method !== "POST") {
    return delegateToBrowser(ctx, page.url, fullReq, deps, "This form only works with JavaScript in a browser, so it's yours to submit — every answer is ready.");
  }
  const built = buildFormEntries(form, ctx.prepared.answers, files);
  const problem = problems(built);
  if (problem) return { status: "failed", error: problem, retryable: false };
  if (ctx.dryRun) {
    return { status: "submitted", evidence: { url: form.action, confirmationText: `Dry run — ${built.entries.length} values ready for ${new URL(form.action).host}. Nothing was submitted.` } };
  }
  const hasFiles = built.entries.some(([, v]) => typeof v !== "string");
  const { body, contentType } =
    form.enctype === "multipart/form-data" || hasFiles ? await multipartBody(built.entries) : { body: urlencodedBody(built.entries), contentType: "application/x-www-form-urlencoded" };
  const res = await channelPost(form.action, body, contentType);
  if (res.status === 429 || res.status >= 500) return { status: "failed", error: `The form's site answered ${res.status}; we'll try again shortly.`, retryable: true };
  const reading = readResponse(res.html, form.fields.map((f) => f.name));
  if (res.status >= 400 || (reading.formAgain && reading.errors.length)) {
    return {
      status: "failed",
      error: reading.errors.length ? `The form came back with: ${reading.errors.slice(0, 4).join(" · ")}` : `The form's site refused the submission (${res.status}).`,
      retryable: false,
    };
  }
  if (detectBlockers(res.html).captcha) return needsYou(ctx, { ...fullReq, captchaLikely: true }, "captcha", "The site asked for a CAPTCHA after we submitted.");
  return {
    status: "submitted",
    evidence: {
      url: res.url,
      ...(reading.ref ? { ref: reading.ref } : {}),
      ...(reading.confirmationText ? { confirmationText: reading.confirmationText } : {}),
    },
  };
}

export const ch2Forms: Channel = {
  id: "CH2",
  analyze,
  async submit(ctx, deps) {
    const url = formUrlFor(ctx.opportunity, ctx.application.id);
    const req = { ...baseRequirements(ctx.opportunity, url), fields: fallbackFields(ctx.opportunity) };
    if (!url) return needsYou(ctx, req, "unsupported", "There is no application link to submit to.");
    if (forbiddenPlatform(url, ctx.opportunity.apply.platform)) return needsYou(ctx, req, "blocked");
    if (jsOnlyFormHost(url)) return delegateToBrowser(ctx, url, req, deps, "This form builder only works in a browser, so it's yours to submit — every answer is ready.");

    const { loaded, missing } = await loadPreparedFiles(ctx.userId, ctx.prepared.files, deps?.loadFile ?? loadPreparedFile);
    if (missing.length) return { status: "failed", error: `These files couldn't be loaded: ${missing.join(", ")}. Re-render them and try again.`, retryable: true };

    try {
      const page = await channelGet(url);
      if (page.status === 404 || page.status === 410) return { status: "failed", error: "The application form is gone (the page no longer exists). The opportunity may have closed.", retryable: false };
      if (page.status >= 500 || page.status === 429) return { status: "failed", error: `The form's site answered ${page.status}; we'll try again shortly.`, retryable: true };
      if (isGoogleFormUrl(url) || isGoogleFormUrl(page.url)) return await submitGoogleForm(ctx, page, req);
      return await submitHtml(ctx, page, req, loaded, deps);
    } catch (err) {
      if (!isRetryableNetwork(err)) return needsYou(ctx, req, "blocked", networkMessage(err));
      await captureError(err, { route: "channels.ch2.submit", severity: "warn", context: { applicationId: ctx.application.id } });
      return { status: "failed", error: networkMessage(err), retryable: true };
    }
  },
};
