import { functionLabel, isFunctionId } from "@/lib/core/functions";
import { industryLabel, isIndustryCode } from "@/lib/core/industries";
import { getMaterial, isMaterialId } from "@/lib/core/materials";
import type { ApplicationAnswer, ApplicationAnswers, ApplicationQuestion, GeneratedDocumentKind, Option, Profile } from "@/lib/core/types";
import { kindForMaterial, OPTIONAL_GAP_KEYS } from "@/lib/documents/build";
import { classifyQuestion } from "@/lib/llm/local/compose";
import { fieldKey } from "@/lib/llm/local/forms";
import type { FieldMapping, QuestionAnswer } from "@/lib/llm/types";
import type { FieldRequirement, RequirementsLike } from "./types";

/*
 * Gap analysis (plan §8.4): ask only what this application needs and the profile cannot answer.
 * Pure: the prepare job feeds it the channel's requirements, the intelligence layer's field
 * mappings and question drafts, the person's earlier answers and the files on record.
 *
 * Choice first. A question becomes a set of chips whenever options can be derived — from the
 * form itself, from the profile ("is this your email?"), from earlier answers, or from common
 * answers (availability, work authorisation…). Free text only when unavoidable, and then with a
 * draft from the profile the person can keep, edit or rewrite. Motivation is never drafted:
 * the person picks their own reasons (or writes them).
 */

type Lang = "en" | "zh";

export interface GapOpportunity {
  id: string;
  type: string;
  name: string;
  orgName?: string | null;
  requiredMaterials?: string[] | null;
  industries?: string[] | null;
  functions?: string[] | null;
  tags?: string[] | null;
  geo?: { remote?: string | boolean | null; cities?: string[]; countries?: string[] } | null;
}

export interface GapInput {
  language: Lang;
  opportunity: GapOpportunity;
  requirements: RequirementsLike;
  /** intelligence.mapFormFields over requirements.fields (any order). */
  mappings: FieldMapping[];
  /** intelligence.answerQuestions over requirements.questions and long free-text fields (keyed by id / field name). */
  drafts: QuestionAnswer[];
  /** Answers already stored on this application. */
  answers: ApplicationAnswers;
  /** The person's most recent confirmed answers on other applications, by semantic key (fieldKey). */
  previous?: Record<string, string>;
  /** Files on record (the `documents` table). */
  documentsOnFile: { id: string; kind: string; filename?: string | null }[];
  profile: Profile;
  /** The signed-in email, offered as a one-tap option for email fields. */
  accountEmail?: string | null;
  /** True when the channel sends email (CH4): the outreach email is composed. */
  outreach?: boolean;
  /** Drafts came from the AI provider (Claude), not the local templates: say so. */
  aiDrafts?: boolean;
}

export interface ComposePlan {
  kind: GeneratedDocumentKind;
  material: string | null;
}

export interface GapResult {
  questions: ApplicationQuestion[];
  /** Values settled without asking (profile facts, earlier confirmed answers, drafts). */
  autoAnswers: ApplicationAnswers;
  /** Documents to compose (deduplicated). */
  compose: ComposePlan[];
  /** Files on record to attach, by field / material. */
  attach: { field: string; documentId: string }[];
}

/* ------------------------------------------------------------------ copy */

const T = {
  why: {
    field: { en: "The form asks for this and your profile doesn't say it yet. You answer once; we reuse it next time.", zh: "表单需要这一项，档案里还没有。只需回答一次，下次自动带上。" },
    confirmProfile: { en: "We found this in your profile. Tap to confirm it for this form.", zh: "档案里有这一项，点一下确认用于这份申请。" },
    consent: { en: "Only you can agree to the organiser's terms.", zh: "主办方的条款只能由你本人同意。" },
    voluntary: { en: "Voluntary self-identification: only you answer it, and you can decline.", zh: "自愿填写的个人信息，只能由你本人回答，也可以选择不填。" },
    signature: { en: "A signature must be yours. Confirm the name to sign with.", zh: "签名必须由你本人确认。" },
    motivation: { en: "We never write your motivation for you. Pick what's true for you, or write one sentence.", zh: "我们从不替你编写动机。选出符合你真实想法的理由，或自己写一句。" },
    draft: { en: "Drafted from your profile. Keep it, edit it, or ask for a rewrite.", zh: "根据你的档案起草。可以保留、修改或重写。" },
    draftAi: { en: "Written with AI from your profile's facts. Keep it, edit it, or ask for a rewrite.", zh: "由 AI 根据你档案中的事实撰写。可以保留、修改或重写。" },
    file: { en: "Only you hold this file. Upload it once; it stays on your profile for later applications.", zh: "这份文件只有你有。上传一次，之后的申请会自动复用。" },
    fileOptional: { en: "Optional, but it strengthens the application.", zh: "可选，但能让申请更有说服力。" },
    ownWords: { en: "Only you can write this part. One or two sentences are enough.", zh: "这一部分只能由你来写，一两句话就够了。" },
  },
  motivationPrompt: { en: "Why are you applying to {target}?", zh: "你为什么申请{target}？" },
  ownSection: {
    talk_abstract: { en: "What is your talk called, and what will the audience take away?", zh: "你的演讲题目是什么？听众会收获什么？" },
    book_idea: { en: "What is the book about, and who is it for?", zh: "这本书讲什么、写给谁？" },
    announcement: { en: "What is the news you want to announce?", zh: "你要发布的消息是什么？" },
  } as Record<string, { en: string; zh: string }>,
  upload: { en: "Upload your {material}", zh: "上传你的{material}" },
};

const t = (x: { en: string; zh: string }, lang: Lang, vars: Record<string, string> = {}) => x[lang].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

const opt = (value: string, label = value): Option => ({ value, label });

/* ------------------------------------------------------------------ presets (common answers) */

const PRESETS: Record<string, { en: string[]; zh: string[] }> = {
  availability: { en: ["Immediately", "In 2 weeks", "In 1 month", "In 1–3 months", "Later than 3 months"], zh: ["随时可以开始", "两周内", "一个月内", "一到三个月", "三个月以后"] },
  work_authorization: { en: ["Yes", "No"], zh: ["是", "否"] },
  sponsorship: { en: ["Yes", "No"], zh: ["需要", "不需要"] },
  years_experience: { en: ["Less than 1 year", "1–2 years", "3–5 years", "6–10 years", "More than 10 years"], zh: ["不到 1 年", "1–2 年", "3–5 年", "6–10 年", "10 年以上"] },
  referral_source: { en: ["Onward Scout", "The organiser's website", "LinkedIn", "A job board or listing site", "A friend or colleague"], zh: ["Onward Scout", "官方网站", "领英", "招聘或活动平台", "朋友或同事推荐"] },
  salary: { en: ["Open to discussion"], zh: ["面议"] },
};

/** Keys whose answers are about the person, not the opportunity: safe to reuse on the next form. */
const REUSABLE = new Set([
  "availability", "work_authorization", "sponsorship", "years_experience", "salary", "location", "city", "country", "phone", "full_name", "first_name", "last_name",
  "email", "linkedin_url", "github_url", "portfolio_url", "scholar_url", "orcid", "school", "degree", "field_of_study", "graduation_date", "gpa", "current_company", "current_title",
  "startup_name", "one_liner", "stage", "raising", "team_size",
]);

/** Fields the composer turns into documents: a planned document satisfies them. */
const FILE_FROM_DOCUMENT: Record<string, GeneratedDocumentKind> = { resume: "resume_variant", cover_letter: "cover_letter", pitch_deck: "pitch_notes" };

/** Which uploaded document kinds can stand in for a material the person supplies. */
const MATERIAL_DOC_KINDS: Record<string, string[]> = {
  transcript: ["transcript"],
  test_scores: ["certificate", "transcript", "other"],
  license: ["license"],
  certificate: ["certificate"],
  paper: ["paper"],
  abstract: ["paper"],
  portfolio: ["portfolio", "link"],
  work_samples: ["portfolio", "link", "other"],
  product_images: ["portfolio", "other"],
  demo_video: ["link", "other"],
  financial_summary: ["business_plan", "other"],
  pitch_deck: ["deck"],
  business_plan: ["business_plan"],
  resume: ["resume", "cv"],
  cv: ["cv", "resume"],
  media_kit: ["portfolio", "other"],
};

/** Materials only the person holds that the organiser will not do without. */
const HARD_MATERIALS = new Set(["transcript", "test_scores", "license", "certificate", "paper"]);

/* ------------------------------------------------------------------ options from the profile */

function uniqOptions(values: Array<string | null | undefined>): Option[] {
  const seen = new Set<string>();
  const out: Option[] = [];
  for (const v of values) {
    const s = (v ?? "").trim();
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(opt(s));
  }
  return out;
}

function splitName(name: string): { first: string; last: string } {
  if (/[一-鿿]/.test(name) && !/\s/.test(name)) return { first: name.slice(1), last: name[0] };
  const parts = name.trim().split(/\s+/);
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : "" };
}

/** Options for a recognised field from what the profile holds (even when no fact backs it yet: the tap confirms it). */
export function profileOptions(key: string, profile: Profile, accountEmail?: string | null): Option[] {
  const id = profile.identity;
  const links = (kinds: string[]) => id.links.filter((l) => kinds.includes(l.kind)).map((l) => l.url);
  const edu = profile.education;
  const exp = profile.experience;
  switch (key) {
    case "full_name":
      return uniqOptions([id.name]);
    case "first_name":
      return uniqOptions([id.name ? splitName(id.name).first : null]);
    case "last_name":
      return uniqOptions([id.name ? splitName(id.name).last : null]);
    case "email":
      return uniqOptions([id.email, accountEmail]);
    case "phone":
      return uniqOptions([id.phone]);
    case "location":
      return uniqOptions([id.location, id.city]);
    case "city":
      return uniqOptions([id.city]);
    case "linkedin_url":
      return uniqOptions(links(["linkedin"]));
    case "github_url":
      return uniqOptions(links(["github", "gitlab"]));
    case "portfolio_url":
      return uniqOptions(links(["portfolio", "website", "behance", "dribbble", "github"]));
    case "scholar_url":
      return uniqOptions(links(["scholar"]));
    case "orcid":
      return uniqOptions(links(["orcid"]));
    case "school":
      return uniqOptions(edu.map((e) => e.institution));
    case "degree":
      return uniqOptions(edu.map((e) => e.degree));
    case "field_of_study":
      return uniqOptions(edu.map((e) => e.field));
    case "graduation_date":
      return uniqOptions(edu.map((e) => e.endDate));
    case "gpa":
      return uniqOptions(edu.map((e) => (e.gpa ? `${e.gpa.value}/${e.gpa.scale}` : null)));
    case "current_company":
      return uniqOptions(exp.filter((e) => e.current).map((e) => e.organization));
    case "current_title":
      return uniqOptions(exp.filter((e) => e.current).map((e) => e.title));
    case "startup_name":
      return uniqOptions((profile.packs.founder?.ventures ?? []).map((v) => v.company));
    case "salary": {
      const js = profile.packs.jobSeeker;
      if (!js?.salaryMin) return [];
      const cur = js.currency ?? "";
      return uniqOptions([`${cur ? `${cur} ` : ""}${js.salaryMin.toLocaleString("en-US")}${js.salaryMax ? `–${js.salaryMax.toLocaleString("en-US")}` : "+"}${js.salaryPeriod ? ` / ${js.salaryPeriod}` : ""}`]);
    }
    default:
      return [];
  }
}

/* ------------------------------------------------------------------ motivation (choice-first, never drafted) */

/**
 * Reasons the person can pick from. Each is a first-person statement the person makes by
 * choosing it; they are built from the opportunity and the profile, never claim results, and the
 * person can always write their own instead.
 */
export function motivationOptions(opp: GapOpportunity, profile: Profile, lang: Lang): Option[] {
  const zh = lang === "zh";
  const org = opp.orgName?.trim() || null;
  const target = org ?? opp.name;
  const out: string[] = [];
  const current = profile.experience.find((e) => e.current) ?? profile.experience[0] ?? null;
  const venture = profile.packs.founder?.ventures?.[0] ?? null;
  const research = profile.packs.researcher?.fields?.[0] ?? null;
  const type = opp.type;
  const fn = (opp.functions ?? []).find(isFunctionId);
  const ind = (opp.industries ?? []).find((i) => isIndustryCode(i));

  const VENTURE = new Set(["investor", "accelerator", "incubator", "startup_competition", "pitch_event", "government_program", "exhibition", "cofounder_match", "crowdfunding", "loan"]);
  const FUNDING = new Set(["grant", "fellowship", "scholarship", "award", "residency", "open_call"]);
  const ACADEMIC = new Set(["phd_position", "postdoc", "visiting_scholar", "collaborator", "editorial_role", "conference_cfp", "journal", "degree_program", "exchange_program"]);

  if (VENTURE.has(type) && venture) {
    out.push(zh ? `${target}的资源和网络正是${venture.company}下一阶段需要的` : `${target}'s network and support are what ${venture.company} needs for its next stage`);
    out.push(zh ? `${target}关注的方向和我们正在解决的问题一致` : `${target} backs the kind of problem we're solving`);
  } else if (FUNDING.has(type)) {
    out.push(zh ? "这笔支持能让我把更多时间投入到自己的工作上" : "The support would let me give my work the time it needs");
    if (research) out.push(zh ? `它和我在${research}方面的方向高度相关` : `It fits my focus on ${research}`);
  } else if (ACADEMIC.has(type)) {
    out.push(zh ? "这里的研究方向正是我接下来想做的" : "The research direction is what I want to work on next");
    if (research) out.push(zh ? `能把我在${research}方面的积累用起来` : `It builds on my work in ${research}`);
  } else if (current) {
    out.push(zh ? `这份工作和我在${current.organization}担任${current.title}的经验直接相关` : `It builds directly on my work as ${current.title} at ${current.organization}`);
  }
  if (fn) out.push(zh ? `我想在${functionLabel(fn, "zh")}方向继续深入` : `I want to go deeper in ${functionLabel(fn, "en").toLowerCase()}`);
  if (ind) out.push(zh ? `我想投身${industryLabel(ind, "zh")}领域` : `I want to work in ${industryLabel(ind, "en").toLowerCase()}`);
  if (org) out.push(zh ? `我认同${org}在做的事，想参与其中` : `I believe in what ${org} is building and want to be part of it`);
  if (opp.geo?.remote === true || opp.geo?.remote === "remote") out.push(zh ? "远程的工作方式适合我" : "The remote setup fits how I work");
  else if (opp.geo?.cities?.[0]) out.push(zh ? `我希望在${opp.geo.cities[0]}发展` : `I want to be based in ${opp.geo.cities[0]}`);
  out.push(zh ? "我想在这里学到新东西、承担更大的挑战" : "I want to learn and take on bigger challenges here");
  return uniqOptions(out).slice(0, 6);
}

/** "I'm applying because A, and B." — the person's chosen reasons as one sentence. */
export function composeMotivation(reasons: string[], lang: Lang): string {
  const rs = reasons.map((r) => r.trim().replace(/[.。!！]+$/, "")).filter(Boolean);
  if (!rs.length) return "";
  if (lang === "zh") return `我申请的原因是：${rs.join("；")}。`;
  const lower = (s: string) => (/^I\b|^I'/.test(s) ? s : s[0].toLowerCase() + s.slice(1));
  if (rs.length === 1) return `I'm applying because ${lower(rs[0])}.`;
  return `I'm applying because ${rs.slice(0, -1).map(lower).join(", ")}, and ${lower(rs[rs.length - 1])}.`;
}

/* ------------------------------------------------------------------ the analysis */

function answered(answers: ApplicationAnswers, key: string): boolean {
  const a = answers[key];
  if (!a) return false;
  if (a.fileKey) return true;
  const v = a.value;
  if (v === null || v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  return String(v).trim().length > 0;
}

function auto(value: string, source: ApplicationAnswer["source"], factIds: string[] = [], confirmed = false): ApplicationAnswer {
  return { value, source, factIds, confirmed, fileKey: null };
}

const LONG = (f: FieldRequirement) => f.type === "textarea" || (f.maxLength ?? 0) > 200 || Boolean(f.question);

const NO_MOTIVATION_STATEMENTS = new Set(["research_statement", "artist_statement", "nomination_packet", "promotion_case", "recommendation_letters"]);
const NO_MOTIVATION_PROPOSALS = new Set(["research_proposal", "talk_proposal", "book_proposal"]);

/** Composition needs the person's own reason for these documents (the composer never writes one). */
export function needsMotivation(plan: ComposePlan[], ventureLike: boolean): boolean {
  return plan.some(
    (p) =>
      p.kind === "cover_letter" ||
      (p.kind === "statement" && !NO_MOTIVATION_STATEMENTS.has(p.material ?? "")) ||
      (p.kind === "proposal" && !ventureLike && !NO_MOTIVATION_PROPOSALS.has(p.material ?? "")),
  );
}

export function computeGaps(input: GapInput): GapResult {
  const lang = input.language;
  const zh = lang === "zh";
  const req = input.requirements;
  const answers = input.answers;
  const previous = input.previous ?? {};
  const questions: ApplicationQuestion[] = [];
  const autoAnswers: ApplicationAnswers = {};
  const attach: GapResult["attach"] = [];
  const compose: ComposePlan[] = [];
  const asked = new Set<string>();
  let motivationAsked = false;

  const addCompose = (kind: GeneratedDocumentKind, material: string | null) => {
    if (!compose.some((c) => c.kind === kind && (c.material === material || kind !== "statement"))) compose.push({ kind, material });
  };
  const ask = (q: ApplicationQuestion) => {
    const key = q.fieldName ?? q.id;
    if (asked.has(key) || answered(answers, key)) return;
    asked.add(key);
    questions.push(q);
  };

  // 1. Materials → documents we compose, or files only the person holds.
  const materials = [...new Set([...(req.materials ?? []), ...(input.opportunity.requiredMaterials ?? [])])];
  for (const m of materials) {
    const kind = kindForMaterial(m);
    if (kind === "email" && !input.outreach) continue;
    if (kind) {
      addCompose(kind, m);
      continue;
    }
    if (!isMaterialId(m)) continue;
    const key = `material:${m}`;
    if (answered(answers, key)) continue;
    const kinds = MATERIAL_DOC_KINDS[m] ?? ["other"];
    const doc = input.documentsOnFile.find((d) => kinds.includes(d.kind));
    if (doc) {
      attach.push({ field: key, documentId: doc.id });
      continue;
    }
    const label = getMaterial(m).label[lang];
    const required = HARD_MATERIALS.has(m) || (input.opportunity.requiredMaterials ?? []).includes(m);
    ask({ id: key, fieldName: key, prompt: t(T.upload, lang, { material: zh ? label : label.toLowerCase() }), kind: "file", why: t(required ? T.why.file : T.why.fileOptional, lang), required });
  }
  if (input.outreach && !compose.some((c) => c.kind === "email")) addCompose("email", "outreach_email");

  // 2. Form fields.
  const byName = new Map(input.mappings.map((m) => [m.name, m]));
  const draftById = new Map(input.drafts.map((d) => [d.questionId, d]));
  for (const f of req.fields) {
    if (answered(answers, f.name)) continue;
    const recognised = fieldKey({ name: f.name, label: f.label, placeholder: null });
    const k = f.key ? { key: f.key, user: Boolean(f.userOnly) || Boolean(recognised?.user) } : f.userOnly ? { key: recognised?.user ? recognised.key : "user_only", user: true } : recognised;
    const key = k?.key ?? null;
    const m = byName.get(f.name);
    const formOptions = f.choices?.length ? f.choices.map((c) => opt(c.value, c.label)) : (f.options ?? []).map((o) => opt(o));

    if (f.type === "file") {
      const planned = key ? FILE_FROM_DOCUMENT[key] : undefined;
      if (planned) {
        addCompose(planned, key === "resume" ? "resume" : key === "pitch_deck" ? "pitch_deck" : "cover_letter");
        continue;
      }
      const doc = m?.source === "document" && m.value ? input.documentsOnFile.find((d) => d.id === m.value) : null;
      if (doc) {
        attach.push({ field: f.name, documentId: doc.id });
        continue;
      }
      ask({ id: `field:${f.name}`, fieldName: f.name, prompt: f.label, kind: "file", why: t(f.required ? T.why.file : T.why.fileOptional, lang), required: f.required });
      continue;
    }

    if (m && m.value !== null && !m.needsUser) {
      autoAnswers[f.name] = auto(m.value, m.source === "answer" ? "user" : m.source === "document" ? "profile" : "profile", m.factIds, m.source === "answer");
      continue;
    }

    if (m?.source === "user" || k?.user) {
      if (key === "captcha" || key === "password" || key === "payment") continue; // handed over, never asked here
      if (key === "consent") {
        ask({ id: `field:${f.name}`, fieldName: f.name, prompt: f.label, kind: "confirm", options: [opt("yes", zh ? "我同意" : "I agree")], why: t(T.why.consent, lang), required: f.required });
        continue;
      }
      if (key === "eeo" || formOptions.length) {
        ask({ id: `field:${f.name}`, fieldName: f.name, prompt: f.label, kind: formOptions.length ? (f.type === "multiselect" ? "multi" : "choice") : "text", options: formOptions.length ? formOptions : undefined, why: t(T.why.voluntary, lang), required: f.required });
        continue;
      }
      if (key === "signature") {
        const name = input.profile.identity.name;
        ask({ id: `field:${f.name}`, fieldName: f.name, prompt: f.label, kind: name ? "choice" : "text", options: name ? [opt(name)] : undefined, why: t(T.why.signature, lang), required: f.required });
        continue;
      }
      ask({ id: `field:${f.name}`, fieldName: f.name, prompt: f.label, kind: "text", why: t(T.why.voluntary, lang), required: f.required });
      continue;
    }

    // Reuse an earlier confirmed answer for facts about the person.
    if (key && REUSABLE.has(key) && previous[key]) {
      const v = formOptions.length ? (formOptions.find((o) => o.value.toLowerCase() === previous[key].toLowerCase() || o.label.toLowerCase() === previous[key].toLowerCase())?.value ?? null) : previous[key];
      if (v) {
        autoAnswers[f.name] = auto(v, "user", [], true);
        continue;
      }
    }

    if (!f.required && !LONG(f)) continue; // optional short fields stay empty rather than asking

    // Motivation-type text: the person's own reasons.
    if (key === "why_this" || (LONG(f) && classifyQuestion(f.label) === "why_this")) {
      motivationAsked = true;
      ask({ id: `field:${f.name}`, fieldName: f.name, prompt: f.label, kind: "multi", options: motivationOptions(input.opportunity, input.profile, lang), why: t(T.why.motivation, lang), required: f.required });
      continue;
    }

    const choices = formOptions.length ? formOptions : key ? [...profileOptions(key, input.profile, input.accountEmail), ...(PRESETS[key]?.[lang] ?? []).map((v) => opt(v))] : [];
    if (choices.length && !LONG(f)) {
      ask({
        id: `field:${f.name}`,
        fieldName: f.name,
        prompt: f.label,
        kind: f.type === "multiselect" ? "multi" : "choice",
        options: uniqOptions(choices.map((c) => c.value)).map((o) => choices.find((c) => c.value === o.value) ?? o),
        why: t(formOptions.length || PRESETS[key ?? ""] ? T.why.field : T.why.confirmProfile, lang),
        required: f.required,
        profilePath: f.profilePath,
      });
      continue;
    }

    const draft = draftById.get(f.name);
    if (draft?.answer && !draft.needsUser && LONG(f)) {
      autoAnswers[f.name] = auto(draft.answer, "generated", draft.factIds, false);
      continue;
    }
    ask({ id: `field:${f.name}`, fieldName: f.name, prompt: f.label, kind: "text", why: t(draft?.answer ? (input.aiDrafts ? T.why.draftAi : T.why.draft) : T.why.field, lang), required: f.required, draft: draft?.answer ?? undefined, profilePath: f.profilePath });
  }

  // 3. The organiser's own questions (CH1 postings, form questions).
  for (const q of req.questions) {
    if (answered(answers, q.id)) continue;
    const d = draftById.get(q.id);
    if (classifyQuestion(q.prompt) === "why_this") {
      motivationAsked = true;
      ask({ id: `q:${q.id}`, fieldName: q.id, prompt: q.prompt, kind: "multi", options: motivationOptions(input.opportunity, input.profile, lang), why: t(T.why.motivation, lang), required: true });
      continue;
    }
    if (d?.answer && !d.needsUser) {
      autoAnswers[q.id] = auto(d.answer, "generated", d.factIds, false);
      continue;
    }
    ask({ id: `q:${q.id}`, fieldName: q.id, prompt: q.prompt, kind: "text", why: d?.answer ? t(input.aiDrafts ? T.why.draftAi : T.why.draft, lang) : (d?.reason ?? t(T.why.ownWords, lang)), required: true, draft: d?.answer ?? undefined });
  }

  // 4. What the documents will need from the person (motivation, their own sections).
  const ventureLike = (input.profile.packs.founder?.ventures?.length ?? 0) > 0;
  // One motivation question per application: the engine mirrors a form's "why" answer into `why_this`.
  if (needsMotivation(compose, ventureLike) && !motivationAsked && !answered(answers, "why_this") && !asked.has("why_this")) {
    const target = input.opportunity.orgName?.trim() || input.opportunity.name;
    ask({ id: "gap:why_this", fieldName: "why_this", prompt: t(T.motivationPrompt, lang, { target }), kind: "multi", options: motivationOptions(input.opportunity, input.profile, lang), why: t(T.why.motivation, lang), required: true });
  }
  for (const c of compose) {
    const own = c.material === "talk_proposal" ? "talk_abstract" : c.material === "book_proposal" ? "book_idea" : c.kind === "press_release" ? "announcement" : null;
    if (own && !answered(answers, own)) ask({ id: `gap:${own}`, fieldName: own, prompt: t(T.ownSection[own], lang), kind: "text", why: t(T.why.ownWords, lang), required: true });
  }

  return { questions, autoAnswers, compose, attach };
}

/** Questions raised by composed documents' gaps that the analysis did not foresee (name, research plan…). */
export function questionsFromDocumentGaps(gaps: { key: string; question: string }[], answers: ApplicationAnswers, lang: Lang): ApplicationQuestion[] {
  const out: ApplicationQuestion[] = [];
  for (const g of gaps) {
    if (OPTIONAL_GAP_KEYS.has(g.key) || answered(answers, g.key) || out.some((q) => q.fieldName === g.key)) continue;
    out.push({ id: `gap:${g.key}`, fieldName: g.key, prompt: g.question, kind: "text", why: t(g.key === "why_this" ? T.why.motivation : T.why.ownWords, lang), required: true });
  }
  return out;
}

/** Required questions still open. */
export function openRequired(questions: ApplicationQuestion[], answers: ApplicationAnswers): ApplicationQuestion[] {
  return questions.filter((q) => q.required !== false && !answered(answers, q.fieldName ?? q.id));
}

export { answered as isAnswered };

/* ------------------------------------------------------------------ answering */

/** A "why are you applying" question: its answer is the person's motivation, reused by the cover letter. */
export function isMotivationQuestion(q: Pick<ApplicationQuestion, "id" | "fieldName" | "prompt" | "kind">): boolean {
  if (q.kind !== "multi" && q.kind !== "text") return false;
  return (q.fieldName ?? q.id) === "why_this" || classifyQuestion(q.prompt) === "why_this";
}

export type AnswerInput = { value?: string | string[] | boolean | null; fileKey?: string | null; documentId?: string | null; source?: "user" | "generated" };

export class AnswerError extends Error {
  constructor(readonly code: "empty" | "not_an_option" | "too_long" | "needs_file") {
    super(code);
    this.name = "AnswerError";
  }
}

/**
 * Validates and normalises one answer to a gap question. Choice answers must be one of the
 * offered options unless the person wrote their own (`custom`); motivation picks become one
 * sentence in the person's voice.
 */
export function normalizeAnswer(q: ApplicationQuestion, input: AnswerInput & { custom?: string | null }, lang: Lang): ApplicationAnswer {
  const own = input.custom?.trim();
  if (q.kind === "file") {
    if (!input.fileKey && !input.documentId) throw new AnswerError("needs_file");
    return { value: input.documentId ?? null, source: "user", factIds: [], confirmed: true, fileKey: input.fileKey ?? null };
  }
  if (q.kind === "confirm") {
    const yes = input.value === true || input.value === "yes" || input.value === "true";
    if (!yes) throw new AnswerError("empty");
    return { value: q.options?.[0]?.value ?? "yes", source: "user", factIds: [], confirmed: true, fileKey: null };
  }
  if (q.kind === "choice" || q.kind === "multi") {
    const values = (Array.isArray(input.value) ? input.value : input.value === null || input.value === undefined ? [] : [String(input.value)]).map((v) => String(v).trim()).filter(Boolean);
    const allowed = new Set((q.options ?? []).map((o) => o.value));
    for (const v of values) if (!allowed.has(v)) throw new AnswerError("not_an_option");
    if (!values.length && !own) throw new AnswerError("empty");
    if (q.kind === "multi" && isMotivationQuestion(q)) {
      const text = [composeMotivation(values.slice(0, 3), lang), own].filter(Boolean).join(lang === "zh" ? "" : " ");
      return { value: text, source: "user", factIds: [], confirmed: true, fileKey: null };
    }
    if (q.kind === "multi") return { value: own ? [...values, own] : values, source: "user", factIds: [], confirmed: true, fileKey: null };
    return { value: own || values[0], source: "user", factIds: [], confirmed: true, fileKey: null };
  }
  const text = (own ?? (typeof input.value === "string" ? input.value : "")).trim();
  if (!text) throw new AnswerError("empty");
  if (text.length > 6000) throw new AnswerError("too_long");
  // Keeping a draft untouched is still the person's explicit confirmation of it.
  return { value: text, source: input.source === "generated" && q.draft && text === q.draft.trim() ? "generated" : "user", factIds: [], confirmed: true, fileKey: null };
}
