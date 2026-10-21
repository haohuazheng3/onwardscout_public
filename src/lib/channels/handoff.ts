/*
 * The 30-second handoff (CH6, and the fallback of every other channel): everything the person
 * needs to finish an application themselves, in the order the real form asks for it — the exact
 * link, numbered steps, every field with its prepared value (one-tap copy in the UI), the files,
 * and honest notes. Pure: no I/O, so P3a can rebuild it for any state and tests can pin it.
 */
import type { Opportunity } from "@/lib/db/schema";
import { cleanLabel, forbiddenPlatform, hostOf } from "./detect";
import type { FieldRequirement, HandoffPackage, PreparedPackage, Requirements } from "./types";

type Lang = "en" | "zh";

const T = {
  en: {
    open: (what: string, host: string | null) => `Open the official application page${what ? ` for ${what}` : ""}${host ? ` on ${host}` : ""}.`,
    account: (host: string | null) => `Sign in or create your account${host ? ` on ${host}` : ""}. Only you can do this; nothing is shared with Onward Scout.`,
    fill: (n: number) => `Fill the form in this order: ${n === 1 ? "the field below has" : `all ${n} fields below have`} a Copy button.`,
    files: (names: string) => `Attach ${names}. Download ${names.includes(",") ? "them" : "it"} below first.`,
    captcha: "When the page asks you to prove you're human (CAPTCHA), complete it yourself.",
    payment: "Pay the application fee on the official page yourself. Onward Scout never sees or handles payments.",
    userOnly: (labels: string) => `Answer these yourself (they are personal or voluntary): ${labels}.`,
    missing: (labels: string) => `We don't have an answer for: ${labels}. Fill ${labels.includes(",") ? "them" : "it"} in on the page.`,
    submit: "Submit the form. Then come back here and tap “I submitted it”; paste the confirmation link or reference number if the page shows one.",
    mailOpen: (to: string) => `Open the prepared email (it opens in your mail app) addressed to ${to}.`,
    mailCheck: "Read it once, attach the files listed below if any, and press Send from your own mailbox.",
    mailDone: "Come back here and tap “I sent it” so we can track the reply and follow up on time.",
    docsUse: "Download the documents below and use them wherever you apply.",
    docsDone: "When you've used them, tap “I used them” so we can keep track and follow up.",
    noteDeadline: (d: string) => `Deadline: ${d}. Check the official page for the time zone.`,
    noteRolling: "Rolling admissions: earlier applications are usually read first.",
    noteForbidden: (p: string) => `${p} does not allow automated submissions, so you submit this one yourself — every answer is ready.`,
    noteInstructions: (s: string) => `The organiser says: “${s}”`,
    noUrl: "We couldn't find a direct application link; start from the organiser's official page.",
  },
  zh: {
    open: (what: string, host: string | null) => `打开${what ? `「${what}」的` : ""}官方申请页面${host ? `（${host}）` : ""}。`,
    account: (host: string | null) => `在${host ?? "该网站"}登录或注册你的账号。这一步只能由你本人完成，Onward Scout 不会获取任何账号信息。`,
    fill: (n: number) => `按下面的顺序填写表单，共 ${n} 项，每项都有「复制」按钮。`,
    files: (names: string) => `上传附件：${names}。请先在下方下载。`,
    captcha: "页面要求人机验证（验证码）时，请你本人完成。",
    payment: "申请费请在官方页面由你本人支付，Onward Scout 不接触任何支付信息。",
    userOnly: (labels: string) => `以下问题涉及个人信息或为自愿填写，请你本人作答：${labels}。`,
    missing: (labels: string) => `以下内容我们还没有答案：${labels}，请在页面上填写。`,
    submit: "提交表单，然后回到这里点「我已提交」；如果页面显示了确认链接或编号，请一并粘贴。",
    mailOpen: (to: string) => `打开准备好的邮件（会在你的邮件应用中打开），收件人是 ${to}。`,
    mailCheck: "通读一遍，如有附件请按下方列表添加，然后从你自己的邮箱发送。",
    mailDone: "发送后回到这里点「我已发送」，我们会跟踪回复并按时跟进。",
    docsUse: "下载下方文书，在你申请的地方使用。",
    docsDone: "用完后点「我已使用」，我们会记录并按时跟进。",
    noteDeadline: (d: string) => `截止日期：${d}，时区以官方页面为准。`,
    noteRolling: "滚动录取：通常越早申请越先被审阅。",
    noteForbidden: (p: string) => `${p} 不允许自动提交，所以这一份需要你本人提交，所有答案都已准备好。`,
    noteInstructions: (s: string) => `主办方说明：“${s}”`,
    noUrl: "没有找到直接的申请链接，请从主办方官方页面开始。",
  },
} as const;

const PLATFORM_NAMES: Record<string, string> = {
  linkedin: "LinkedIn",
  indeed: "Indeed",
  glassdoor: "Glassdoor",
  boss: "BOSS 直聘",
  zhaopin: "智联招聘",
  liepin: "猎聘",
  "51job": "前程无忧",
  lagou: "拉勾",
  maimai: "脉脉",
  workday: "Workday",
  successfactors: "SuccessFactors",
  taleo: "Taleo",
  icims: "iCIMS",
  common_app: "Common App",
  ucas: "UCAS",
  openreview: "OpenReview",
  easychair: "EasyChair",
  softconf: "Softconf",
  editorial_manager: "Editorial Manager",
  scholarone: "ScholarOne",
  government: "This government portal",
  handshake: "Handshake",
  wellfound: "Wellfound",
  marketplace: "This marketplace",
};

/** The value to show for a field: a choice's label when the prepared answer is its value. */
export function displayValue(field: Pick<FieldRequirement, "choices" | "type">, raw: string | undefined): string {
  const v = (raw ?? "").trim();
  if (!v) return "";
  if (field.type === "checkbox") return /^(yes|true|1|on|checked|是)$/i.test(v) ? "✓" : "";
  const choices = field.choices ?? [];
  if (!choices.length) return v;
  const parts = field.type === "multiselect" ? splitMulti(v) : [v];
  return parts.map((p) => choices.find((c) => c.value === p)?.label ?? p).join(", ");
}

/** Multi-select answers are stored as JSON arrays or newline/semicolon separated text. */
export function splitMulti(v: string): string[] {
  const t = v.trim();
  if (t.startsWith("[")) {
    try {
      const arr = JSON.parse(t) as unknown;
      if (Array.isArray(arr)) return arr.map((x) => String(x).trim()).filter(Boolean);
    } catch {
      /* not JSON: fall through to separators */
    }
  }
  return t
    .split(/\n|;|；/)
    .map((x) => x.trim())
    .filter(Boolean);
}

function isoDate(d: Date | string | null | undefined): string | null {
  if (!d) return null;
  const date = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(date.getTime()) ? null : date.toISOString().slice(0, 10);
}

function mailtoUrl(to: string, subject: string, body: string): string {
  return `mailto:${encodeURIComponent(to).replace(/%40/g, "@")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function joinList(items: string[], lang: Lang): string {
  return items.join(lang === "zh" ? "、" : ", ");
}

/**
 * Builds the handoff panel for an opportunity. `req.fields` must be in the target form's order
 * (every analyzer returns them that way); `answers` are keyed by field name.
 */
export function buildHandoff(
  opp: Pick<Opportunity, "name" | "orgName" | "url" | "apply" | "deadline" | "rolling">,
  req: Pick<Requirements, "fields" | "requiresAccount" | "requiresPayment" | "captchaLikely" | "submitUrl" | "notes" | "channel">,
  answers: Record<string, string>,
  files: PreparedPackage["files"],
  locale: Lang = "en",
): HandoffPackage {
  const t = T[locale];
  const url = req.submitUrl ?? opp.apply?.url ?? opp.url ?? "";
  const host = hostOf(url);
  const what = [opp.orgName, opp.name].filter(Boolean).join(locale === "zh" ? " · " : " — ");

  const fields: HandoffPackage["fields"] = [];
  const userOnly: string[] = [];
  const missing: string[] = [];
  for (const f of req.fields) {
    const label = cleanLabel(f.label) || f.name;
    if (f.type === "file") continue; // files are listed separately
    const value = displayValue(f, answers[f.name]);
    if (f.userOnly && !value) {
      userOnly.push(label);
      continue;
    }
    if (!value) {
      if (f.required) missing.push(label);
      continue;
    }
    fields.push({ label, value, ...(f.type === "textarea" || value.length > 120 ? { long: true } : {}) });
  }

  const fileList = files.map((f) => ({
    name: f.filename,
    ...(f.documentId ? { documentId: f.documentId } : {}),
    ...(f.generatedDocumentId ? { generatedDocumentId: f.generatedDocumentId } : {}),
  }));

  const steps: string[] = [];
  const isMail = url.startsWith("mailto:");
  if (isMail) {
    const to = decodeURIComponent(url.slice(7).split("?")[0] ?? "");
    steps.push(t.mailOpen(to), t.mailCheck, t.mailDone);
  } else if (req.channel === "CH5") {
    steps.push(t.docsUse, t.docsDone);
  } else {
    steps.push(t.open(what, host));
    if (req.requiresAccount) steps.push(t.account(host));
    if (fields.length) steps.push(t.fill(fields.length));
    if (fileList.length) steps.push(t.files(joinList(fileList.map((f) => f.name), locale)));
    if (req.captchaLikely) steps.push(t.captcha);
    if (req.requiresPayment) steps.push(t.payment);
    if (userOnly.length) steps.push(t.userOnly(joinList(userOnly, locale)));
    if (missing.length) steps.push(t.missing(joinList(missing, locale)));
    steps.push(t.submit);
  }

  const notes: string[] = [];
  const forbidden = forbiddenPlatform(url, opp.apply?.platform ?? null);
  if (forbidden) notes.push(t.noteForbidden(PLATFORM_NAMES[forbidden] ?? forbidden));
  const deadline = isoDate(opp.deadline);
  if (deadline) notes.push(t.noteDeadline(deadline));
  else if (opp.rolling) notes.push(t.noteRolling);
  if (!url) notes.push(t.noUrl);
  const instructions = opp.apply?.instructions?.trim();
  if (instructions) notes.push(t.noteInstructions(instructions.length > 400 ? `${instructions.slice(0, 399)}…` : instructions));
  for (const n of req.notes) if (n && !notes.includes(n)) notes.push(n);

  return { url, steps: steps.map((text, i) => ({ n: i + 1, text })), fields, files: fileList, notes };
}

/** A handoff for an email the person sends from their own mail app (CH4 without Gmail). */
export function buildMailtoHandoff(
  email: { to: string; subject: string; body: string },
  files: PreparedPackage["files"],
  notes: string[] = [],
  locale: Lang = "en",
): HandoffPackage {
  const t = T[locale];
  const url = mailtoUrl(email.to, email.subject, email.body);
  const steps = [t.mailOpen(email.to), t.mailCheck, t.mailDone];
  return {
    url,
    steps: steps.map((text, i) => ({ n: i + 1, text })),
    fields: [
      { label: locale === "zh" ? "收件人" : "To", value: email.to },
      { label: locale === "zh" ? "主题" : "Subject", value: email.subject },
      { label: locale === "zh" ? "正文" : "Message", value: email.body, long: true },
    ],
    files: files.map((f) => ({ name: f.filename, ...(f.documentId ? { documentId: f.documentId } : {}), ...(f.generatedDocumentId ? { generatedDocumentId: f.generatedDocumentId } : {}) })),
    notes,
  };
}
