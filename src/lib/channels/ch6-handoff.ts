import "server-only";
import { forbiddenPlatform } from "./detect";
import { buildHandoff } from "./handoff";
import { channelGet } from "./http";
import { formToRequirements, parseHtmlForms, pickMainForm, questionsOf } from "./html-form";
import { handoffReason } from "./select";
import type { Channel, Requirements } from "./types";

/*
 * CH6 — the handoff. For sites that need the person's own account or forbid automation, every
 * field, file and step is prepared in the target form's order; the person copies, submits and
 * taps "I submitted it". Always `needs_you`. We read a public form page (when the platform
 * allows it) only to order the fields like the real form; forbidden platforms are never fetched.
 */

export const ch6Handoff: Channel = {
  id: "CH6",
  async analyze(opp): Promise<Requirements> {
    const url = opp.apply.url ?? opp.url;
    const base: Requirements = {
      channel: "CH6",
      fields: opp.apply.fieldsSchema.map((f) => ({
        name: f.name,
        label: f.label,
        type: f.type,
        required: f.required,
        ...(f.options ? { options: f.options.map((o) => o.label), choices: f.options } : {}),
        ...(f.maxLength ? { maxLength: f.maxLength } : {}),
        ...(f.profilePath ? { profilePath: f.profilePath } : {}),
      })),
      materials: [...opp.requiredMaterials],
      questions: [],
      requiresAccount: opp.apply.requiresAccount,
      requiresPayment: opp.apply.requiresPayment,
      captchaLikely: opp.apply.captchaLikely,
      ...(url ? { submitUrl: url } : {}),
      notes: [],
    };
    if (!url || base.fields.length || forbiddenPlatform(url, opp.apply.platform)) return { ...base, questions: questionsOf(base.fields) };
    try {
      const page = await channelGet(url);
      const form = page.status < 400 ? pickMainForm(parseHtmlForms(page.html, page.url)) : null;
      if (!form) return base;
      const fields = formToRequirements(form);
      return { ...base, fields, questions: questionsOf(fields) };
    } catch {
      // Reading the page is a convenience for ordering fields; the handoff works without it.
      return base;
    }
  },
  async submit(ctx) {
    const req = await ch6Handoff.analyze(ctx.opportunity);
    return {
      status: "needs_you",
      reason: handoffReason(ctx.opportunity),
      handoff: buildHandoff(ctx.opportunity, req, ctx.prepared.answers, ctx.prepared.files),
    };
  },
};
