import { getSubGoal, isGoalFamily, isSubGoalId, opportunityTypesOfFamily } from "@/lib/core/goals";
import { audienceIncludes } from "@/lib/core/identities";
import { industryLabel, isIndustryCode } from "@/lib/core/industries";
import { isMaterialId, materialLabel } from "@/lib/core/materials";
import { isOpportunityTypeId, opportunityTypeLabel } from "@/lib/core/opportunity-types";
import type { IdentityCode, IdentityTarget, Profile } from "@/lib/core/types";
import { professionalYears } from "../build";
import { readProfile, ScoreMatchesInput, type GoalInput, type MatchScore, type OpportunityInput } from "../types";
import { countryOfLocation, countryName } from "./geo";
import { findMoney } from "./text";

/*
 * Rule-based match scoring (the local engine; Claude refines when enabled).
 *
 *   1. Hard filters → `eligible: false` with blockers: deadline passed, identity/stage the
 *      program excludes, degree below the minimum, too few/too many years, remote-only goal
 *      vs on-site role, age limits when the birth year is known.
 *   2. Fit (0–100): goal alignment 25, identity 15, field (industry/function/occupation) 25,
 *      skills & keywords 20, location 10, language 5.
 *   3. Win probability: the program's acceptance rate when known, else a per-type prior,
 *      scaled by fit and reduced by open gaps.
 *   4. Effort (the person's own time — we prepare the rest) and value.
 *   Reasons and gaps are short sentences in the person's language.
 */

type Lang = "en" | "zh";
type Opp = OpportunityInput;

const DEGREE_RANK: Record<string, number> = { none: 0, high_school: 1, vocational: 2, associate: 2, bachelor: 3, master: 4, professional: 5, doctorate: 5 };

const TYPE_PRIOR: Record<string, number> = {
  job: 0.06, remote_job: 0.04, internship: 0.08, part_time: 0.12, graduate_program: 0.05, returnship: 0.1, referral: 0.2, recruiter: 0.15,
  freelance_project: 0.12, client_lead: 0.05, ngo_job: 0.05, volunteer: 0.4, public_sector_exam: 0.05,
  investor: 0.03, accelerator: 0.03, incubator: 0.15, startup_competition: 0.08, pitch_event: 0.3, exhibition: 0.4, cofounder_match: 0.1,
  grant: 0.15, fellowship: 0.08, scholarship: 0.1, award: 0.05, competition: 0.1, hackathon: 0.25,
  conference_cfp: 0.25, journal: 0.2, phd_position: 0.1, postdoc: 0.1, visiting_scholar: 0.2, collaborator: 0.15,
  degree_program: 0.2, exchange_program: 0.3, course: 0.8, certification: 0.6, mentorship: 0.3,
  residency: 0.08, open_call: 0.1, brand_partnership: 0.1, platform_signing: 0.2, speaking: 0.2, media: 0.1, podcast: 0.15,
  community: 0.7, event: 0.8, practice: 1,
};

const TYPE_VALUE: Record<string, number> = {
  job: 70, remote_job: 70, internship: 55, graduate_program: 65, investor: 75, accelerator: 75, grant: 65, fellowship: 70, scholarship: 60,
  postdoc: 70, phd_position: 70, conference_cfp: 45, award: 45, competition: 45, startup_competition: 50, residency: 55, speaking: 45,
  media: 40, podcast: 35, community: 25, event: 25, course: 25, practice: 5,
};

const DEFAULT_EFFORT_MIN: Record<string, number> = {
  job: 15, remote_job: 15, internship: 15, investor: 10, accelerator: 45, grant: 60, fellowship: 60, scholarship: 45, conference_cfp: 60,
  phd_position: 45, postdoc: 30, residency: 45, open_call: 30, startup_competition: 40, speaking: 20, practice: 2,
};

/** Materials the person has to bring themselves (we can't draft them). */
const PERSON_MATERIALS: Record<string, { check: (p: Profile) => boolean; en: string; zh: string }> = {
  transcript: { check: () => false, en: "Upload your transcript", zh: "上传成绩单" },
  test_scores: { check: (p) => Boolean(p.packs.student?.testScores.length), en: "Add your test scores", zh: "补充考试成绩" },
  recommendation_letters: { check: () => false, en: "Line up recommenders (we draft the letters for them)", zh: "联系推荐人（我们可为推荐人准备草稿）" },
  pitch_deck: { check: (p) => Boolean(p.packs.founder?.ventures.some((v) => v.deckDocumentId)), en: "Upload your pitch deck", zh: "上传路演 Deck" },
  demo_video: { check: () => false, en: "Record a short product demo", zh: "录制简短的产品演示视频" },
  portfolio: { check: (p) => p.identity.links.some((l) => ["portfolio", "behance", "dribbble", "website"].includes(l.kind)), en: "Add a portfolio link", zh: "添加作品集链接" },
  work_samples: { check: (p) => p.identity.links.some((l) => ["portfolio", "behance", "dribbble", "github", "website"].includes(l.kind)), en: "Pick work samples to attach", zh: "挑选要附上的作品样本" },
  paper: { check: (p) => p.publications.length > 0, en: "Attach the paper", zh: "附上论文全文" },
  product_images: { check: () => false, en: "Add product photos", zh: "补充产品图片" },
  license: { check: (p) => Boolean(p.packs.professional?.licenses.length), en: "Add your license details", zh: "补充执业资格信息" },
  certificate: { check: (p) => p.certifications.length > 0, en: "Upload the certificate", zh: "上传证书" },
};

function goalTypes(goal: GoalInput): string[] {
  if (goal.opportunityTypes?.length) return goal.opportunityTypes;
  const c = goal.constraints?.opportunityTypes;
  if (c?.length) return c;
  if (goal.sub && isSubGoalId(goal.sub)) return getSubGoal(goal.sub).opportunityTypes;
  if (isGoalFamily(goal.family)) return opportunityTypesOfFamily(goal.family);
  return [];
}

function deadlineOf(opp: Opp): Date | null {
  if (!opp.deadline) return null;
  const d = opp.deadline instanceof Date ? opp.deadline : new Date(opp.deadline);
  return Number.isNaN(d.getTime()) ? null : d;
}

function textOf(opp: Opp): string {
  return [opp.name, opp.orgName, opp.summary, opp.description?.slice(0, 4000), ...(opp.tags ?? [])].filter(Boolean).join(" \n ").toLowerCase();
}

function industryMatch(user: string[], opp: string[]): string | null {
  for (const u of user) {
    for (const o of opp) {
      if (u === o || u.startsWith(`${o}.`) || o.startsWith(`${u}.`)) return o.includes(".") && u.includes(".") ? o : u.split(".")[0] === o.split(".")[0] ? o : u;
    }
  }
  return null;
}

function remoteMode(opp: Opp): "remote" | "hybrid" | "onsite" | null {
  const r = opp.geo?.remote;
  if (r === true) return "remote";
  if (r === false) return "onsite";
  if (r === "remote" || r === "hybrid" || r === "onsite") return r;
  return null;
}

function money(opp: Opp): { amount: number; currency: string | null } | null {
  const b = opp.benefits as { money?: { max?: number | null; min?: number | null; currency?: string | null } | null; summary?: string | null } | null | undefined;
  const amt = b?.money?.max ?? b?.money?.min ?? null;
  if (amt) return { amount: amt, currency: b?.money?.currency ?? null };
  const m = findMoney(`${b?.summary ?? ""} ${opp.summary ?? ""}`)[0];
  return m ? { amount: m.amount, currency: m.currency } : null;
}

function fmtMoney(m: { amount: number; currency: string | null }, lang: Lang): string {
  const cur = m.currency ?? "USD";
  if (lang === "zh" && cur === "CNY") return m.amount >= 10_000 ? `${Math.round(m.amount / 1000) / 10} 万元` : `${m.amount} 元`;
  const sym = cur === "USD" ? "$" : cur === "EUR" ? "€" : cur === "GBP" ? "£" : `${cur} `;
  return m.amount >= 1_000_000 ? `${sym}${Math.round(m.amount / 100_000) / 10}M` : m.amount >= 1000 ? `${sym}${Math.round(m.amount / 1000)}K` : `${sym}${m.amount}`;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function scoreOne(profile: Profile, goals: GoalInput[], opp: Opp, lang: Lang, now: Date): MatchScore {
  const zh = lang === "zh";
  const t = (en: string, cn: string) => (zh ? cn : en);
  // Reasons carry a weight so the five shown are the most telling ones.
  const weighted: Array<{ text: string; w: number }> = [];
  const reasons = { push: (text: string, w = 5) => weighted.push({ text, w }) };
  const gaps: string[] = [];
  const blockers: string[] = [];
  const codes = profile.roles.map((r) => r.code as IdentityCode);
  const text = textOf(opp);
  const years = professionalYears(profile, now);

  /* goals */
  const applicable = goals.filter((g) => goalTypes(g).includes(opp.type));
  const goal = applicable[0] ?? null;
  let fit = goal ? 25 : goals.length ? 5 : 12;
  if (goal) reasons.push(t(`Matches your goal${goal.label ? `: ${goal.label}` : ""}`, `符合你的目标${goal.label ? `：${goal.label}` : ""}`), 10);

  /* deadline */
  const deadline = deadlineOf(opp);
  if (deadline && !opp.rolling) {
    const days = Math.ceil((deadline.getTime() - now.getTime()) / 86_400_000);
    if (days < 0) blockers.push(t("The deadline has passed", "截止日期已过"));
    else if (days <= 14) reasons.push(t(`Deadline in ${days} day${days === 1 ? "" : "s"}`, `${days} 天后截止`), days <= 7 ? 8 : 6);
  } else if (opp.rolling) reasons.push(t("Rolling applications", "滚动录取，随时可申请"), 2);

  /* identity & stage */
  const el = opp.eligibility ?? {};
  const audience = (el.identities ?? []).filter(Boolean) as IdentityTarget[];
  if (audience.length) {
    if (!codes.length) gaps.push(t("Confirm who you are (student, professional, founder…) so we can check eligibility", "确认你的身份（学生、职场人、创业者……）以便核对申请资格"));
    else if (audienceIncludes(audience, codes)) {
      fit += 15;
      reasons.push(t("Open to people like you", "面向你这样的申请人"), 7);
    } else blockers.push(t("This program is for a different group of applicants", "该机会面向其他类型的申请人"));
  } else fit += 8;
  if (el.studentsOnly && !codes.some((c) => c.startsWith("S")) && !profile.education.some((e) => e.current)) blockers.push(t("Only open to current students", "仅限在读学生申请"));
  const stages = (el.stages ?? []).filter(Boolean);
  if (stages.length) {
    const userStages = [...profile.roles.map((r) => r.stage), ...(profile.packs.founder?.ventures.map((v) => v.stage) ?? [])].filter((s): s is string => Boolean(s));
    if (!userStages.length) gaps.push(t("Confirm your stage", "确认你所处的阶段"));
    else if (!userStages.some((s) => stages.includes(s))) blockers.push(t(`Only for stages: ${stages.join(", ")}`, `仅限以下阶段：${stages.join("、")}`));
    else reasons.push(t("Right stage for this program", "阶段符合要求"), 7);
  }

  /* degree */
  if (el.degree && DEGREE_RANK[el.degree] !== undefined) {
    const need = DEGREE_RANK[el.degree];
    const have = Math.max(-1, ...profile.education.map((e) => (e.level ? DEGREE_RANK[e.level] ?? 0 : 0)));
    if (!profile.education.length) gaps.push(t("Add your education so we can check the degree requirement", "补充学历信息以核对学历要求"));
    else if (have < need) {
      const studying = profile.education.some((e) => e.current && e.level && (DEGREE_RANK[e.level] ?? 0) >= need);
      if (studying) gaps.push(t("Requires a degree you're still completing — check whether current students qualify", "要求的学位你仍在攻读——请确认在读是否符合"));
      else blockers.push(t("Requires a higher degree than your profile shows", "学历要求高于你目前的学历"));
    }
  }

  /* years */
  if (typeof el.minYears === "number" && el.minYears > 0) {
    if (years + 1 < el.minYears) blockers.push(t(`Asks for ${el.minYears}+ years of experience (you have about ${Math.floor(years)})`, `要求 ${el.minYears} 年以上经验（你约 ${Math.floor(years)} 年）`));
    else if (years < el.minYears) gaps.push(t(`Asks for ${el.minYears}+ years; you're close — highlight your strongest results`, `要求 ${el.minYears} 年以上经验，你已接近——突出最强的成果`));
    else reasons.push(t(`Your ${Math.floor(years)} years meet the experience bar`, `你约 ${Math.floor(years)} 年的经验符合要求`), 4);
  }
  if (typeof el.maxYears === "number" && years > el.maxYears + 1) blockers.push(t(`Meant for people with at most ${el.maxYears} years of experience`, `面向 ${el.maxYears} 年以内经验的申请人`));

  /* age (only from an explicit birth year) */
  const by = profile.identity.birthYear;
  if (typeof el.ageMax === "number" || typeof el.ageMin === "number") {
    if (!by) gaps.push(t("This program has an age limit — confirm you qualify", "该项目有年龄限制——请确认是否符合"));
    else {
      const age = now.getUTCFullYear() - by;
      if (typeof el.ageMax === "number" && age > el.ageMax + 1) blockers.push(t(`Age limit ${el.ageMax}`, `年龄上限 ${el.ageMax} 岁`));
      if (typeof el.ageMin === "number" && age < el.ageMin - 1) blockers.push(t(`Minimum age ${el.ageMin}`, `最低年龄 ${el.ageMin} 岁`));
    }
  }

  /* nationality / residency */
  const countries = [...(el.nationality ?? []), ...(el.residency ?? [])].map((c) => c.toUpperCase());
  if (countries.length) {
    const mine = new Set([profile.identity.countryCode, ...profile.identity.workAuthorization.filter((w) => w.status === "citizen" || w.status === "permanent_resident").map((w) => w.countryCode)].filter(Boolean) as string[]);
    if (![...mine].some((c) => countries.includes(c))) gaps.push(t(`Limited to ${countries.map((c) => countryName(c)).join(", ")} — confirm you qualify`, `仅限${countries.map((c) => countryName(c, "zh")).join("、")}——请确认是否符合`));
  }

  /* field: industries, functions, occupations */
  let field = 0;
  const ind = industryMatch(profile.industries, opp.industries ?? []);
  if (ind) {
    field += 10;
    reasons.push(t(`In your field: ${isIndustryCode(ind) ? industryLabel(ind, "en") : ind}`, `与你的行业相关：${isIndustryCode(ind) ? industryLabel(ind, "zh") : ind}`), 6);
  }
  const fnOverlap = profile.functions.filter((f) => (opp.functions ?? []).includes(f));
  if (fnOverlap.length) field += 8;
  const titleWords = [...profile.experience.slice(0, 3).map((e) => e.title), ...(profile.packs.jobSeeker?.targetOccupations ?? [])].map((x) => x.toLowerCase().replace(/[-_]/g, " "));
  if (titleWords.some((w) => w.length > 3 && (text.includes(w) || w.split(" ").filter((x) => x.length > 3).every((x) => text.includes(x))))) {
    field += 7;
    reasons.push(t("Close to roles you've held or want", "与你做过或想做的职位相近"), 5);
  }
  fit += Math.min(25, field);

  /* skills & keywords */
  const skillHits = profile.skills.map((s) => s.name).filter((s) => s.length > 1 && new RegExp(`(^|[^a-z0-9])${s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^a-z0-9]|$)`).test(text));
  const researchHits = (profile.packs.researcher?.fields ?? []).filter((f) => f.toLowerCase().split(/\s+/).filter((w) => w.length > 4).some((w) => text.includes(w)));
  const kw = skillHits.length + researchHits.length;
  fit += Math.min(20, kw * 6);
  if (skillHits.length) reasons.push(t(`Uses your skills: ${skillHits.slice(0, 4).join(", ")}`, `用得上你的技能：${skillHits.slice(0, 4).join("、")}`), 9);
  if (researchHits.length) reasons.push(t(`Fits your research: ${researchHits.slice(0, 2).join(", ")}`, `契合你的研究方向：${researchHits.slice(0, 2).join("、")}`), 9);

  /* location */
  const mode = remoteMode(opp);
  const goalRemote = goals.map((g) => g.constraints?.remote).find((r) => r !== undefined && r !== null);
  const remoteOnly = goalRemote === true || goalRemote === "remote_only";
  const oppCountries = (opp.geo?.countries ?? []).map((c) => c.toUpperCase());
  const oppCities = (opp.geo?.cities ?? []).map((c) => c.toLowerCase());
  const myCountry = profile.identity.countryCode ?? (profile.identity.location ? countryOfLocation(profile.identity.location) : null);
  const goalGeo = goals.flatMap((g) => g.constraints?.geo ?? []).map((x) => x.toUpperCase());
  if (mode === "remote" || opp.geo?.worldwide) {
    fit += 10;
    reasons.push(t(opp.geo?.worldwide ? "Open worldwide" : "Remote-friendly", opp.geo?.worldwide ? "面向全球" : "支持远程"), 5);
  } else if (remoteOnly && (mode === "onsite" || mode === "hybrid")) {
    blockers.push(t("On-site, and you asked for remote only", "需要到岗，而你只考虑远程"));
  } else if (oppCountries.length || oppCities.length) {
    const city = profile.identity.city?.toLowerCase() ?? null;
    if ((city && oppCities.includes(city)) || (myCountry && oppCountries.includes(myCountry)) || goalGeo.some((g) => oppCountries.includes(g))) {
      fit += 10;
      reasons.push(t(`In ${city && oppCities.includes(city) ? profile.identity.city : countryName(myCountry ?? oppCountries[0])}`, `地点：${city && oppCities.includes(city) ? profile.identity.city : countryName(myCountry ?? oppCountries[0], "zh")}`), 6);
    } else if (myCountry) {
      gaps.push(t(`Based in ${oppCountries.map((c) => countryName(c)).join(", ") || opp.geo?.cities?.join(", ")} — check you can relocate or work there`, `地点在${oppCountries.map((c) => countryName(c, "zh")).join("、") || opp.geo?.cities?.join("、")}——请确认能否前往或在当地工作`));
    } else fit += 4;
  } else fit += 5;

  /* language */
  const langs = (opp.languages ?? []).map((l) => l.toLowerCase().slice(0, 2));
  const mine = profile.identity.languages.map((l) => l.code.slice(0, 2));
  if (!langs.length || !mine.length || langs.some((l) => mine.includes(l))) fit += 5;
  else gaps.push(t(`Conducted in ${langs.join(", ")} — add the languages you speak`, `使用语言：${langs.join("、")}——请补充你的语言能力`));

  /* materials the person must bring */
  for (const mat of opp.requiredMaterials ?? []) {
    const rule = PERSON_MATERIALS[mat];
    if (rule && !rule.check(profile)) gaps.push(zh ? rule.zh : rule.en);
  }

  /* money & cost */
  const m = money(opp);
  if (m) reasons.push(t(`Up to ${fmtMoney(m, "en")}`, `最高 ${fmtMoney(m, "zh")}`), 8);
  const cost = opp.cost as { free?: boolean | null; applicationFee?: { amount?: number | null } | null; equityPercent?: number | null } | null | undefined;
  if (cost?.free) reasons.push(t("Free to apply", "免费申请"), 3);
  if (cost?.applicationFee?.amount) gaps.push(t(`Application fee: ${cost.applicationFee.amount} — you pay it yourself at submission`, `申请费 ${cost.applicationFee.amount}——提交时需你本人支付`));

  fit = clamp(Math.round(fit), 0, 100);
  const eligible = blockers.length === 0;

  /* win probability */
  const prior = typeof opp.estAcceptanceRate === "number" && opp.estAcceptanceRate > 0 ? opp.estAcceptanceRate : TYPE_PRIOR[opp.type] ?? 0.1;
  let win = prior * (0.4 + (fit / 100) * 1.4) * Math.pow(0.9, gaps.length);
  if (!eligible) win = 0;
  win = Math.round(clamp(win, 0, 0.95) * 1000) / 1000;

  /* effort: the person's own minutes, mapped to 0–100 */
  const apply = (opp.apply ?? {}) as { channel?: string; requiresAccount?: boolean; requiresPayment?: boolean };
  let minutes = opp.estEffortMinutes ?? DEFAULT_EFFORT_MIN[opp.type] ?? 25;
  if (apply.channel === "CH6") minutes += 10; // the person submits on the platform (handoff)
  if (apply.requiresAccount) minutes += 5;
  minutes += gaps.length * 4;
  const effort = clamp(Math.round(minutes * 1.2), 1, 100);

  /* value */
  let value = TYPE_VALUE[opp.type] ?? 40;
  if (m) value += clamp(Math.log10(Math.max(10, m.amount)) * 4 - 8, 0, 15);
  if (typeof opp.qualityScore === "number") value = value * 0.7 + clamp(opp.qualityScore, 0, 100) * 0.3;
  if (goal) value += 10;
  value = clamp(Math.round(value), 0, 100);

  if (!weighted.length && isOpportunityTypeId(opp.type)) reasons.push(t(`A ${opportunityTypeLabel(opp.type, "en").toLowerCase()} you could apply to`, `你可以申请的${opportunityTypeLabel(opp.type, "zh")}`), 1);

  return {
    opportunityId: opp.id,
    goalId: goal?.id ?? null,
    fit,
    winProbability: win,
    effort,
    value,
    eligible,
    reasons: weighted
      .map((r, i) => ({ ...r, i }))
      .sort((a, b) => b.w - a.w || a.i - b.i)
      .slice(0, 5)
      .map((r) => r.text),
    gaps: [...new Set(gaps)].slice(0, 5),
    blockers,
  };
}

export function localScoreMatches(raw: ScoreMatchesInput): MatchScore[] {
  const input = ScoreMatchesInput.parse(raw);
  const profile = readProfile(input.profile);
  const now = input.now ? new Date(input.now) : new Date();
  return input.opportunities.map((opp) => scoreOne(profile, input.goals, opp, input.language, now));
}

/** Material labels for gaps elsewhere (re-exported for P2a's UI). */
export function materialName(id: string, lang: Lang): string {
  return isMaterialId(id) ? materialLabel(id, lang) : id;
}
