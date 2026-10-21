/*
 * Pure helpers shared by the channel adapters: what blocks automation on a page (CAPTCHA,
 * login, payment, JS-only forms), which platforms forbid server-side automation, and what a
 * form field means (semantic key → profile path, material). No I/O; unit-tested.
 *
 * Page content is data: these functions only look for markers, they never follow anything a
 * page says.
 */
import { fieldKey } from "@/lib/llm/local/forms";
import type { FieldRequirement } from "./types";

/* ------------------------------------------------------------------ blockers */

export interface Blockers {
  captcha: boolean;
  login: boolean;
  payment: boolean;
  /** Markers found, for logs and the honest note shown to the person. */
  markers: string[];
}

const CAPTCHA_MARKERS: [string, RegExp][] = [
  ["g-recaptcha", /\bg-recaptcha\b/i],
  ["recaptcha", /recaptcha\/(api|enterprise)\.js|www\.google\.com\/recaptcha|recaptcha\.net\/recaptcha|grecaptcha\.(execute|render)|recaptchaPublicSiteKey|"recaptcha[A-Za-z]*SiteKey"/i],
  ["h-captcha", /\bh-captcha\b|hcaptcha\.com\/1\/api\.js|js\.hcaptcha\.com/i],
  ["cf-turnstile", /\bcf-turnstile\b|challenges\.cloudflare\.com\/turnstile/i],
  ["data-sitekey", /\bdata-sitekey\s*=/i],
  ["friendly-captcha", /\bfrc-captcha\b|friendlycaptcha/i],
  ["arkose", /arkoselabs\.com|funcaptcha/i],
  ["captcha-text", /i'?m not a robot|verify (that )?you are (a )?human|人机验证|滑动验证/i],
];

const LOGIN_RE = /<input[^>]+type\s*=\s*["']?password\b/i;
const PAYMENT_RE = /autocomplete\s*=\s*["']?cc-(number|csc|exp)|name\s*=\s*["'][^"']*(card[_-]?number|cardnumber|cvc|cvv)[^"']*["']|js\.stripe\.com\/v3|checkout\.stripe\.com|paypal\.com\/sdk/i;

/** Looks for CAPTCHA, login and payment markers in raw HTML. */
export function detectBlockers(html: string): Blockers {
  const markers: string[] = [];
  for (const [name, re] of CAPTCHA_MARKERS) if (re.test(html)) markers.push(name);
  const captcha = markers.length > 0;
  const login = LOGIN_RE.test(html);
  if (login) markers.push("password-field");
  const payment = PAYMENT_RE.test(html);
  if (payment) markers.push("payment-field");
  return { captcha, login, payment, markers };
}

/* ------------------------------------------------------------------ platforms */

/**
 * Hosts whose terms forbid server-side automation, or that sit behind the person's own account
 * (build contract honesty rule 3). These always go to the handoff (CH6), whatever a source says.
 */
const FORBIDDEN_HOSTS: [RegExp, string][] = [
  [/(^|\.)linkedin\.com$/, "linkedin"],
  [/(^|\.)indeed\.[a-z.]+$/, "indeed"],
  [/(^|\.)glassdoor\.[a-z.]+$/, "glassdoor"],
  [/(^|\.)zhipin\.com$/, "boss"],
  [/(^|\.)zhaopin\.com$/, "zhaopin"],
  [/(^|\.)liepin\.com$/, "liepin"],
  [/(^|\.)51job\.com$/, "51job"],
  [/(^|\.)lagou\.com$/, "lagou"],
  [/(^|\.)maimai\.cn$/, "maimai"],
  [/(^|\.)myworkdayjobs\.com$|(^|\.)workday\.com$/, "workday"],
  [/(^|\.)successfactors\.(com|eu)$/, "successfactors"],
  [/(^|\.)taleo\.net$/, "taleo"],
  [/(^|\.)icims\.com$/, "icims"],
  [/(^|\.)commonapp\.org$/, "common_app"],
  [/(^|\.)ucas\.com$/, "ucas"],
  [/(^|\.)openreview\.net$/, "openreview"],
  [/(^|\.)easychair\.org$/, "easychair"],
  [/(^|\.)softconf\.com$/, "softconf"],
  [/(^|\.)editorialmanager\.com$/, "editorial_manager"],
  [/(^|\.)manuscriptcentral\.com$/, "scholarone"],
  [/(^|\.)gov\.(cn|uk|au|sg|hk)$|(^|\.)gc\.ca$|(^|\.)ec\.europa\.eu$/, "government"],
  [/(^|\.)joinhandshake\.com$/, "handshake"],
  [/(^|\.)wellfound\.com$|(^|\.)angel\.co$/, "wellfound"],
  [/(^|\.)upwork\.com$|(^|\.)fiverr\.com$/, "marketplace"],
];

/** Platform names that are never automated server-side (source `apply.platform` values). */
const FORBIDDEN_PLATFORMS = new Set(["linkedin", "indeed", "glassdoor", "boss", "zhaopin", "liepin", "51job", "lagou", "maimai", "workday", "successfactors", "taleo", "icims", "common_app", "ucas", "openreview", "easychair", "softconf", "editorial_manager", "scholarone", "government", "handshake", "wellfound", "marketplace"]);

export function hostOf(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase().replace(/\.$/, "");
  } catch {
    return null;
  }
}

/** The forbidden platform this URL / platform name belongs to, or null. */
export function forbiddenPlatform(url: string | null | undefined, platform?: string | null): string | null {
  const p = (platform ?? "").toLowerCase().trim();
  if (p && FORBIDDEN_PLATFORMS.has(p)) return p;
  const host = hostOf(url);
  if (!host) return null;
  for (const [re, name] of FORBIDDEN_HOSTS) if (re.test(host)) return name;
  if (host.endsWith(".gov")) return "government";
  return null;
}

/** Form builders that render with JavaScript only (no server-side HTML form to post). */
export function jsOnlyFormHost(url: string | null | undefined): string | null {
  const host = hostOf(url);
  if (!host) return null;
  if (/(^|\.)typeform\.com$/.test(host)) return "typeform";
  if (/(^|\.)tally\.so$/.test(host)) return "tally";
  if (/(^|\.)jotform\.(com|me)$|(^|\.)form\.jotform\.com$/.test(host)) return "jotform";
  if (/(^|\.)airtable\.com$/.test(host)) return "airtable";
  if (/(^|\.)fillout\.com$/.test(host)) return "fillout";
  if (/(^|\.)paperform\.co$/.test(host)) return "paperform";
  return null;
}

export function isGoogleFormUrl(url: string | null | undefined): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (host === "forms.gle") return true;
  if (host === "docs.google.com" || host === "forms.google.com") {
    try {
      return /^\/forms\//.test(new URL(url as string).pathname);
    } catch {
      return false;
    }
  }
  return false;
}

/** Whether `url` is on `allowedHost` or one of its subdomains. */
export function hostAllowed(url: string, allowedHost: string): boolean {
  const h = hostOf(url);
  if (!h) return false;
  const a = allowedHost.toLowerCase().replace(/^\*\./, "").replace(/\.$/, "");
  return h === a || h.endsWith(`.${a}`);
}

/* ------------------------------------------------------------------ field semantics */

/** Profile JSON pointer for each semantic key the form mapper recognises. */
const PROFILE_PATHS: Record<string, string> = {
  full_name: "/identity/name",
  first_name: "/identity/name",
  last_name: "/identity/name",
  email: "/identity/email",
  phone: "/identity/phone",
  location: "/identity/location",
  city: "/identity/city",
  country: "/identity/countryCode",
  linkedin_url: "/identity/links",
  github_url: "/identity/links",
  portfolio_url: "/identity/links",
  scholar_url: "/identity/links",
  orcid: "/identity/links",
  work_authorization: "/identity/workAuthorization",
  sponsorship: "/identity/workAuthorization",
  current_company: "/experience",
  current_title: "/experience",
  years_experience: "/experience",
  school: "/education",
  degree: "/education",
  field_of_study: "/education",
  graduation_date: "/education",
  gpa: "/education",
  startup_name: "/packs/founder",
  one_liner: "/packs/founder",
  stage: "/packs/founder",
  raising: "/packs/founder",
  team_size: "/packs/founder",
  traction: "/packs/founder",
  problem: "/packs/founder",
  use_of_funds: "/packs/founder",
  about_you: "/summary",
  proud_project: "/projects",
};

/** Material each file key produces (for `Requirements.materials`). */
const FILE_MATERIALS: Record<string, string> = {
  resume: "resume_variant",
  cover_letter: "cover_letter",
  pitch_deck: "pitch_deck",
};

export interface FieldSemantics {
  key?: string;
  profilePath?: string;
  userOnly: boolean;
}

/** Semantic meaning of one form field (deterministic; same rules as the local form mapper). */
export function fieldSemantics(name: string, label: string, type?: string): FieldSemantics {
  const k = fieldKey({ name, label, placeholder: null });
  if (!k) return { userOnly: false };
  // "Name pronunciation" is not a self-identification question ("pronoun" ⊂ "pronounce").
  if (k.key === "eeo" && /pronounc/i.test(label) && !/\bpronouns?\b|gender|\bsex\b|race|ethnic|veteran|disab|orientation|religion|marital/i.test(label)) return { userOnly: false };
  // "Website" / "URL" text fields are links; file fields called "Portfolio" are documents.
  const key = type === "file" && k.key === "portfolio_url" ? "portfolio" : k.key;
  return { key, profilePath: PROFILE_PATHS[key], userOnly: k.user };
}

/** Long answers we compose: textareas and custom text questions the mapper can't answer from facts. */
export function isLongQuestion(f: Pick<FieldRequirement, "type" | "key" | "userOnly" | "label">): boolean {
  if (f.userOnly) return false;
  if (f.type === "textarea") return !(f.key && ["full_name", "email", "phone", "location"].includes(f.key));
  if (f.type === "text" && !f.key && f.label.length >= 40 && /\?|describe|tell us|explain|why|what|how/i.test(f.label)) return true;
  return false;
}

/** "(max 200 words)", "in 150 words or less", "最多 300 字" → 200 / 150 / 300. */
export function wordLimitFrom(text: string | null | undefined, maxLength?: number): number | undefined {
  const t = text ?? "";
  const m = /(\d{2,4})\s*(?:words?|字)/i.exec(t) ?? /(?:max(?:imum)?|up to|no more than|under|less than|最多|不超过)\s*(\d{2,4})/i.exec(t);
  if (m) {
    const n = Number(m[1]);
    if (n >= 10 && n <= 5000) return n;
  }
  if (maxLength && maxLength >= 100) return Math.max(20, Math.floor(maxLength / 6.5));
  return undefined;
}

/** Materials implied by the form's file fields, merged with the opportunity's own list. */
export function materialsFor(fields: FieldRequirement[], base: readonly string[] = []): string[] {
  const out = new Set<string>(base);
  for (const f of fields) {
    if (f.type !== "file") continue;
    const m = f.key ? FILE_MATERIALS[f.key] : undefined;
    if (m) out.add(m);
    else if (/writing sample|work sample|sample of (your )?work/i.test(f.label)) out.add("work_samples");
    else if (/transcript|成绩单/i.test(f.label)) out.add("transcript");
    else if (/portfolio|作品集/i.test(f.label)) out.add("portfolio");
  }
  return [...out];
}

/** Cleans a label: collapses whitespace, drops trailing colons/asterisks and "(optional)" markers stay. */
export function cleanLabel(raw: string | null | undefined): string {
  return (raw ?? "")
    .replace(/\s+/g, " ")
    .replace(/\s*[*✱]+\s*$/u, "")
    .replace(/\s*[:：]\s*$/u, "")
    .trim();
}

/** Strips HTML tags/entities from organiser help text (kept as plain data). */
export function plainText(html: string | null | undefined, max = 600): string {
  const text = (html ?? "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&[a-z]+;/gi, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
