import { getMaterial, isMaterialId } from "@/lib/core/materials";
import { getOpportunityType, isOpportunityTypeId } from "@/lib/core/opportunity-types";
import { kindForMaterial } from "@/lib/documents/build";

/* The listing's "apply for me" promise (pure): it names only materials Onward Scout really drafts for that kind of programme. */

const STARTUP_TYPES = new Set(["accelerator", "incubator", "pitch_event", "startup_competition", "investor"]);

/** How a material reads in the promise (what we actually hand over), else its own label. */
const PHRASE: Partial<Record<string, string>> = {
  resume: "tailored résumé",
  resume_variant: "tailored résumé",
  cv: "CV",
  personal_statement: "personal statement",
  recommendation_letters: "notes for your referees",
  application_form: "application answers",
  grant_application: "application narrative",
};

function phraseOf(m: string): string {
  if (PHRASE[m]) return PHRASE[m]!;
  return isMaterialId(m) ? getMaterial(m).label.en.replace(/\s*\(.*\)$/, "").toLowerCase() : m.replace(/_/g, " ");
}

/** "a, b and c" */
function listOf(items: string[]): string {
  return items.length <= 1 ? (items[0] ?? "") : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

/** What Onward Scout drafts for this kind of programme, in one sentence (only materials it really composes). */
export function applyPromise(type: string): string {
  if (type === "returnship") return "A returner résumé, a cover letter and a career-break note for this programme, drafted from your own résumé in about two minutes.";
  if (STARTUP_TYPES.has(type)) return "A pitch deck and a one-pager for this programme, drafted from what you already have in about two minutes.";
  const drafted = isOpportunityTypeId(type)
    ? [...new Set(getOpportunityType(type).materials.filter((m) => kindForMaterial(m)).map(phraseOf))].slice(0, 3)
    : [];
  if (!drafted.length) return "The application for this programme drafted from your own documents in about two minutes, every answer with its source.";
  return `Your ${listOf(drafted)} for this programme, drafted from your own documents in about two minutes.`;
}
