import { mapFunction } from "@/lib/core/functions";
import { mapIndustry } from "@/lib/core/industries";
import { getOpportunityType, isOpportunityTypeId } from "@/lib/core/opportunity-types";
import { htmlToReadable } from "@/lib/ingest/html";
import { NormalizeOpportunityInput, type NormalizedOpportunity } from "../types";
import { citiesIn, countriesIn, countryCodeFromName } from "./geo";
import { clip, collapse, detectLanguage, findEmail, findMoney } from "./text";

/*
 * normalizeOpportunity for the local engine: an opportunity page (HTML or text) → the
 * fields of an `opportunities` row. Structured data first (schema.org JobPosting, Event,
 * EducationalOccupationalProgram, Grant JSON-LD), then the page's own wording. Unknown stays
 * null and is listed in `missing` — the UI shows "check the official page" (honesty rule 6).
 */

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Json) : {});
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? collapse(v.replace(/<[^>]+>/g, " ")) : null);
const first = <T>(v: T | T[] | undefined | null): T | undefined => (Array.isArray(v) ? v[0] : (v ?? undefined));

const TYPE_RULES: Array<[string, RegExp]> = [
  ["practice", /onward scout practice application/i],
  ["accelerator", /\baccelerator\b|\bcohort\b.*\bdemo day\b|demo day|加速器|加速营/i],
  ["incubator", /\bincubator\b|孵化器|孵化基地/i],
  ["startup_competition", /startup (competition|challenge|cup)|pitch competition|business plan competition|venture competition|创业大赛|创新创业大赛|创业比赛/i],
  ["pitch_event", /pitch (night|event|day)|demo night|路演活动/i],
  ["hackathon", /hackathon|hack day|黑客马拉松|编程马拉松/i],
  ["postdoc", /\bpost-?doc(toral)?\b|博士后/i],
  ["phd_position", /\bph\.?d\.? (position|studentship|student|candidate|opening|program)|doctoral (position|studentship|student)|博士(研究)?生招生|招收博士/i],
  ["visiting_scholar", /visiting (scholar|researcher|fellow)|访问学者/i],
  ["conference_cfp", /call for (papers|submissions|abstracts|posters)|\bcfp\b|paper submission|征稿|论文征集/i],
  ["speaking", /call for (speakers|talks|proposals|presentations)|speaker (application|submission)|submit a talk|演讲征集|讲者招募/i],
  ["residency", /residency|artist[- ]in[- ]residence|writer[- ]in[- ]residence|驻留|驻地/i],
  ["open_call", /open call|call for (artists|entries|works|artwork)|作品征集|征集作品/i],
  ["scholarship", /scholarship|bursary|tuition (award|waiver)|奖学金|助学金/i],
  ["fellowship", /fellowship|fellows program|研究员计划/i],
  ["grant", /\bgrants?\b|funding opportunity|call for proposals|request for proposals|\brfp\b|资助计划|基金申请|项目申报/i],
  ["award", /\baward\b|\bprize\b|nominations? (open|close)|奖项|评选|大奖/i],
  ["competition", /\bcompetition\b|\bcontest\b|\bchallenge\b|比赛|竞赛|大赛/i],
  ["brand_partnership", /creator (program|fund)|brand (partnership|ambassador)|ambassador program|affiliate program|品牌合作|达人招募/i],
  ["exhibition", /exhibitor|trade (show|fair)|booth application|参展|展商招募|展会/i],
  ["volunteer", /\bvolunteer(s|ing)?\b|志愿者/i],
  ["internship", /\bintern(ship)?s?\b|实习生?/i],
  ["mentorship", /mentorship program|mentoring program|导师计划/i],
  ["course", /\bcourse\b|bootcamp|培训班|课程/i],
  ["job", /(we('| a)re hiring|job description|responsibilities|requirements|qualifications|what you('| wi)ll do|apply for this (job|position|role)|full[- ]time|岗位职责|任职要求|职位描述|招聘)/i],
  ["community", /join (our|the) (community|network)|membership application|社群|会员申请/i],
  ["event", /\b(meetup|summit|conference|workshop|webinar)\b|峰会|论坛|沙龙/i],
];

const MATERIAL_RULES: Array<[string, RegExp]> = [
  ["cv", /\b(academic cv|curriculum vitae|\bcv\b)/i],
  ["resume", /r[ée]sum[ée]|\bresume\b|简历/i],
  ["cover_letter", /cover letter|motivation letter|求职信|动机信/i],
  ["portfolio", /portfolio|作品集/i],
  ["work_samples", /writing sample|work samples?|samples of (your )?work|作品样本/i],
  ["transcript", /transcripts?|成绩单/i],
  ["test_scores", /\b(gre|gmat|toefl|ielts|sat|act|duolingo)\b|test scores|语言成绩/i],
  ["recommendation_letters", /letters? of (recommendation|reference)|recommendation letters?|references?\b|referees?|推荐信/i],
  ["personal_statement", /personal statement|statement of purpose|\bsop\b|个人陈述/i],
  ["research_statement", /research statement|研究陈述/i],
  ["research_proposal", /research (proposal|plan)|project proposal|研究计划/i],
  ["publication_list", /publication list|list of publications|论文列表/i],
  ["pitch_deck", /pitch deck|\bdeck\b|路演/i],
  ["business_plan", /business plan|商业计划书/i],
  ["one_pager", /one[- ]pager|executive summary/i],
  ["financial_summary", /financials|financial (statements|projections|summary)|budget|财务/i],
  ["demo_video", /(demo|pitch|application|intro) video|video (pitch|submission)|视频/i],
  ["abstract", /\babstract\b|摘要/i],
  ["paper", /full paper|manuscript|论文全文/i],
  ["speaker_bio", /speaker bio|讲者简介/i],
  ["talk_proposal", /talk (proposal|abstract|description)|session (proposal|description)/i],
  ["artist_statement", /artist statement|艺术家陈述/i],
  ["short_bio", /\bbio\b|biography|个人简介/i],
];

const PLATFORMS: Array<[RegExp, string, string, boolean]> = [
  // host, platform, channel, requiresAccount
  [/(^|\.)greenhouse\.io$|boards\.greenhouse/, "greenhouse", "CH1", false],
  [/(^|\.)lever\.co$/, "lever", "CH1", false],
  [/(^|\.)ashbyhq\.com$/, "ashby", "CH1", false],
  [/^docs\.google\.com$|^forms\.gle$/, "google_forms", "CH2", false],
  [/(^|\.)typeform\.com$/, "typeform", "CH3", false],
  [/(^|\.)tally\.so$/, "tally", "CH3", false],
  [/(^|\.)jotform\.com$/, "jotform", "CH3", false],
  [/(^|\.)airtable\.com$/, "airtable", "CH3", false],
  [/(^|\.)myworkdayjobs\.com$|(^|\.)workday\.com$/, "workday", "CH6", true],
  [/(^|\.)smartrecruiters\.com$/, "smartrecruiters", "CH3", false],
  [/(^|\.)workable\.com$/, "workable", "CH3", false],
  [/(^|\.)linkedin\.com$/, "linkedin", "CH6", true],
  [/(^|\.)indeed\.com$/, "indeed", "CH6", true],
  [/(^|\.)f6s\.com$/, "f6s", "CH6", true],
  [/(^|\.)devpost\.com$/, "devpost", "CH6", true],
  [/(^|\.)openreview\.net$/, "openreview", "CH6", true],
  [/(^|\.)easychair\.org$/, "easychair", "CH6", true],
  [/(^|\.)submittable\.com$/, "submittable", "CH6", true],
  [/(^|\.)commonapp\.org$/, "common_app", "CH6", true],
  [/(^|\.)zhipin\.com$|(^|\.)zhaopin\.com$|(^|\.)liepin\.com$|(^|\.)51job\.com$/, "cn_job_board", "CH6", true],
];

const MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTH_NUM: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };

/** Finds explicit calendar dates in a string (ISO YYYY-MM-DD), in order. */
export function findDates(text: string): Array<{ iso: string; index: number }> {
  const out: Array<{ iso: string; index: number }> = [];
  const pad = (n: number) => String(n).padStart(2, "0");
  const push = (y: number, m: number, d: number, index: number) => {
    if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return;
    out.push({ iso: `${y}-${pad(m)}-${pad(d)}`, index });
  };
  for (const m of text.matchAll(/\b(20\d{2})-(\d{1,2})-(\d{1,2})\b/g)) push(+m[1], +m[2], +m[3], m.index ?? 0);
  for (const m of text.matchAll(/(20\d{2})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/g)) push(+m[1], +m[2], +m[3], m.index ?? 0);
  for (const m of text.matchAll(new RegExp(`\\b(${MONTHS})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(20\\d{2})\\b`, "gi"))) push(+m[3], MONTH_NUM[m[1].slice(0, 3).toLowerCase()], +m[2], m.index ?? 0);
  for (const m of text.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MONTHS})\\.?,?\\s+(20\\d{2})\\b`, "gi"))) push(+m[3], MONTH_NUM[m[2].slice(0, 3).toLowerCase()], +m[1], m.index ?? 0);
  for (const m of text.matchAll(/\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g)) push(+m[3], +m[1], +m[2], m.index ?? 0); // US M/D/Y
  return out.sort((a, b) => a.index - b.index);
}

const DEADLINE_WORDS = /(deadline|apply by|applications? (close|closes|closing|due|deadline)|due (date|by)|closes? on|closing date|submission deadline|submit by|until|no later than|截止(日期|时间)?|报名截止|申请截止|截至)/i;

function findDeadline(text: string): string | null {
  const lines = text.split(/\n|(?<=[.。])\s+/);
  for (const line of lines) {
    if (!DEADLINE_WORDS.test(line)) continue;
    const at = line.search(DEADLINE_WORDS);
    const dates = findDates(line.slice(at));
    if (dates.length) return dates[0].iso;
  }
  return null;
}

function remoteOf(text: string): "remote" | "hybrid" | "onsite" | null {
  if (/\bhybrid\b|混合办公/i.test(text)) return "hybrid";
  if (/\b(fully remote|remote[- ](first|friendly|ok)|work from (home|anywhere)|\bremote\b|distributed team)\b|远程/i.test(text)) return "remote";
  if (/\b(on-?site|in[- ]office|in[- ]person)\b|到岗|驻场/i.test(text)) return "onsite";
  return null;
}

function eligibilityLines(text: string): string[] {
  return text
    .split(/\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 10 && l.length < 400 && /\b(eligib|must (be|have)|open to|who can apply|requirements?|applicants? (must|should)|you('ll)? need|only|citizens?|residents?|under the age|years? of experience|degree)\b|申请条件|申请资格|要求|仅限|须为|年龄/i.test(l));
}

export function localNormalizeOpportunity(raw: NormalizeOpportunityInput): NormalizedOpportunity {
  const input = NormalizeOpportunityInput.parse(raw);
  const now = input.now ? new Date(input.now) : new Date();
  const page = input.html ? htmlToReadable(input.html, input.url) : null;
  const text = (page?.text || input.text || "").slice(0, 60_000);
  const allText = [page?.title, page?.description, text].filter(Boolean).join("\n");
  const missing: string[] = [];

  /* JSON-LD */
  let ld: Json = {};
  let ldType: string | null = null;
  for (const item of page?.jsonLd ?? []) {
    const t = first(obj(item)["@type"] as string | string[] | undefined);
    if (typeof t === "string" && /JobPosting|Event|EducationalOccupationalProgram|Grant|MonetaryGrant|Course|Competition/.test(t)) {
      ld = obj(item);
      ldType = t;
      break;
    }
  }

  /* type */
  let type: string | null = input.hint?.type && isOpportunityTypeId(input.hint.type) ? input.hint.type : null;
  if (!type && ldType === "JobPosting") {
    const emp = String(first(ld.employmentType as string | string[]) ?? "").toUpperCase();
    type = emp.includes("INTERN") ? "internship" : emp.includes("PART") ? "part_time" : emp.includes("VOLUNTEER") ? "volunteer" : String(ld.jobLocationType ?? "").includes("TELECOMMUTE") ? "remote_job" : "job";
  }
  if (!type && ldType && /Grant/.test(ldType)) type = "grant";
  if (!type) {
    const head = `${page?.title ?? ""}\n${input.hint?.name ?? ""}\n${allText.slice(0, 3000)}`;
    for (const [t, re] of TYPE_RULES) {
      if (re.test(head)) {
        type = t;
        break;
      }
    }
  }
  if (!type) missing.push("type");

  /* name & organisation */
  const titleClean = (s: string | null | undefined) => (s ? collapse(s.split(/\s+[|·–—-]\s+/)[0]) : null);
  const name = input.hint?.name ?? str(ld.title) ?? str(ld.name) ?? titleClean(page?.meta["og:title"]) ?? titleClean(page?.title) ?? (text ? clip(text.split("\n").find((l) => l.trim().length > 5) ?? "", 160) || null : null);
  const ldOrg = str(obj(ld.hiringOrganization).name) ?? str(obj(first(ld.organizer as unknown[]) ?? ld.organizer).name) ?? str(obj(ld.provider).name) ?? str(obj(ld.funder).name);
  const atOrg = page?.title ? /\bat\s+([A-Z][\w&.' -]{1,60}?)(?:\s+[|·–—-]|$)/.exec(page.title)?.[1] ?? null : null;
  const orgName = input.hint?.orgName ?? ldOrg ?? atOrg ?? page?.siteName ?? null;
  if (!name) missing.push("name");
  if (!orgName) missing.push("orgName");

  /* dates */
  const ldDeadline = str(ld.validThrough) ?? str(ld.applicationDeadline) ?? null;
  let deadline = ldDeadline ? ldDeadline.slice(0, 10) : findDeadline(allText);
  if (deadline && !/^\d{4}-\d{2}-\d{2}/.test(deadline)) deadline = null;
  const rolling = /\brolling (basis|admissions?|applications?|deadline)\b|accepted (on a rolling basis|year[- ]round|continuously)|no deadline|随时申请|滚动(招生|录取|申请)|常年/i.test(allText);
  const closed = /\b(applications? (are|is) (now )?closed|no longer accepting|this (job|position|role) (is|has been) (closed|filled)|applications have closed|registration (is )?closed)\b|已截止|停止报名|招聘已结束/i.test(allText);
  const expired = closed || (deadline !== null && new Date(`${deadline}T23:59:59Z`).getTime() < now.getTime());
  if (!deadline && !rolling) missing.push("deadline");
  const cycle = /\b(annual(ly)?|every year|each year|yearly)\b|每年|年度/i.test(allText) ? "annual" : /\b(twice a year|biannual|two batches|spring and fall|两期)\b/i.test(allText) ? "biannual" : /\b(quarterly|every quarter)\b|每季度/i.test(allText) ? "quarterly" : /\b(monthly|every month)\b|每月/i.test(allText) ? "monthly" : null;

  /* geo */
  const ldLoc = obj(first(ld.jobLocation as unknown[]) ?? ld.jobLocation ?? ld.location);
  const addr = obj(ldLoc.address);
  const locText = [str(addr.addressLocality), str(addr.addressRegion), str(obj(addr.addressCountry).name) ?? str(addr.addressCountry)].filter(Boolean).join(", ");
  const elig = eligibilityLines(allText);
  const locationLines = allText.split("\n").filter((l) => /\b(location|based in|located in|office|where)\b|地点|城市|地址/i.test(l)).slice(0, 5).join("\n");
  const ldCountryRaw = str(obj(addr.addressCountry).name) ?? str(addr.addressCountry);
  const ldCountry = ldCountryRaw ? (/^[A-Za-z]{2}$/.test(ldCountryRaw) ? ldCountryRaw.toUpperCase() : countryCodeFromName(ldCountryRaw)) : null;
  const countries = [...new Set([...(ldCountry ? [ldCountry] : []), ...countriesIn(`${locText}\n${locationLines}`), ...countriesIn(elig.join("\n"))])].slice(0, 12);
  const cities = [...new Set(citiesIn(`${locText}\n${locationLines}`))].slice(0, 8).map((c) => c.replace(/\b\w/g, (ch) => ch.toUpperCase()));
  const remote = String(ld.jobLocationType ?? "").includes("TELECOMMUTE") ? "remote" : remoteOf(`${page?.title ?? ""}\n${locText}\n${allText.slice(0, 8000)}`);
  const worldwide = /\b(open (to|for) (applicants|founders|teams|people|everyone) (from )?(anywhere|all over the world|any country|worldwide)|from anywhere in the world|worldwide|globally|any nationality)\b|面向全球|不限国籍/i.test(allText);

  /* eligibility */
  const eligText = elig.join("\n");
  const identities: string[] = [];
  if (/\b(students?|undergraduates?|graduate students|enrolled)\b|在读|学生/i.test(eligText)) identities.push("S");
  if (/\b(founders?|startups?|early[- ]stage (companies|teams|startups))\b|创业者|初创/i.test(eligText) || ["accelerator", "incubator", "startup_competition", "investor"].includes(type ?? "")) identities.push("F");
  if (/\b(researchers?|faculty|postdocs?|scientists?|phd holders?)\b|研究者|科研人员|青年教师/i.test(eligText)) identities.push("R");
  if (/\b(artists?|creators?|writers?|designers?|filmmakers?)\b|艺术家|创作者/i.test(eligText) && ["residency", "open_call", "brand_partnership"].includes(type ?? "")) identities.push("C");
  const stages: string[] = [];
  if (/\bpre-?seed\b/i.test(eligText)) stages.push("pre_seed");
  if (/\bseed\b/i.test(eligText)) stages.push("seed");
  if (/\bseries a\b/i.test(eligText)) stages.push("series_a");
  if (/\bidea[- ]stage\b|想法阶段/i.test(eligText)) stages.push("idea");
  const degree = /\bph\.?d\.?\b.*\b(required|holders?|completed)|doctoral degree|博士学位/i.test(eligText) ? "doctorate" : /\bmaster'?s degree\b|硕士(及以上)?学历/i.test(eligText) ? "master" : /\bbachelor'?s degree\b|本科(及以上)?学历/i.test(eligText) ? "bachelor" : null;
  const minYears = (() => {
    const m = /(\d{1,2})\+?\s*(?:or more\s*)?years?(?:\s+of)?\s+(?:relevant |professional |industry |work )?experience|(\d{1,2})\s*年以上(?:相关)?(?:工作)?经验/i.exec(allText);
    return m ? Number(m[1] ?? m[2]) : null;
  })();
  const maxYears = (() => {
    const m = /(?:less than|under|fewer than|up to|no more than|at most|within)\s+(\d{1,2})\s+years?\s+(?:of\s+)?(?:experience|since graduat|post[- ]?(?:phd|graduation))/i.exec(allText);
    return m ? Number(m[1]) : null;
  })();
  const ageMax = (() => {
    const m = /\bunder (?:the age of )?(\d{2})\b|\baged? (\d{2}) (?:or|and) (?:under|younger)|(\d{2}) years (?:old )?or younger|(\d{2})\s*周?岁(?:以下|及以下)/i.exec(allText);
    return m ? Number(m[1] ?? m[2] ?? m[3] ?? m[4]) : null;
  })();
  const ageMin = (() => {
    const m = /\b(?:at least|over|aged?) (\d{2})(?: years old)?(?: or older| and over|\+)?\b(?=.*(?:age|old|older))|(\d{2})\s*周?岁以上/i.exec(eligText);
    return m ? Number(m[1] ?? m[2]) : null;
  })();
  const studentsOnly = /\b(current|enrolled|full-time) students? only\b|must be (a |an )?(currently )?enrolled|open (only )?to (current )?students|仅限在读|在校生/i.test(eligText) ? true : null;
  const nationality = /\b(citizens?|nationals?)\b|国籍|公民/i.test(eligText) ? countriesIn(eligText.split("\n").filter((l) => /citizen|national|国籍|公民/i.test(l)).join("\n")) : [];
  const residency = /\b(residents?|based in|located in)\b|常住|居住/i.test(eligText) ? countriesIn(eligText.split("\n").filter((l) => /resident|based in|located in|常住|居住/i.test(l)).join("\n")) : [];
  if (!elig.length) missing.push("eligibility");

  /* money */
  const benefitLines = allText.split("\n").filter((l) => /\b(prize|grant|award|funding|stipend|salary|compensation|invest(ment)?|up to|per year|per month|scholarship|cash)\b|奖金|资助|薪资|津贴|投资|奖学金/i.test(l)).slice(0, 12);
  const ldSalary = obj(ld.baseSalary);
  const ldValue = obj(ldSalary.value);
  let money: NormalizedOpportunity["benefits"]["money"] = null;
  if (typeof ldValue.minValue === "number" || typeof ldValue.maxValue === "number" || typeof ldValue.value === "number") {
    money = { min: (ldValue.minValue as number) ?? (ldValue.value as number) ?? null, max: (ldValue.maxValue as number) ?? (ldValue.value as number) ?? null, currency: str(ldSalary.currency), text: null };
  } else {
    const amounts = benefitLines.flatMap((l) => findMoney(l).map((m) => ({ ...m, line: l }))).filter((m) => m.amount >= 100);
    if (amounts.length) {
      const sorted = [...amounts].sort((a, b) => a.amount - b.amount);
      money = { min: amounts.length > 1 ? sorted[0].amount : null, max: sorted[sorted.length - 1].amount, currency: sorted[sorted.length - 1].currency, text: clip(sorted[sorted.length - 1].line, 200) };
    }
  }
  const perks = [
    [/mentor(ship|ing)/i, "mentorship"],
    [/office space|co-?working|desk space|办公场地/i, "workspace"],
    [/cloud credits|aws credits|gcp credits|azure credits/i, "cloud credits"],
    [/housing|accommodation|住宿/i, "housing"],
    [/travel (support|stipend|grant|costs)|travel (is )?covered|差旅/i, "travel support"],
    [/visa sponsorship|sponsor (your )?visa|签证支持/i, "visa sponsorship"],
    [/demo day/i, "demo day"],
    [/investor (intros|introductions|network)|投资人对接/i, "investor introductions"],
  ]
    .filter(([re]) => (re as RegExp).test(allText))
    .map(([, p]) => p as string);
  const benefitSummary = benefitLines[0] ? clip(benefitLines[0], 240) : null;

  /* cost */
  const feeLine = allText.split("\n").find((l) => /(application|entry|registration|submission) fee|报名费|申请费/i.test(l));
  const feeMoney = feeLine ? findMoney(feeLine)[0] ?? null : null;
  const free = /\bfree to (apply|enter|participate)|no (application|entry) fee|free of charge|免费(报名|申请|参加)/i.test(allText) ? true : feeMoney ? false : null;
  const equity = /(\d+(?:\.\d+)?)\s*%\s*(?:equity|stake|of (?:your )?(?:company|equity))|in exchange for (\d+(?:\.\d+)?)\s*%|(\d+(?:\.\d+)?)%\s*股权/i.exec(allText);
  const equityPercent = equity ? Number(equity[1] ?? equity[2] ?? equity[3]) : null;

  /* materials & apply */
  const requiredMaterials: string[] = [];
  const reqText = allText.split("\n").filter((l) => /\b(submit|upload|include|attach|provide|required|requirements|materials|send|application (consists|includes|package))\b|提交|上传|材料|附上/i.test(l)).join("\n");
  for (const [mat, re] of MATERIAL_RULES) if (re.test(reqText) && !requiredMaterials.includes(mat)) requiredMaterials.push(mat);
  if (requiredMaterials.includes("cv") && requiredMaterials.includes("resume")) requiredMaterials.splice(requiredMaterials.indexOf(type === "job" || type === "internship" ? "cv" : "resume"), 1);

  const applyLink = page?.links.find((l) => /^(apply|apply now|apply here|start (your )?application|submit (an )?application|register|报名|申请|立即申请|投递)/i.test(l.text.trim()))?.url ?? str(ld.url) ?? null;
  const applyUrl = applyLink ?? input.url;
  let host = "";
  try {
    host = new URL(applyUrl).hostname.toLowerCase();
  } catch {
    host = "";
  }
  const platformRow = PLATFORMS.find(([re]) => re.test(host));
  const applyEmail = (() => {
    const line = allText.split("\n").find((l) => /\b(send|email|e-mail|apply|submit)\b.*@|发送至|投递至|邮箱/i.test(l) && /@/.test(l));
    return line ? findEmail(line) : null;
  })();
  const requiresAccount = platformRow ? platformRow[3] : /\b(create an account|sign in to apply|log in to apply|register an account)\b|注册账号|登录后/i.test(allText) ? true : null;
  const channel = platformRow?.[2] ?? (applyEmail && !applyLink ? "CH4" : requiresAccount ? "CH6" : type && isOpportunityTypeId(type) ? getOpportunityType(type).defaultChannel : null);
  if (!applyLink && !applyEmail) missing.push("apply");

  /* classification helpers */
  const head = `${name ?? ""} ${page?.description ?? ""} ${allText.slice(0, 1500)}`;
  const industries = mapIndustry(head, { limit: 3, minScore: 0.6 }).map((m) => m.code);
  const functions = name ? mapFunction(name, { limit: 2 }).map((m) => m.code) : [];
  const keywords = str(ld.skills) ?? str(ld.keywords) ?? page?.meta["keywords"] ?? null;
  const tags = keywords ? [...new Set(keywords.split(/\s*[,;|]\s*/).map((t) => t.trim().toLowerCase()).filter((t) => t && t.length <= 40))].slice(0, 12) : [];
  const lang = page?.lang?.slice(0, 2).toLowerCase() || detectLanguage(allText);

  /* effort: minutes of the whole application (we prepare most of it) */
  const personMats = requiredMaterials.filter((m) => ["transcript", "test_scores", "recommendation_letters", "demo_video", "work_samples", "paper"].includes(m)).length;
  const estEffortMinutes = type ? 10 + personMats * 20 + (requiredMaterials.length - personMats) * 6 + (requiresAccount ? 10 : 0) : null;

  const summary = page?.description ? clip(page.description, 300) : text ? clip(text.replace(/^#.*\n/, "").split(/(?<=[.!?。！？])\s/).slice(0, 2).join(" "), 300) : null;
  const found = [type, name, orgName, deadline ?? (rolling ? "rolling" : null), applyLink ?? applyEmail, elig.length ? "e" : null].filter(Boolean).length;
  return {
    type,
    name: name ? clip(name, 200) : null,
    orgName: orgName ? clip(orgName, 120) : null,
    summary,
    description: text ? text.slice(0, 8000) : null,
    url: input.url,
    deadline,
    rolling,
    cycle,
    geo: { countries, cities, remote, worldwide },
    languages: lang ? [lang] : [],
    tags,
    industries,
    functions,
    eligibility: {
      identities,
      stages,
      degree,
      minYears,
      maxYears,
      nationality,
      residency,
      ageMin,
      ageMax,
      studentsOnly,
      notes: elig.length ? clip(elig.slice(0, 4).join(" "), 600) : null,
    },
    benefits: { summary: benefitSummary, money, perks },
    cost: { free, applicationFee: feeMoney ? { min: feeMoney.amount, max: feeMoney.amount, currency: feeMoney.currency, text: clip(feeLine ?? "", 160) } : null, equityPercent, notes: equity ? clip(equity[0], 120) : null },
    requiredMaterials,
    apply: { channel, url: applyLink ?? input.url, email: applyEmail, platform: platformRow?.[1] ?? (host ? "own_site" : null), requiresAccount, requiresPayment: feeMoney ? true : free === true ? false : null },
    estEffortMinutes,
    confidence: Math.round((0.2 + (found / 6) * 0.7) * 100) / 100,
    missing,
    expired,
  };
}
