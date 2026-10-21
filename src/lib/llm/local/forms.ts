import { readProfile, MapFormFieldsInput, PlanBrowserStepInput, type BrowserStep, type FieldMapping, type FormFieldInput } from "../types";
import { FactView, type Backed } from "./factview";
import { countryName } from "./geo";

/*
 * Form understanding without a model: label-synonym field mapping (English + Chinese) and a
 * deterministic browser-step planner over Playwright's accessibility snapshot.
 *
 * Rules that never bend:
 *  - consent boxes, signatures, EEO/self-identification questions, CAPTCHAs, passwords and
 *    payment fields are the person's: `source: "user"`, `needsUser: true`, no value;
 *  - a value is only filled from a fact, a prepared answer or a document; otherwise the
 *    field is left empty and flagged;
 *  - the planner never submits unless `allowSubmit` (the person tapped "Confirm & submit"),
 *    never acts off the allowed host, and stops at CAPTCHA/login/payment.
 */

type Lang = "en" | "zh";

interface KeyDef {
  key: string;
  re: RegExp;
  /** Only the person may answer (consent, EEO, signature, credentials). */
  user?: boolean;
}

/** Ordered: the first match wins, so specific keys come before general ones. */
const KEYS: KeyDef[] = [
  { key: "captcha", re: /captcha|recaptcha|hcaptcha|not a robot|验证码|人机验证/, user: true },
  { key: "password", re: /password|passcode|密码/, user: true },
  { key: "payment", re: /card ?number|credit card|cvc|cvv|expir(y|ation) date|billing|银行卡|信用卡/, user: true },
  { key: "signature", re: /signature|sign here|e-?sign|签名|签字/, user: true },
  { key: "eeo", re: /gender|sex\b|pronoun|race|ethnic|hispanic|latino|veteran|disab|sexual orientation|transgender|self[- ]identif|religion|marital|性别|民族|宗教|婚姻|残疾|政治面貌/, user: true },
  { key: "date_of_birth", re: /date of birth|birth ?date|\bdob\b|出生日期|出生年月/, user: true },
  { key: "consent", re: /consent|i agree|agree to|accept (the )?(terms|privacy)|privacy policy|terms (of|and) (service|use|conditions)|acknowledge|certify that|confirm that|同意|隐私|条款|声明/, user: true },
  { key: "referral_source", re: /how did you (hear|find|learn)|where did you (hear|find)|referr(al|ed) by|source of application|从哪里得知|如何得知|推荐人/ },
  { key: "first_name", re: /first ?name|given ?name|fname|名字(?!.*姓)|^名$/ },
  { key: "last_name", re: /last ?name|surname|family ?name|lname|^姓$|姓氏/ },
  { key: "full_name", re: /full ?name|^name$|your name|applicant name|legal name|contact name|姓名|名字|申请人/ },
  { key: "email", re: /e-?mail|邮箱|电子邮件/ },
  { key: "phone", re: /phone|mobile|cell|telephone|tel\b|whatsapp|手机|电话|联系方式/ },
  { key: "linkedin_url", re: /linkedin|领英/ },
  { key: "github_url", re: /github|gitlab/ },
  { key: "orcid", re: /orcid/ },
  { key: "scholar_url", re: /google scholar|scholar profile|谷歌学术/ },
  { key: "portfolio_url", re: /portfolio|personal (site|website)|website|web ?site|homepage|url|link to (your )?work|作品集|个人网站|主页|链接/ },
  { key: "pitch_deck", re: /pitch ?deck|\bdeck\b|路演|商业计划书|\bbp\b/ },
  { key: "resume", re: /r[ée]sum[ée]|\bcv\b|curriculum vitae|简历|履历/ },
  { key: "cover_letter", re: /cover ?letter|motivation letter|求职信|自荐信/ },
  { key: "why_this", re: /why (do you want|are you interested|this|us|our|join|apply)|what (draws|attracts|interests) you|motivation|why_this|为什么|申请动机|吸引你/ },
  { key: "proud_project", re: /proud|accomplishment|achievement|best work|project you|proud_project|最自豪|代表作|成就/ },
  { key: "about_you", re: /about (you|yourself)|tell us about|introduce yourself|short bio|\bbio\b|自我介绍|个人简介/ },
  { key: "availability", re: /availab|start date|when can you start|earliest start|notice period|到岗|入职时间|可开始/ },
  { key: "salary", re: /salary|compensation|pay expectation|expected (pay|rate)|desired pay|期望薪资|薪资要求|期望工资/ },
  { key: "sponsorship", re: /sponsor|visa support|签证担保/ },
  { key: "work_authorization", re: /authori[sz]ed to work|work authori[sz]ation|right to work|legally (able|eligible) to work|eligible to work|work permit|工作许可|工作签证/ },
  { key: "current_company", re: /current (company|employer)|company name(?!.*startup)|employer|现单位|当前公司|所在公司/ },
  { key: "current_title", re: /current (title|role|position)|job title|^title$|职位|职务|头衔/ },
  { key: "years_experience", re: /years? of experience|experience \(years\)|how many years|工作年限|从业年限/ },
  { key: "school", re: /school|university|college|institution|学校|院校|大学/ },
  { key: "degree", re: /degree|qualification|学历|学位/ },
  { key: "field_of_study", re: /major|field of study|discipline|专业/ },
  { key: "graduation_date", re: /graduat|毕业(时间|日期)/ },
  { key: "gpa", re: /\bgpa\b|grade point|绩点/ },
  { key: "startup_name", re: /startup name|company|organi[sz]ation name|venture|公司名称|项目名称/ },
  { key: "one_liner", re: /one[- ]?liner|tagline|describe (your|the) (company|startup) in|elevator pitch|一句话/ },
  { key: "stage", re: /\bstage\b|阶段|轮次/ },
  { key: "raising", re: /raising|amount (you are|you're) raising|funding (ask|amount)|how much|融资金额|本轮融资/ },
  { key: "team_size", re: /team size|number of (employees|founders|people)|how many (people|employees)|团队规模|团队人数/ },
  { key: "traction", re: /traction|revenue|users|customers|metrics|进展|营收|用户/ },
  { key: "problem", re: /problem|pain|痛点|问题/ },
  { key: "use_of_funds", re: /use of funds|how will you use|资金用途/ },
  { key: "research_interest", re: /research (interest|statement|area)|研究(兴趣|方向)/ },
  { key: "city", re: /^city$|城市/ },
  { key: "country", re: /country|nationality|国家|国籍/ },
  { key: "location", re: /location|address|where are you (based|located)|current location|所在地|地址|居住地/ },
];

function normalize(field: FormFieldInput): string {
  return [field.label, field.name.replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2"), field.placeholder]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
}

/** The semantic key of a form field, or null. Exposed for P3b's own adapters. */
export function fieldKey(field: Pick<FormFieldInput, "name" | "label" | "placeholder">): { key: string; user: boolean } | null {
  const text = normalize({ name: field.name, label: field.label ?? null, placeholder: field.placeholder ?? null, type: "text" });
  // The field name is the most reliable signal (sandbox: full_name, portfolio_url…).
  const name = field.name.toLowerCase();
  for (const k of KEYS) if (name === k.key) return { key: k.key, user: Boolean(k.user) };
  for (const k of KEYS) if (k.re.test(text)) return { key: k.key, user: Boolean(k.user) };
  return null;
}

function splitName(name: string): { first: string; last: string } {
  if (/[一-鿿]/.test(name) && !/\s/.test(name)) {
    const compound = /^(欧阳|司马|上官|诸葛|东方|皇甫|慕容|令狐)/.exec(name)?.[1];
    const last = compound ?? name[0];
    return { first: name.slice(last.length), last };
  }
  const parts = name.trim().split(/\s+/);
  return { first: parts[0], last: parts.length > 1 ? parts[parts.length - 1] : "" };
}

type OptionLike = string | { value: string; label: string };

function optionValue(o: OptionLike): string {
  return typeof o === "string" ? o : o.value;
}
function optionLabel(o: OptionLike): string {
  return typeof o === "string" ? o : o.label;
}

/** Picks the option matching a value (exact, then contained, then yes/no semantics). Returns the option's value. */
export function pickOption(options: OptionLike[], value: string): string | null {
  const v = value.trim().toLowerCase();
  if (!v) return null;
  for (const o of options) if (optionValue(o).toLowerCase() === v || optionLabel(o).toLowerCase() === v) return optionValue(o);
  for (const o of options) {
    const l = optionLabel(o).toLowerCase();
    if (l.length > 1 && (l.includes(v) || v.includes(l))) return optionValue(o);
  }
  const yes = /^(yes|true|y|1|是|有|需要)$/i.test(v);
  const no = /^(no|false|n|0|否|没有|不需要)$/i.test(v);
  if (yes || no) {
    for (const o of options) if ((yes ? /^(yes|是|有|需要)/i : /^(no|否|没有|不需要)/i).test(optionLabel(o).trim())) return optionValue(o);
  }
  return null;
}

export interface Resolved {
  value: string | null;
  source: FieldMapping["source"];
  ids: string[];
  confidence: number;
}

const NONE: Resolved = { value: null, source: "none", ids: [], confidence: 0 };

function fromFact(b: Backed<string> | null, confidence = 0.95): Resolved {
  return b ? { value: b.value, source: "profile", ids: b.ids, confidence } : NONE;
}

/** Resolves one recognised field from facts, answers or documents (exported for answerQuestions). */
export function resolveField(key: string, field: FormFieldInput, view: FactView, answers: Record<string, string>, docs: Array<{ id: string; kind: string; filename: string }>, lang: Lang): Resolved {
  const answer = answers[field.name] ?? answers[key];
  const isFile = field.type === "file";
  if (answer && !isFile) return { value: answer, source: "answer", ids: [`answer:${answers[field.name] ? field.name : key}`], confidence: 0.95 };
  const p = view.profile;
  const name = view.name();
  const links = view.links();
  const link = (...kinds: string[]) => {
    const l = links.find((x) => kinds.includes(x.value.kind));
    return l ? { value: l.value.url, ids: l.ids } : null;
  };
  const doc = (...kinds: string[]): Resolved => {
    const d = docs.find((x) => kinds.includes(x.kind));
    return d ? { value: d.id, source: "document", ids: [], confidence: 0.9 } : NONE;
  };
  const current = view.rankedExperiences().find((e) => e.value.current) ?? null;
  const edu = view.education()[0] ?? null;
  const venture = view.venture();
  switch (key) {
    case "full_name":
      return fromFact(name);
    case "first_name":
      return name ? { value: splitName(name.value).first, source: "profile", ids: name.ids, confidence: 0.9 } : NONE;
    case "last_name":
      return name && splitName(name.value).last ? { value: splitName(name.value).last, source: "profile", ids: name.ids, confidence: 0.9 } : NONE;
    case "email":
      return fromFact(view.email(), 0.98);
    case "phone":
      return fromFact(view.phone(), 0.95);
    case "location":
      return fromFact(view.location(), 0.85);
    case "city": {
      const loc = view.location();
      return loc && p.identity.city ? { value: p.identity.city, source: "profile", ids: loc.ids, confidence: 0.8 } : NONE;
    }
    case "country": {
      const loc = view.location();
      return loc && p.identity.countryCode ? { value: countryName(p.identity.countryCode, lang), source: "profile", ids: loc.ids, confidence: 0.75 } : NONE;
    }
    case "linkedin_url":
      return fromFact(link("linkedin"));
    case "github_url":
      return fromFact(link("github", "gitlab"));
    case "scholar_url":
      return fromFact(link("scholar"));
    case "orcid": {
      const o = view.links().find((l) => l.value.kind === "orcid");
      return o ? { value: o.value.url, source: "profile", ids: o.ids, confidence: 0.95 } : NONE;
    }
    case "portfolio_url":
      return fromFact(link("portfolio", "website", "behance", "dribbble", "github"), 0.85);
    case "resume":
      return isFile ? doc("resume_variant", "resume", "cv") : NONE;
    case "pitch_deck":
      return isFile ? doc("pitch_notes", "deck", "business_plan") : NONE;
    case "cover_letter":
      return isFile ? doc("cover_letter") : NONE;
    case "current_company":
      return current ? { value: current.value.organization, source: "profile", ids: current.ids, confidence: 0.9 } : NONE;
    case "current_title":
      return current ? { value: current.value.title, source: "profile", ids: current.ids, confidence: 0.9 } : NONE;
    case "years_experience": {
      const y = view.years();
      return y ? { value: String(y.value), source: "profile", ids: y.ids, confidence: 0.8 } : NONE;
    }
    case "school":
      return edu ? { value: edu.value.institution, source: "profile", ids: edu.ids, confidence: 0.9 } : NONE;
    case "degree":
      return edu && edu.value.degree ? { value: edu.value.degree, source: "profile", ids: edu.ids, confidence: 0.85 } : NONE;
    case "field_of_study":
      return edu && edu.value.field ? { value: edu.value.field, source: "profile", ids: edu.ids, confidence: 0.85 } : NONE;
    case "graduation_date":
      return edu && edu.value.endDate ? { value: edu.value.endDate, source: "profile", ids: edu.ids, confidence: 0.85 } : NONE;
    case "gpa":
      return edu && edu.value.gpa ? { value: `${edu.value.gpa.value}/${edu.value.gpa.scale}`, source: "profile", ids: edu.ids, confidence: 0.85 } : NONE;
    case "availability":
      return fromFact(view.availableFrom(), 0.85);
    case "work_authorization": {
      const ok = view.workAuthorization().find((w) => ["citizen", "permanent_resident", "work_visa"].includes(w.value.status));
      return ok ? { value: "Yes", source: "profile", ids: ok.ids, confidence: 0.8 } : NONE;
    }
    case "sponsorship": {
      const needs = view.workAuthorization().find((w) => w.value.status === "needs_sponsorship");
      if (needs) return { value: "Yes", source: "profile", ids: needs.ids, confidence: 0.8 };
      const citizen = view.workAuthorization().find((w) => w.value.status === "citizen" || w.value.status === "permanent_resident");
      return citizen ? { value: "No", source: "profile", ids: citizen.ids, confidence: 0.75 } : NONE;
    }
    case "startup_name":
      return venture ? { value: venture.company.value, source: "profile", ids: venture.company.ids, confidence: 0.9 } : current ? { value: current.value.organization, source: "profile", ids: current.ids, confidence: 0.6 } : NONE;
    case "one_liner":
      return fromFact(venture?.field("oneLiner") ?? null, 0.85);
    case "stage":
      return fromFact(venture?.field("stage") ?? venture?.field("round") ?? null, 0.75);
    case "raising":
      return fromFact(venture?.raising() ?? null, 0.85);
    case "team_size":
      return fromFact(venture?.field("teamSize") ?? null, 0.85);
    case "traction": {
      const t = venture?.traction() ?? [];
      return t.length ? { value: t.map((x) => x.value).join("; "), source: "profile", ids: t.flatMap((x) => x.ids), confidence: 0.8 } : NONE;
    }
    case "problem":
      return fromFact(venture?.field("problem") ?? null, 0.8);
    case "use_of_funds":
      return fromFact(venture?.field("useOfFunds") ?? null, 0.8);
    default:
      return NONE;
  }
}

export function localMapFormFields(raw: MapFormFieldsInput): FieldMapping[] {
  const input = MapFormFieldsInput.parse(raw);
  const view = new FactView(readProfile(input.profile), input.facts);
  return input.fields.map((field) => {
    if (field.type === "hidden" || field.type === "submit") return { name: field.name, value: null, source: "none", key: null, factIds: [], confidence: 1, needsUser: false };
    const k = fieldKey(field);
    if (k?.user) {
      // Consent and self-identification are the person's own tap; never pre-filled.
      return { name: field.name, value: null, source: "user", key: k.key, factIds: [], confidence: 1, needsUser: true };
    }
    let r = k ? resolveField(k.key, field, view, input.answers, input.documents, input.language) : NONE;
    if (!k && input.answers[field.name]) r = { value: input.answers[field.name], source: "answer", ids: [`answer:${field.name}`], confidence: 0.9 };
    let value = r.value;
    const options = field.options ?? [];
    if (value !== null && options.length && (field.type === "select" || field.type === "radio" || field.type === "multiselect")) {
      value = pickOption(options, value);
    }
    if (value !== null && field.type === "checkbox") value = /^(yes|true|1|checked|on|是)$/i.test(value) ? "true" : null;
    const filled = value !== null && value !== "";
    return {
      name: field.name,
      value: filled ? value : null,
      source: filled ? r.source : "none",
      key: k?.key ?? null,
      factIds: filled ? r.ids : [],
      confidence: filled ? r.confidence : 0,
      needsUser: !filled && Boolean(field.required),
    };
  });
}

/* ------------------------------------------------------------------ browser planner */

export interface AxNode {
  role: string;
  name: string;
  attrs: string[];
  value: string | null;
  depth: number;
}

/** Parses Playwright `ariaSnapshot()` output (`- role "name" [attr]: value`). */
export function parseAxTree(snapshot: string): AxNode[] {
  const out: AxNode[] = [];
  for (const line of snapshot.split("\n")) {
    const m = /^(\s*)-\s+([a-z]+)(?:\s+"((?:[^"\\]|\\.)*)")?((?:\s+\[[^\]]*\])*)(?::\s*(.*))?$/.exec(line);
    if (!m) continue;
    const attrs = [...(m[4] ?? "").matchAll(/\[([^\]]*)\]/g)].map((a) => a[1].trim().toLowerCase());
    out.push({ role: m[2], name: (m[3] ?? "").replace(/\\"/g, '"'), attrs, value: m[5]?.trim() ? m[5].trim().replace(/^"|"$/g, "") : null, depth: m[1].length });
  }
  return out;
}

const INPUT_ROLES = new Set(["textbox", "searchbox", "combobox", "spinbutton", "checkbox", "radio", "listbox", "slider", "switch"]);
const SUBMIT_RE = /^(submit|apply|apply now|send|send application|submit application|finish|complete|提交|申请|发送|确认提交)\b/i;
const CONFIRM_RE = /\b(thank you|thanks for (applying|your application|submitting)|application (received|submitted|complete)|we('ve| have) received|submission (received|successful)|successfully submitted|confirmation (number|code))\b|提交成功|已提交|感谢您的申请|我们已收到/i;
const CAPTCHA_RE = /captcha|recaptcha|hcaptcha|i'?m not a robot|verify (that )?you are (a )?human|cloudflare challenge|人机验证|验证码|滑动验证/i;
const LOGIN_RE = /\b(sign in|log in|login|create (an )?account|register to (continue|apply))\b|登录|注册后/i;
const PAYMENT_RE = /card number|credit card|debit card|cvc|cvv|payment details|pay now|checkout|银行卡|信用卡|支付|付款/i;

function norm(s: string): string {
  return s.toLowerCase().replace(/[*:：]/g, "").replace(/\s+/g, " ").trim();
}

function lookup(map: Record<string, string>, node: AxNode): string | null {
  const n = norm(node.name);
  if (!n) return null;
  for (const [k, v] of Object.entries(map)) if (norm(k) === n) return v;
  for (const [k, v] of Object.entries(map)) {
    const nk = norm(k).replace(/_/g, " ");
    if (nk.length > 2 && (n.includes(nk) || nk.includes(n))) return v;
  }
  // Fall back to semantic keys: "full_name" ↔ "Full name", "why_this" ↔ "Why do you want…".
  const key = fieldKey({ name: node.name, label: node.name, placeholder: null })?.key;
  if (key && map[key] !== undefined) return map[key];
  return null;
}

function target(node: AxNode): string {
  return `${node.role} "${node.name}"`;
}

function hostAllowed(current: string | undefined, allowed: string | undefined): boolean {
  if (!current || !allowed) return true;
  try {
    const h = new URL(current).hostname.toLowerCase();
    const a = allowed.toLowerCase().replace(/^\*\./, "");
    return h === a || h.endsWith(`.${a}`);
  } catch {
    return false;
  }
}

export function localPlanBrowserStep(raw: PlanBrowserStepInput): BrowserStep {
  const input = PlanBrowserStepInput.parse(raw);
  const nodes = parseAxTree(input.axTree);
  const page = `${input.pageSummary}\n${input.axTree}`;
  const stop = (reason: string, needsUser: boolean, done = false): BrowserStep => ({ action: "stop", target: null, value: null, done, needsUser, reason });

  if (!hostAllowed(input.currentUrl, input.allowedHost)) return stop(`The page left the application site (${input.currentUrl}); handing over to you.`, true);
  const submitted = input.history.some((h) => (h.action === "submit" || (h.action === "click" && SUBMIT_RE.test((h.target ?? "").replace(/^button\s+"/i, "")))) && h.ok !== false);
  if (submitted && CONFIRM_RE.test(input.pageSummary)) return stop("The application was submitted and the confirmation page is showing.", false, true);
  if (CAPTCHA_RE.test(page)) return stop("A CAPTCHA is on the page; only you can solve it.", true);
  if (nodes.some((n) => n.role === "textbox" && /password|密码/i.test(n.name))) return stop("The site asks you to sign in; that's yours to do.", true);
  if (nodes.some((n) => (n.role === "textbox" || n.role === "spinbutton") && PAYMENT_RE.test(n.name))) return stop("The form asks for payment details; you pay yourself.", true);

  const tried = new Set(input.history.map((h) => `${h.action}|${h.target ?? ""}`));
  const failed = new Set(input.history.filter((h) => h.ok === false).map((h) => h.target ?? ""));
  const inputs = nodes.filter((n) => INPUT_ROLES.has(n.role) && !n.attrs.includes("disabled"));

  if (!inputs.length && LOGIN_RE.test(input.pageSummary) && !nodes.some((n) => n.role === "button" && SUBMIT_RE.test(n.name))) {
    return stop("The site asks you to sign in or create an account; that's yours to do.", true);
  }

  // Fill fields in page order.
  for (const node of inputs) {
    const t = target(node);
    if (failed.has(t)) continue;
    const key = fieldKey({ name: node.name, label: node.name, placeholder: null });
    if (key?.user && node.role !== "checkbox") continue; // EEO / signature: leave for the person
    const value = lookup(input.values, node);
    if (node.role === "checkbox" || node.role === "switch") {
      if (key?.user) continue; // consent boxes are ticked by the person
      if (value === null) continue;
      const want = /^(yes|true|1|checked|on|是)$/i.test(value);
      const has = node.attrs.includes("checked") || node.attrs.includes("checked=true");
      if (want !== has && !tried.has(`${want ? "check" : "uncheck"}|${t}`)) return { action: want ? "check" : "uncheck", target: t, value: null, done: false, needsUser: false, reason: `Set "${node.name}" from the prepared answers.` };
      continue;
    }
    if (node.role === "radio") {
      if (value !== null && norm(value) === norm(node.name) && !node.attrs.includes("checked") && !tried.has(`check|${t}`)) return { action: "check", target: t, value: null, done: false, needsUser: false, reason: `Choose "${node.name}".` };
      continue;
    }
    if (value === null) continue;
    if (node.value !== null && norm(node.value) === norm(value)) continue;
    const action = node.role === "combobox" || node.role === "listbox" ? "select" : "fill";
    if (tried.has(`${action}|${t}`) && node.value !== null) continue;
    if (tried.has(`${action}|${t}`) && input.history.filter((h) => h.target === t).length >= 2) continue;
    return { action, target: t, value, done: false, needsUser: false, reason: `Fill "${node.name}" with the prepared value.` };
  }

  // File uploads (Playwright shows file inputs as buttons such as "Choose File" next to a label).
  for (const [label, docId] of Object.entries(input.files)) {
    const node = nodes.find((n) => (n.role === "button" || n.role === "textbox") && (norm(n.name).includes(norm(label)) || /upload|attach|choose file|browse|上传|选择文件/i.test(n.name)) && !tried.has(`upload|${target(n)}`));
    if (node) return { action: "upload", target: target(node), value: docId, done: false, needsUser: false, reason: `Attach the prepared document for "${label}".` };
  }

  // Required fields we couldn't fill (the page flags them after a submit attempt).
  if (submitted && /required|is missing|please (fill|enter|select|complete)|invalid|必填|请填写|请选择|格式不正确/i.test(input.pageSummary)) {
    return stop("The form still needs answers we don't have; handing the remaining fields to you.", true);
  }

  const submit = nodes.find((n) => n.role === "button" && SUBMIT_RE.test(n.name.trim()));
  if (!submit) {
    const next = nodes.find((n) => n.role === "button" && /^(next|continue|下一步|继续)\b/i.test(n.name.trim()) && !tried.has(`click|${target(n)}`));
    if (next) return { action: "click", target: target(next), value: null, done: false, needsUser: false, reason: "Go to the next page of the form." };
    return stop("No submit button found; the form may need you to continue.", true);
  }
  if (!input.allowSubmit) return { action: "stop", target: null, value: null, done: true, needsUser: false, reason: "Everything we can fill is filled; waiting for your confirmation before submitting." };
  if (tried.has(`submit|${target(submit)}`) && !CONFIRM_RE.test(input.pageSummary)) return stop("Submitted, but no confirmation appeared; please check the page.", true);
  return { action: "submit", target: target(submit), value: null, done: false, needsUser: false, reason: "You confirmed: submitting the application." };
}
