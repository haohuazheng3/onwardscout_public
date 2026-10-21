import "server-only";
import type { Opportunity } from "@/lib/db/schema";
import { ch1Ats } from "./ch1-ats";
import { ch2Forms } from "./ch2-forms";
import { ch3Browser } from "./ch3-browser";
import { ch4Email } from "./ch4-email";
import { ch5Docs } from "./ch5-docs";
import { ch6Handoff } from "./ch6-handoff";
import { ch7Partner } from "./ch7-partner";
import { resolveChannelId } from "./select";
import type { Channel, ChannelId } from "./types";

/*
 * Channels (docs/contracts-features.md §4) — the server entry point P3a's orchestration uses:
 *   const ch = channelFor(opp); const req = await ch.analyze(opp); … await ch.submit(ctx)
 * Types are also importable from "@/lib/channels/types" (client-safe), the pure handoff
 * builder from "@/lib/channels/handoff".
 *
 * Name clash: `getChannel` here returns the implementation; `getChannel` in @/lib/core returns
 * the display data (labels, automation level).
 */

export type {
  Channel,
  ChannelDeps,
  ChannelId,
  FieldRequirement,
  HandoffPackage,
  LoadedFile,
  NeedsYouReason,
  PersonContext,
  PreparedFile,
  PreparedPackage,
  Requirements,
  SubmitContext,
  SubmitResult,
} from "./types";
export { buildHandoff, buildMailtoHandoff, displayValue } from "./handoff";
export { handoffReason, resolveChannelId } from "./select";
export { OUTREACH_LIMITS, checkFollowUpPolicy, checkOutreachPolicy, isOptOut } from "./outreach-policy";
export { browserAgentEnabled, runBrowserAgent } from "./ch3-browser";

export const CHANNEL_REGISTRY: Readonly<Record<ChannelId, Channel>> = {
  CH1: ch1Ats,
  CH2: ch2Forms,
  CH3: ch3Browser,
  CH4: ch4Email,
  CH5: ch5Docs,
  CH6: ch6Handoff,
  CH7: ch7Partner,
};

export function getChannel(id: ChannelId): Channel {
  return CHANNEL_REGISTRY[id] ?? ch6Handoff;
}

/** `apply.channel`, else the type's default — corrected for forbidden platforms and JS-only forms (see select.ts). */
export function channelFor(opp: Opportunity): Channel {
  return getChannel(resolveChannelId(opp));
}
