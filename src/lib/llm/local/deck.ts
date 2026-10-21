import { clip, collapse, findEmail, findMoney, findUrls, hasCjk, isQuantified, lines as splitLines, stripBullet, uniq } from "./text";

/*
 * Pitch deck / business plan parser for founders. Decks are slide text ("[Slide n]" blocks
 * from the PPTX extractor, or page text from a PDF export); business plans are long prose
 * with headings. Both are read as titled blocks: the block title decides what the lines
 * mean (Problem, Solution, Traction, Team, Ask…). Every value keeps its source lines.
 */

export interface Money {
  amount: number | null;
  currency: string | null;
  text: string | null;
}

/** Parse-level venture (deck vocabulary); ir.ts maps it to the extraction IR. */
export interface Venture {
  company: string | null;
  oneLiner: string | null;
  website: string | null;
  industry: string | null;
  stage: string | null;
  teamSize: number | null;
  team: Array<{ name: string; role: string | null; background: string | null }>;
  problem: string | null;
  solution: string | null;
  market: string | null;
  businessModel: string | null;
  traction: string[];
  fundingHistory: string[];
  raising: Money | null;
  round: string | null;
  useOfFunds: string | null;
}

export interface Sourced<T> {
  value: T;
  quote: string;
}

type BlockKey =
  | "cover"
  | "problem"
  | "solution"
  | "product"
  | "market"
  | "business_model"
  | "traction"
  | "team"
  | "ask"
  | "use_of_funds"
  | "competition"
  | "go_to_market"
  | "financials"
  | "vision"
  | "contact"
  | "summary"
  | "other";

const BLOCK_TITLES: Array<[BlockKey, RegExp]> = [
  ["problem", /^(the )?(problem|pain points?|challenge|why now\??)$|^(痛点|问题|行业痛点|市场痛点)$/i],
  ["solution", /^(the |our )?solution$|^(解决方案|我们的方案)$/i],
  ["product", /^(the |our )?(product|how it works|platform|technology|demo)$|^(产品|产品介绍|核心技术|技术)$/i],
  ["market", /^(the )?(market|market size|market opportunity|opportunity|tam\b.*|target market)$|^(市场|市场规模|市场机会|目标市场)$/i],
  ["business_model", /^(the )?(business model|revenue model|pricing|monetization|unit economics)$|^(商业模式|盈利模式|收入模式)$/i],
  ["traction", /^(traction|milestones|progress|metrics|key metrics|results|customers|growth)$|^(牵引力|进展|里程碑|核心数据|运营数据|业绩)$/i],
  ["team", /^(the |our )?(team|founders?|founding team|leadership|management team)$|^(团队|核心团队|创始团队|管理团队)$/i],
  ["ask", /^(the )?(ask|investment|fundraising|funding|the round|raise|our raise|financing)$|^(融资需求|融资计划|本轮融资|融资)$/i],
  ["use_of_funds", /^(use of (funds|proceeds)|allocation of funds)$|^(资金用途|资金使用计划)$/i],
  ["competition", /^(competition|competitive landscape|competitors|why us|differentiation)$|^(竞争|竞品分析|竞争优势|竞争格局)$/i],
  ["go_to_market", /^(go[- ]to[- ]market|gtm|distribution|sales strategy|marketing plan)$|^(市场策略|推广策略|营销策略)$/i],
  ["financials", /^(financials?|financial projections?|projections|financial plan)$|^(财务|财务预测|财务规划)$/i],
  ["vision", /^(vision|mission|our vision|our mission)$|^(愿景|使命)$/i],
  ["contact", /^(contact|contact us|thank you|thanks|get in touch)$|^(联系方式|联系我们|谢谢)$/i],
  ["summary", /^(executive summary|summary|overview|company overview|company description)$|^(执行摘要|项目概述|公司简介|项目简介)$/i],
];

interface Block {
  key: BlockKey;
  title: string;
  lines: string[];
}

function blockKeyOf(line: string): BlockKey | null {
  const t = line.replace(/^[\d.\s#]+/, "").replace(/[:：]$/, "").trim();
  if (!t || t.length > 40) return null;
  for (const [key, re] of BLOCK_TITLES) if (re.test(t)) return key;
  return null;
}

/** Splits a deck into blocks: one per slide (titled by its first line) or per heading in prose. */
export function splitBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const isSlides = /\[Slide \d+\]/i.test(text);
  if (isSlides) {
    for (const chunk of text.split(/\[Slide \d+\]/i)) {
      const ls = splitLines(chunk).filter(Boolean);
      if (!ls.length) continue;
      const key = blockKeyOf(ls[0]);
      blocks.push({ key: blocks.length === 0 && !key ? "cover" : key ?? "other", title: ls[0], lines: key ? ls.slice(1) : ls });
    }
    return blocks;
  }
  let cur: Block = { key: "cover", title: "", lines: [] };
  blocks.push(cur);
  for (const line of splitLines(text)) {
    if (!line) continue;
    const key = blockKeyOf(line);
    if (key) {
      cur = { key, title: line, lines: [] };
      blocks.push(cur);
    } else cur.lines.push(line);
  }
  return blocks.filter((b) => b.lines.length || b.key !== "cover");
}

const GENERIC_COVER = /^(pitch ?deck|investor (presentation|deck|update)|confidential|seed round|series [a-e]|pre-?seed|business plan|商业计划书|融资计划书|路演|\d{4})$/i;

const ROUND_RE: Array<[RegExp, string]> = [
  [/\bpre[- ]?seed\b|天使轮前|种子前/i, "pre_seed"],
  [/\bseed\b|种子轮|天使轮|angel round/i, "seed"],
  [/\bpre[- ]?a\b|pre-?a轮/i, "seed"],
  [/\bseries a\b|a\s?轮/i, "series_a"],
  [/\bseries [b-f]\b|[b-f]\s?轮/i, "series_b_plus"],
  [/\bbootstrapped\b|自筹|自有资金/i, "bootstrapped"],
];

export function roundOf(text: string): { round: string; stage: string } | null {
  for (const [re, stage] of ROUND_RE) {
    const m = re.exec(text);
    if (m) return { round: m[0], stage };
  }
  return null;
}

const INDUSTRY_HINTS: Array<[RegExp, string]> = [
  [/\b(fintech|payments?|banking|lending|bookkeeping|accounting|insurtech|invoic)/i, "fintech"],
  [/\b(health|clinic|patients?|medical|biotech|pharma|care)\b|医疗|健康|医药/i, "healthcare"],
  [/\b(edtech|education|students?|learning|tutoring|school)\b|教育|学习/i, "education"],
  [/\b(climate|carbon|solar|energy|battery|emissions?|sustainab)/i, "climate"],
  [/\b(restaurant|food|grocery|kitchen|dining)\b|餐饮|食品/i, "food"],
  [/\b(ai|machine learning|llm|computer vision|generative)\b|人工智能|大模型/i, "ai"],
  [/\b(saas|b2b software|workflow|platform for)\b/i, "saas"],
  [/\b(e-?commerce|marketplace|retail|d2c|dtc)\b|电商|零售/i, "commerce"],
  [/\b(logistics|supply chain|freight|shipping)\b|物流|供应链/i, "logistics"],
  [/\b(real estate|proptech|housing|construction)\b|地产|建筑/i, "real_estate"],
  [/\b(game|gaming|esports)\b|游戏/i, "gaming"],
  [/\b(robot|hardware|iot|device|semiconductor)\b|硬件|机器人|芯片/i, "hardware"],
  [/\b(security|cyber)\b|安全/i, "security"],
  [/\b(hr|recruiting|hiring|workforce)\b|招聘|人力/i, "hr"],
];

export interface ParsedDeck {
  venture: Venture;
  /** Source line per field, for facts: keys are Venture field names; traction/team use `traction.<i>`, `team.<i>`. */
  quotes: Record<string, string>;
  email: Sourced<string> | null;
  founders: Array<{ name: string; role: string | null; background: string | null; quote: string }>;
  isFounderDoc: boolean;
}

function firstLines(ls: string[], n: number): string {
  return ls
    .slice(0, n)
    .map(stripBullet)
    .filter(Boolean)
    .join(hasCjk(ls.join("")) ? "；" : ". ")
    .replace(/\.\./g, ".");
}

const PERSON_LINE = /^([A-Z][a-zà-ÿ'’-]+(?:\s+[A-Z][a-zà-ÿ'’-]+){1,3}|[一-鿿]{2,4})\s*(?:[—–\-|,:：，]\s*|\s+)((?:co-?founder|founder|ceo|cto|coo|cfo|cpo|cmo|chief [a-z]+ officer|head of [a-z ]+|vp [a-z ]+|president|创始人|联合创始人|首席[一-鿿]+官|技术负责人|总经理|合伙人)[^,，;；]*)(?:[,，;；]\s*(.+))?$/i;

export function parseDeck(text: string): ParsedDeck {
  const blocks = splitBlocks(text);
  const quotes: Record<string, string> = {};
  const all = blocks.flatMap((b) => [b.title, ...b.lines]);
  const byKey = (k: BlockKey) => blocks.filter((b) => b.key === k);

  // Company and one-liner: the cover's first meaningful lines.
  const cover = blocks[0]?.key === "cover" ? blocks[0] : null;
  const coverLines = cover ? [cover.title, ...cover.lines].filter((l) => l && !GENERIC_COVER.test(l.trim())) : [];
  let company: string | null = null;
  let oneLiner: string | null = null;
  const labelled = /(?:公司名称|项目名称|company name|company)\s*[:：]\s*(.+)/i.exec(text);
  if (labelled) {
    company = clip(labelled[1], 80);
    quotes.company = labelled[0];
  } else if (coverLines[0] && coverLines[0].length <= 40 && coverLines[0].split(/\s+/).length <= 5 && !/[.。]$/.test(coverLines[0])) {
    company = coverLines[0].trim();
    quotes.company = coverLines[0];
  }
  const tagline = coverLines.find((l, i) => i > 0 && l.length >= 15 && l.length <= 160 && !findUrls(l).length && !findEmail(l) && !roundOf(l));
  if (tagline) {
    oneLiner = collapse(tagline);
    quotes.oneLiner = tagline;
  }
  if (!oneLiner) {
    const mission = byKey("vision")[0] ?? byKey("summary")[0];
    if (mission?.lines[0]) {
      oneLiner = clip(stripBullet(mission.lines[0]), 200);
      quotes.oneLiner = mission.lines[0];
    }
  }

  const section = (k: BlockKey, field: string, n = 3): string | null => {
    const b = byKey(k)[0];
    if (!b || !b.lines.length) return null;
    quotes[field] = clip(b.lines.slice(0, n).join(" / "), 300);
    return clip(firstLines(b.lines, n), 600);
  };
  const problem = section("problem", "problem");
  const solution = section("solution", "solution") ?? section("product", "solution");
  const market = section("market", "market", 2);
  const businessModel = section("business_model", "businessModel", 2);

  // Traction: the traction block, plus quantified lines anywhere that use traction words.
  const traction: string[] = [];
  for (const b of byKey("traction")) for (const l of b.lines) if (stripBullet(l).length > 3 && !/\b(raising|the ask)\b|本轮融资/i.test(l)) traction.push(stripBullet(l));
  for (const l of all) {
    const s = stripBullet(l);
    if (traction.includes(s) || s.length > 200) continue;
    if (/\b(raising|raise|seeking|the ask)\b|融资|募集/i.test(s)) continue;
    if (isQuantified(s) && /\b(paying|customers?|users?|arr|mrr|revenue|gmv|retention|pilots?|lois?|downloads?|waitlist|signed|growing|growth)\b|付费|客户|用户|营收|收入|复购|留存|签约|增长/i.test(s) && !/\b(market|tam|sam|som)\b|市场规模/i.test(s)) {
      traction.push(s);
    }
  }
  const tractionList = uniq(traction).slice(0, 10);
  tractionList.forEach((t, i) => (quotes[`traction.${i}`] = t));

  // Team.
  const founders: ParsedDeck["founders"] = [];
  let teamSize: number | null = null;
  const teamBlocks = byKey("team");
  const teamLines = teamBlocks.length ? teamBlocks.flatMap((b) => b.lines) : all;
  for (const l of teamLines) {
    const s = stripBullet(l);
    const m = PERSON_LINE.exec(s);
    if (m) founders.push({ name: m[1].trim(), role: m[2].trim(), background: m[3]?.trim() ?? null, quote: l });
    const size = /\b(?:team of|we are|team:?)\s*(\d{1,4})\b|\b(\d{1,4})\s*(?:full[- ]time|employees|people|team members|ftes?)\b|团队\s*(\d{1,4})\s*人|(\d{1,4})\s*名(?:员工|成员)/i.exec(s);
    if (size && teamSize === null) {
      teamSize = Number(size[1] ?? size[2] ?? size[3] ?? size[4]);
      quotes.teamSize = l;
    }
  }
  if (teamSize === null && founders.length) {
    teamSize = null; // founders listed ≠ team size; ask instead of guessing
  }
  founders.forEach((f, i) => (quotes[`team.${i}`] = f.quote));

  // The ask.
  let raising: Money | null = null;
  let round: string | null = null;
  let stage: string | null = null;
  const askLines = [...byKey("ask").flatMap((b) => [b.title, ...b.lines]), ...all.filter((l) => /\b(raising|raise|we are seeking|seeking|the ask|investment of)\b|融资|募集|拟融/i.test(l))];
  for (const l of askLines) {
    const money = findMoney(l);
    if (money.length && !raising && /\b(rais|seek|ask|round|invest)|融资|募集/i.test(l)) {
      raising = { amount: money[0].amount, currency: money[0].currency, text: money[0].text };
      quotes.raising = l;
    }
    const r = roundOf(l);
    if (r && !round) {
      round = r.round;
      stage = r.stage;
      quotes.round = l;
    }
  }
  if (!round) {
    const r = roundOf(all.slice(0, 6).join(" "));
    if (r) {
      round = r.round;
      stage = r.stage;
      quotes.round = all.slice(0, 6).find((l) => roundOf(l)) ?? "";
    }
  }
  const useBlock = byKey("use_of_funds")[0];
  let useOfFunds: string | null = null;
  if (useBlock?.lines.length) {
    useOfFunds = clip(firstLines(useBlock.lines, 4), 400);
    quotes.useOfFunds = useBlock.lines.slice(0, 4).join(" / ");
  } else {
    const l = all.find((x) => /\b(use of funds|funds will|proceeds)\b|资金用途|资金将用于/i.test(x));
    if (l) {
      useOfFunds = clip(l.replace(/^.*?(use of funds|资金用途)\s*[:：]?\s*/i, ""), 400);
      quotes.useOfFunds = l;
    }
  }

  const email = (() => {
    for (const l of all) {
      const e = findEmail(l);
      if (e) return { value: e, quote: l };
    }
    return null;
  })();
  const website = findUrls(all.join("\n")).find((u) => !/linkedin|twitter|x\.com|facebook|instagram/.test(u)) ?? null;
  if (website) {
    const host = website.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0];
    quotes.website = all.find((l) => l.includes(host) && !l.includes(`@${host}`)) ?? all.find((l) => l.includes(host)) ?? website;
  }

  let industry: string | null = null;
  const sample = [oneLiner, problem, solution, market].filter(Boolean).join(" ");
  for (const [re, ind] of INDUSTRY_HINTS) {
    if (re.test(sample)) {
      industry = ind;
      quotes.industry = oneLiner ?? problem ?? "";
      break;
    }
  }
  if (!stage && tractionList.some((t) => /\b(arr|mrr|revenue|paying)\b|营收|付费/i.test(t))) stage = null;

  const isFounderDoc = Boolean(problem || solution || tractionList.length || raising || founders.length || byKey("market").length);
  return {
    venture: {
      company,
      oneLiner,
      website,
      industry,
      stage,
      teamSize,
      team: founders.map((f) => ({ name: f.name, role: f.role, background: f.background })),
      problem,
      solution,
      market,
      businessModel,
      traction: tractionList,
      fundingHistory: [],
      raising,
      round,
      useOfFunds,
    },
    quotes,
    email,
    founders,
    isFounderDoc,
  };
}
