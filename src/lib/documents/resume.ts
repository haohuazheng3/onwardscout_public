import type { GeneratedBlock, Profile } from "@/lib/core/types";
import { FactView, type Backed } from "@/lib/llm/local/factview";
import { hasCjk, isQuantified, stripTrailingPunct } from "@/lib/llm/local/text";
import type { FactRef, OpportunityInput } from "@/lib/llm/types";
import type { DocumentGap } from "./content";

/*
 * The tailored résumé, assembled deterministically from backed profile items (never written by a
 * model, under any provider): every line is a value the person's own documents contain, cited
 * with the fact ids behind it. Tailoring only ORDERS and SELECTS — roles, bullets, projects and
 * skills that overlap the opportunity's words come first — it never rewrites a claim.
 */

type Lang = "en" | "zh";

export interface ResumeBuild {
  title: string;
  blocks: GeneratedBlock[];
  roles: string[];
  gaps: DocumentGap[];
  notes: string[];
}

const STOP = new Set(
  "the and for with from that this your you our are will have has into about their they them was were been being which while where when what how who all any can its not but also more most other such than then there these those very just over under within across per via using use used team role work working job position company program application apply candidate experience years year skills".split(
    " ",
  ),
);

export function keywordsOf(opp: OpportunityInput | null | undefined): Set<string> {
  const text = [opp?.name, opp?.summary, opp?.description?.slice(0, 3000), ...(opp?.tags ?? []), ...(opp?.functions ?? []), ...(opp?.industries ?? [])]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const out = new Set<string>();
  for (const w of text.match(/[a-z][a-z0-9+#.-]{2,}/g) ?? []) if (!STOP.has(w)) out.add(w.replace(/[.-]+$/, ""));
  for (const run of text.match(/[一-鿿]{2,}/g) ?? []) for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
  return out;
}

function overlap(text: string, keywords: Set<string>): number {
  if (!keywords.size || !text) return 0;
  const lower = text.toLowerCase();
  let n = 0;
  for (const k of keywords) if (lower.includes(k)) n++;
  return n;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatPartialDate(d: string | null | undefined, lang: Lang): string | null {
  if (!d) return null;
  const [y, m] = d.split("-");
  if (!m) return y;
  return lang === "zh" ? `${y}.${m}` : `${MONTHS[Number(m) - 1] ?? m} ${y}`;
}

export function formatRange(start: string | null | undefined, end: string | null | undefined, current: boolean, lang: Lang): string {
  const s = formatPartialDate(start, lang);
  const e = current ? (lang === "zh" ? "至今" : "present") : formatPartialDate(end, lang);
  if (s && e) return `${s} – ${e}`;
  return s ?? e ?? "";
}

const LANGUAGE_NAMES: Record<string, { en: string; zh: string }> = {
  en: { en: "English", zh: "英语" },
  zh: { en: "Chinese", zh: "中文" },
  ja: { en: "Japanese", zh: "日语" },
  ko: { en: "Korean", zh: "韩语" },
  fr: { en: "French", zh: "法语" },
  de: { en: "German", zh: "德语" },
  es: { en: "Spanish", zh: "西班牙语" },
  pt: { en: "Portuguese", zh: "葡萄牙语" },
  it: { en: "Italian", zh: "意大利语" },
  ru: { en: "Russian", zh: "俄语" },
  ar: { en: "Arabic", zh: "阿拉伯语" },
  hi: { en: "Hindi", zh: "印地语" },
};

const LEVEL_WORDS: Record<string, { en: string; zh: string }> = {
  native: { en: "native", zh: "母语" },
  fluent: { en: "fluent", zh: "流利" },
  professional: { en: "professional", zh: "工作水平" },
  conversational: { en: "conversational", zh: "日常交流" },
  basic: { en: "basic", zh: "基础" },
};

const H = {
  summary: { en: "Summary", zh: "个人概述" },
  experience: { en: "Experience", zh: "工作经历" },
  projects: { en: "Projects", zh: "项目经历" },
  education: { en: "Education", zh: "教育背景" },
  skills: { en: "Skills", zh: "技能" },
  publications: { en: "Publications", zh: "论文与出版" },
  awards: { en: "Awards", zh: "荣誉奖项" },
  certifications: { en: "Certifications", zh: "证书与资质" },
  languages: { en: "Languages", zh: "语言能力" },
} as const;

export interface ResumeInput {
  profile: Profile;
  facts: FactRef[];
  opportunity?: OpportunityInput | null;
  language: Lang;
  /** Caps keep a one- to two-page résumé. */
  maxRoles?: number;
  maxBulletsPerRole?: number;
}

export function buildResume(input: ResumeInput): ResumeBuild {
  const lang = input.language;
  const zh = lang === "zh";
  const view = new FactView(input.profile, input.facts);
  const kw = keywordsOf(input.opportunity);
  const blocks: GeneratedBlock[] = [];
  const roles: string[] = [];
  const gaps: DocumentGap[] = [];
  const notes = new Set<string>();
  const push = (role: string, b: GeneratedBlock) => {
    blocks.push(b);
    roles.push(role);
  };
  const heading = (key: keyof typeof H) => push("heading", { type: "heading", text: H[key][lang], factIds: [], flags: [] });
  const foreign = (text: string) => {
    if (zh ? !hasCjk(text) && /[A-Za-z]{3}/.test(text) : hasCjk(text)) {
      notes.add(zh ? "部分条目保留了原材料的语言（未翻译）。如需全中文，发送前请自行调整。" : "Some lines keep the language of your original documents (we never translate claims). Adjust them before sending if needed.");
    }
    return text;
  };

  // Name and contact.
  const name = view.name();
  if (name) push("heading", { type: "heading", text: name.value, factIds: name.ids, flags: [] });
  else {
    const q = zh ? "简历上的姓名是？" : "What name goes at the top of your résumé?";
    gaps.push({ key: "name", question: q });
    push("gap", { type: "heading", label: q, text: zh ? "【你的姓名】" : "[Your full name]", factIds: [], flags: ["needs_confirmation"] });
  }
  const contact: Array<Backed<string>> = [];
  const headline = view.headline();
  for (const c of [view.email(), view.phone(), view.location()]) if (c) contact.push(c);
  const links = view.links().filter((l) => ["website", "portfolio", "linkedin", "github", "gitlab", "scholar", "orcid", "behance", "dribbble"].includes(l.value.kind)).slice(0, 3);
  for (const l of links) contact.push({ value: l.value.url.replace(/^https?:\/\//, "").replace(/\/$/, ""), ids: l.ids });
  if (headline) push("context-line", { type: "paragraph", text: foreign(headline.value), factIds: headline.ids, flags: [] });
  if (contact.length) push("contact", { type: "paragraph", text: contact.map((c) => c.value).join(" · "), factIds: [...new Set(contact.flatMap((c) => c.ids))], flags: [] });

  const summary = view.summary();
  if (summary) {
    heading("summary");
    push("body", { type: "paragraph", text: foreign(summary.value), factIds: summary.ids, flags: [] });
  }

  // Experience: relevance first among the most recent roles, then recency.
  const exps = view.rankedExperiences();
  if (exps.length) {
    const scored = exps.map((e, i) => ({
      e,
      score: overlap(`${e.value.title} ${e.value.summary ?? ""} ${e.value.highlights.join(" ")} ${e.value.skills.join(" ")}`, kw) * 2 + (exps.length - i) * 0.5 + (e.value.current ? 3 : 0),
    }));
    const keep = new Set(scored.sort((a, b) => b.score - a.score).slice(0, input.maxRoles ?? 5).map((x) => x.e.value.id));
    heading("experience");
    for (const e of exps) {
      if (!keep.has(e.value.id)) continue;
      const x = e.value;
      const when = formatRange(x.startDate, x.endDate, x.current, lang);
      const where = [when, x.location].filter(Boolean).join(" · ");
      push("entry", { type: "field", label: foreign(zh ? `${x.organization} · ${x.title}` : `${x.title} · ${x.organization}`), text: where, factIds: e.ids, flags: [] });
      const bullets = x.highlights
        .map((h, i) => ({ h: stripTrailingPunct(h), score: overlap(h, kw) * 2 + (isQuantified(h) ? 2 : 0) - i * 0.1 }))
        .filter((b) => b.h.length >= 6)
        .sort((a, b) => b.score - a.score)
        .slice(0, input.maxBulletsPerRole ?? 4);
      if (!bullets.length && x.summary) push("body", { type: "bullet", text: foreign(stripTrailingPunct(x.summary)), factIds: e.ids, flags: [] });
      for (const b of bullets) push("body", { type: "bullet", text: foreign(b.h), factIds: e.ids, flags: [] });
    }
  }

  const projects = view
    .projects()
    .map((p) => ({ p, score: overlap(`${p.value.name} ${p.value.summary ?? ""} ${p.value.highlights.join(" ")}`, kw) * 2 + (isQuantified(p.value.summary ?? "") ? 1 : 0) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
  if (projects.length) {
    heading("projects");
    for (const { p } of projects) {
      const x = p.value;
      push("entry", { type: "field", label: foreign(x.role ? `${x.name} · ${x.role}` : x.name), text: [formatRange(x.startDate, x.endDate, false, lang), x.url?.replace(/^https?:\/\//, "")].filter(Boolean).join(" · "), factIds: p.ids, flags: [] });
      const detail = x.summary ?? x.highlights[0] ?? null;
      if (detail) push("body", { type: "bullet", text: foreign(stripTrailingPunct(detail)), factIds: p.ids, flags: [] });
    }
  }

  const edu = view.education();
  if (edu.length) {
    heading("education");
    for (const e of edu.slice(0, 3)) {
      const x = e.value;
      const what = [x.degree, x.field].filter(Boolean).join(zh ? " · " : ", ");
      push("entry", { type: "field", label: foreign(zh ? [x.institution, what].filter(Boolean).join(" · ") : [what || null, x.institution].filter(Boolean).join(" · ")), text: [formatRange(x.startDate, x.endDate, x.current, lang), x.gpa ? `GPA ${x.gpa.value}/${x.gpa.scale}` : null].filter(Boolean).join(" · "), factIds: e.ids, flags: [] });
      if (x.honors.length) push("body", { type: "bullet", text: foreign(x.honors.slice(0, 3).join(zh ? "；" : "; ")), factIds: e.ids, flags: [] });
    }
  }

  const pubs = view.publications().slice(0, 5);
  if (pubs.length) {
    heading("publications");
    for (const p of pubs) {
      const x = p.value;
      const venue = [x.venue, x.year].filter(Boolean).join(", ");
      push("body", { type: "bullet", text: foreign(`${x.title}${venue ? ` — ${venue}` : ""}`), factIds: p.ids, flags: [] });
    }
  }

  const awards = view.achievements().slice(0, 5);
  if (awards.length) {
    heading("awards");
    for (const a of awards) {
      const x = a.value;
      push("body", { type: "bullet", text: foreign([x.title, x.issuer, formatPartialDate(x.date, lang)].filter(Boolean).join(" · ")), factIds: a.ids, flags: [] });
    }
  }

  const certs = view.certifications().slice(0, 5);
  if (certs.length) {
    heading("certifications");
    for (const c of certs) {
      const x = c.value;
      push("body", { type: "bullet", text: foreign([x.name, x.issuer, formatPartialDate(x.issuedAt, lang)].filter(Boolean).join(" · ")), factIds: c.ids, flags: [] });
    }
  }

  const skills = view
    .skills()
    .map((s, i) => ({ s, score: overlap(s.value, kw) * 3 - i * 0.01 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 14)
    .map((x) => x.s);
  if (skills.length) {
    heading("skills");
    push("body", { type: "paragraph", text: foreign(skills.map((s) => s.value).join(zh ? "、" : " · ")), factIds: [...new Set(skills.flatMap((s) => s.ids))], flags: [] });
  }

  const languages = view.languages();
  if (languages.length) {
    heading("languages");
    const text = languages
      .map((l) => {
        const nm = LANGUAGE_NAMES[l.value.code.slice(0, 2)]?.[lang] ?? l.value.code;
        const lv = l.value.level ? LEVEL_WORDS[l.value.level]?.[lang] : null;
        return lv ? (zh ? `${nm}（${lv}）` : `${nm} (${lv})`) : nm;
      })
      .join(zh ? "、" : " · ");
    push("body", { type: "paragraph", text, factIds: [...new Set(languages.flatMap((l) => l.ids))], flags: [] });
  }

  if (!exps.length && !edu.length && !projects.length) {
    const q = zh ? "简历还缺少经历。请先在「档案」里上传简历或补充经历。" : "Your profile has no experience, education or projects yet. Add your résumé on the Profile page first.";
    gaps.push({ key: "experience", question: q });
    push("gap", { type: "paragraph", label: q, text: zh ? "【经历：请先上传简历】" : "[Experience: upload your résumé first]", factIds: [], flags: ["needs_confirmation"] });
  }

  const title = zh ? `${name?.value ?? ""}简历`.trim() : `${name?.value ? `${name.value} — ` : ""}Résumé`;
  return { title, blocks, roles, gaps, notes: [...notes] };
}
