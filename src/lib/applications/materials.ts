import { isMaterialId, materialLabel } from "@/lib/core/materials";
import type { ApplicationQuestion } from "@/lib/core/types";

/*
 * Files only the person holds (a transcript, a demo video, work samples…), pure and client-safe.
 * They never hold the drafts back: the application moves on and they wait in the room's file list
 * with an upload control. A file the organiser needs to accept the application is "needed to
 * submit" (confirm waits for it on the channels we submit through; on a handoff the person
 * attaches it on the official form); a deliverable made later — a hackathon's demo video and
 * project, a demo "if we ask" — is a "later" item that never blocks anything.
 */

/** Deliverables a hackathon asks for at the end, built during the event. */
const HACKATHON_LATER = new Set(["demo_video", "work_samples", "product_images", "portfolio"]);
/** A startup's demo and product shots: asked for by the programme when it wants them. */
const VENTURE_LATER = new Set(["demo_video", "product_images"]);
const VENTURE_TYPES = new Set(["accelerator", "incubator", "startup_competition", "pitch_event", "investor", "government_program", "crowdfunding", "cofounder_match"]);

/** A file the organiser wants later (or only if they ask), not to accept the application. */
export function laterMaterial(material: string, oppType: string | null | undefined): boolean {
  const type = oppType ?? "";
  if (material === "demo_video") return true;
  if (type === "hackathon") return HACKATHON_LATER.has(material);
  return VENTURE_TYPES.has(type) && VENTURE_LATER.has(material);
}

/** The material a file question asks for ("material:demo_video" → "demo_video"), else null (a form's own file field). */
export function materialOf(q: Pick<ApplicationQuestion, "id" | "fieldName">): string | null {
  const key = q.fieldName ?? q.id;
  return key.startsWith("material:") ? key.slice("material:".length) : null;
}

/** What the file is called ("Transcript"), else the question's own words (a form's file field). */
export function fileName(q: Pick<ApplicationQuestion, "id" | "fieldName" | "prompt">, lang: "en" | "zh"): string {
  const m = materialOf(q);
  return m && isMaterialId(m) ? materialLabel(m, lang) : q.prompt;
}

/** File questions still open, split the way the room shows them. */
export function fileItems(questions: ApplicationQuestion[], oppType: string | null | undefined): { needed: ApplicationQuestion[]; later: ApplicationQuestion[]; optional: ApplicationQuestion[] } {
  const files = questions.filter((q) => q.kind === "file");
  const needed = files.filter((q) => q.required !== false);
  const rest = files.filter((q) => q.required === false);
  const isLater = (q: ApplicationQuestion) => {
    const m = materialOf(q);
    return Boolean(m && laterMaterial(m, oppType));
  };
  return { needed, later: rest.filter(isLater), optional: rest.filter((q) => !isLater(q)) };
}

/** Confirm waits for needed files only where we submit them ourselves (a handoff is attached by the person). */
export function filesBlockConfirm(app: { channel: string; practice: boolean }): boolean {
  return !app.practice && app.channel !== "CH6";
}

/** A link stands in for a file (a demo video on YouTube, a repository). */
export function isLinkAnswer(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\/[^\s]+\.[^\s]+$/i.test(value.trim());
}
