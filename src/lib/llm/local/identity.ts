import { matchIdentityCues, isValidStage } from "@/lib/core/identities";
import type { IdentityCode, Profile } from "@/lib/core/types";
import { professionalYears } from "../build";
import type { IdentityGuess } from "../types";

/*
 * Identity inference (plan §2): which of S/E/F/R/C/P/T the person is, from the structured
 * profile first (education in progress, years of experience, titles, ventures, publications)
 * and from F2's cue phrases in the raw text second. A guess is a pre-selection the person
 * confirms; sensitive identities (T8 disability) are never inferred, and age is never guessed
 * from anything but an explicit birth year.
 */

type Lang = "en" | "zh";

interface Evidence {
  code: IdentityCode;
  score: number;
  why: string;
  stage: string | null;
}

const TITLE_RULES: Array<{ code: IdentityCode; re: RegExp; score: number }> = [
  { code: "E5", re: /\b(chief [a-z]+ officer|ceo|cto|coo|cfo|cmo|cpo|president|general manager|managing director|svp|evp|senior vice president|vp\b|vice president)\b|总裁|总经理|首席.{1,4}官|副总裁/i, score: 3 },
  // "Product/project/account manager" and 产品经理/项目经理 are individual-contributor titles.
  { code: "E4", re: /\b(director|head of|(?<!product |project |program |account |community |social media |content |office |case )manager|team lead|engineering manager|group lead)\b|总监|(?<!产品|项目|客户|运营|销售|大客户)经理|主管|部门负责人|部长/i, score: 2.5 },
  { code: "E3", re: /\b(senior|staff|principal|lead|expert|architect|sr\.?)\b|资深|高级|专家|架构师/i, score: 2 },
  { code: "E6", re: /\b(civil servant|government|ministry|public sector|state[- ]owned|municipal|federal|county)\b|公务员|事业单位|国企|政府|机关/i, score: 3 },
  { code: "E7", re: /\b(electrician|welder|technician|mechanic|plumber|machinist|carpenter|hvac|operator|assembler|lineman)\b|技工|电工|焊工|钳工|车工|技术员|操作工/i, score: 3 },
  { code: "E8", re: /\b(barista|server|waiter|waitress|cashier|retail associate|sales associate|receptionist|housekeeper|host|bartender|cook|line cook|driver|courier)\b|服务员|店员|收银|前台|厨师|司机|骑手/i, score: 3 },
  { code: "R1", re: /\b(postdoc|postdoctoral)\b|博士后/i, score: 4 },
  { code: "R2", re: /\b(assistant professor|lecturer|tenure[- ]track)\b|助理教授|讲师|青年教师/i, score: 4 },
  { code: "R3", re: /\b(associate professor|full professor|professor|chair professor)\b|副教授|教授|博导|研究员/i, score: 3.5 },
  { code: "R4", re: /\b(research scientist|research engineer|applied scientist|member of technical staff)\b|研究科学家|算法研究员/i, score: 3 },
  { code: "R6", re: /\b(clinical research|clinical trial|principal investigator|clinical investigator)\b|临床研究|临床试验/i, score: 3 },
  { code: "C1", re: /\b(designer|ux|ui|graphic design|illustrator|art director)\b|设计师|插画/i, score: 1.5 },
  { code: "C2", re: /\b(writer|author|copywriter|screenwriter|journalist|editor|novelist|poet)\b|作家|编剧|撰稿|记者|编辑/i, score: 1.5 },
  { code: "C3", re: /\b(photographer|videographer|filmmaker|cinematographer|director of photography|video editor)\b|摄影|摄像|导演|剪辑/i, score: 1.5 },
  { code: "C4", re: /\b(youtuber|content creator|influencer|streamer|blogger|podcaster|creator)\b|博主|主播|up主|自媒体/i, score: 2.5 },
  { code: "C5", re: /\b(musician|artist|painter|composer|singer|sculptor|dj|producer)\b|音乐人|艺术家|画家|作曲|歌手/i, score: 1.5 },
  { code: "C7", re: /\b(consultant|coach|advisor|adviser|mentor)\b|顾问|教练|咨询师/i, score: 1 },
  { code: "C8", re: /\b(translator|interpreter|locali[sz]ation)\b|翻译|口译|笔译|本地化/i, score: 2.5 },
  { code: "P1", re: /\b(registered nurse|\brn\b|nurse|physician|doctor of medicine|\bmd\b|resident physician|pharmacist|dentist|surgeon|physical therapist)\b|护士|医生|医师|药师|牙医/i, score: 3 },
  { code: "P2", re: /\b(attorney|lawyer|solicitor|barrister|counsel|paralegal|associate attorney)\b|律师|法务/i, score: 3 },
  { code: "P3", re: /\b(cpa|accountant|auditor|tax (manager|associate|advisor)|acca|chartered accountant)\b|会计|审计|税务|注册会计师/i, score: 3 },
  { code: "P4", re: /\b(licensed architect|professional engineer|\bpe\b|registered architect|structural engineer|civil engineer)\b|注册建筑师|注册工程师|结构工程师/i, score: 2.5 },
  { code: "P5", re: /\b(teacher|teaching license|certified teacher|educator)\b|教师|老师|教师资格/i, score: 2.5 },
  { code: "P6", re: /\b(therapist|counselor|counsellor|psychologist|lpc|lcsw|lmft)\b|心理咨询师|咨询师|心理治疗/i, score: 3 },
  { code: "P7", re: /\b(cfa|frm|series 7|series 63|financial advisor|wealth manager)\b|证券从业|基金从业|理财师/i, score: 2.5 },
];

const FREELANCE = /\b(freelance|freelancer|self[- ]employed|independent|contract(or)?|own studio|studio founder)\b|自由职业|独立|接单|工作室/i;

function yearOf(d: string | null | undefined): number | null {
  const m = /^(\d{4})/.exec(d ?? "");
  return m ? Number(m[1]) : null;
}

function monthsUntil(d: string | null, now: Date): number | null {
  if (!d) return null;
  const [y, m] = d.split("-").map(Number);
  return (y - now.getUTCFullYear()) * 12 + ((m || 6) - (now.getUTCMonth() + 1));
}

function studentYearStage(level: string | null, monthsLeft: number | null): string | null {
  if (monthsLeft === null) return null;
  if (level === "bachelor") {
    if (monthsLeft <= 12) return "year_4_plus";
    if (monthsLeft <= 24) return "year_3";
    if (monthsLeft <= 36) return "year_2";
    return "year_1";
  }
  if (level === "master") return monthsLeft <= 12 ? "final_year" : "first_year";
  if (level === "doctorate") return monthsLeft <= 12 ? "final_year" : null;
  return null;
}

export function inferIdentities(profile: Profile, texts: string[], opts: { now?: Date; locale?: Lang } = {}): IdentityGuess[] {
  const now = opts.now ?? new Date();
  const lang = opts.locale ?? "en";
  const zh = lang === "zh";
  const ev: Evidence[] = [];
  const add = (code: IdentityCode, score: number, why: string, stage: string | null = null) => ev.push({ code, score, why, stage });
  const allText = texts.join("\n").slice(0, 80_000);

  /* students */
  const studying = profile.education.filter((e) => e.current || (e.endDate && (monthsUntil(e.endDate, now) ?? -1) > 0));
  for (const e of studying) {
    const left = monthsUntil(e.endDate, now);
    const where = e.institution;
    if (e.level === "high_school") add("S1", 5, zh ? `正在${where}读高中` : `In high school at ${where}`);
    else if (e.level === "bachelor") add("S2", 5, zh ? `${where}本科在读` : `Undergraduate at ${where}${e.endDate ? `, graduating ${e.endDate.slice(0, 4)}` : ""}`, studentYearStage("bachelor", left));
    else if (e.level === "master") add("S3", 5, zh ? `${where}硕士在读` : `Master's student at ${where}`, studentYearStage("master", left));
    else if (e.level === "doctorate") add("S4", 5, zh ? `${where}博士在读` : `PhD student at ${where}`, studentYearStage("doctorate", left));
    else if (e.level === "associate" || e.level === "vocational") add("S7", 5, zh ? `${where}专科/职业教育在读` : `Studying at ${where} (associate/vocational)`);
  }
  // Recent graduate: a degree finished within the last 12 months and no long full-time career.
  const latest = profile.education.filter((e) => !e.current && e.endDate).sort((a, b) => (b.endDate ?? "").localeCompare(a.endDate ?? ""))[0];
  const years = professionalYears(profile, now);
  if (latest && !studying.length) {
    const since = -(monthsUntil(latest.endDate, now) ?? -99);
    if (since >= 0 && since <= 12 && years < 1.5) add("S5", 4, zh ? `${latest.endDate?.slice(0, 4)} 年从${latest.institution}毕业` : `Graduated from ${latest.institution} in ${latest.endDate?.slice(0, 7)}`, since <= 6 ? "within_6_months" : "within_12_months");
  }

  /* professionals: years and seniority from the current or latest role */
  const current = profile.experience.find((e) => e.current) ?? profile.experience[0];
  const employed = profile.experience.some((e) => e.current && e.employmentType !== "internship" && e.employmentType !== "volunteer");
  if (profile.experience.length && !(studying.length && years < 1)) {
    const yrs = Math.round(years * 10) / 10;
    const base = current ? (zh ? `${current.organization} ${current.title}，约 ${yrs} 年工作经验` : `${current.title} at ${current.organization}, about ${yrs} years of experience`) : "";
    if (years < 3) add("E1", 3, base);
    else if (years < 8) add("E2", 3, base);
    else add("E3", 3, base);
  }
  if (current) {
    // Creator codes need more than a title (an employed designer is not a freelancer): see below.
    const academicOrg = /universit|college|institute|school|lab\b|laboratory|大学|学院|研究所|研究院|实验室/i.test(current.organization);
    for (const rule of TITLE_RULES.filter((r) => !r.code.startsWith("C"))) {
      if (rule.code === "R4" && academicOrg) continue; // industry researcher means a company lab
      if (rule.re.test(current.title)) add(rule.code, rule.score, zh ? `当前/最近职位：${current.title}` : `Current or latest title: ${current.title}`);
    }
  }
  // Lots of senior titles but few years read as E3 rather than E1.
  /* founders */
  const founderRoles = profile.experience.filter((e) => /\b(co-?founder|founder|owner)\b|创始人|联合创始人|创办/i.test(e.title) || e.employmentType === "self_employed");
  const ventures = profile.packs.founder?.ventures ?? [];
  if (ventures.length || founderRoles.length) {
    const v = ventures[0];
    const stage = v?.stage ?? null;
    const why = v ? (zh ? `创业项目：${v.company}${stage ? `（${stage}）` : ""}` : `Building ${v.company}${stage ? ` (${stage.replace(/_/g, " ")})` : ""}`) : zh ? `创始人经历：${founderRoles[0].organization}` : `Founder role at ${founderRoles[0].organization}`;
    if (stage === "idea") add("F1", 5, why, "idea");
    else if (stage === "series_a" || stage === "series_b_plus") add("F3", 5, why, stage);
    else if (stage === "bootstrapped" || stage === "profitable") add("F5", 3, why, stage);
    else add("F2", ventures.length ? 5 : 3.5, why, stage);
    if (founderRoles.length >= 2) add("F4", 4, zh ? `${founderRoles.length} 段创业经历` : `${founderRoles.length} founder roles`);
    if (/\b(solo founder|indie hacker|indie developer|bootstrapped|one[- ]person company)\b|独立开发|一人公司/i.test(allText)) add("F5", 4, zh ? "独立开发/一人公司" : "Solo or bootstrapped founder");
    if (/\b(social enterprise|nonprofit|non-profit|b corp|impact)\b|社会企业|公益/i.test(allText)) add("F8", 2, zh ? "社会企业/公益方向" : "Social enterprise cues");
    if (/\b(shop|store|restaurant|café|cafe|salon|bakery|boutique)\s+(owner)\b|店主|个体户|小微企业/i.test(allText)) add("F6", 4, zh ? "小店/小微企业主" : "Small business owner");
  }

  /* researchers */
  const pubs = profile.publications.length;
  if (pubs >= 3 && !studying.some((e) => e.level === "doctorate")) {
    const phd = profile.education.find((e) => e.level === "doctorate" && !e.current);
    const phdYear = yearOf(phd?.endDate);
    const stage = phdYear ? (now.getUTCFullYear() - phdYear <= 7 ? "early_career" : now.getUTCFullYear() - phdYear <= 15 ? "mid_career" : "senior") : null;
    const academic = profile.experience.some((e) => /universit|college|institute|lab|大学|学院|研究所|实验室/i.test(e.organization));
    if (!academic && profile.experience.length) add("R4", 2, zh ? `${pubs} 篇论文，企业研究背景` : `${pubs} publications from an industry role`, stage);
    else if (!profile.experience.length) add("R5", 2, zh ? `${pubs} 篇论文` : `${pubs} publications`, stage);
    // Stage for title-based R codes.
    for (const e of ev) if (e.code.startsWith("R") && !e.stage) e.stage = stage;
  }
  if (profile.packs.researcher?.orcid) add("R5", 0.5, "ORCID iD");

  /* creators & freelancers */
  const freelance = FREELANCE.test(current?.title ?? "") || profile.experience.some((e) => e.employmentType === "freelance") || FREELANCE.test(profile.identity.headline ?? "");
  const creatorLinks = profile.identity.links.filter((l) => ["behance", "dribbble", "youtube", "bilibili", "xiaohongshu", "tiktok", "instagram", "substack", "medium", "portfolio"].includes(l.kind));
  if (freelance || creatorLinks.length || profile.packs.creator) {
    const titleText = `${current?.title ?? ""} ${profile.identity.headline ?? ""}`;
    let matched = false;
    for (const rule of TITLE_RULES.filter((r) => r.code.startsWith("C"))) {
      if (rule.re.test(titleText)) {
        add(rule.code, rule.score + (freelance ? 2.5 : 1), zh ? `${freelance ? "自由职业" : "作品平台"}：${titleText.trim()}` : `${freelance ? "Freelance" : "Portfolio links"}: ${titleText.trim()}`, freelance ? "full_time" : "side");
        matched = true;
      }
    }
    if (freelance && /\b(developer|engineer|programmer)\b|开发|工程师/i.test(titleText)) {
      add("C6", 4.5, zh ? "自由开发者" : "Freelance developer", "full_time");
      matched = true;
    }
    if (!matched && creatorLinks.length) add("C4", 1.5, zh ? `创作平台链接：${creatorLinks[0].kind}` : `Creator profile on ${creatorLinks[0].kind}`, "side");
    if ((profile.packs.creator?.audienceMetrics ?? []).some((a) => (a.followers ?? 0) >= 1000)) add("C4", 3, zh ? "有一定粉丝规模" : "Audience of 1,000+ followers");
  }
  if (/\b(handmade|artisan|ceramic|ceramics|jewelry maker|maker brand|etsy)\b|手作|手工|独立品牌|主理人/i.test(allText)) add("C9", 2.5, zh ? "手作/独立品牌线索" : "Maker or independent brand cues");

  /* licensed professionals */
  for (const l of profile.packs.professional?.licenses ?? []) {
    const text = l.type;
    for (const rule of TITLE_RULES.filter((r) => r.code.startsWith("P"))) if (rule.re.test(text)) add(rule.code, rule.score + 1.5, zh ? `执业资格：${text}` : `License: ${text}`, "licensed");
  }
  for (const c of profile.certifications) {
    if (/\b(cpa|acca|cfa|frm|pmp)\b|注册会计师|证券从业/i.test(c.name)) {
      for (const rule of TITLE_RULES.filter((r) => r.code === "P3" || r.code === "P7")) if (rule.re.test(c.name)) add(rule.code, rule.score, zh ? `证书：${c.name}` : `Certification: ${c.name}`, "licensed");
    }
  }

  /* transitions */
  const latestJob = [...profile.experience].sort((a, b) => (b.endDate ?? "9999").localeCompare(a.endDate ?? "9999"))[0];
  if (latestJob && !profile.experience.some((e) => e.current) && !studying.length && latestJob.endDate) {
    const gap = -(monthsUntil(latestJob.endDate, now) ?? 0);
    if (gap >= 3) add("T1", gap >= 6 ? 3 : 2, zh ? `${latestJob.endDate} 后暂无在职经历` : `No current role since ${latestJob.endDate}`, gap >= 6 ? "long_gap" : "in_transition");
  }
  if (/\b(career change|career changer|career transition|transitioning (into|to)|pivot(ing)? (into|to)|bootcamp graduate)\b|转行|转型|跨行/i.test(allText)) add("T2", 3, zh ? "提到转行/转型" : "Mentions a career change");
  if (/\b(veteran|u\.s\. army|us army|u\.s\. navy|marine corps|air force|national guard|military service)\b|退役军人|退伍|服役/i.test(allText)) add("T5", 3.5, zh ? "有服役经历" : "Military service");
  if (/\b(career break|returning to work|return to work|returnship|stay[- ]at[- ]home (parent|mom|dad)|parental leave)\b|全职妈妈|全职爸爸|重返职场|育儿/i.test(allText)) add("T6", 3, zh ? "提到职业空窗/重返职场" : "Career break / returning to work");
  if (/\b(relocating to|moving to|open to relocation to)\b|计划出国|准备移民/i.test(allText)) add("T4", 2, zh ? "计划迁居" : "Plans to relocate");
  if (/\b(retired|semi-retired|retirement)\b|退休/i.test(allText)) add("T7", 2.5, zh ? "提到退休" : "Mentions retirement");
  // Returnee: studied abroad, now located in mainland China.
  if (profile.identity.countryCode === "CN" && profile.education.some((e) => e.location && !/中国|china|北京|上海|广州|深圳|杭州|南京|武汉|成都|西安/i.test(e.location) && /[a-z]/i.test(e.location))) {
    add("T3", 2.5, zh ? "海外求学后回国" : "Studied abroad, now based in China");
  }
  if (/\b(international student|f-?1 (visa|student)|opt\b|cpt\b|student visa)\b|留学生/i.test(allText)) add("S6", 3, zh ? "留学生身份线索" : "International student cues");

  /* F2's cue phrases as weak evidence (never T8, never supply side) */
  for (const m of matchIdentityCues(allText, { limit: 12 })) {
    if (m.code === "T8") continue;
    // A finished degree mentions "bachelor"/"master" too: student codes need current study.
    if (["S1", "S2", "S3", "S4", "S7"].includes(m.code) && !studying.length) continue;
    add(m.code, Math.min(2, m.score * 0.5), zh ? `关键词：${m.hits.slice(0, 3).join("、")}` : `Cues: ${m.hits.slice(0, 3).join(", ")}`);
  }

  /* aggregate */
  const byCode = new Map<IdentityCode, { score: number; whys: string[]; stage: string | null }>();
  for (const e of ev) {
    const cur = byCode.get(e.code) ?? { score: 0, whys: [], stage: null };
    cur.score += e.score;
    if (e.why && !cur.whys.includes(e.why)) cur.whys.push(e.why);
    cur.stage ??= e.stage;
    byCode.set(e.code, cur);
  }
  // E-level codes are exclusive by seniority: keep the strongest of E1/E2/E3 (E4/E5 can stack with one).
  const eLevels = (["E1", "E2", "E3"] as IdentityCode[]).filter((c) => byCode.has(c)).sort((a, b) => byCode.get(b)!.score - byCode.get(a)!.score);
  for (const c of eLevels.slice(1)) byCode.delete(c);
  // Academic researchers (postdoc, faculty) are not placed on the employee seniority ladder.
  if (["R1", "R2", "R3"].some((c) => (byCode.get(c as IdentityCode)?.score ?? 0) >= 3)) for (const c of ["E1", "E2", "E3"] as IdentityCode[]) byCode.delete(c);
  // A current student isn't also "early career" from internships alone.
  if (studying.length && !employed) for (const c of ["E1", "E2", "E3", "E4"] as IdentityCode[]) byCode.delete(c);
  // Minors: S1 excludes outreach-oriented guesses that need an adult (founder/outreach codes stay, the person confirms).

  const out: IdentityGuess[] = [];
  for (const [code, v] of byCode) {
    const confidence = Math.round(Math.min(0.95, 1 - Math.exp(-v.score / 3.5)) * 100) / 100;
    if (confidence < 0.3) continue;
    const stage = v.stage && isValidStage(code, v.stage) ? v.stage : null;
    out.push({ code, confidence, why: v.whys.slice(0, 2).join(zh ? "；" : "; ") || (zh ? "文档线索" : "Document cues"), stage });
  }
  out.sort((a, b) => b.confidence - a.confidence);
  return out.slice(0, 6);
}

/** Roles to pre-select on the profile (inferred: true until the person confirms). */
export function rolesFromGuesses(guesses: IdentityGuess[], threshold = 0.55): Profile["roles"] {
  return guesses
    .filter((g) => g.confidence >= threshold)
    .slice(0, 4)
    .map((g) => ({ code: g.code, stage: g.stage, since: null, inferred: true }));
}
