/*
 * The built-in practice opportunity: an application to Onward Scout's own sandbox form
 * (/sandbox/form), so every person can watch the whole flow — profile, drafted answers, their
 * tap to confirm, submission, confirmation — without anything reaching a real organisation.
 * Free, never public, always open. Automated tests target it too.
 */
import { AVAILABILITY, SANDBOX_FIELD_LABELS, SANDBOX_FIELD_ORDER } from "@/app/sandbox/form/render";
import { applyInfoSchema, eligibilitySchema, opportunityBenefitsSchema, opportunityCostSchema, type FormField } from "@/lib/core/types";
import { contentHash } from "./normalize";
import type { MappedOpportunity } from "./types";

/** Same value as `PRACTICE_OPPORTUNITY_SLUG` in src/lib/opportunities (P2a). */
export const PRACTICE_SLUG = "practice-application";
export const PRACTICE_FORM_URL = "https://onwardscout.com/sandbox/form";
/** `sources.url` / `source_ref` of the practice opportunity. */
export const PRACTICE_SOURCE = { kind: "manual" as const, name: "Practice application (built in)", url: "seed://practice" };

const FIELD_SPEC: Record<string, Pick<FormField, "type" | "required"> & { profilePath?: string; accept?: string; help?: string }> = {
  full_name: { type: "text", required: true, profilePath: "/identity/name" },
  email: { type: "email", required: true, profilePath: "/identity/email" },
  phone: { type: "tel", required: false, profilePath: "/identity/phone" },
  location: { type: "text", required: true, profilePath: "/identity/location" },
  profile_url: { type: "url", required: false },
  resume: { type: "file", required: true, accept: ".pdf,.docx", help: "PDF or Word, up to 4 MB." },
  motivation: { type: "textarea", required: true },
  proud_project: { type: "textarea", required: true },
  availability: { type: "select", required: true },
  consent: { type: "checkbox", required: true, help: "Confirms this is a practice submission." },
};

/** The sandbox form's fields, in its own order (what CH2 will find on the page). */
export function practiceFields(): FormField[] {
  return SANDBOX_FIELD_ORDER.map((name) => {
    const spec = FIELD_SPEC[name];
    const field: FormField = { name, label: SANDBOX_FIELD_LABELS[name], type: spec.type, required: spec.required };
    if (spec.profilePath) field.profilePath = spec.profilePath;
    if (spec.accept) field.accept = spec.accept;
    if (spec.help) field.help = spec.help;
    if (name === "availability") field.options = AVAILABILITY.map((a) => ({ value: a.value, label: a.label }));
    if (name === "consent") field.options = [{ value: "yes", label: "Yes" }];
    return field;
  });
}

export function practiceOpportunity(now: Date): MappedOpportunity {
  const stored = {
    type: "practice" as const,
    name: "Practice application",
    orgName: "Onward Scout",
    orgSlug: "onward-scout",
    url: PRACTICE_FORM_URL,
    summary:
      "A safe dry run: Onward Scout prepares and submits a real application to its own sandbox form, so you can see every step — and what you tap — before anything goes to a real organisation.",
    description: [
      "This practice application goes to Onward Scout's own sandbox form, never to a real organisation. It is free and does not use a credit.",
      "You will see the whole flow: the answers drafted from your profile (each one shows where it came from), the questions only you can answer, the moment you confirm, the submission itself and the confirmation reference the form returns.",
      "The form asks for your name, email, location, résumé, why this opportunity, a project you are proud of, and when you could start — the same kinds of fields most real applications ask for.",
    ].join("\n\n"),
    benefits: opportunityBenefitsSchema.parse({ summary: "See the whole application flow end to end before you apply for real.", perks: ["no credit used", "nothing leaves Onward Scout"] }),
    cost: opportunityCostSchema.parse({ free: true }),
    geo: { countries: [], cities: [], remote: "remote" as const, worldwide: true },
    languages: ["en", "zh"],
    tags: ["practice", "sandbox"],
    industries: [],
    functions: [],
    eligibility: eligibilitySchema.parse({ identities: ["ALL"] }),
    deadline: null,
    rolling: true,
    cycle: null,
    apply: applyInfoSchema.parse({
      channel: "CH2",
      url: PRACTICE_FORM_URL,
      platform: "sandbox",
      fieldsSchema: practiceFields(),
      requiresAccount: false,
      requiresPayment: false,
      captchaLikely: false,
      instructions: "Practice only: submissions are stored by Onward Scout's sandbox and go nowhere else.",
    }),
    requiredMaterials: ["resume" as const],
    estAcceptanceRate: null,
    estEffortMinutes: 2,
    public: false,
  };
  return {
    sourceRef: PRACTICE_SLUG,
    hash: contentHash({ v: 1, ...stored }),
    raw: { url: PRACTICE_FORM_URL, httpStatus: null, contentType: null, title: stored.name, text: null, data: { builtIn: true } },
    draft: { ...stored, slug: PRACTICE_SLUG, sourceRef: PRACTICE_SLUG, qualityScore: 100, verifiedAt: now, status: "active" },
  };
}
