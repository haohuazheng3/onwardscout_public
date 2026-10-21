/*
 * Which channel an opportunity goes through — pure, so the routing rules are pinned by tests.
 *
 *  1. Platforms that forbid server-side automation (LinkedIn, Indeed, Workday, Common App,
 *     academic submission systems, government portals…) always use the handoff (CH6).
 *  2. Otherwise `apply.channel` as the source recorded it, else the opportunity type's default.
 *  3. Adjustments that keep the promise honest: CH1 without a recognisable ATS posting becomes
 *     the browser agent (CH3) on the apply page, or the handoff without one; CH2 on a form
 *     builder that only works with JavaScript (Typeform, Tally, Jotform…) becomes CH3.
 */
import { getOpportunityType, isOpportunityTypeId, type ChannelId } from "@/lib/core";
import type { ApplyInfo } from "@/lib/core/types";
import { coordsOf } from "./ats";
import { forbiddenPlatform, jsOnlyFormHost } from "./detect";
import type { HandoffPackage, NeedsYouReason } from "./types";

export interface RoutableOpportunity {
  type: string;
  url: string | null;
  apply: Pick<ApplyInfo, "channel" | "url" | "platform" | "ats" | "requiresAccount" | "requiresPayment" | "captchaLikely"> & Partial<ApplyInfo>;
}

export function resolveChannelId(opp: RoutableOpportunity): ChannelId {
  const url = opp.apply.url ?? opp.url;
  if (forbiddenPlatform(url, opp.apply.platform)) return "CH6";
  const fallback: ChannelId = isOpportunityTypeId(opp.type) ? getOpportunityType(opp.type).defaultChannel : "CH6";
  const id: ChannelId = opp.apply.channel ?? fallback;
  if (id === "CH1" && !coordsOf({ apply: { ats: opp.apply.ats ?? null, url: opp.apply.url }, url: opp.url })) return url ? "CH3" : "CH6";
  if (id === "CH2" && jsOnlyFormHost(url)) return "CH3";
  if ((id === "CH2" || id === "CH3") && !url) return "CH6";
  return id;
}

/** Why a handoff-only opportunity needs the person (CH6's `needs_you` reason). */
export function handoffReason(opp: RoutableOpportunity): NeedsYouReason {
  const url = opp.apply.url ?? opp.url;
  if (forbiddenPlatform(url, opp.apply.platform)) return "blocked";
  if (opp.apply.requiresAccount) return "login";
  if (opp.apply.requiresPayment) return "payment";
  if (opp.apply.captchaLikely) return "captcha";
  return "unsupported";
}

/** Adds a leading note to a handoff (without duplicating it). */
export function withNote(h: HandoffPackage, note: string | null | undefined): HandoffPackage {
  if (!note || h.notes.includes(note)) return h;
  return { ...h, notes: [note, ...h.notes] };
}
