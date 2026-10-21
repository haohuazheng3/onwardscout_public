import "server-only";
import { captureError } from "@/lib/errors";
import type { Opportunity } from "@/lib/db/schema";
import { atsApiUrl, atsHostedFormUrl, coordsOf, parseAshbyPosting, parseGreenhousePosting, parseLeverPosting, type AtsCoords, type AtsPosting } from "./ats";
import { browserAgentEnabled, submitWithBrowser } from "./ch3-browser";
import { detectBlockers, materialsFor } from "./detect";
import { buildHandoff } from "./handoff";
import { channelGet, channelGetJson, networkMessage } from "./http";
import { questionsOf } from "./html-form";
import type { Channel, Requirements } from "./types";

/*
 * CH1 — ATS-aware (Greenhouse, Lever, Ashby hosted postings). The public posting APIs give us
 * the posting and its questions, so every answer is prepared without a browser. Submission goes
 * through the employer's hosted form: by the browser agent (CH3) when it is enabled, the host is
 * the ATS's own and the page shows no CAPTCHA; otherwise a handoff ordered exactly like the real
 * form. Employer submission APIs need the employer's key — we never claim to use them.
 */

const PROVIDER_NAME = { greenhouse: "Greenhouse", lever: "Lever", ashby: "Ashby" } as const;

/** Reads the posting through its public API (plus Lever's public apply page for custom questions). */
export async function fetchAtsPosting(c: AtsCoords): Promise<AtsPosting | null> {
  const api = await channelGetJson(atsApiUrl(c));
  if (api.status === 404) return null;
  if (api.status >= 400 || api.json === null) throw new Error(`${PROVIDER_NAME[c.provider]} answered ${api.status}`);
  if (c.provider === "greenhouse") return parseGreenhousePosting(api.json);
  if (c.provider === "ashby") return parseAshbyPosting(api.json, c.postingId);
  let applyHtml: string | null = null;
  try {
    const page = await channelGet(atsHostedFormUrl(c));
    if (page.status < 400) applyHtml = page.html;
  } catch (err) {
    await captureError(err, { route: "channels.ch1.lever-apply", severity: "warn", context: { board: c.board } });
  }
  return parseLeverPosting(api.json, applyHtml);
}

function fallback(opp: Opportunity, notes: string[]): Requirements {
  return {
    channel: "CH1",
    fields: opp.apply.fieldsSchema.map((f) => ({
      name: f.name,
      label: f.label,
      type: f.type,
      required: f.required,
      ...(f.options ? { options: f.options.map((o) => o.label), choices: f.options } : {}),
    })),
    materials: [...opp.requiredMaterials],
    questions: [],
    requiresAccount: opp.apply.requiresAccount,
    requiresPayment: false,
    captchaLikely: true,
    ...(opp.apply.url ? { submitUrl: opp.apply.url } : opp.url ? { submitUrl: opp.url } : {}),
    notes,
  };
}

async function analyze(opp: Opportunity): Promise<Requirements> {
  const c = coordsOf(opp);
  if (!c) return fallback(opp, ["We couldn't identify this job's ATS posting; you'll get every answer ready to paste into the official form."]);
  try {
    const posting = await fetchAtsPosting(c);
    if (!posting) return fallback(opp, ["This posting is no longer on the employer's job board; it may have closed."]);
    return {
      channel: "CH1",
      fields: posting.fields,
      materials: materialsFor(posting.fields, opp.requiredMaterials.length ? opp.requiredMaterials : ["resume_variant"]),
      questions: questionsOf(posting.fields),
      requiresAccount: false,
      requiresPayment: false,
      captchaLikely: posting.captchaLikely,
      submitUrl: atsHostedFormUrl(c),
      notes: posting.notes,
    };
  } catch (err) {
    await captureError(err, { route: "channels.ch1.analyze", severity: "warn", context: { provider: c.provider, board: c.board } });
    return fallback(opp, [`We couldn't read the posting right now (${networkMessage(err)}); we'll try again when we prepare your application.`]);
  }
}

export const ch1Ats: Channel = {
  id: "CH1",
  analyze,
  async submit(ctx, deps) {
    const opp = ctx.opportunity;
    const c = coordsOf(opp);
    const req = await analyze(opp);
    const handoff = (note?: string) => {
      const h = buildHandoff(opp, req, ctx.prepared.answers, ctx.prepared.files);
      return note ? { ...h, notes: [note, ...h.notes] } : h;
    };
    if (!c) return { status: "needs_you", reason: "unsupported", handoff: handoff() };
    const formUrl = atsHostedFormUrl(c);
    if (!browserAgentEnabled(deps)) {
      return { status: "needs_you", reason: req.captchaLikely ? "captcha" : "unsupported", handoff: handoff() };
    }
    // Look at the hosted form before opening a browser: a CAPTCHA means the person submits.
    try {
      const page = await channelGet(formUrl);
      if (page.status === 404 || page.status === 410) return { status: "failed", error: "The job posting is gone; the role may have been filled.", retryable: false };
      const blockers = detectBlockers(page.html);
      if (blockers.captcha) return { status: "needs_you", reason: "captcha", handoff: handoff(`${PROVIDER_NAME[c.provider]} protects this form with a CAPTCHA, so you press Submit yourself.`) };
      if (blockers.login) return { status: "needs_you", reason: "login", handoff: handoff() };
    } catch (err) {
      return { status: "failed", error: networkMessage(err), retryable: true };
    }
    return submitWithBrowser(ctx, formUrl, { ...req, channel: "CH1" }, deps);
  },
};
