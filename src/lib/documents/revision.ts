import type { GeneratedBlock } from "@/lib/core/types";
import type { RevisedDocument } from "@/lib/llm/types";
import { isGapBlock, type StoredContent } from "./content";

/*
 * A revision as stored content (pure, used by revise.ts and its tests): the revised blocks with
 * their roles, gap blocks carrying their question in `label` (as composed ones do), and the
 * person's note appended to the document's history with what it changed.
 */

export function blockRole(content: StoredContent, b: GeneratedBlock, i: number): string {
  return content.meta.roles[i] || (isGapBlock(b) ? "gap" : b.type === "heading" ? "heading" : "body");
}

/** The revision as stored content: gap blocks carry their question in `label` (as composed ones do). */
export function revisedContent(previous: StoredContent, revised: RevisedDocument, note: string, at: Date): StoredContent {
  const questions = new Map<string, string>();
  const gapBlocks = revised.blocks.filter((b) => b.role === "gap");
  revised.gaps.forEach((g, i) => {
    if (gapBlocks[i]) questions.set(gapBlocks[i].text, g.question);
  });
  const blocks: GeneratedBlock[] = [];
  const roles: string[] = [];
  for (const b of revised.blocks) {
    const label = b.role === "gap" ? (b.label ?? questions.get(b.text)) : b.label;
    blocks.push({ type: b.type, ...(label ? { label } : {}), text: b.text, factIds: b.factIds, flags: b.flags });
    roles.push(b.role);
  }
  return {
    format: "blocks",
    blocks,
    meta: {
      ...previous.meta,
      label: revised.label,
      gaps: revised.gaps,
      roles,
      revisions: [...previous.meta.revisions, { note, changes: revised.changes, at: at.toISOString(), restore: false }],
      revisedFrom: null,
    },
  };
}
