import { functionLabel, isFunctionId } from "@/lib/core/functions";
import { industryLabel, isIndustryCode } from "@/lib/core/industries";
import { getMaterial, isMaterialId } from "@/lib/core/materials";
import type { ApplicationAnswer, ApplicationAnswers, ApplicationQuestion, GeneratedDocumentKind, Option, Profile } from "@/lib/core/types";
import { isOptionalGapQuestion, kindForMaterial, OPTIONAL_GAP_KEYS } from "@/lib/documents/build";
import { CAREER_BREAK_KEY, CAREER_BREAK_REASONS, careerBreakFromProfile } from "@/lib/documents/career-break";
import { classifySpot, IDEA_KEY, IDEA_TYPES, listedOptions, PROFILE_SPOT_KEYS, TEAM_KEY, TRACK_KEY } from "@/lib/documents/spots";
import { classifyQuestion } from "@/lib/llm/local/compose";
import { fieldKey } from "@/lib/llm/local/forms";
import type { FieldMapping, QuestionAnswer } from "@/lib/llm/types";
import { isLinkAnswer, laterMaterial } from "./materials";
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
    fileLater: { en: "Not needed to start: organisers ask for this at the end or if you're shortlisted. Add it (or a link) whenever it's ready; nothing waits on it.", zh: "现在不需要：主办方通常在最后阶段或入围后才要。做好后再上传（或贴链接），不影响其他步骤。" },
    ownWords: { en: "Only you can write this part. One or two sentences are enough.", zh: "这一部分只能由你来写，一两句话就够了。" },
    profileMissing: { en: "Your documents need this and your profile doesn't say it yet. You answer once; we reuse it next time.", zh: "文书里需要这一项，档案里还没有。只需回答一次，下次自动带上。" },
    idea: { en: "Only you know what you'll build. Your sentences become the deck's title, one-liner, problem and solution; nothing is made up.", zh: "要做什么只有你知道。我们用你的这一两句话写出 Deck 的标题、一句话介绍、问题和方案，不会编造任何内容。" },
    team: { en: "So the deck and the form say who's taking part. Going solo is fine.", zh: "让 Deck 和报名表写清楚谁参加。一个人参赛也完全可以。" },
    founders: { en: "So the deck and the form say who's building it. A solo founder is fine.", zh: "让 Deck 和申请表写清楚谁在做这件事。独立创始人也完全可以。" },
    track: { en: "The organiser sorts entries by track. One tap.", zh: "主办方按赛道分组，点一下即可。" },
  },
  motivationPrompt: { en: "Why are you applying to {target}?", zh: "你为什么申请{target}？" },
  idea: { en: "What are you building, and what problem does it solve? One or two sentences (add its name if it has one).", zh: "你要做什么、解决什么问题？一两句话就够（有名字的话也写上）。" },
  team: { en: "Who's on your team?", zh: "你的团队有谁？" },
  teamOptions: {
    en: ["Just me — I'm going solo", "Me and my teammates", "I'm still looking for teammates"],
    zh: ["就我一个人（单人参赛）", "我和队友一起", "还在找队友"],
  },
  founderOptions: {
    en: ["I'm a solo founder", "Me and my co-founders", "I'm still looking for a co-founder"],
    zh: ["我是独立创始人", "我和联合创始人一起", "还在找联合创始人"],
  },
  later: { en: "Your {material}, when it's ready", zh: "你的{material}（做好后再加）" },
  ownSection: {
    talk_abstract: { en: "What is your talk called, and what will the audience take away?", zh: "你的演讲题目是什么？听众会收获什么？" },
    book_idea: { en: "What is the book about, and who is it for?", zh: "这本书讲什么、写给谁？" },
    announcement: { en: "What is the news you want to announce?", zh: "你要发布的消息是什么？" },
  } as Record<string, { en: string; zh: string }>,
  upload: { en: "Upload your {material}", zh: "上传你的{material}" },
};

const t = (x: { en: string; zh: string }, lang: Lang, vars: Record<string, string> = {}) => x[lang].replace(/\{(\w+)\}/g, (_, k: string) => vars[k] ?? "");

const opt = (value: string, label = value): Option => ({ value, label });

/**
 * Materials prepared for every opportunity of a type, on top of what the organiser lists: a
 * returnship always gets the returner résumé, a cover letter and the career-break note (most
 * returner portals ask for them, and the break is what the reader wonders about first); a
 * startup programme gets the deck and the one-pager (what the Startup season pass promises,
 * and what its form's answers are copied from); a hackathon gets the deck its judges see.
 */
export const ALWAYS_PREPARED: Partial<Record<string, string[]>> = {
  returnship: ["resume_variant", "cover_letter", "career_break_statement"],
  accelerator: ["pitch_deck", "one_pager"],
  incubator: ["pitch_deck", "one_pager"],
  startup_competition: ["pitch_deck", "one_pager"],
  pitch_event: ["pitch_deck", "one_pager"],
  hackathon: ["pitch_deck"],
};

/* ------------------------------------------------------------------ presets (common answers) */

const PRESETS: Record<string, { en: string[]; zh: string[] }> = {
  availability: { en: ["Immediately", "In 2 weeks", "In 1 month", "In 1–3 months", "Later than 3 months"], zh: ["随时可以开始", "两周内", "一个月内", "一到三个月", "三个月以后"] },
  work_authorization: { en: ["Yes", "No"], zh: ["是", "否"] },
  sponsorship: { en: ["Yes", "No"], zh: ["需要", "不需要"] },
  years_experience: { en: ["Less than 1 year", "1–2 years", "3–5 years", "6–10 years", "More than 10 years"], zh: ["不到 1 年", "1–2 年", "3–5 年", "6–10 年", "10 年以上"] },
  referral_source: { en: ["Onward Scout", "The organiser's website", "LinkedIn", "A job board or listing site", "A friend or colleague"], zh: ["Onward Scout", "官方网站", "领英", "招聘或活动平台", "朋友或同事推荐"] },
  salary: { en: ["Open to discussion"], zh: ["面议"] },
};

/** The tapped reason's label, for showing it (own words need none). */
function careerBreakLabel(value: string, lang: Lang): { label?: string } {
  const hit = CAREER_BREAK_REASONS.find((r) => r.value === value);
  return hit ? { label: hit.label[lang] } : {};
}

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
  const materials = [...new Set([...(req.materials ?? []), ...(input.opportunity.requiredMaterials ?? []), ...(ALWAYS_PREPARED[input.opportunity.type] ?? [])])];
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
    const material = zh ? label : label.toLowerCase();
    // A file never holds the drafts back (materials.ts): one needed to accept the application
    // waits at confirm; a deliverable made later (a hackathon's demo video) waits for nothing.
    if (laterMaterial(m, input.opportunity.type)) {
      ask({ id: key, fieldName: key, prompt: t(T.later, lang, { material }), kind: "file", why: t(T.why.fileLater, lang), required: false });
      continue;
    }
    const required = HARD_MATERIALS.has(m) || (input.opportunity.requiredMaterials ?? []).includes(m);
    ask({ id: key, fieldName: key, prompt: t(T.upload, lang, { material }), kind: "file", why: t(required ? T.why.file : T.why.fileOptional, lang), required });
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
  // The career break is the person's to explain: one tap on a plain choice, or their own words —
  // unless their own résumé already says it outright, which is then their answer (from the profile).
  // Said once on another application, it is reused as theirs (the reason is about the person).
  const needsBreak = compose.some((c) => c.material === "career_break_statement") && !answered(answers, CAREER_BREAK_KEY);
  const statedReason = needsBreak ? careerBreakFromProfile(input.profile) : null;
  const givenBefore = needsBreak ? previous[CAREER_BREAK_KEY]?.trim() : undefined;
  if (givenBefore) autoAnswers[CAREER_BREAK_KEY] = { ...auto(givenBefore, "user", [], true), ...careerBreakLabel(givenBefore, lang) };
  else if (statedReason) autoAnswers[CAREER_BREAK_KEY] = auto(statedReason, "profile");
  else if (compose.some((c) => c.material === "career_break_statement") && !answered(answers, CAREER_BREAK_KEY)) {
    ask({
      id: `gap:${CAREER_BREAK_KEY}`,
      fieldName: CAREER_BREAK_KEY,
      prompt: zh ? "你当时为什么离开职场？" : "What was your career break for?",
      kind: "choice",
      options: CAREER_BREAK_REASONS.map((r) => opt(r.value, r.label[lang])),
      why: zh ? "空窗期说明和简历会如实写上你选的原因（也可以写你自己的话）。我们从不替你猜。" : "Your career-break note and résumé say it the way you choose (or in your own words). We never guess it.",
      required: true,
    });
  }
  for (const c of compose) {
    const own = c.material === "talk_proposal" ? "talk_abstract" : c.material === "book_proposal" ? "book_idea" : c.kind === "press_release" ? "announcement" : null;
    if (own && !answered(answers, own)) ask({ id: `gap:${own}`, fieldName: own, prompt: t(T.ownSection[own], lang), kind: "text", why: t(T.why.ownWords, lang), required: true });
  }

  return { questions, autoAnswers, compose, attach };
}

/** "Was your career break for caregiving…?", "Why did you step away from work?" (not "what did you do during it"). */
export function isCareerBreakReasonQuestion(question: string): boolean {
  return /\b(why did you|what was|was) (your|the) (career )?break\b|\bcareer break\b[^?]{0,40}\b(for|because|reason)\b|\bwhy (did )?you (step|stepped|took|take) (away|time off|a break)|空窗(期)?(的)?原因|为什么离开职场/i.test(question);
}

/** What the canonical questions can offer from the person's own record (all optional: tests pass none). */
export interface DocumentGapContext {
  profile?: Profile;
  accountEmail?: string | null;
  /** The opportunity's type: a hackathon has teammates, a startup programme co-founders. */
  oppType?: string | null;
}

/** Events entered as a team (teammates), as opposed to companies (co-founders). */
const TEAM_EVENTS = new Set(["hackathon", "competition"]);

/** "What are you building?" as a tap on one of the person's own projects, when the profile has some. */
function ideaOptions(profile: Profile | undefined): Option[] {
  // Their company first (a founder's venture, in their own words), then their projects.
  const ventures = (profile?.packs.founder?.ventures ?? []).filter((v) => v.oneLiner?.trim()).map((v) => `${v.company}: ${v.oneLiner!.trim().replace(/\s+/g, " ").slice(0, 220)}`);
  const projects = (profile?.projects ?? []).filter((p) => p.summary?.trim()).map((p) => `${p.name}: ${p.summary!.trim().replace(/\s+/g, " ").slice(0, 220)}`);
  return uniqOptions([...ventures, ...projects].slice(0, 3));
}

/**
 * Questions raised by composed documents' gaps that the analysis did not foresee. Keys arrive
 * canonical (documents/spots.ts settled them), so one question stands for every spot it fills:
 * the idea once (a tap on one of their projects, or one or two sentences), the team as one tap,
 * the track as one tap among the organiser's options, a profile value as a tap on what the
 * profile holds; a writer's own wording of "why are you applying" is the application's one
 * motivation question and its "why did you step away" the one career-break question.
 */
export function questionsFromDocumentGaps(gaps: { key: string; question: string }[], answers: ApplicationAnswers, lang: Lang, ctx: DocumentGapContext = {}): ApplicationQuestion[] {
  const out: ApplicationQuestion[] = [];
  for (const g of gaps) {
    if (OPTIONAL_GAP_KEYS.has(g.key) || isOptionalGapQuestion(g.question)) continue;
    const key = g.key !== "why_this" && classifyQuestion(g.question) === "why_this" ? "why_this" : g.key !== CAREER_BREAK_KEY && isCareerBreakReasonQuestion(g.question) ? CAREER_BREAK_KEY : g.key;
    if (answered(answers, key) || out.some((q) => q.fieldName === key)) continue;
    const base = { id: `gap:${key}`, fieldName: key, required: true } as const;
    if (key === IDEA_KEY) {
      const options = ideaOptions(ctx.profile);
      out.push({ ...base, prompt: t(T.idea, lang), kind: options.length ? "choice" : "text", ...(options.length ? { options } : {}), why: t(T.why.idea, lang) });
      continue;
    }
    if (key === TEAM_KEY) {
      const founders = Boolean(ctx.oppType) && !TEAM_EVENTS.has(ctx.oppType ?? "");
      out.push({ ...base, prompt: t(T.team, lang), kind: "choice", options: (founders ? T.founderOptions : T.teamOptions)[lang].map((v) => opt(v)), why: t(founders ? T.why.founders : T.why.team, lang) });
      continue;
    }
    if (key === TRACK_KEY) {
      const options = listedOptions(g.question);
      // Without the organiser's own list there is nothing to tap: it is picked on the official form.
      if (!options.length) continue;
      out.push({ ...base, prompt: g.question, kind: "choice", options: options.map((v) => opt(v)), why: t(T.why.track, lang) });
      continue;
    }
    if (PROFILE_SPOT_KEYS.has(key)) {
      const options = ctx.profile ? profileOptions(key, ctx.profile, ctx.accountEmail) : [];
      out.push({ ...base, prompt: g.question, kind: options.length ? "choice" : "text", ...(options.length ? { options } : {}), why: t(options.length ? T.why.confirmProfile : T.why.profileMissing, lang) });
      continue;
    }
    out.push({ ...base, prompt: g.question, kind: "text", why: t(key === "why_this" ? T.why.motivation : T.why.ownWords, lang) });
  }
  return out;
}

/**
 * Required questions still open — the ones that keep an application in `needs_info`. Files are
 * not among them: they never hold the drafts back (see `missingFiles`).
 */
export function openRequired(questions: ApplicationQuestion[], answers: ApplicationAnswers): ApplicationQuestion[] {
  return questions.filter((q) => q.kind !== "file" && q.required !== false && !answered(answers, q.fieldName ?? q.id));
}

/**
 * Questions stored before the drafts' spots were settled (spots.ts, 2026-11-02): a writer's own
 * key the fold now answers another way (presenter_name → the profile, project_name / one_liner /
 * problem → the one idea question…). Such an application is prepared again, so the person is
 * asked the few folded questions instead of the old wall.
 */
export function hasStaleQuestions(questions: ApplicationQuestion[], oppType: string | null | undefined): boolean {
  const idea = IDEA_TYPES.has(oppType ?? "");
  return questions.some((q) => {
    if (!q.id.startsWith("gap:")) return false;
    const key = q.fieldName ?? q.id.slice(4);
    // Judged like the settler judges a document of any kind (a deck's slide spots are never asked).
    return classifySpot({ key, question: q.prompt }, { idea }).key !== key;
  });
}

/** Files the organiser needs to accept the application that are still missing (confirm waits for them where we submit). */
export function missingFiles(questions: ApplicationQuestion[], answers: ApplicationAnswers): ApplicationQuestion[] {
  return questions.filter((q) => q.kind === "file" && q.required !== false && !answered(answers, q.fieldName ?? q.id));
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
    // A link stands in for the file (a demo video on YouTube, a repository on GitHub).
    const link = own || (typeof input.value === "string" ? input.value.trim() : "");
    if (!input.fileKey && !input.documentId && isLinkAnswer(link)) return { value: link, source: "user", factIds: [], confirmed: true, fileKey: null };
    if (!input.fileKey && !input.documentId) throw new AnswerError("needs_file");
    return { value: input.documentId ?? null, source: "user", factIds: [], confirmed: true, fileKey: input.fileKey ?? null };
  }
  if (q.kind === "confirm") {
    const yes = input.value === true || input.value === "yes" || input.value === "true";
    if (!yes) throw new AnswerError("empty");
    const agreed = q.options?.[0];
    return { value: agreed?.value ?? "yes", source: "user", factIds: [], confirmed: true, fileKey: null, ...(agreed?.label ? { label: agreed.label } : {}) };
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
    const labelOf = (v: string) => q.options?.find((o) => o.value === v)?.label ?? v;
    if (q.kind === "multi") {
      const label = [...values.map(labelOf), ...(own ? [own] : [])].join(", ");
      return { value: own ? [...values, own] : values, source: "user", factIds: [], confirmed: true, fileKey: null, label };
    }
    return { value: own || values[0], source: "user", factIds: [], confirmed: true, fileKey: null, ...(own ? {} : { label: labelOf(values[0]) }) };
  }
  const text = (own ?? (typeof input.value === "string" ? input.value : "")).trim();
  if (!text) throw new AnswerError("empty");
  if (text.length > 6000) throw new AnswerError("too_long");
  // Keeping a draft untouched is still the person's explicit confirmation of it.
  return { value: text, source: input.source === "generated" && q.draft && text === q.draft.trim() ? "generated" : "user", factIds: [], confirmed: true, fileKey: null };
}
