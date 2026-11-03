import { BLOCK_ROLES, ReviseDocumentInput, type BlockRole, type ComposedBlock, type RevisedDocument, type Tone } from "../types";
import { hasCjk } from "./text";

/*
 * The deterministic engine's answer to "change this draft": it cannot rewrite prose from a free
 * note, so it does the part it can do honestly — shortening (each paragraph keeps its first
 * sentences, each section its first points) — and otherwise returns the document unchanged with
 * applied = false. The documents module then acts on what a re-draft can do (another language,
 * another tone: `feedbackIntent`) or tells the person to edit the sentence directly.
 */

export interface FeedbackIntent {
  shorter: boolean;
  language: "en" | "zh" | null;
  tone: Tone | null;
}

/** What a note asks for that a re-draft can do without understanding the rest of it. */
export function feedbackIntent(feedback: string): FeedbackIntent {
  const f = feedback.toLowerCase();
  const language = /中文|汉语|chinese|简体/.test(f) ? "zh" : /英文|英语|\benglish\b/.test(f) ? "en" : null;
  const shorter = /\bshort(er|en)?\b|\bconcise\b|\btighten\b|\btrim\b|\bbrief(er)?\b|\bcut\b|简洁|精简|简短|短一?[点些]|缩短|删减|压缩/.test(f);
  const tone: Tone | null = /\bwarm(er)?\b|\bfriendl|亲切|温暖|热情/.test(f)
    ? "warm"
    : /\bconfident\b|\bbold(er)?\b|\benthusias|\benergetic\b|自信|有力|激情/.test(f)
      ? "enthusiastic"
      : /\bformal\b|\bprofessional\b|正式|专业/.test(f)
        ? "professional"
        : null;
  return { shorter, language, tone };
}

const SENTENCE = /(?<=[.!?。！？])\s*/;

function roleOf(role: string): BlockRole {
  return (BLOCK_ROLES as readonly string[]).includes(role) ? (role as BlockRole) : "body";
}

export function localReviseDocument(raw: ReviseDocumentInput): RevisedDocument {
  const input = ReviseDocumentInput.parse(raw);
  const zh = input.language === "zh" || hasCjk(input.feedback);
  const blocks: ComposedBlock[] = input.blocks.map((b) => ({ type: b.type, role: roleOf(b.role), ...(b.label ? { label: b.label } : {}), text: b.text, factIds: b.factIds, flags: b.flags }));
  const gaps = blocks.filter((b) => b.role === "gap").map((b) => ({ key: b.label ?? "gap", question: b.label ?? b.text }));
  const unchanged = (reason: string): RevisedDocument => ({ applied: false, title: input.title, language: input.language, blocks, gaps, changes: [], reason, label: "drafted_from_profile" });

  if (!feedbackIntent(input.feedback).shorter) {
    return unchanged(zh ? "现在无法按这条意见自动修改。你可以直接点开任意一句修改。" : "This note can't be applied automatically right now. You can edit any sentence directly.");
  }

  let removed = 0;
  let pointsInSection = 0;
  const out: ComposedBlock[] = [];
  for (const b of blocks) {
    if (b.type === "heading") {
      pointsInSection = 0;
      out.push(b);
      continue;
    }
    // The person's own words and the spots only they can fill are never cut.
    if (b.role !== "body" || b.factIds.includes("user:confirmed")) {
      out.push(b);
      continue;
    }
    if (b.type === "bullet") {
      pointsInSection++;
      if (pointsInSection > 3) {
        removed++;
        continue;
      }
      out.push(b);
      continue;
    }
    if (b.type === "paragraph") {
      const sentences = b.text.split(SENTENCE).filter((x) => x.trim());
      if (sentences.length > 1) {
        const keep = Math.ceil(sentences.length / 2);
        removed += sentences.length - keep;
        out.push({ ...b, text: sentences.slice(0, keep).join(zh || hasCjk(b.text) ? "" : " ") });
        continue;
      }
    }
    out.push(b);
  }
  if (!removed) return unchanged(zh ? "这份材料已经很精简了，没有可以再删的句子。" : "This draft is already as short as it can be without losing a point.");
  return {
    applied: true,
    title: input.title,
    language: input.language,
    blocks: out,
    gaps,
    changes: [zh ? `精简了 ${removed} 处（每段保留最重要的句子，每页最多 3 个要点）` : `Shortened in ${removed} place${removed === 1 ? "" : "s"} (each paragraph keeps its key sentences, each section at most 3 points)`],
    reason: null,
    label: "drafted_from_profile",
  };
}
