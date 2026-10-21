import { readProfile, ComposeInput, type BlockRole, type ComposedBlock, type ComposedDocument, type ContentGap, type QuestionKey } from "../types";
import type { BLOCK_FLAGS, GENERATED_BLOCK_TYPES, Profile } from "@/lib/core/types";
import { FactView, type Backed, type VentureView } from "./factview";
import { countWords, hasCjk, isQuantified, joinList, lowerFirst, stripTrailingPunct, uniq } from "./text";

/*
 * Template composition from facts (the local engine's "drafted from your profile").
 *
 * Rules, enforced by construction:
 *  - every `body` block is built from sentences that each cite at least one fact id (or the
 *    person's own answer, `answer:<key>`); a sentence without ids is dropped, never emitted;
 *  - when something only the person can say is needed (motivation, a pitch, the round size),
 *    a `gap` block marks the spot and `gaps[]` carries the question;
 *  - nothing is translated or embellished: the person's bullet points are used verbatim
 *    (re-cased to fit a sentence); a line in another language is quoted and noted;
 *  - no gendered pronouns: third person uses the person's first name.
 */

type Lang = "en" | "zh";
type BlockType = (typeof GENERATED_BLOCK_TYPES)[number];
type Flag = (typeof BLOCK_FLAGS)[number];
type Exp = Profile["experience"][number];
type Opp = NonNullable<ComposeInput["opportunity"]>;

interface Sent {
  text: string;
  ids: string[];
}

interface Para {
  role: BlockRole;
  type: BlockType;
  label?: string;
  sentences: Sent[];
  /** Higher survives trimming longer. */
  priority: number;
  flags: Flag[];
}

const JOB_TYPES = new Set(["job", "internship", "remote_job", "part_time", "graduate_program", "returnship", "ngo_job", "phd_position", "postdoc", "internal_role", "public_sector_exam"]);

/* ------------------------------------------------------------------ language helpers */

const VERBS = new Set(
  (
    "accelerate achieve acquire adapt administer advise analyze analyse architect assemble assess audit automate build built coach collaborate compile complete conceive conduct consolidate construct consult contribute coordinate create cultivate curate cut debug decrease define deliver deploy design develop devise direct discover document draft drive edit educate eliminate enable engineer establish evaluate execute expand facilitate forecast form formulate found generate grow guide handle head help hire identify implement improve increase influence initiate innovate install integrate interview introduce invent investigate launch lead led maintain manage map market measure mentor merge migrate model moderate monitor motivate negotiate operate optimize optimise orchestrate organize organise oversee own partner perform pilot pioneer plan prepare present prioritize produce program promote propose prototype publish raise ran rebuild recruit redesign reduce refactor research resolve restructure revamp review revitalize run save scale schedule secure select sell ship simplify solve spearhead standardize start streamline strengthen structure supervise support survey teach test train transform translate triple double unify upgrade use validate win won wrote write grew drove set spoke sold taught brought began took gave held kept made met found rose co-founded cofounded co-led owned cofound co-found"
  ).split(/\s+/),
);

function isVerbStart(text: string): boolean {
  const w = text.trim().split(/[\s,]+/)[0]?.toLowerCase().replace(/[^a-z-]/g, "") ?? "";
  if (!w) return false;
  if (VERBS.has(w)) return true;
  if (/ed$/.test(w) && w.length > 4) return true;
  const base = w.replace(/(ied)$/, "y").replace(/(ed|es|s)$/, "");
  return VERBS.has(base) || VERBS.has(`${base}e`);
}

/** Irregular past forms: already fine after any subject, never conjugated. */
const PAST_IRREGULAR = new Set("built ran led grew drove set spoke sold taught brought began took gave held kept made met found rose won wrote cut co-led co-founded cofounded owned".split(" "));

/** Third-person present for a leading present-tense verb ("lead a team" → "leads a team"). */
function thirdPerson(text: string): string {
  const conj = (w: string) => {
    const lw = w.toLowerCase();
    if (/(ed|s)$/i.test(w) || PAST_IRREGULAR.has(lw) || !VERBS.has(lw)) return w;
    if (/(sh|ch|x|ss|o)$/i.test(w)) return `${w}es`;
    if (/[^aeiou]y$/i.test(w)) return `${w.slice(0, -1)}ies`;
    return `${w}s`;
  };
  return text.replace(/^(\S+)/, (m) => conj(m)).replace(/\band (\w+)\b/, (m, v: string) => (VERBS.has(v.toLowerCase()) ? `and ${conj(v)}` : m));
}

function article(phrase: string): string {
  const w = phrase.trim();
  if (/^(uni|use|usu|one|eu|ux\b|ui\b|us\b)/i.test(w)) return `a ${w}`;
  if (/^(hour|honest|heir|mba|msc|ma\b|ms\b|mfa|md\b|mph|seo|sre|svp|evp|fbi|llm\b|nlp|rn\b|hr\b)/i.test(w)) return `an ${w}`;
  if (/^[A-Z]{2,}/.test(w)) return /^[AEFHILMNORSX]/.test(w) ? `an ${w}` : `a ${w}`;
  return /^[aeiou]/i.test(w) ? `an ${w}` : `a ${w}`;
}

function sentence(text: string, lang: Lang): string {
  const t = stripTrailingPunct(text.trim());
  if (!t) return "";
  return lang === "zh" ? `${t}。` : `${t[0].toUpperCase()}${t.slice(1)}.`;
}

function yearOf(d: string | null | undefined): string | null {
  return d ? d.slice(0, 4) : null;
}

/* ------------------------------------------------------------------ the document builder */

class Draft {
  readonly paras: Para[] = [];
  readonly gaps: ContentGap[] = [];
  readonly notes = new Set<string>();
  constructor(readonly lang: Lang) {}

  private push(p: Para): void {
    if (p.sentences.length || p.role === "gap") this.paras.push(p);
  }

  subject(text: string, ids: string[]): void {
    this.push({ role: "subject", type: "field", label: this.lang === "zh" ? "主题" : "Subject", sentences: [{ text, ids }], priority: 99, flags: [] });
  }
  greeting(text: string): void {
    this.push({ role: "greeting", type: "paragraph", sentences: [{ text, ids: [] }], priority: 99, flags: [] });
  }
  context(text: string, priority = 90): void {
    this.push({ role: "context", type: "paragraph", sentences: [{ text, ids: [] }], priority, flags: [] });
  }
  heading(text: string, ids: string[] = []): void {
    this.push({ role: "heading", type: "heading", sentences: [{ text, ids }], priority: 95, flags: [] });
  }
  /** A claim paragraph: sentences without fact ids are dropped (the honesty rule). */
  body(sentences: Array<Sent | null>, priority = 50): void {
    const ok = sentences.filter((s): s is Sent => s !== null && s.ids.length > 0 && s.text.trim().length > 0);
    this.push({ role: "body", type: "paragraph", sentences: ok, priority, flags: [] });
  }
  bullet(s: Sent | null, priority = 40): void {
    if (s && s.ids.length) this.push({ role: "body", type: "bullet", sentences: [s], priority, flags: [] });
  }
  /** The person's own words, verbatim. */
  answer(key: string, text: string, priority = 80): void {
    this.push({ role: "body", type: "paragraph", sentences: [{ text: text.trim(), ids: [`answer:${key}`] }], priority, flags: [] });
  }
  gap(key: string, question: string, placeholder: string, priority = 85): void {
    if (!this.gaps.some((g) => g.key === key)) this.gaps.push({ key, question });
    this.push({ role: "gap", type: "paragraph", sentences: [{ text: placeholder, ids: [] }], priority, flags: ["needs_confirmation"] });
  }
  closing(text: string): void {
    this.push({ role: "closing", type: "paragraph", sentences: [{ text, ids: [] }], priority: 98, flags: [] });
  }
  signature(lines: string[], ids: string[]): void {
    const text = lines.filter(Boolean).join("\n");
    if (text) this.push({ role: "signature", type: "paragraph", sentences: [{ text, ids }], priority: 99, flags: [] });
  }

  private render(p: Para): string {
    return p.sentences.map((s) => s.text).join(this.lang === "zh" ? "" : " ");
  }

  words(): number {
    return this.paras.filter((p) => p.role !== "subject").reduce((n, p) => n + countWords(this.render(p)), 0);
  }

  /** Trims to the word budget: last sentences of the lowest-priority claim paragraphs first. */
  fit(maxWords: number | undefined): void {
    if (!maxWords) return;
    let guard = 200;
    while (this.words() > maxWords && guard-- > 0) {
      const bodies = this.paras.filter((p) => p.role === "body").sort((a, b) => a.priority - b.priority);
      const multi = bodies.find((p) => p.sentences.length > 1);
      if (multi) {
        multi.sentences.pop();
        continue;
      }
      const victim = bodies.length > 1 ? bodies[0] : null;
      if (!victim) break;
      this.paras.splice(this.paras.indexOf(victim), 1);
    }
  }

  build(kind: ComposedDocument["kind"], title: string): ComposedDocument {
    const blocks: ComposedBlock[] = this.paras.map((p) => ({
      type: p.type,
      role: p.role,
      ...(p.label ? { label: p.label } : {}),
      text: this.render(p),
      factIds: uniq(p.sentences.flatMap((s) => s.ids), (x) => x),
      flags: p.flags,
    }));
    return {
      format: "blocks",
      kind,
      language: this.lang,
      title,
      blocks,
      gaps: this.gaps,
      notes: [...this.notes],
      factIds: uniq(blocks.flatMap((b) => b.factIds), (x) => x),
      wordCount: blocks.filter((b) => b.role !== "subject").reduce((n, b) => n + countWords(b.text), 0),
      label: "drafted_from_profile",
    };
  }
}

/* ------------------------------------------------------------------ shared pieces */

interface Ctx {
  view: FactView;
  lang: Lang;
  opp: Opp | null;
  org: string | null;
  answers: Record<string, string>;
  keywords: Set<string>;
  now: Date;
  third: boolean;
  doc: Draft;
}

const STOP = new Set("the and for with from that this your you our are will have has into about their they them was were been being which while where when what how who all any can its it's not but also more most other such than then there these those very just over under within across per via using use used team role work working job position company program application apply candidate experience years year skills".split(" "));

function keywordsOf(opp: Opp | null): Set<string> {
  const text = [opp?.name, opp?.summary, opp?.description?.slice(0, 3000), ...(opp?.tags ?? []), ...(opp?.functions ?? []), ...(opp?.industries ?? [])].filter(Boolean).join(" ").toLowerCase();
  const out = new Set<string>();
  for (const w of text.match(/[a-z][a-z0-9+#.-]{3,}/g) ?? []) if (!STOP.has(w)) out.add(w.replace(/[.-]+$/, ""));
  for (const run of text.match(/[一-鿿]{2,}/g) ?? []) for (let i = 0; i + 2 <= run.length; i++) out.add(run.slice(i, i + 2));
  return out;
}

function overlap(text: string, keywords: Set<string>): number {
  if (!keywords.size) return 0;
  const lower = text.toLowerCase();
  let n = 0;
  for (const k of keywords) if (lower.includes(k)) n++;
  return n;
}

function quoteForeign(ctx: Ctx, text: string): string {
  const foreign = ctx.lang === "zh" ? !hasCjk(text) : hasCjk(text);
  if (!foreign) return text;
  ctx.doc.notes.add(ctx.lang === "zh" ? "部分内容引用自你的英文材料（原文保留在引号中），如需全中文请在发送前翻译。" : "Some lines are quoted in the original language of your documents; translate them before sending if needed.");
  return ctx.lang === "zh" ? `「${stripTrailingPunct(text)}」` : `"${stripTrailingPunct(text)}"`;
}

interface Highlight {
  text: string;
  exp: Exp;
  ids: string[];
  score: number;
}

function topHighlights(ctx: Ctx, limit: number): Highlight[] {
  const exps = ctx.view.rankedExperiences().slice(0, 4);
  const out: Highlight[] = [];
  exps.forEach((e, rank) => {
    for (const h of e.value.highlights) {
      const text = stripTrailingPunct(h);
      if (text.length < 12) continue;
      out.push({ text, exp: e.value, ids: e.ids, score: (isQuantified(text) ? 3 : 0) + overlap(text, ctx.keywords) * 1.5 + (4 - rank) * 0.5 });
    }
  });
  out.sort((a, b) => b.score - a.score);
  // At most two from the same role so the letter covers more than one job.
  const per = new Map<string, number>();
  const picked: Highlight[] = [];
  for (const h of out) {
    const n = per.get(h.exp.id) ?? 0;
    if (n >= 2) continue;
    per.set(h.exp.id, n + 1);
    picked.push(h);
    if (picked.length >= limit) break;
  }
  return picked;
}

/** One highlight as a sentence; `again` = same organisation as the previous sentence ("I also…"). */
function highlightSentence(ctx: Ctx, h: Highlight, again = false): Sent {
  const org = h.exp.organization;
  const name = ctx.view.firstName() ?? "";
  if (ctx.lang === "zh") {
    const who = ctx.third ? name : "我";
    const lead = again ? `${who}还` : `在${org}，${who}`;
    const t = quoteForeign(ctx, h.text);
    if (t !== h.text) return { text: `${again ? `${who}的成果还包括` : `在${org}，${who}的主要成果包括`}：${t}。`, ids: h.ids };
    return { text: `${lead}${stripTrailingPunct(h.text)}。`, ids: h.ids };
  }
  if (hasCjk(h.text)) return { text: `${again ? "Also" : `At ${org}`}: ${quoteForeign(ctx, h.text)}.`, ids: h.ids };
  if (isVerbStart(h.text)) {
    const verbPhrase = lowerFirst(h.text);
    const subject = ctx.third ? `${name}${again ? " also" : ""} ${thirdPerson(verbPhrase)}` : `I${again ? " also" : ""} ${verbPhrase}`;
    return { text: again ? `${subject[0].toUpperCase()}${subject.slice(1)}.` : `At ${org}, ${subject}.`, ids: h.ids };
  }
  return { text: again ? `${ctx.third ? `${name}'s` : "My"} work there also included ${lowerFirst(h.text)}.` : `At ${org}, ${ctx.third ? `${name}'s` : "my"} work included ${lowerFirst(h.text)}.`, ids: h.ids };
}

/** Highlights as consecutive sentences, avoiding "At X, … At X, …" repetition. */
function highlightSentences(ctx: Ctx, hs: Highlight[]): Sent[] {
  return hs.map((h, i) => highlightSentence(ctx, h, i > 0 && hs[i - 1].exp.id === h.exp.id));
}

function currentRoleSentence(ctx: Ctx, withYears = true): Sent | null {
  const exps = ctx.view.rankedExperiences();
  const cur = exps.find((e) => e.value.current && e.value.employmentType !== "internship");
  const years = withYears ? ctx.view.years(ctx.now) : null;
  const name = ctx.view.firstName() ?? "";
  const zh = ctx.lang === "zh";
  if (cur) {
    const e = cur.value;
    const ids = [...cur.ids, ...(years?.ids ?? [])];
    if (zh) return { text: `${ctx.third ? name : "我"}目前在${e.organization}担任${e.title}${years ? `，拥有 ${years.value} 年相关工作经验` : ""}。`, ids };
    const who = ctx.third ? `${name} is` : "I'm";
    return { text: `${who} currently ${article(e.title)} at ${e.organization}${years ? `, with ${years.value} years of professional experience` : ""}.`, ids };
  }
  const study = ctx.view.education().find((e) => e.value.current);
  if (study) {
    const s = study.value;
    if (zh) return { text: `${ctx.third ? name : "我"}目前在${s.institution}${s.field ? `攻读${s.field}` : "就读"}${s.degree ? `（${s.degree}）` : ""}${s.endDate ? `，预计 ${yearOf(s.endDate)} 年毕业` : ""}。`, ids: study.ids };
    return {
      text: `${ctx.third ? `${name} is` : "I'm"} ${s.degree ? `completing ${article(s.degree)}` : "studying"}${s.field ? ` in ${s.field}` : ""} at ${s.institution}${s.endDate ? `, graduating in ${yearOf(s.endDate)}` : ""}.`,
      ids: study.ids,
    };
  }
  const last = exps[0];
  if (last) {
    const e = last.value;
    if (zh) return { text: `${ctx.third ? name : "我"}最近在${e.organization}担任${e.title}。`, ids: last.ids };
    return { text: `Most recently, ${ctx.third ? name : "I"} worked as ${article(e.title)} at ${e.organization}.`, ids: last.ids };
  }
  const v = ctx.view.venture();
  if (v) {
    const c = v.company;
    if (zh) return { text: `${ctx.third ? name : "我"}正在创办${c.value}。`, ids: c.ids };
    return { text: `${ctx.third ? `${name} is` : "I'm"} building ${c.value}.`, ids: c.ids };
  }
  return null;
}

function skillsSentence(ctx: Ctx, max = 5): Sent | null {
  const skills = ctx.view.skills();
  if (!skills.length) return null;
  const ranked = [...skills].sort((a, b) => overlap(b.value, ctx.keywords) - overlap(a.value, ctx.keywords)).slice(0, max);
  const list = joinList(ranked.map((s) => s.value), ctx.lang);
  const ids = ranked.flatMap((s) => s.ids);
  const name = ctx.view.firstName() ?? "";
  if (ctx.lang === "zh") return { text: `${ctx.third ? name : "我"}常用的工具和方法包括${list}。`, ids };
  return { text: `${ctx.third ? `${name}'s` : "My"} core tools and methods include ${list}.`, ids };
}

function projectSentence(ctx: Ctx): Sent | null {
  const projects = ctx.view.projects();
  if (!projects.length) return null;
  const p = [...projects].sort((a, b) => overlap(`${b.value.name} ${b.value.summary ?? ""}`, ctx.keywords) - overlap(`${a.value.name} ${a.value.summary ?? ""}`, ctx.keywords) || Number(isQuantified(b.value.summary ?? "")) - Number(isQuantified(a.value.summary ?? "")))[0];
  const detail = p.value.summary ?? p.value.highlights[0] ?? null;
  if (ctx.lang === "zh") return { text: detail ? `项目经历方面，「${p.value.name}」：${stripTrailingPunct(quoteForeign(ctx, detail))}。` : `项目经历方面，包括「${p.value.name}」。`, ids: p.ids };
  if (!detail) return { text: `${ctx.third ? `${ctx.view.firstName()}'s` : "My"} projects include ${p.value.name}.`, ids: p.ids };
  const d = hasCjk(detail) ? quoteForeign(ctx, detail) : lowerFirst(stripTrailingPunct(detail));
  return { text: `One project ${ctx.third ? "of note" : "I can point to"} is ${p.value.name}: ${d}.`, ids: p.ids };
}

function educationSentence(ctx: Ctx): Sent | null {
  const edu = ctx.view.education().find((e) => !e.value.current) ?? null;
  if (!edu) return null;
  const e = edu.value;
  const name = ctx.view.firstName() ?? "";
  if (ctx.lang === "zh") return { text: `${ctx.third ? name : "我"}毕业于${e.institution}${e.field ? `${e.field}专业` : ""}${e.degree ? `（${e.degree}）` : ""}。`, ids: edu.ids };
  if (!e.degree && !e.field) return { text: `${ctx.third ? name : "I"} studied at ${e.institution}.`, ids: edu.ids };
  return { text: `${ctx.third ? `${name} holds` : "I hold"} ${e.degree ? article(e.degree) : "a degree"}${e.field ? ` in ${e.field}` : ""} from ${e.institution}.`, ids: edu.ids };
}

function contactLine(view: FactView): { text: string; ids: string[] } {
  const parts: Array<Backed<string>> = [view.email(), view.phone()].filter((x): x is Backed<string> => x !== null);
  const site = view.links().find((l) => ["website", "portfolio", "github", "behance", "dribbble"].includes(l.value.kind));
  return {
    text: [...parts.map((p) => p.value), site?.value.url].filter(Boolean).join(" · "),
    ids: [...parts.flatMap((p) => p.ids), ...(site?.ids ?? [])],
  };
}

function signOff(ctx: Ctx, closingWord: { en: string; zh: string }): void {
  const name = ctx.view.name();
  const contact = contactLine(ctx.view);
  if (!name) {
    ctx.doc.gap("name", ctx.lang === "zh" ? "申请材料上的署名是？" : "What name should we sign with?", ctx.lang === "zh" ? "【署名：你的姓名】" : "[Signature: your full name]", 99);
    return;
  }
  ctx.doc.signature([ctx.lang === "zh" ? closingWord.zh : closingWord.en, name.value, contact.text], [...name.ids, ...contact.ids]);
}

function orgOf(opp: Opp | null): string | null {
  return opp?.orgName?.trim() || null;
}

function greetingFor(ctx: Ctx, contactName: string | null | undefined, tone: string, fallbackEn: string, fallbackZh: string): string {
  const org = ctx.org;
  if (ctx.lang === "zh") {
    if (contactName) return `${contactName}您好：`;
    return org ? `尊敬的${org}团队：` : fallbackZh;
  }
  const hello = tone === "warm" || tone === "enthusiastic" ? "Hello" : tone === "concise" ? "Hi" : "Dear";
  if (contactName) return `${hello} ${contactName},`;
  return org ? `${hello} ${org} team,` : fallbackEn;
}

function whyGap(ctx: Ctx, key = "why_this"): void {
  const jobLike = ctx.opp ? JOB_TYPES.has(ctx.opp.type) : false;
  const target = jobLike && ctx.org ? ctx.org : ctx.opp?.name ?? ctx.org ?? (ctx.lang === "zh" ? "这个机会" : "this opportunity");
  if (ctx.answers[key]) {
    ctx.doc.answer(key, ctx.answers[key]);
    return;
  }
  if (ctx.lang === "zh") ctx.doc.gap(key, `是什么吸引你申请${target}？用一两句话说说你自己的理由。`, `【为什么是${target}：请用一两句话写你自己的理由——我们不会替你编写动机】`);
  else ctx.doc.gap(key, `What draws you to ${target}? One or two sentences in your own words.`, `[Why ${target}: add one or two sentences in your own words — we never write your motivation for you.]`);
}

/* ------------------------------------------------------------------ kinds */

function coverLetter(ctx: Ctx, tone: string, contactName: string | null | undefined): string {
  const { doc, opp, org, lang } = ctx;
  const zh = lang === "zh";
  doc.greeting(greetingFor(ctx, contactName, tone, "Dear Hiring Manager,", "尊敬的招聘负责人："));
  if (opp) {
    const jobLike = JOB_TYPES.has(opp.type);
    if (zh) doc.context(jobLike ? `我希望应聘${org ? `贵司的` : ""}${opp.name}一职。` : `我希望申请${opp.name}${org && !opp.name.includes(org) ? `（${org}）` : ""}。`);
    else doc.context(jobLike ? `I'm writing to apply for the ${opp.name} position${org ? ` at ${org}` : ""}.` : `I'm writing to apply to ${opp.name}${org && !opp.name.includes(org) ? ` at ${org}` : ""}.`);
  }
  doc.body([currentRoleSentence(ctx)], 70);
  doc.body(highlightSentences(ctx, topHighlights(ctx, 3)), 60);
  doc.body([skillsSentence(ctx), projectSentence(ctx)], 30);
  const student = ctx.view.education().some((e) => e.value.current) || !ctx.view.experiences().length;
  if (!student) doc.body([educationSentence(ctx)], 20);
  whyGap(ctx);
  doc.closing(
    zh
      ? `感谢您抽出时间阅读我的申请，期待有机会进一步交流${org ? `我能为${org}带来的价值` : ""}。`
      : `Thank you for considering my application. I'd welcome the chance to talk about how I could contribute${org ? ` to ${org}` : ""}.`,
  );
  signOff(ctx, { en: tone === "warm" ? "Warm regards," : "Sincerely,", zh: "此致\n敬礼" });
  return zh ? `求职信——${[org, opp?.name].filter(Boolean).join(" ")}`.replace(/——$/, "") : `Cover letter${opp ? ` — ${opp.name}${org ? ` at ${org}` : ""}` : ""}`;
}

function founderIntro(ctx: Ctx, v: VentureView): Sent | null {
  const name = ctx.view.name();
  const company = v.company;
  const role = v.field("role");
  const one = v.field("oneLiner");
  const zh = ctx.lang === "zh";
  const ids = [...(name?.ids ?? []), ...company.ids, ...(role?.ids ?? []), ...(one?.ids ?? [])];
  if (zh) {
    const who = name ? `我是${name.value}，` : "";
    return { text: `${who}${role ? `${company.value}的${role.value}` : `正在创办${company.value}`}${one ? `。${company.value}：${stripTrailingPunct(one.value)}` : ""}。`, ids };
  }
  const who = name ? `I'm ${name.value}, ` : "I'm ";
  const what = role ? `${role.value} of ${company.value}` : `building ${company.value}`;
  if (!one) return { text: `${who}${what}.`, ids };
  const line = stripTrailingPunct(quoteForeign(ctx, one.value));
  const pitch = isVerbStart(line) ? `, which ${thirdPerson(lowerFirst(line))}` : ` — ${lowerFirst(line)}`;
  return { text: `${who}${what}${pitch}.`, ids };
}

function tractionSentence(ctx: Ctx, v: VentureView, max = 3): Sent | null {
  const items = v.traction().slice(0, max);
  if (!items.length) return null;
  const list = items.map((t) => stripTrailingPunct(quoteForeign(ctx, t.value)));
  const ids = items.flatMap((t) => t.ids);
  if (ctx.lang === "zh") return { text: `目前的进展：${list.join("；")}。`, ids };
  return { text: `Traction so far: ${list.map((l, i) => (i === 0 ? l : lowerFirst(l))).join("; ")}.`, ids };
}

function teamSentence(ctx: Ctx, v: VentureView): Sent | null {
  const team = v.team();
  const size = v.field("teamSize");
  const zh = ctx.lang === "zh";
  if (!team.length && !size) return null;
  const people = team.map((m) => (zh ? `${m.value.name}${m.value.role ? `（${m.value.role}${m.value.background ? `，${m.value.background}` : ""}）` : ""}` : `${m.value.name}${m.value.role ? ` (${m.value.role}${m.value.background ? `, ${m.value.background}` : ""})` : ""}`));
  const ids = [...team.flatMap((m) => m.ids), ...(size?.ids ?? [])];
  if (zh) return { text: `团队：${people.join("、")}${size ? `${people.length ? "，" : ""}共 ${size.value} 人` : ""}。`, ids };
  return { text: `${people.length ? `The team: ${joinList(people, "en")}` : "The team"}${size ? `${people.length ? "; " : " is "}${size.value} people${people.length ? " in total" : ""}` : ""}.`, ids };
}

function askSentence(ctx: Ctx, v: VentureView): Sent | null {
  const raising = v.raising();
  const round = v.field("round");
  const use = v.field("useOfFunds");
  if (!raising) return null;
  const ids = [...raising.ids, ...(round?.ids ?? []), ...(use?.ids ?? [])];
  if (ctx.lang === "zh") return { text: `我们正在进行${round ? `${round.value} ` : ""}融资，本轮金额 ${raising.value}${use ? `，资金将用于：${stripTrailingPunct(use.value)}` : ""}。`, ids };
  const roundText = round && !raising.value.toLowerCase().includes(round.value.toLowerCase()) ? ` ${round.value}` : "";
  return { text: `We're raising ${raising.value}${roundText}${use ? `; use of funds: ${lowerFirst(stripTrailingPunct(use.value))}` : ""}.`, ids };
}

function investorEmail(ctx: Ctx, tone: string, contactName: string | null | undefined): string {
  const { doc, lang } = ctx;
  const zh = lang === "zh";
  const v = ctx.view.venture();
  if (!v) {
    doc.gap("company", zh ? "你的公司叫什么？一句话介绍它做什么。" : "What's your company called, and what does it do in one sentence?", zh ? "【公司名称与一句话介绍】" : "[Your company and what it does, in one sentence]", 99);
    signOff(ctx, { en: "Best,", zh: "祝好" });
    return zh ? "投资人邮件" : "Email to an investor";
  }
  const one = v.field("oneLiner");
  const round = v.field("round");
  doc.subject(zh ? `${v.company.value}${one ? `：${stripTrailingPunct(one.value)}` : ""}${round ? `（${round.value}）` : ""}` : `${v.company.value}${round ? ` (${round.value})` : ""}${one ? ` — ${stripTrailingPunct(one.value)}` : ""}`, [...v.company.ids, ...(one?.ids ?? []), ...(round?.ids ?? [])]);
  doc.greeting(greetingFor(ctx, contactName?.split(/\s+/)[0], tone === "professional" ? "concise" : tone, "Hi there,", "您好："));
  doc.body([founderIntro(ctx, v)], 90);
  const problem = v.field("problem");
  const product = v.field("product");
  doc.body(
    [
      problem ? { text: zh ? `我们要解决的问题：${stripTrailingPunct(quoteForeign(ctx, problem.value))}。` : `The problem: ${lowerFirst(stripTrailingPunct(quoteForeign(ctx, problem.value)))}.`, ids: problem.ids } : null,
      product ? { text: zh ? `我们的方案：${stripTrailingPunct(quoteForeign(ctx, product.value))}。` : sentence(quoteForeign(ctx, product.value), "en"), ids: product.ids } : null,
    ],
    60,
  );
  doc.body([tractionSentence(ctx, v)], 80);
  doc.body([teamSentence(ctx, v)], 40);
  const ask = askSentence(ctx, v);
  if (ask) doc.body([ask], 85);
  else doc.gap("raising", zh ? `${v.company.value} 本轮计划融资多少？什么轮次？` : `How much is ${v.company.value} raising, and in what round?`, zh ? "【本轮融资金额与轮次】" : "[How much you're raising, and the round]");
  // Why this investor: only the founder knows (a portfolio company, a thesis they read).
  if (ctx.answers.why_investor || ctx.answers.why_this) ctx.doc.answer(ctx.answers.why_investor ? "why_investor" : "why_this", ctx.answers.why_investor ?? ctx.answers.why_this);
  else
    doc.gap(
      "why_investor",
      zh ? `为什么联系${ctx.org ?? "这位投资人"}？提一个你真正研究过的投资案例或投资方向。` : `Why ${ctx.org ?? "this investor"}? Mention a portfolio company or thesis you've genuinely looked at.`,
      zh ? `【为什么是${ctx.org ?? "这位投资人"}：一句你自己的话】` : `[Why ${ctx.org ?? "this investor"}: one sentence in your own words]`,
    );
  // Offer the deck only when there is one (a venture read from an uploaded deck or business plan).
  const hasDeck = Boolean(v.venture.deckDocumentId);
  doc.closing(
    zh
      ? `如果方便，能否在未来两周内约 20 分钟聊聊？${hasDeck ? "我可以提前发送完整材料。" : "如有需要，我可以补充更多信息。"}`
      : `Would you be open to a 20-minute call in the next two weeks? ${hasDeck ? "Happy to send the full deck ahead of time." : "Happy to share more detail if useful."}`,
  );
  signOff(ctx, { en: "Best,", zh: "祝好" });
  return zh ? `投资人邮件——${v.company.value}${ctx.org ? ` → ${ctx.org}` : ""}` : `Investor email — ${v.company.value}${ctx.org ? ` → ${ctx.org}` : ""}`;
}

function recruiterEmail(ctx: Ctx, tone: string, contactName: string | null | undefined): string {
  const { doc, lang, opp, org } = ctx;
  const zh = lang === "zh";
  const cur = ctx.view.rankedExperiences()[0];
  const headline = ctx.view.headline();
  const subjectIds = [...(cur?.ids ?? []), ...(headline?.ids ?? [])];
  const who = headline?.value ?? cur?.value.title;
  if (who) doc.subject(zh ? `${who}${opp ? ` 对${org ?? ""}${opp.name}感兴趣` : " 寻求新机会"}` : `${who}${opp ? ` — interested in ${opp.name}${org ? ` at ${org}` : ""}` : " — open to new roles"}`, subjectIds);
  else if (opp) doc.subject(zh ? `关于${opp.name}` : `About ${opp.name}`, []);
  doc.greeting(greetingFor(ctx, contactName?.split(/\s+/)[0], tone === "professional" ? "concise" : tone, "Hi there,", "您好："));
  if (opp) doc.context(zh ? `看到${org ? `${org}的` : ""}${opp.name}，想主动和您联系。` : `I came across the ${opp.name} opening${org ? ` at ${org}` : ""} and wanted to reach out directly.`);
  doc.body([currentRoleSentence(ctx)], 80);
  doc.body(highlightSentences(ctx, topHighlights(ctx, 2)), 60);
  doc.body([skillsSentence(ctx, 4)], 30);
  if (ctx.answers.why_this) ctx.doc.answer("why_this", ctx.answers.why_this);
  doc.closing(zh ? `不知您这周或下周是否方便沟通 15 分钟${opp ? `，聊聊${opp.name}` : ""}？` : `Would you have 15 minutes this week or next to talk${opp ? ` about the ${opp.name} role` : ""}?`);
  signOff(ctx, { en: "Thanks,", zh: "谢谢" });
  return zh ? `给招聘方的邮件${org ? `——${org}` : ""}` : `Email to a recruiter${org ? ` — ${org}` : ""}`;
}

function professorEmail(ctx: Ctx, tone: string, contactName: string | null | undefined): string {
  const { doc, lang, opp, org } = ctx;
  const zh = lang === "zh";
  const fields = ctx.view.researchFields();
  const seeking = opp?.type === "postdoc" ? (zh ? "博士后" : "postdoc") : opp?.type === "phd_position" ? (zh ? "博士生" : "PhD student") : opp?.type === "visiting_scholar" ? (zh ? "访问学者" : "visiting researcher") : zh ? "研究合作" : "research collaborator";
  doc.subject(zh ? `${seeking}申请咨询${fields[0] ? `：${fields[0].value}` : ""}` : `Prospective ${seeking}${fields[0] ? `: ${fields[0].value}` : ""}`, fields[0]?.ids ?? []);
  const prof = contactName ? (zh ? `${contactName}教授您好：` : `Dear Professor ${contactName.split(/\s+/).pop()},`) : zh ? "尊敬的教授：" : "Dear Professor,";
  doc.greeting(prof);
  const name = ctx.view.name();
  const intro = currentRoleSentence(ctx, false);
  doc.body([name ? { text: zh ? `我是${name.value}。` : `My name is ${name.value}.`, ids: name.ids } : null, intro], 90);
  if (fields.length) {
    const f = fields.slice(0, 3);
    doc.body([{ text: zh ? `我的研究方向是${joinList(f.map((x) => x.value), "zh")}。` : `My research focuses on ${joinList(f.map((x, i) => (i === 0 ? lowerFirst(x.value) : x.value)), "en")}.`, ids: f.flatMap((x) => x.ids) }], 70);
  }
  const pubs = ctx.view.publications().sort((a, b) => overlap(b.value.title, ctx.keywords) - overlap(a.value.title, ctx.keywords) || (b.value.year ?? 0) - (a.value.year ?? 0)).slice(0, 2);
  if (pubs.length) {
    const cite = (p: (typeof pubs)[number]) => (zh ? `《${p.value.title}》${p.value.venue ? `（${p.value.venue}${p.value.year ? `，${p.value.year}` : ""}）` : p.value.year ? `（${p.value.year}）` : ""}` : `"${p.value.title}"${p.value.venue || p.value.year ? ` (${[p.value.venue, p.value.year].filter(Boolean).join(", ")})` : ""}`);
    doc.body([{ text: zh ? `相关成果包括${pubs.map(cite).join("、")}。` : `Relevant work includes ${joinList(pubs.map(cite), "en")}.`, ids: pubs.flatMap((p) => p.ids) }], 60);
  } else doc.body(highlightSentences(ctx, topHighlights(ctx, 1)), 50);
  if (ctx.answers.research_interest) ctx.doc.answer("research_interest", ctx.answers.research_interest);
  else
    doc.gap(
      "research_interest",
      zh ? `${contactName ? `${contactName}教授` : "这位教授"}的哪篇论文或哪个项目让你感兴趣？为什么？` : `Which of ${contactName ? `Professor ${contactName.split(/\s+/).pop()}'s` : "the professor's"} papers or projects interests you, and why?`,
      zh ? "【你对教授某项研究的具体兴趣：一两句你自己的话】" : "[Your specific interest in the professor's work: one or two sentences in your own words]",
    );
  doc.closing(zh ? `请问您${opp?.type === "phd_position" ? "下一届是否招收博士生" : "近期是否有合适的机会"}？如有需要，我可以发送完整的 CV。` : `Are you ${opp?.type === "phd_position" ? "taking new PhD students" : "open to new members"} for the coming year? I'd be glad to send my full CV.`);
  void tone;
  signOff(ctx, { en: "With thanks,", zh: "此致\n敬礼" });
  return zh ? `给教授的邮件${org ? `——${org}` : ""}` : `Email to a professor${org ? ` — ${org}` : ""}`;
}

function pitchEmail(ctx: Ctx, kind: "email_editor" | "email_brand" | "email_client", tone: string, contactName: string | null | undefined): string {
  const { doc, lang, org } = ctx;
  const zh = lang === "zh";
  const headline = ctx.view.headline();
  const key = kind === "email_editor" ? "pitch" : kind === "email_brand" ? "collab_idea" : "offer";
  const subjectAnswer = ctx.answers[`${key}_title`] ?? null;
  if (subjectAnswer) doc.subject(subjectAnswer, [`answer:${key}_title`]);
  else if (headline) doc.subject(zh ? `${headline.value}${org ? ` × ${org}` : ""}` : `${headline.value}${org ? ` × ${org}` : ""}`, headline.ids);
  doc.greeting(greetingFor(ctx, contactName?.split(/\s+/)[0], tone === "professional" ? "concise" : tone, "Hi there,", "您好："));
  const name = ctx.view.name();
  const first: Array<Sent | null> = [];
  if (name && headline) first.push({ text: zh ? `我是${name.value}，${headline.value}。` : `I'm ${name.value}, ${article(headline.value)}.`.replace("a an", "an"), ids: [...name.ids, ...headline.ids] });
  else first.push(currentRoleSentence(ctx));
  if (kind === "email_brand") {
    const aud = ctx.view.audience().filter((a) => a.value.followers);
    if (aud.length) first.push({ text: zh ? `我的受众：${aud.map((a) => `${a.value.platform} ${a.value.followers}`).join("、")}。` : `My audience: ${joinList(aud.map((a) => `${a.value.followers!.toLocaleString("en-US")} followers on ${a.value.platform}`), "en")}.`, ids: aud.flatMap((a) => a.ids) });
  }
  doc.body(first, 90);
  if (kind === "email_editor") {
    const pubs = ctx.view.publications().slice(0, 2);
    if (pubs.length) doc.body([{ text: zh ? `我发表过的作品包括${pubs.map((p) => `《${p.value.title}》`).join("、")}。` : `My published work includes ${joinList(pubs.map((p) => `"${p.value.title}"${p.value.venue ? ` (${p.value.venue})` : ""}`), "en")}.`, ids: pubs.flatMap((p) => p.ids) }], 60);
    else doc.body(highlightSentences(ctx, topHighlights(ctx, 1)), 50);
  } else {
    const brands = ctx.view.brands().slice(0, 5);
    if (brands.length) doc.body([{ text: zh ? `合作过的品牌/客户包括${joinList(brands.map((b) => b.value), "zh")}。` : `I've worked with ${joinList(brands.map((b) => b.value), "en")}.`, ids: brands.flatMap((b) => b.ids) }], 70);
    doc.body([projectSentence(ctx), ...highlightSentences(ctx, topHighlights(ctx, 1))], 50);
  }
  if (ctx.answers[key]) ctx.doc.answer(key, ctx.answers[key]);
  else {
    const q = {
      pitch: zh ? ["你想投稿的选题是什么？用两句话概括。", "【选题：两句话说明你想写什么、为什么是现在】"] : ["What story do you want to pitch, in two sentences?", "[Your pitch: what you want to write and why now, in two sentences]"],
      collab_idea: zh ? ["你想和这个品牌做什么合作？", "【合作设想：一两句你自己的话】"] : ["What collaboration do you have in mind for this brand?", "[Your collaboration idea, in one or two sentences]"],
      offer: zh ? ["你能具体为这位客户做什么？", "【你的方案：具体能为对方做什么】"] : ["What exactly would you offer this client?", "[What you'd offer them, specifically]"],
    }[key]!;
    doc.gap(key, q[0], q[1]);
  }
  // A closing offers only what the profile actually holds (rates, audience numbers, past brands).
  const creator = ctx.view.profile.packs.creator;
  const hasRates = Boolean(creator?.rates && (creator.rates.min != null || creator.rates.max != null));
  const hasResults = ctx.view.audience().length > 0 || ctx.view.brands().length > 0;
  doc.closing(
    kind === "email_editor"
      ? zh
        ? "如果您感兴趣，我很乐意进一步展开。"
        : "If it's a fit, I'd be glad to develop it further."
      : kind === "email_brand"
        ? hasRates && hasResults
          ? zh
            ? "如果契合，我可以发送报价和过往合作数据。"
            : "If this fits your plans, I can share rates and past results."
          : hasRates
            ? zh
              ? "如果契合，我可以发送报价。"
              : "If this fits your plans, I can share my rates."
            : hasResults
              ? zh
                ? "如果契合，我可以发送过往合作数据。"
                : "If this fits your plans, I can share past results."
              : zh
                ? "如果契合，我很乐意进一步沟通细节。"
                : "If this fits your plans, I'd be glad to talk through the details."
        : zh
          ? "方便的话，我们可以约个时间聊聊需求。"
          : "If useful, I'd be glad to set up a short call to hear what you need.",
  );
  signOff(ctx, { en: "Best,", zh: "祝好" });
  const label = { email_editor: ["Pitch to an editor", "给编辑的投稿邮件"], email_brand: ["Brand partnership email", "品牌合作邮件"], email_client: ["Email to a prospective client", "给潜在客户的邮件"] }[kind];
  return `${label[zh ? 1 : 0]}${org ? (zh ? `——${org}` : ` — ${org}`) : ""}`;
}

function followUpEmail(ctx: Ctx, previous: ComposeInput["previous"], contactName: string | null | undefined): string {
  const { doc, lang, opp } = ctx;
  const zh = lang === "zh";
  const subj = previous?.subject?.trim();
  if (subj) doc.subject(/^re:/i.test(subj) ? subj : `Re: ${subj}`, []);
  doc.greeting(greetingFor(ctx, contactName?.split(/\s+/)[0], "concise", "Hi there,", "您好："));
  const when = previous?.sentAt ? new Date(previous.sentAt) : null;
  const days = when ? Math.max(1, Math.round((ctx.now.getTime() - when.getTime()) / 86_400_000)) : null;
  doc.context(
    zh
      ? `想跟进一下我${days ? ` ${days} 天前` : "之前"}发送的邮件${opp ? `（关于${opp.name}）` : ""}。`
      : `I wanted to follow up on my note${days ? ` from ${days === 1 ? "yesterday" : `${days} days ago`}` : ""}${opp ? ` about ${opp.name}` : ""}.`,
  );
  const v = ctx.view.venture();
  if (v) doc.body([tractionSentence(ctx, v, 1) ?? founderIntro(ctx, v)], 60);
  else doc.body([currentRoleSentence(ctx)], 60);
  doc.closing(zh ? "如果现在不方便，也完全理解；如有任何问题，我随时可以补充材料。" : "If now isn't the right time, no problem at all — I'm happy to send anything that would help.");
  signOff(ctx, { en: "Thanks,", zh: "谢谢" });
  return zh ? "跟进邮件" : "Follow-up email";
}

function bio(ctx: Ctx): string {
  const { doc, lang } = ctx;
  const zh = lang === "zh";
  const name = ctx.view.name();
  const first = ctx.view.firstName();
  const sentences: Array<Sent | null> = [];
  const exps = ctx.view.rankedExperiences();
  const cur = exps.find((e) => e.value.current) ?? null;
  if (name && cur) {
    sentences.push(
      ctx.third
        ? { text: zh ? `${name.value}现任${cur.value.organization}${cur.value.title}。` : `${name.value} is ${article(cur.value.title)} at ${cur.value.organization}.`, ids: [...name.ids, ...cur.ids] }
        : { text: zh ? `我是${name.value}，现任${cur.value.organization}${cur.value.title}。` : `I'm ${name.value}, ${article(cur.value.title)} at ${cur.value.organization}.`, ids: [...name.ids, ...cur.ids] },
    );
  } else if (name) {
    const v = ctx.view.venture();
    if (v) sentences.push({ text: zh ? `${name.value}正在创办${v.company.value}。` : `${name.value} is building ${v.company.value}.`, ids: [...name.ids, ...v.company.ids] });
    else sentences.push(currentRoleSentence(ctx, false));
  } else sentences.push(currentRoleSentence(ctx, false));
  const v = ctx.view.venture();
  if (v && cur) {
    const one = v.field("oneLiner");
    if (one) sentences.push({ text: zh ? `${v.company.value}：${stripTrailingPunct(one.value)}。` : `${v.company.value}: ${lowerFirst(stripTrailingPunct(one.value))}.`, ids: [...v.company.ids, ...one.ids] });
  }
  const hs = topHighlights(ctx, 2);
  sentences.push(...highlightSentences(ctx, hs));
  // Earlier roles not already mentioned through a highlight.
  const prev = exps.filter((e) => e !== cur && e.value.employmentType !== "internship" && !hs.some((h) => h.exp.id === e.value.id)).slice(0, 2);
  if (prev.length) {
    sentences.push({
      text: zh
        ? `此前，${ctx.third ? first : "我"}曾任${prev.map((p) => `${p.value.organization}${p.value.title}`).join("、")}。`
        : `Previously, ${ctx.third ? first : "I"} worked as ${joinList(prev.map((p) => `${article(p.value.title)} at ${p.value.organization}`), "en")}.`,
      ids: prev.flatMap((p) => p.ids),
    });
  }
  const fields = ctx.view.researchFields().slice(0, 3);
  if (fields.length) sentences.push({ text: zh ? `研究方向：${joinList(fields.map((f) => f.value), "zh")}。` : `${ctx.third ? `${first}'s` : "My"} research focuses on ${joinList(fields.map((f, i) => (i === 0 ? lowerFirst(f.value) : f.value)), "en")}.`, ids: fields.flatMap((f) => f.ids) });
  sentences.push(educationSentence(ctx));
  const award = ctx.view.achievements()[0];
  if (award) sentences.push({ text: zh ? `曾获${award.value.title}${award.value.date ? `（${award.value.date.slice(0, 4)}）` : ""}。` : `${ctx.third ? `${first}'s` : "My"} recognition includes ${award.value.title}${award.value.issuer ? ` (${award.value.issuer})` : ""}.`, ids: award.ids });
  doc.body(sentences, 60);
  if (!name) doc.gap("name", zh ? "简介中使用的姓名是？" : "Which name should the bio use?", zh ? "【姓名】" : "[Your name]", 99);
  return zh ? "个人简介" : `Bio${name ? ` — ${name.value}` : ""}`;
}

function onePager(ctx: Ctx): string {
  const { doc, lang } = ctx;
  const zh = lang === "zh";
  const v = ctx.view.venture();
  const h = (en: string, cn: string) => doc.heading(zh ? cn : en);
  if (v) {
    doc.heading(v.company.value, v.company.ids);
    const one = v.field("oneLiner");
    if (one) doc.body([{ text: stripTrailingPunct(quoteForeign(ctx, one.value)), ids: one.ids }], 95);
    const section = (en: string, cn: string, field: string) => {
      const f = v.field(field);
      if (!f) return;
      h(en, cn);
      doc.body([{ text: sentence(quoteForeign(ctx, f.value), lang), ids: f.ids }], 70);
    };
    section("Problem", "问题", "problem");
    section("Solution", "方案", "product");
    section("Market", "市场", "market");
    section("Business model", "商业模式", "businessModel");
    const traction = v.traction();
    if (traction.length) {
      h("Traction", "进展");
      for (const t of traction.slice(0, 6)) doc.bullet({ text: stripTrailingPunct(quoteForeign(ctx, t.value)), ids: t.ids }, 80);
    }
    const team = v.team();
    if (team.length) {
      h("Team", "团队");
      for (const m of team) doc.bullet({ text: zh ? `${m.value.name}${m.value.role ? `，${m.value.role}` : ""}${m.value.background ? `，${m.value.background}` : ""}` : `${m.value.name}${m.value.role ? ` — ${m.value.role}` : ""}${m.value.background ? `, ${m.value.background}` : ""}`, ids: m.ids }, 60);
    }
    const ask = askSentence(ctx, v);
    h("The ask", "融资需求");
    if (ask) doc.body([ask], 85);
    else doc.gap("raising", zh ? "本轮融资金额与轮次？" : "How much are you raising, and in what round?", zh ? "【本轮融资金额与轮次】" : "[Amount and round]");
  } else {
    const name = ctx.view.name();
    if (name) doc.heading(name.value, name.ids);
    else doc.gap("name", zh ? "你的姓名？" : "Your name?", zh ? "【姓名】" : "[Your name]", 99);
    const headline = ctx.view.headline();
    if (headline) doc.body([{ text: headline.value, ids: headline.ids }], 95);
    const summary = ctx.view.summary();
    h("Summary", "简介");
    doc.body([summary ? { text: summary.value, ids: summary.ids } : currentRoleSentence(ctx)], 75);
    const hs = topHighlights(ctx, 5);
    if (hs.length) {
      h("Selected results", "代表成果");
      for (const x of hs) doc.bullet({ text: `${stripTrailingPunct(quoteForeign(ctx, x.text))}${zh ? `（${x.exp.organization}）` : ` (${x.exp.organization})`}`, ids: x.ids }, 70);
    }
    const pubs = ctx.view.publications().slice(0, 4);
    if (pubs.length) {
      h("Selected publications", "代表论文");
      for (const p of pubs) doc.bullet({ text: `${p.value.title}${p.value.venue ? `, ${p.value.venue}` : ""}${p.value.year ? ` (${p.value.year})` : ""}`, ids: p.ids }, 65);
    }
    const exps = ctx.view.rankedExperiences().slice(0, 4);
    if (exps.length) {
      h("Experience", "经历");
      for (const e of exps) doc.bullet({ text: zh ? `${e.value.organization} · ${e.value.title}${e.value.startDate ? `（${e.value.startDate.slice(0, 4)}–${e.value.current ? "至今" : (e.value.endDate ?? "").slice(0, 4)}）` : ""}` : `${e.value.title}, ${e.value.organization}${e.value.startDate ? ` (${e.value.startDate.slice(0, 4)}–${e.value.current ? "present" : (e.value.endDate ?? "").slice(0, 4)})` : ""}`, ids: e.ids }, 60);
    }
    const sk = skillsSentence(ctx, 8);
    if (sk) {
      h("Skills", "技能");
      doc.body([sk], 40);
    }
    const ed = ctx.view.education().slice(0, 2);
    if (ed.length) {
      h("Education", "教育");
      for (const e of ed) doc.bullet({ text: [e.value.degree, e.value.field, e.value.institution, yearOf(e.value.endDate)].filter(Boolean).join(zh ? " · " : ", "), ids: e.ids }, 45);
    }
  }
  const contact = contactLine(ctx.view);
  if (contact.text) {
    h("Contact", "联系方式");
    doc.body([{ text: contact.text, ids: contact.ids }], 99);
  }
  return zh ? "一页纸简介" : `One-pager${v ? ` — ${v.company.value}` : ""}`;
}

/* ------------------------------------------------------------------ application answers */

const QUESTION_PATTERNS: Array<[QuestionKey, RegExp]> = [
  ["why_this", /\bwhy (do you want|are you (interested|applying)|this|us|our|join|apply)|what (draws|attracts|interests) you|motivation|why (would|should) (you|we)|why now\b|为什么(想|要|申请|选择|加入)|申请动机|吸引你/i],
  ["proud_project", /proud|accomplishment|achievement you|most (impressive|significant)|project you('| a)re|best work|tell us about a project|最自豪|最有成就|代表作|印象最深的项目/i],
  ["startup_description", /describe (your|the) (company|startup|business|product)|what does your (company|startup) do|company description|elevator pitch|one[- ]liner|介绍(你的|一下)?(公司|项目|产品)|项目简介/i],
  ["problem", /what problem|problem (are you|you're) solving|pain point|解决什么问题|痛点/i],
  ["traction", /traction|progress|metrics|revenue|how many (users|customers)|milestones|kpi|进展|数据|营收|用户数|里程碑/i],
  ["team", /\bteam\b|co-?founders?|who (is|are) on|founding|团队|创始人/i],
  ["use_of_funds", /use of (funds|proceeds)|how will you (use|spend)|what (will|would) you do with (the )?(money|funding|grant)|资金用途|如何使用/i],
  ["availability", /availab|start date|when can you start|notice period|earliest start|到岗|入职时间|可以开始/i],
  ["research_interest", /research (interest|statement|plan|proposal)|research (area|direction)|研究(兴趣|方向|计划)/i],
  ["about_you", /tell us about yourself|about you|introduce yourself|describe yourself|your background|who are you|short bio|自我介绍|介绍(一下)?(你|自己)|个人简介/i],
  ["experience", /relevant experience|work experience|describe your experience|工作经历|相关经验/i],
  ["skills", /\bskills?\b|tools you|technolog(y|ies) you|proficien|技能|擅长/i],
  ["education", /education|degree|school|university|学历|教育/i],
];

export function classifyQuestion(text: string): QuestionKey {
  for (const [key, re] of QUESTION_PATTERNS) if (re.test(text)) return key;
  return "other";
}

function answerBody(ctx: Ctx, key: QuestionKey, questionText: string | undefined): void {
  const { doc, lang } = ctx;
  const zh = lang === "zh";
  const v = ctx.view.venture();
  const userAnswer = ctx.answers[key];
  switch (key) {
    case "why_this": {
      if (userAnswer) {
        doc.answer(key, userAnswer, 90);
        return;
      }
      // Only point at a connection the text supports (shared keywords), never assert a feeling.
      const h = topHighlights(ctx, 1)[0];
      if (h && ctx.opp && overlap(h.text, ctx.keywords) > 0) {
        const jobLike = JOB_TYPES.has(ctx.opp.type);
        const what = zh ? `${ctx.org && jobLike ? `${ctx.org}的` : ""}${ctx.opp.name}${jobLike ? "岗位" : ""}` : jobLike ? `The ${ctx.opp.name} role${ctx.org ? ` at ${ctx.org}` : ""}` : ctx.opp.name;
        doc.body([{ text: zh ? `${what}与我做过的工作直接相关：` : `${what} is close to work I've already done.`, ids: h.ids }, highlightSentence(ctx, h)], 60);
      }
      whyGap(ctx);
      return;
    }
    case "about_you": {
      if (userAnswer) return doc.answer(key, userAnswer, 90);
      const summary = ctx.view.summary();
      if (summary) doc.body([{ text: summary.value, ids: summary.ids }], 80);
      else doc.body([currentRoleSentence(ctx), ...highlightSentences(ctx, topHighlights(ctx, 2)), educationSentence(ctx)], 70);
      return;
    }
    case "proud_project": {
      if (userAnswer) return doc.answer(key, userAnswer, 90);
      const projects = ctx.view.projects().filter((p) => p.value.summary || p.value.highlights.length);
      const best = [...projects].sort((a, b) => Number(isQuantified(`${b.value.summary} ${b.value.highlights.join(" ")}`)) - Number(isQuantified(`${a.value.summary} ${a.value.highlights.join(" ")}`)))[0];
      const h = topHighlights(ctx, 2);
      if (best && (!h.length || isQuantified(`${best.value.summary ?? ""}`))) {
        const parts: Sent[] = [{ text: zh ? `想重点介绍的项目是「${best.value.name}」：${stripTrailingPunct(quoteForeign(ctx, best.value.summary ?? best.value.highlights[0]))}。` : `One project I'd point to is ${best.value.name}: ${lowerFirst(stripTrailingPunct(quoteForeign(ctx, best.value.summary ?? best.value.highlights[0])))}.`, ids: best.ids }];
        for (const x of best.value.highlights.slice(best.value.summary ? 0 : 1, 3)) parts.push({ text: sentence(quoteForeign(ctx, x), lang), ids: best.ids });
        doc.body(parts, 80);
      } else if (h.length) {
        doc.body([{ text: zh ? `想重点介绍的一项工作来自${h[0].exp.organization}：` : `One piece of work I'd point to is from ${h[0].exp.organization}.`, ids: h[0].ids }, highlightSentence(ctx, h[0]), ...(h[1] && h[1].exp.id === h[0].exp.id ? [highlightSentence(ctx, h[1])] : [])], 80);
      }
      if (!best && !h.length) doc.gap(key, zh ? "你最自豪的项目是什么？结果如何？" : "Which project are you proudest of, and what came of it?", zh ? "【你最自豪的项目与结果】" : "[The project you're proudest of and its result]");
      else if (!ctx.answers.proud_why) doc.gap("proud_why", zh ? "为什么这个项目对你特别重要？（可选，一句话）" : "Why does this project matter to you? (optional, one sentence)", zh ? "【可选：为什么这个项目对你重要】" : "[Optional: why this project matters to you]", 20);
      return;
    }
    case "startup_description": {
      if (!v) return void doc.gap("company", zh ? "你的公司做什么？" : "What does your company do?", zh ? "【公司介绍】" : "[What your company does]");
      const problem = v.field("problem");
      const product = v.field("product");
      doc.body([founderIntro(ctx, v), problem ? { text: zh ? `我们解决的问题：${stripTrailingPunct(quoteForeign(ctx, problem.value))}。` : `The problem: ${lowerFirst(stripTrailingPunct(quoteForeign(ctx, problem.value)))}.`, ids: problem.ids } : null, product ? { text: sentence(quoteForeign(ctx, product.value), lang), ids: product.ids } : null], 80);
      return;
    }
    case "problem": {
      const problem = v?.field("problem");
      if (problem) doc.body([{ text: sentence(quoteForeign(ctx, problem.value), lang), ids: problem.ids }], 80);
      else doc.gap(key, zh ? "你们要解决的问题是什么？" : "What problem are you solving?", zh ? "【要解决的问题】" : "[The problem you solve]");
      return;
    }
    case "traction": {
      const t = v ? tractionSentence(ctx, v, 5) : null;
      if (t) doc.body([t], 80);
      else doc.gap(key, zh ? "目前有哪些可以引用的数据（用户、客户、收入、增长）？" : "What traction can we cite (users, customers, revenue, growth)?", zh ? "【进展数据】" : "[Your traction: users, customers, revenue, growth]");
      return;
    }
    case "team": {
      const t = v ? teamSentence(ctx, v) : null;
      if (t) doc.body([t], 80);
      else doc.gap(key, zh ? "团队有哪些成员、各自背景如何？" : "Who is on the team, and what's their background?", zh ? "【团队成员与背景】" : "[Your team and their backgrounds]");
      return;
    }
    case "use_of_funds": {
      const ask = v ? askSentence(ctx, v) : null;
      const use = v?.field("useOfFunds");
      if (use && !ask) doc.body([{ text: sentence(quoteForeign(ctx, use.value), lang), ids: use.ids }], 80);
      else if (ask) doc.body([ask], 80);
      if (!use) doc.gap(key, zh ? "这笔资金将如何使用？" : "How would you use the funds?", zh ? "【资金用途】" : "[How you'd use the funds]");
      return;
    }
    case "availability": {
      if (userAnswer) return doc.answer(key, userAnswer, 90);
      const a = ctx.view.availableFrom();
      if (a) doc.body([{ text: zh ? `我最早可于 ${a.value} 开始。` : `I can start from ${a.value}.`, ids: a.ids }], 80);
      else doc.gap(key, zh ? "你最早什么时候可以开始？" : "When could you start?", zh ? "【最早开始时间】" : "[Your earliest start date]");
      return;
    }
    case "experience": {
      doc.body([currentRoleSentence(ctx), ...highlightSentences(ctx, topHighlights(ctx, 3))], 70);
      return;
    }
    case "skills": {
      const s = skillsSentence(ctx, 8);
      if (s) doc.body([s], 70);
      else doc.gap(key, zh ? "你最擅长的技能有哪些？" : "Which skills should we list?", zh ? "【主要技能】" : "[Your main skills]");
      return;
    }
    case "education": {
      const ed = ctx.view.education();
      if (ed.length) doc.body(ed.slice(0, 2).map((e) => ({ text: zh ? `${e.value.institution}${e.value.field ? ` ${e.value.field}` : ""}${e.value.degree ? `（${e.value.degree}）` : ""}${e.value.endDate ? `，${e.value.current ? "预计" : ""}${yearOf(e.value.endDate)} 年毕业` : ""}。` : `${[e.value.degree, e.value.field].filter(Boolean).join(" in ") || "Studies"} at ${e.value.institution}${e.value.endDate ? ` (${e.value.current ? "expected " : ""}${yearOf(e.value.endDate)})` : ""}.`, ids: e.ids })), 70);
      else doc.gap(key, zh ? "你的学历是？" : "What's your education?", zh ? "【学历】" : "[Your education]");
      return;
    }
    case "research_interest": {
      if (userAnswer) return doc.answer(key, userAnswer, 90);
      const f = ctx.view.researchFields().slice(0, 4);
      const pubs = ctx.view.publications().slice(0, 2);
      if (f.length) doc.body([{ text: zh ? `我的研究方向是${joinList(f.map((x) => x.value), "zh")}。` : `My research focuses on ${joinList(f.map((x) => x.value), "en")}.`, ids: f.flatMap((x) => x.ids) }, ...pubs.map((p) => ({ text: zh ? `代表成果：《${p.value.title}》${p.value.year ? `（${p.value.year}）` : ""}。` : `Recent work includes "${p.value.title}"${p.value.year ? ` (${p.value.year})` : ""}.`, ids: p.ids }))], 80);
      doc.gap("research_plan", zh ? "接下来你想研究什么？（一两句话）" : "What do you want to work on next? (one or two sentences)", zh ? "【下一步研究计划】" : "[What you want to work on next]");
      return;
    }
    default: {
      if (userAnswer) return doc.answer(key, userAnswer, 90);
      doc.gap(key, questionText ?? (zh ? "这个问题需要你本人回答。" : "This question needs your own answer."), zh ? "【需要你本人回答】" : "[Needs your own answer]");
    }
  }
}

/* ------------------------------------------------------------------ entry point */

const DEFAULT_WORDS: Partial<Record<ComposeInput["kind"], number>> = {
  cover_letter: 380,
  email_investor: 220,
  email_recruiter: 160,
  email_professor: 220,
  email_editor: 200,
  email_brand: 180,
  email_client: 180,
  email_follow_up: 90,
  answer: 200,
  bio: 140,
};

export function localCompose(raw: ComposeInput): ComposedDocument {
  const input = ComposeInput.parse(raw);
  const lang = input.language;
  const profile = readProfile(input.profile);
  const view = new FactView(profile, input.facts);
  const opp = input.opportunity ?? null;
  const doc = new Draft(lang);
  const ctx: Ctx = {
    view,
    lang,
    opp,
    org: orgOf(opp) ?? input.contact?.org ?? null,
    answers: input.answers,
    keywords: keywordsOf(opp),
    now: input.now ? new Date(input.now) : new Date(),
    third: input.kind === "bio" ? input.perspective !== "first" : false,
    doc,
  };
  const contactName = input.contact?.name ?? null;
  let title: string;
  switch (input.kind) {
    case "cover_letter":
      title = coverLetter(ctx, input.tone, contactName);
      break;
    case "email_investor":
      title = investorEmail(ctx, input.tone, contactName);
      break;
    case "email_recruiter":
      title = recruiterEmail(ctx, input.tone, contactName);
      break;
    case "email_professor":
      title = professorEmail(ctx, input.tone, contactName);
      break;
    case "email_editor":
    case "email_brand":
    case "email_client":
      title = pitchEmail(ctx, input.kind, input.tone, contactName);
      break;
    case "email_follow_up":
      title = followUpEmail(ctx, input.previous, contactName);
      break;
    case "bio":
      title = bio(ctx);
      break;
    case "one_pager":
      title = onePager(ctx);
      break;
    case "answer": {
      const key = input.questionKey ?? (input.question ? classifyQuestion(input.question) : "other");
      answerBody(ctx, key, input.question);
      title = input.question ?? key;
      break;
    }
  }
  const max = input.maxWords ?? (input.tone === "concise" ? Math.round((DEFAULT_WORDS[input.kind] ?? 300) * 0.7) : DEFAULT_WORDS[input.kind]);
  doc.fit(max);
  return doc.build(input.kind, title);
}
