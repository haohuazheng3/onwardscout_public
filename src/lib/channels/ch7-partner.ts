import "server-only";
import { buildHandoff } from "./handoff";
import type { Channel, Requirements } from "./types";

/*
 * CH7 — partner API (organisations that connect to Onward Scout directly). Not available yet:
 * the interface exists so the orchestration never special-cases it; every submission is a
 * handoff until a partner is onboarded.
 */

const NOTE = "Direct submission to this organisation isn't available yet, so you submit it yourself — everything is ready.";

export const ch7Partner: Channel = {
  id: "CH7",
  async analyze(opp): Promise<Requirements> {
    return {
      channel: "CH7",
      fields: [],
      materials: [...opp.requiredMaterials],
      questions: [],
      requiresAccount: opp.apply.requiresAccount,
      requiresPayment: opp.apply.requiresPayment,
      captchaLikely: opp.apply.captchaLikely,
      ...(opp.apply.url ?? opp.url ? { submitUrl: (opp.apply.url ?? opp.url) as string } : {}),
      notes: [NOTE],
    };
  },
  async submit(ctx) {
    const req = await ch7Partner.analyze(ctx.opportunity);
    return { status: "needs_you", reason: "unsupported", handoff: buildHandoff(ctx.opportunity, req, ctx.prepared.answers, ctx.prepared.files) };
  },
};
