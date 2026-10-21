import "server-only";
import { getOpportunityType, isOpportunityTypeId } from "@/lib/core";
import { buildHandoff } from "./handoff";
import type { Channel, Requirements } from "./types";

/*
 * CH5 — documents only. The package is the rendered files (drafted from sourced facts by P3a's
 * documents module): nothing is sent anywhere. The person downloads them and uses them where
 * they apply; the application counts as submitted when they tap "I used them" (P3a records it
 * as a user-confirmed handoff).
 */

function materialsOf(type: string, required: readonly string[]): string[] {
  if (required.length) return [...required];
  return isOpportunityTypeId(type) ? [...getOpportunityType(type).materials] : [];
}

export const ch5Docs: Channel = {
  id: "CH5",
  async analyze(opp): Promise<Requirements> {
    return {
      channel: "CH5",
      fields: [],
      materials: materialsOf(opp.type, opp.requiredMaterials),
      questions: [],
      requiresAccount: opp.apply.requiresAccount,
      requiresPayment: opp.apply.requiresPayment,
      captchaLikely: false,
      ...(opp.apply.url ?? opp.url ? { submitUrl: (opp.apply.url ?? opp.url) as string } : {}),
      notes: ["We draft every document from your sourced facts. You download them and use them where you apply — nothing is sent for you."],
    };
  },
  async submit(ctx) {
    const req = await ch5Docs.analyze(ctx.opportunity);
    return { status: "needs_you", reason: "unsupported", handoff: buildHandoff(ctx.opportunity, req, ctx.prepared.answers, ctx.prepared.files) };
  },
};
