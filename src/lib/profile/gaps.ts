import { bi, localize, type Bilingual, type Locale } from "@/lib/core/labels";
import { isMinor } from "@/lib/core/identities";
import { OCCUPATIONS, isOccupationCode, getOccupation } from "@/lib/core/occupations";
import { topLevelIndustry } from "@/lib/core/industries";
import { groupOfIdentity, type FunctionId, type GoalFamily, type IdentityCode, type Profile, type SubGoalId, type Venture } from "@/lib/core/types";
import { setAt } from "./merge";

/*
 * "3 things I still need" — choice questions from the gaps in a profile, for the identity
 * packs and goals that matter to the person (plan §8.4: choice-first, at most three at a
 * time, answers written back so we never ask twice). Pure and tested
 * (tests/profile-gaps.test.ts). Questions and options are bilingual data, like the
 * taxonomies they come from.
 *
 * Each question writes one profile path (or a group, see PATH_GROUPS in merge.ts); the
 * answer is stored as a user-confirmed fact at that path, so a later extraction never
 * overwrites it and `answeredPaths` stops it being asked again (even when the answer was
 * "not raising" or "prefer not to say").
 */

export const GAP_IDS = [
  "jobSeeker.targetRole",
  "jobSeeker.remote",
  "jobSeeker.salary",
  "jobSeeker.start",
  "founder.round",
  "founder.team",
  "founder.traction",
  "researcher.field",
  "researcher.tier",
  "student.graduation",
  "student.degree",
  "creator.rates",
  "creator.audience",
] as const;
export type GapId = (typeof GAP_IDS)[number];
export type GapPack = "jobSeeker" | "founder" | "researcher" | "student" | "creator";

export interface GapOption {
  value: string;
  label: Bilingual;
}

export interface GapQuestion {
  id: GapId;
  pack: GapPack;
  /** The profile path the answer writes (and the confirmed fact's path). */
  path: string;
  multi: boolean;
  maxPicks: number;
  prompt: Bilingual;
  /** Why we ask, one short line. */
  why: Bilingual;
  options: GapOption[];
}

export interface GapGoal {
  family: GoalFamily;
  sub?: SubGoalId | null;
}

export interface GapOptions {
  /** Paths of the person's confirmed facts (answers already given). */
  answeredPaths?: readonly string[];
  now?: Date;
  /** Cap on the number of questions (default: all). */
  limit?: number;
}

export function isGapId(v: unknown): v is GapId {
  return typeof v === "string" && (GAP_IDS as readonly string[]).includes(v);
}

/* ------------------------------------------------------------------ money bands */

export type BandCurrency = "USD" | "EUR" | "GBP" | "CNY";

const EURO = new Set(["DE", "FR", "NL", "IE", "ES", "IT", "PT", "BE", "AT", "FI", "EE", "GR", "LU", "LV", "LT", "SK", "SI", "MT", "CY", "HR"]);

/** The currency bands are shown in, from where the person lives. */
export function bandCurrency(countryCode: string | null | undefined): BandCurrency {
  const cc = (countryCode ?? "").toUpperCase();
  if (cc === "CN") return "CNY";
  if (cc === "GB") return "GBP";
  if (EURO.has(cc)) return "EUR";
  return "USD";
}

interface Band {
  value: string;
  min: number | null;
  max: number | null;
  label: Bilingual;
}

const SYMBOL: Record<Exclude<BandCurrency, "CNY">, string> = { USD: "$", EUR: "€", GBP: "£" };

/** Western-style bands ("$50k–80k"); `edges` in whole units. */
function westernBands(cur: Exclude<BandCurrency, "CNY">, edges: number[]): Band[] {
  const s = SYMBOL[cur];
  const k = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}k` : String(n));
  const out: Band[] = [{ value: "b0", min: null, max: edges[0]!, label: bi(`Under ${s}${k(edges[0]!)}`, `${s}${k(edges[0]!)} 以下`) }];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    out.push({ value: `b${i + 1}`, min: a, max: b, label: bi(`${s}${k(a)}–${k(b)}`, `${s}${k(a)}–${k(b)}`) });
  }
  const top = edges[edges.length - 1]!;
  out.push({ value: `b${edges.length}`, min: top, max: null, label: bi(`${s}${k(top)}+`, `${s}${k(top)} 以上`) });
  return out;
}

/** Chinese-style bands ("¥15万–30万"); `edges` in yuan. */
function yuanBands(edges: number[]): Band[] {
  const w = (n: number) => (n >= 100_000_000 ? `${n / 100_000_000}亿` : n >= 10_000 ? `${n / 10_000}万` : String(n));
  const e = (n: number) => (n >= 1_000_000 ? `${n / 1_000_000}M` : n >= 1000 ? `${n / 1000}k` : String(n));
  const out: Band[] = [{ value: "b0", min: null, max: edges[0]!, label: bi(`Under ¥${e(edges[0]!)}`, `¥${w(edges[0]!)} 以下`) }];
  for (let i = 0; i < edges.length - 1; i++) {
    const a = edges[i]!;
    const b = edges[i + 1]!;
    out.push({ value: `b${i + 1}`, min: a, max: b, label: bi(`¥${e(a)}–${e(b)}`, `¥${w(a)}–${w(b)}`) });
  }
  const top = edges[edges.length - 1]!;
  out.push({ value: `b${edges.length}`, min: top, max: null, label: bi(`¥${e(top)}+`, `¥${w(top)} 以上`) });
  return out;
}

/** Yearly base salary bands. */
export function salaryBands(cur: BandCurrency): Band[] {
  if (cur === "CNY") return yuanBands([150_000, 300_000, 500_000, 800_000]);
  if (cur === "USD") return westernBands(cur, [50_000, 80_000, 120_000, 180_000]);
  return westernBands(cur, [40_000, 60_000, 90_000, 130_000]);
}

/** Size of the round being raised. */
export function roundBands(cur: BandCurrency): Band[] {
  if (cur === "CNY") return yuanBands([2_000_000, 5_000_000, 20_000_000, 100_000_000]);
  return westernBands(cur, [250_000, 1_000_000, 3_000_000, 10_000_000]);
}

/** Typical fee per project. */
export function rateBands(cur: BandCurrency): Band[] {
  if (cur === "CNY") return yuanBands([3_000, 10_000, 30_000, 100_000]);
  return westernBands(cur, [500, 2_000, 5_000, 15_000]);
}

const PREFER_NOT = { value: "na", label: bi("Prefer not to say", "暂不透露") } satisfies GapOption;

/* ------------------------------------------------------------------ fixed option lists */

export const RESEARCH_FIELDS: readonly GapOption[] = [
  { value: "computer-science", label: bi("Computer science & AI", "计算机与人工智能") },
  { value: "engineering", label: bi("Engineering", "工程") },
  { value: "life-sciences", label: bi("Life sciences", "生命科学") },
  { value: "medicine", label: bi("Medicine & health", "医学与健康") },
  { value: "physical-sciences", label: bi("Physics & chemistry", "物理与化学") },
  { value: "mathematics", label: bi("Mathematics & statistics", "数学与统计") },
  { value: "earth-environment", label: bi("Earth & environmental science", "地球与环境科学") },
  { value: "economics-business", label: bi("Economics & business", "经济与管理") },
  { value: "social-sciences", label: bi("Social sciences", "社会科学") },
  { value: "humanities", label: bi("Humanities", "人文学科") },
  { value: "education", label: bi("Education", "教育学") },
  { value: "arts-design", label: bi("Arts & design", "艺术与设计") },
];

const REMOTE_OPTIONS: GapOption[] = [
  { value: "remote_only", label: bi("Remote only", "只要远程") },
  { value: "remote_ok", label: bi("Remote or on-site", "远程或到岗都行") },
  { value: "onsite_only", label: bi("On-site only", "只要到岗") },
];

const START_OPTIONS: Array<GapOption & { months: number }> = [
  { value: "now", months: 0, label: bi("Right away", "随时可以") },
  { value: "1m", months: 1, label: bi("In about a month", "一个月左右") },
  { value: "3m", months: 2, label: bi("In 2–3 months", "2–3 个月后") },
  { value: "6m", months: 4, label: bi("In 4–6 months", "4–6 个月后") },
  { value: "later", months: 7, label: bi("Later than that", "更晚") },
];

const TEAM_OPTIONS: Array<GapOption & { size: number }> = [
  { value: "1", size: 1, label: bi("Just me", "只有我") },
  { value: "2", size: 2, label: bi("2–3 people", "2–3 人") },
  { value: "4", size: 4, label: bi("4–10 people", "4–10 人") },
  { value: "11", size: 11, label: bi("11–50 people", "11–50 人") },
  { value: "51", size: 51, label: bi("More than 50", "50 人以上") },
];

const TRACTION_OPTIONS: GapOption[] = [
  { value: "pre_launch", label: bi("Not launched yet", "还没上线") },
  { value: "early_users", label: bi("Launched, with early users", "已上线，有早期用户") },
  { value: "paying", label: bi("Paying customers", "已有付费客户") },
  { value: "growing", label: bi("Revenue growing every month", "收入逐月增长") },
  { value: "profitable", label: bi("Profitable", "已盈利") },
];

const TIER_OPTIONS: GapOption[] = [
  { value: "top", label: bi("Top venues in my field", "领域顶级会议或期刊") },
  { value: "high", label: bi("Strong, well-known venues", "知名的高水平会议或期刊") },
  { value: "solid", label: bi("Solid peer-reviewed venues", "扎实的同行评审会议或期刊") },
  { value: "any", label: bi("Whatever fits the work best", "最适合这项工作的就好") },
];

const DEGREE_OPTIONS: GapOption[] = [
  { value: "bachelor", label: bi("Bachelor's", "本科") },
  { value: "master", label: bi("Master's", "硕士") },
  { value: "doctorate", label: bi("PhD", "博士") },
  { value: "professional", label: bi("Professional degree (MBA, JD, MD…)", "专业学位（MBA、JD、MD 等）") },
  { value: "none", label: bi("No more study planned", "暂不打算继续深造") },
];

const AUDIENCE_OPTIONS: Array<GapOption & { followers: number }> = [
  { value: "0", followers: 0, label: bi("Under 1,000", "1,000 以下") },
  { value: "1000", followers: 1_000, label: bi("1,000–10,000", "1,000–1 万") },
  { value: "10000", followers: 10_000, label: bi("10,000–100,000", "1 万–10 万") },
  { value: "100000", followers: 100_000, label: bi("100,000–1 million", "10 万–100 万") },
  { value: "1000000", followers: 1_000_000, label: bi("Over 1 million", "100 万以上") },
];

/* ------------------------------------------------------------------ helpers */

const isoMonth = (d: Date) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;

function addMonths(now: Date, months: number): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + months, 1));
}

function firstVenture(profile: Profile): Venture | null {
  return profile.packs.founder?.ventures[0] ?? null;
}

/** Target-role options: the person's own occupations first, then neighbours in the same function. */
export function targetRoleOptions(profile: Profile, max = 6): GapOption[] {
  const seeds: string[] = [];
  const addSeed = (code: string | null | undefined) => {
    if (code && isOccupationCode(code) && !seeds.includes(code)) seeds.push(code);
  };
  for (const c of profile.occupations) addSeed(c);
  for (const e of profile.experience) addSeed(e.occupation);
  const fns: FunctionId[] = [...new Set([...seeds.map((c) => getOccupation(c).function), ...profile.functions])];
  if (!seeds.length && !fns.length) return [];
  const out: string[] = seeds.slice(0, 3);
  const industries = new Set(seeds.map((c) => topLevelIndustry(getOccupation(c).industry)));
  const neighbours = OCCUPATIONS.filter((o) => fns.includes(o.function) && !out.includes(o.code))
    .map((o) => ({ o, near: industries.has(topLevelIndustry(o.industry)) ? 0 : 1, fn: fns.indexOf(o.function) }))
    .sort((a, b) => a.fn - b.fn || a.near - b.near);
  for (const { o } of neighbours) {
    if (out.length >= max) break;
    out.push(o.code);
  }
  return out.map((code) => ({ value: code, label: getOccupation(code).label }));
}

/** Which packs matter, goals first (what the person asked for), then identities. */
export function relevantGapPacks(profile: Profile, goals: readonly GapGoal[]): GapPack[] {
  const out: GapPack[] = [];
  const add = (p: GapPack) => {
    if (!out.includes(p)) out.push(p);
  };
  for (const g of goals) {
    if (g.family === "G1") add("jobSeeker");
    else if (g.family === "G2" && g.sub === "G2.3") add("jobSeeker");
    else if (g.family === "G3") add("founder");
    else if (g.family === "G4") add("researcher");
    else if (g.family === "G5") add("student");
    else if (g.family === "G6") add("creator");
  }
  for (const r of profile.roles) {
    const group = groupOfIdentity(r.code);
    if (group === "S") {
      add("student");
      if (r.code === "S4") add("researcher");
      if (r.code === "S5") add("jobSeeker");
    } else if (group === "E" || group === "T" || group === "P") add("jobSeeker");
    else if (group === "F") add("founder");
    else if (group === "R") add("researcher");
    else if (group === "C") add("creator");
  }
  return out;
}

const PACK_QUESTIONS: Record<GapPack, GapId[]> = {
  jobSeeker: ["jobSeeker.targetRole", "jobSeeker.remote", "jobSeeker.salary", "jobSeeker.start"],
  founder: ["founder.round", "founder.team", "founder.traction"],
  researcher: ["researcher.field", "researcher.tier"],
  student: ["student.graduation", "student.degree"],
  creator: ["creator.rates", "creator.audience"],
};

/**
 * One question, built for this profile (options depend on where the person lives, their
 * occupations, their venture…). Null when it cannot be asked (a founder question without a
 * venture, a role question without anything to suggest).
 */
export function gapQuestion(id: GapId, profile: Profile, now: Date = new Date()): GapQuestion | null {
  const cur = bandCurrency(profile.identity.countryCode);
  const curLabel = cur === "CNY" ? bi("CNY", "人民币") : bi(cur, cur);
  const v = firstVenture(profile);
  const vPath = v ? `/packs/founder/ventures/${v.id}` : null;
  const q = (pack: GapPack, path: string, prompt: Bilingual, why: Bilingual, options: GapOption[], multi = false, maxPicks = 1): GapQuestion => ({
    id,
    pack,
    path,
    multi,
    maxPicks: multi ? maxPicks : 1,
    prompt,
    why,
    options,
  });
  switch (id) {
    case "jobSeeker.targetRole": {
      const options = targetRoleOptions(profile);
      if (!options.length) return null;
      return q("jobSeeker", "/packs/jobSeeker/targetOccupations", bi("Which roles should we look for?", "我们该帮你找哪些职位？"), bi("Pick up to three. Matches follow these first.", "最多选三个，匹配会优先按这些来。"), options, true, 3);
    }
    case "jobSeeker.remote":
      return q("jobSeeker", "/packs/jobSeeker/remote", bi("Remote, on-site, or either?", "远程、到岗，还是都可以？"), bi("So we don't show roles you'd never take.", "这样就不会推荐你根本不考虑的岗位。"), REMOTE_OPTIONS);
    case "jobSeeker.salary":
      if (isMinor(profile.roles.map((r) => r.code))) return null;
      return q(
        "jobSeeker",
        "/packs/jobSeeker/salary",
        bi(`What yearly base salary are you aiming for? (${curLabel.en})`, `你期望的年薪（税前，${curLabel.zh}）大约是？`),
        bi("A band is enough. It filters out roles that pay far below it.", "选个区间就够了，用来过滤明显偏低的岗位。"),
        [...salaryBands(cur).map(({ value, label }) => ({ value, label })), PREFER_NOT],
      );
    case "jobSeeker.start":
      return q("jobSeeker", "/packs/jobSeeker/availableFrom", bi("When could you start?", "你最早什么时候可以到岗？"), bi("Employers ask; we answer for you.", "雇主会问，我们替你回答。"), START_OPTIONS.map(({ value, label }) => ({ value, label })));
    case "founder.round":
      if (!v || !vPath) return null;
      return q(
        "founder",
        `${vPath}/currentRound`,
        bi(`Is ${v.company} raising right now? How much? (${curLabel.en})`, `${v.company} 现在在融资吗？本轮大约多少？（${curLabel.zh}）`),
        bi("Investors are matched to your round size.", "投资人会按本轮金额来匹配。"),
        [{ value: "not_raising", label: bi("Not raising right now", "暂不融资") }, ...roundBands(cur).map(({ value, label }) => ({ value, label }))],
      );
    case "founder.team":
      if (!v || !vPath) return null;
      return q("founder", `${vPath}/teamSize`, bi(`How many people work on ${v.company}?`, `${v.company} 团队有多少人？`), bi("Programs and grants often have team-size rules.", "很多项目和补贴对团队规模有要求。"), TEAM_OPTIONS.map(({ value, label }) => ({ value, label })));
    case "founder.traction":
      if (!v || !vPath) return null;
      return q("founder", `${vPath}/traction`, bi(`Where is ${v.company} today?`, `${v.company} 现在进展到哪一步？`), bi("Accelerators and investors ask this first.", "加速器和投资人最先问的就是这个。"), TRACTION_OPTIONS);
    case "researcher.field":
      return q("researcher", "/packs/researcher/fields", bi("Which field is your research in?", "你的研究属于哪个领域？"), bi("Calls for papers and grants are matched by field.", "会议征稿和基金都按领域匹配。"), [...RESEARCH_FIELDS], true, 3);
    case "researcher.tier":
      return q("researcher", "/packs/researcher/targetTier", bi("Where do you want to publish?", "你希望投到什么级别的会议或期刊？"), bi("We rank calls for papers by this.", "我们会按这个给征稿排序。"), TIER_OPTIONS);
    case "student.graduation": {
      const y = now.getUTCFullYear();
      const years = Array.from({ length: 6 }, (_, i) => y + i).map((n) => ({ value: String(n), label: bi(String(n), `${n} 年`) }));
      return q("student", "/packs/student/graduationDate", bi("When do you graduate?", "你哪一年毕业？"), bi("Internships and graduate programs depend on it.", "实习和校招项目都看这个。"), [...years, { value: "done", label: bi("Already graduated", "已经毕业") }]);
    }
    case "student.degree":
      return q("student", "/packs/student/targetDegree", bi("What degree are you aiming for next?", "你下一步想读什么学位？"), bi("Admissions and scholarships follow this.", "录取和奖学金会按这个来找。"), DEGREE_OPTIONS);
    case "creator.rates":
      return q(
        "creator",
        "/packs/creator/rates",
        bi(`What do you usually charge per project? (${curLabel.en})`, `你通常每个项目报价多少？（${curLabel.zh}）`),
        bi("Clients and briefs are matched to your range.", "客户和需求会按你的报价区间来匹配。"),
        [...rateBands(cur).map(({ value, label }) => ({ value, label })), PREFER_NOT],
      );
    case "creator.audience":
      return q("creator", "/packs/creator/audienceMetrics", bi("Roughly how many followers do you have, across platforms?", "你在各平台的粉丝加起来大约有多少？"), bi("Brand deals and creator funds look at audience size.", "品牌合作和创作者基金会看受众规模。"), AUDIENCE_OPTIONS.map(({ value, label }) => ({ value, label })));
  }
}

/** True when the profile already knows what the question asks. */
export function gapKnown(id: GapId, profile: Profile): boolean {
  const j = profile.packs.jobSeeker;
  const v = firstVenture(profile);
  switch (id) {
    case "jobSeeker.targetRole":
      return (j?.targetOccupations.length ?? 0) > 0;
    case "jobSeeker.remote":
      return j?.remote != null;
    case "jobSeeker.salary":
      return j?.salaryMin != null || j?.salaryMax != null;
    case "jobSeeker.start":
      return j?.availableFrom != null;
    case "founder.round":
      return v?.currentRound != null;
    case "founder.team":
      return v?.teamSize != null;
    case "founder.traction":
      return Boolean(v && (v.traction.revenue || v.traction.users || v.traction.growth));
    case "researcher.field":
      return (profile.packs.researcher?.fields.length ?? 0) > 0;
    case "researcher.tier":
      return profile.packs.researcher?.targetTier != null;
    case "student.graduation":
      return profile.packs.student?.graduationDate != null || profile.education.some((e) => e.current && e.endDate);
    case "student.degree":
      return profile.packs.student?.targetDegree != null;
    case "creator.rates":
      return profile.packs.creator?.rates != null;
    case "creator.audience":
      return (profile.packs.creator?.audienceMetrics.length ?? 0) > 0;
  }
}

/**
 * The choice questions the person still needs to answer, most relevant first: packs of
 * their goals, then of their identities; within a pack, the order that matters most for
 * matching. Already-known values and already-answered paths are skipped.
 */
export function gapsFor(profile: Profile, goals: readonly GapGoal[] = [], opts: GapOptions = {}): GapQuestion[] {
  const now = opts.now ?? new Date();
  const answered = new Set(opts.answeredPaths ?? []);
  const out: GapQuestion[] = [];
  for (const pack of relevantGapPacks(profile, goals)) {
    for (const id of PACK_QUESTIONS[pack]) {
      if (gapKnown(id, profile)) continue;
      const q = gapQuestion(id, profile, now);
      if (!q || answered.has(q.path)) continue;
      out.push(q);
    }
  }
  return typeof opts.limit === "number" ? out.slice(0, opts.limit) : out;
}

/* ------------------------------------------------------------------ answers */

export class GapAnswerError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GapAnswerError";
  }
}

export interface GapAnswerResult {
  profile: Profile;
  /** The confirmed fact to store. */
  fact: { path: string; value: unknown; claim: string };
}

function label(options: readonly GapOption[], value: string, locale: Locale): string {
  const o = options.find((x) => x.value === value);
  return o ? localize(o.label, locale) : value;
}

/**
 * Applies the person's tap(s) to the profile. Throws GapAnswerError for an unknown question,
 * a question that no longer applies, or values that are not among its options.
 */
export function applyGapAnswer(profile: Profile, id: GapId, values: readonly string[], opts: { now?: Date; locale?: Locale } = {}): GapAnswerResult {
  const now = opts.now ?? new Date();
  const locale = opts.locale ?? "en";
  const q = gapQuestion(id, profile, now);
  if (!q) throw new GapAnswerError("That question doesn't apply to your profile any more.");
  const picks = [...new Set(values)];
  if (!picks.length) throw new GapAnswerError("Pick an answer first.");
  if (picks.length > q.maxPicks) throw new GapAnswerError(`Pick up to ${q.maxPicks}.`);
  for (const p of picks) if (!q.options.some((o) => o.value === p)) throw new GapAnswerError("That answer isn't one of the choices.");
  const said = picks.map((p) => label(q.options, p, locale)).join(locale === "zh" ? "、" : ", ");
  const claim = locale === "zh" ? `你告诉我们：${said}` : `You told us: ${said}`;
  const cur = bandCurrency(profile.identity.countryCode);
  const one = picks[0]!;
  let p = profile;
  const write = (path: string, value: unknown) => {
    p = setAt(p, path, value);
  };
  const jobSeeker = () => {
    if (!p.packs.jobSeeker) write("/packs/jobSeeker", { targetFunctions: [], targetOccupations: [], targetIndustries: [], locations: [], remote: null, salaryMin: null, salaryMax: null, currency: null, salaryPeriod: null, availableFrom: null, needsSponsorship: null, searchVisibility: null });
  };
  const pack = (key: "researcher" | "student" | "creator", empty: Record<string, unknown>) => {
    if (!p.packs[key]) write(`/packs/${key}`, empty);
  };
  let value: unknown;
  switch (id) {
    case "jobSeeker.targetRole": {
      jobSeeker();
      const fns = [...new Set(picks.map((c) => getOccupation(c).function))];
      write("/packs/jobSeeker/targetOccupations", picks);
      write("/packs/jobSeeker/targetFunctions", fns);
      value = picks;
      break;
    }
    case "jobSeeker.remote":
      jobSeeker();
      write("/packs/jobSeeker/remote", one);
      value = one;
      break;
    case "jobSeeker.salary": {
      jobSeeker();
      const band = salaryBands(cur).find((b) => b.value === one);
      // Keys match the profile fields the answer owns (PATH_GROUPS["/packs/jobSeeker/salary"]).
      value = band ? { salaryMin: band.min, salaryMax: band.max, currency: cur, salaryPeriod: "year" } : null;
      write("/packs/jobSeeker/salaryMin", band?.min ?? null);
      write("/packs/jobSeeker/salaryMax", band?.max ?? null);
      write("/packs/jobSeeker/currency", band ? cur : null);
      write("/packs/jobSeeker/salaryPeriod", band ? "year" : null);
      break;
    }
    case "jobSeeker.start": {
      jobSeeker();
      const opt = START_OPTIONS.find((o) => o.value === one)!;
      value = isoMonth(addMonths(now, opt.months));
      write("/packs/jobSeeker/availableFrom", value);
      break;
    }
    case "founder.round": {
      const band = roundBands(cur).find((b) => b.value === one);
      value = band ? { amount: band.min, currency: cur, instrument: null, valuationCap: null, committed: null } : null;
      write(q.path, value);
      break;
    }
    case "founder.team": {
      value = TEAM_OPTIONS.find((o) => o.value === one)!.size;
      write(q.path, value);
      break;
    }
    case "founder.traction": {
      const text = localize(TRACTION_OPTIONS.find((o) => o.value === one)!.label, locale);
      value =
        one === "pre_launch" || one === "early_users"
          ? { revenue: null, users: { count: null, label: null, text }, growth: null }
          : one === "growing"
            ? { revenue: { amount: null, currency: null, period: null, text }, users: null, growth: { percent: null, period: "month", text } }
            : { revenue: { amount: null, currency: null, period: null, text }, users: null, growth: null };
      write(q.path, value);
      break;
    }
    case "researcher.field": {
      pack("researcher", { fields: [], hIndex: null, citations: null, grants: [], advisors: [], scholarUrl: null, orcid: null, targetVenues: [], targetTier: null });
      value = picks.map((x) => RESEARCH_FIELDS.find((f) => f.value === x)!.label.en);
      write("/packs/researcher/fields", value);
      break;
    }
    case "researcher.tier":
      pack("researcher", { fields: [], hIndex: null, citations: null, grants: [], advisors: [], scholarUrl: null, orcid: null, targetVenues: [], targetTier: null });
      write("/packs/researcher/targetTier", one);
      value = one;
      break;
    case "student.graduation":
      pack("student", { gpa: null, testScores: [], targetDegree: null, targetFields: [], targetCountries: [], budget: null, graduationDate: null, internshipMonths: null, availableFrom: null });
      value = one === "done" ? null : one;
      write("/packs/student/graduationDate", value);
      break;
    case "student.degree":
      pack("student", { gpa: null, testScores: [], targetDegree: null, targetFields: [], targetCountries: [], budget: null, graduationDate: null, internshipMonths: null, availableFrom: null });
      write("/packs/student/targetDegree", one);
      value = one;
      break;
    case "creator.rates": {
      pack("creator", { disciplines: [], styles: [], audienceMetrics: [], rates: null, brandsWorkedWith: [], portfolioUrls: [] });
      const band = rateBands(cur).find((b) => b.value === one);
      value = band ? { min: band.min, max: band.max, currency: cur, unit: "project" } : null;
      write("/packs/creator/rates", value);
      break;
    }
    case "creator.audience": {
      pack("creator", { disciplines: [], styles: [], audienceMetrics: [], rates: null, brandsWorkedWith: [], portfolioUrls: [] });
      const opt = AUDIENCE_OPTIONS.find((o) => o.value === one)!;
      value = { platform: locale === "zh" ? "全平台合计（本人估计）" : "All platforms (your estimate)", handle: null, url: null, followers: opt.followers, avgViews: null, engagementRate: null };
      const list = p.packs.creator?.audienceMetrics ?? [];
      write("/packs/creator/audienceMetrics", [...list, value]);
      return { profile: p, fact: { path: `/packs/creator/audienceMetrics/${list.length}`, value, claim } };
    }
  }
  return { profile: p, fact: { path: q.path, value, claim } };
}

/** Identity codes in the profile (convenience for callers). */
export function profileCodes(profile: Profile): IdentityCode[] {
  return profile.roles.map((r) => r.code);
}
