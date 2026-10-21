/**
 * The Scout board's six type groups, derived from the opportunity-type groups of
 * src/lib/core/opportunity-types.ts. The core has ten groups (work, venture, funding, academic,
 * education, creative, visibility, community, mobility, system); a phone screen holds six chips,
 * so they fold together by what the person does next:
 *
 *   jobs      ← work
 *   funding   ← funding + venture programs (investors, accelerators, grants, fellowships…)
 *   stages    ← things you enter or appear at: competitions, hackathons, pitch events, trade
 *               shows, awards-as-entries are funding; talks, media, podcasts, events
 *   academic  ← academic
 *   creative  ← creative
 *   learning  ← education + community + mobility
 *
 * `practice` (system) belongs to no chip: it is pinned on top for people who have not applied yet.
 * Pure and client-safe.
 */
import { OPPORTUNITY_TYPES } from "@/lib/core/opportunity-types";
import type { OpportunityGroup, OpportunityTypeId } from "@/lib/core/types";

export const BOARD_GROUPS = ["jobs", "funding", "stages", "academic", "creative", "learning"] as const;
export type BoardGroup = (typeof BOARD_GROUPS)[number];

const BY_CORE_GROUP: Record<OpportunityGroup, BoardGroup | null> = {
  work: "jobs",
  venture: "funding",
  funding: "funding",
  academic: "academic",
  education: "learning",
  creative: "creative",
  visibility: "stages",
  community: "learning",
  mobility: "learning",
  system: null,
};

/** Types whose core group says "funding/venture" or "community" but which you enter or appear at. */
const STAGE_TYPES: ReadonlySet<OpportunityTypeId> = new Set<OpportunityTypeId>([
  "startup_competition",
  "pitch_event",
  "exhibition",
  "competition",
  "hackathon",
  "event",
]);

export function isBoardGroup(v: unknown): v is BoardGroup {
  return typeof v === "string" && (BOARD_GROUPS as readonly string[]).includes(v);
}

const TYPE_GROUP = new Map<OpportunityTypeId, BoardGroup | null>(
  OPPORTUNITY_TYPES.map((t) => [t.id, STAGE_TYPES.has(t.id) ? "stages" : BY_CORE_GROUP[t.group]]),
);

/** The chip a type belongs to; null for `practice`. */
export function boardGroupOfType(type: OpportunityTypeId | string): BoardGroup | null {
  return TYPE_GROUP.get(type as OpportunityTypeId) ?? null;
}

/** Every type in a chip, in taxonomy order. */
export function typesInBoardGroup(group: BoardGroup): OpportunityTypeId[] {
  return OPPORTUNITY_TYPES.filter((t) => TYPE_GROUP.get(t.id) === group).map((t) => t.id);
}

/** Folds per-type counts into per-chip counts (unknown types and `practice` are skipped). */
export function groupCounts(byType: Record<string, number>): Record<BoardGroup, number> {
  const out = Object.fromEntries(BOARD_GROUPS.map((g) => [g, 0])) as Record<BoardGroup, number>;
  for (const [type, n] of Object.entries(byType)) {
    const g = boardGroupOfType(type);
    if (g) out[g] += n;
  }
  return out;
}
