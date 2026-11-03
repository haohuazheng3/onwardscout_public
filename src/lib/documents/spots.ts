import { fieldKey } from "@/lib/llm/local/forms";

/*
 * The spots a draft leaves for the person, put in order before anything is asked (pure).
 *
 * A writer (the local templates, or Claude) marks every fact it lacks as a gap with its own key
 * and wording: one hackathon deck came back with seven — project_name, one_liner, problem,
 * solution, track, presenter_role, teammates — and another asked for the presenter's name the
 * profile already had. Asked one by one, that is a wall of questions before anyone sees a draft.
 * Here each spot gets a canonical key so that
 *   - what the profile already says (name, email, school…) is filled from it, never asked;
 *   - the idea spots of a deck or a startup/hackathon application fold into ONE question
 *     ("what are you building, and what problem does it solve?"), the team spots into one, the
 *     track into one tap when the options are known;
 *   - a deck slide nobody needs to apply (traction, market, the ask…) is left out rather than
 *     asked: the person can always add it by telling the AI what to change.
 */

export const IDEA_KEY = "idea";
export const TEAM_KEY = "team";
export const TRACK_KEY = "track";

/** Keys one answer settles for several spots: a writer that still leaves one after the answer is not asked again. */
export const FOLDED_KEYS: ReadonlySet<string> = new Set([IDEA_KEY, TEAM_KEY, TRACK_KEY]);

/** Opportunity types whose application is about an idea and a team (a project, a startup). */
export const IDEA_TYPES: ReadonlySet<string> = new Set(["hackathon", "competition", "startup_competition", "pitch_event", "accelerator", "incubator"]);

/** Documents about a project or a company, whatever the opportunity. */
const IDEA_DOCUMENTS = new Set(["pitch_notes", "one_pager"]);

/** Where idea / team / track spots fold. */
export function ideaContext(kind: string, oppType: string | null | undefined): boolean {
  return IDEA_DOCUMENTS.has(kind) || IDEA_TYPES.has(oppType ?? "");
}

/* ------------------------------------------------------------------ profile spots */

/** Profile values a spot can be filled from (fieldKey keys). */
export const PROFILE_SPOT_KEYS: ReadonlySet<string> = new Set([
  "full_name", "first_name", "last_name", "email", "phone", "location", "city", "country",
  "linkedin_url", "github_url", "portfolio_url", "school", "degree", "field_of_study", "graduation_date", "current_company", "current_title",
]);

const PROFILE_ALIASES: Record<string, string> = {
  name: "full_name", full_name: "full_name", fullname: "full_name", legal_name: "full_name", signature_name: "full_name", sign_name: "full_name",
  first_name: "first_name", given_name: "first_name", last_name: "last_name", surname: "last_name", family_name: "last_name",
  email: "email", email_address: "email", e_mail: "email",
  phone: "phone", phone_number: "phone", mobile: "phone", mobile_number: "phone", whatsapp: "phone",
  location: "location", based_in: "location", city: "city", country: "country",
  linkedin: "linkedin_url", linkedin_url: "linkedin_url", github: "github_url", github_url: "github_url", portfolio_url: "portfolio_url", personal_website: "portfolio_url",
  school: "school", university: "school", college: "school", institution: "school", school_name: "school", university_name: "school",
  degree: "degree", major: "field_of_study", field_of_study: "field_of_study", graduation: "graduation_date", graduation_date: "graduation_date", graduation_year: "graduation_date",
  current_company: "current_company", employer: "current_company", current_title: "current_title", job_title: "current_title",
};

/** Who the spot is about ("presenter_name" is the person's name): stripped before the alias lookup. */
const PERSON_PREFIX = /^(?:(?:presenter|applicant|founder|team_lead|lead|speaker|author|contact|participant|student|your|my|candidate|signer|primary)_)+/;

/** A question about a project, a team or a company, never about the person ("the name of your project"). */
const ABOUT_A_THING = /\b(project|team|company|startup|product|app|venture|hack|idea|organi[sz]ation|business)\b|项目|团队|公司|产品|作品|队伍/i;

/** Questions that ask for writing, not a value ("Write the email you'd send…"). */
const WRITING = /^\s*(write|describe|tell|explain|share|list|draft|summari[sz]e|give|how|why)\b|请(描述|介绍|写)|为什么/i;

function norm(key: string): string {
  return key.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** The profile field a spot asks for (presenter_name, "What is your full name?"), or null. */
export function profileSpotKey(key: string, question: string): string | null {
  const k = norm(key);
  const alias = PROFILE_ALIASES[k] ?? PROFILE_ALIASES[k.replace(PERSON_PREFIX, "")];
  if (alias) return alias;
  // Unknown key: a short question asking for a value about the person.
  if (ABOUT_A_THING.test(question) || WRITING.test(question) || question.trim().split(/\s+/).length > 10) return null;
  const f = fieldKey({ name: k, label: question, placeholder: null });
  return f && !f.user && PROFILE_SPOT_KEYS.has(f.key) ? f.key : null;
}

/* ------------------------------------------------------------------ idea, team, track */

const IDEA_KEYS = new Set([
  "idea", "project", "project_name", "project_title", "project_description", "project_summary", "team_name", "hack_name", "app_name",
  "product", "product_name", "product_description", "solution", "problem", "problem_statement", "one_liner", "oneliner", "tagline", "pitch",
  "elevator_pitch", "startup_description", "company", "company_name", "startup", "startup_name", "venture", "venture_name", "concept",
  "what_you_build", "what_we_build", "demo_description", "value_proposition",
]);
const TEAM_KEYS = new Set(["team", "teammates", "team_members", "members", "cofounders", "co_founders", "founders", "founding_team", "team_roles", "team_size", "role", "your_role", "role_in_team", "team_role", "teammate_names", "presenter_role"]);
const TRACK_KEYS = new Set(["track", "tracks", "domain", "theme", "category", "challenge", "vertical", "stream", "focus_area", "track_choice", "domain_choice"]);

/** "Which of the six domains is the idea for?" — a pick among the organiser's tracks. */
const TRACK_Q = /\bwhich\b.{0,40}\b(track|domain|theme|category|challenge|vertical|stream)s?\b|\b(track|domain|theme|category|challenge)s?\b.{0,20}\b(are you|will you|do you)\b.{0,20}\b(enter|join|choose|pick|apply)|选(择)?.{0,6}(赛道|方向|主题|赛题)|哪个(赛道|方向|主题|领域|赛题)/i;
/** "What is the name of your project or team?" */
const IDEA_NAME_Q = /\b(name|call(ed)?|title)\b.{0,25}\b(project|team|app|product|startup|company|venture|hack|idea)\b|\b(project|team|app|product|startup|company|venture|hack|idea)('s)?\s+(name|called|title)\b|项目(名称|名字|叫什么)|团队名|队名|产品名|公司(名称|叫什么)/i;
const TEAM_Q = /\bteam(mates?|\s+members?)?\b|co-?founders?|\bwho (else )?(is|are) (on|in|building)\b|your role\b|团队|队友|队员|成员|你的角色|你在团队/i;
const IDEA_Q = /one[- ]?liner|tagline|elevator pitch|\bpitch\b|\bidea\b|what (are|will|do) you (build|building|make|making|plan to build)|what does (your|the) (project|product|app|startup|company|solution) do|\bproblem\b|\bsolution\b|一句话|点子|创意|痛点|解决(什么|的)?问题|解决方案|产品(做什么|是什么)|项目(介绍|简介|做什么)/i;

/** "Why are you applying / what draws you to…": the person's motivation, never folded into the idea. */
const MOTIVATION_Q = /\bwhy (are|do|did|would|should) you\b|\bwhat (draws|attracts|interests) you\b|\bmotivat|为什么(想|要|申请|选择|加入|参加)|申请动机|吸引你/i;

/** Spots a deck or one-pager simply leaves out when no fact backs them (nobody needs them to apply). */
const SLIDE_KEYS = /^(traction|metrics|kpis?|customers|users|revenue|market|market_size|tam|business_model|pricing|monetization|raising|round|ask|the_ask|funding|funding_ask|use_of_funds|competition|competitors|go_to_market|gtm|milestones|roadmap|vision|website|contact|links?|demo|demo_link)$/;

export type SpotKind = "profile" | "idea" | "team" | "track" | "slide" | "own";

export interface Spot {
  kind: SpotKind;
  /** The canonical key the application's answer is stored under. */
  key: string;
}

/** What a writer's gap really asks for, and the key its answer is kept under. */
export function classifySpot(gap: { key: string; question: string }, ctx: { idea: boolean; slides?: boolean }): Spot {
  const k = norm(gap.key);
  const q = gap.question ?? "";
  // The reasons for applying and the career break have their own one question (gaps.ts).
  if (k === "why_this" || k === "career_break" || MOTIVATION_Q.test(q)) return { kind: "own", key: gap.key };
  const profile = PROFILE_ALIASES[k] ?? PROFILE_ALIASES[k.replace(PERSON_PREFIX, "")];
  if (profile) return { kind: "profile", key: profile };
  if (ctx.idea) {
    if (TRACK_KEYS.has(k)) return { kind: "track", key: TRACK_KEY };
    if (IDEA_KEYS.has(k)) return { kind: "idea", key: IDEA_KEY };
    if (TEAM_KEYS.has(k)) return { kind: "team", key: TEAM_KEY };
  }
  if (ctx.slides && SLIDE_KEYS.test(k)) return { kind: "slide", key: gap.key };
  if (ctx.idea) {
    if (TRACK_Q.test(q)) return { kind: "track", key: TRACK_KEY };
    if (IDEA_NAME_Q.test(q)) return { kind: "idea", key: IDEA_KEY };
    if (TEAM_Q.test(q)) return { kind: "team", key: TEAM_KEY };
    if (IDEA_Q.test(q)) return { kind: "idea", key: IDEA_KEY };
  }
  const byQuestion = profileSpotKey(k, q);
  if (byQuestion) return { kind: "profile", key: byQuestion };
  return { kind: "own", key: gap.key };
}

/** The canonical key alone (gaps.ts maps stored keys with it). */
export function spotKey(gap: { key: string; question: string }, ctx: { idea: boolean; slides?: boolean }): string {
  return classifySpot(gap, ctx).key;
}

/**
 * The options a question lists itself ("Which track: AI, FinTech or Health Tech?"), else [].
 * A list given as examples ("incl. …", "e.g. …") is not the full set and is not offered.
 */
export function listedOptions(question: string): string[] {
  const m = /[:：]\s*([^?？:：]+?)\s*[?？]?\s*$/.exec(question) ?? /[(（]([^)）]+)[)）]/.exec(question);
  if (!m) return [];
  if (/\be\.?g\.?\b|for example|such as|\bincl(\.|uding)?\b|\blike\b|etc\.?|例如|比如|包括|等/i.test(m[1])) return [];
  const parts = m[1]
    .split(/\s*(?:,|，|、|\/|;|；|\bor\b|或者|或)\s*/i)
    .map((s) => s.trim().replace(/^(and|和)\s+/i, "").replace(/[.。]+$/, "").trim())
    .filter(Boolean);
  if (parts.length < 2 || parts.length > 10 || parts.some((p) => p.length > 40 || p.split(/\s+/).length > 5)) return [];
  return [...new Map(parts.map((p) => [p.toLowerCase(), p])).values()];
}

/** How a canonical answer reads as a row label (answers sheet, room). */
export function spotLabel(key: string, lang: "en" | "zh"): string | null {
  const L: Record<string, { en: string; zh: string }> = {
    [IDEA_KEY]: { en: "Your idea", zh: "你的点子" },
    [TEAM_KEY]: { en: "Team", zh: "团队" },
    [TRACK_KEY]: { en: "Track", zh: "赛道" },
    why_this: { en: "Why I'm applying", zh: "申请理由" },
    full_name: { en: "Full name", zh: "姓名" },
  };
  return L[key]?.[lang] ?? null;
}

/** Answers the composers read under their own names: the idea is also the project's description. */
export const IDEA_ALIASES = ["startup_description"] as const;

/**
 * The spot's text with the value in place of its placeholder ("[Your name]", "【姓名】"): the whole
 * text when it is only the placeholder, else the one bracketed part. Null when the text holds a
 * second placeholder the value does not settle (it stays a spot).
 */
export function fillPlaceholder(text: string, value: string): string | null {
  const t = text.trim();
  if (/^[[【(（][^\]】)）]*[\]】)）]$/.test(t) || !/[[【]/.test(t)) return value;
  const out = t.replace(/\[[^\]]*\]|【[^】]*】/, value);
  return /[[【]/.test(out) ? null : out;
}
