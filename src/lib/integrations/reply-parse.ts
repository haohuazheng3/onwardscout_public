/*
 * Reading a reply that arrives at a drop-box address (`in+<token>@onwardscout.com`). Two ways
 * it gets there:
 *  - the person forwards it by hand → the original sender, subject and date sit in a
 *    "Forwarded message" header block inside the body (Gmail, Outlook, Apple Mail, QQ/163…);
 *  - a mail filter auto-forwards it → the envelope keeps the original From, Subject and the
 *    In-Reply-To / References headers, which carry our own Message-ID (`<msg_…@onwardscout.com>`).
 * Then the reply is matched to the outgoing email it answers. Pure; unit-tested.
 */
import { isOptOut } from "@/lib/channels/outreach-policy";
import { messageRowIdFrom } from "./google/mime";

export interface Address {
  email: string;
  name: string | null;
}

export interface ParsedReply {
  /** Who wrote the reply (the counterpart), when known. */
  from: Address | null;
  subject: string | null;
  date: Date | null;
  /** The reply's own text (forward header block removed). */
  body: string;
  /** True when a "Forwarded message" block was found. */
  forwarded: boolean;
  /** Our `messages` row ids referenced by In-Reply-To / References / quoted headers. */
  referencedIds: string[];
}

const EMAIL_RE = /[A-Z0-9._%+'-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

/** `"Jane Doe" <jane@vc.com>` / `Jane <jane@vc.com>` / `jane@vc.com` / `发件人："Jane"<jane@vc.com>`. */
export function parseAddress(raw: string | null | undefined): Address | null {
  if (!raw) return null;
  const m = EMAIL_RE.exec(raw);
  if (!m) return null;
  const email = m[0].toLowerCase();
  const name =
    raw
      .slice(0, m.index)
      .replace(/[<>"'“”«»\[\]]/g, " ")
      .replace(/\s+/g, " ")
      .replace(/[:：,]+$/, "")
      .trim() || null;
  return { email, name: name && !EMAIL_RE.test(name) ? name : null };
}

const PREFIX_RE = /^\s*(re|fw|fwd|aw|wg|sv|vs|tr|rv|r|回复|答复|回覆|转发|轉寄|转寄)\s*(\[\d+\])?\s*[:：]\s*/i;

/** Subject without Re:/Fwd:/回复: prefixes (repeated), whitespace-collapsed, lowercase. */
export function normalizeSubject(s: string | null | undefined): string {
  let t = (s ?? "").replace(/\s+/g, " ").trim();
  for (let i = 0; i < 6 && PREFIX_RE.test(t); i++) t = t.replace(PREFIX_RE, "");
  return t.toLowerCase();
}

const FORWARD_MARKERS = [
  /^-{2,}\s*forwarded message\s*-{2,}\s*$/i,
  /^begin forwarded message:?\s*$/i,
  /^-{2,}\s*original message\s*-{2,}\s*$/i,
  /^_{8,}\s*$/,
  /^-{2,}\s*(转发邮件信息|原始邮件|转发的邮件|轉寄郵件)\s*-{2,}\s*$/,
  /^-{3,}\s*message transféré\s*-{3,}$/i,
  /^-{3,}\s*weitergeleitete nachricht\s*-{3,}$/i,
];

const HEADER_KEYS: [RegExp, "from" | "subject" | "date" | "to" | "cc"][] = [
  [/^(from|de|von|发件人|寄件者|寄件人)\s*[:：]\s*(.*)$/i, "from"],
  [/^(subject|objet|betreff|asunto|主题|主旨|標題)\s*[:：]\s*(.*)$/i, "subject"],
  [/^(date|sent|envoyé|gesendet|enviado|发送时间|日期|时间|傳送時間)\s*[:：]\s*(.*)$/i, "date"],
  [/^(to|à|an|para|收件人)\s*[:：]\s*(.*)$/i, "to"],
  [/^(cc|抄送)\s*[:：]\s*(.*)$/i, "cc"],
];

function headerOf(line: string): { key: "from" | "subject" | "date" | "to" | "cc"; value: string } | null {
  const l = line.replace(/^>\s?/, "").replace(/^\*+|\*+$/g, "").trim();
  for (const [re, key] of HEADER_KEYS) {
    const m = re.exec(l);
    if (m) return { key, value: m[2].replace(/\*+/g, "").trim() };
  }
  return null;
}

function parseDate(v: string | undefined): Date | null {
  if (!v) return null;
  const cleaned = v.replace(/\s+at\s+/i, " ").replace(/\(.*?\)/g, "").trim();
  const d = new Date(cleaned);
  if (!Number.isNaN(d.getTime())) return d;
  const zh = /(\d{4})年(\d{1,2})月(\d{1,2})日/.exec(v);
  if (zh) return new Date(Date.UTC(Number(zh[1]), Number(zh[2]) - 1, Number(zh[3])));
  return null;
}

/** Finds a forwarded header block: a marker line, or a From: line followed closely by Subject:/Date:. */
function findForwardBlock(lines: string[]): { start: number; headers: Record<string, string>; end: number } | null {
  for (let i = 0; i < lines.length; i++) {
    const marker = FORWARD_MARKERS.some((re) => re.test(lines[i].trim()));
    const first = headerOf(lines[i]);
    if (!marker && first?.key !== "from") continue;
    const headers: Record<string, string> = {};
    let j = marker ? i + 1 : i;
    // Skip blank lines right after a marker.
    while (marker && j < lines.length && !lines[j].trim()) j++;
    let seen = 0;
    for (; j < lines.length && j < i + 14; j++) {
      const h = headerOf(lines[j]);
      if (!h) {
        if (!lines[j].trim() && seen > 0) break;
        // Wrapped header value (long To: lists).
        if (seen > 0 && /^\s+\S/.test(lines[j])) continue;
        if (seen > 0) break;
        continue;
      }
      if (!headers[h.key]) headers[h.key] = h.value;
      seen++;
    }
    if (headers.from && (headers.subject || headers.date || marker)) return { start: i, headers, end: j };
  }
  return null;
}

export interface InboundMail {
  from: string;
  subject?: string | null;
  text?: string | null;
  headers?: Record<string, string> | null;
}

function headerValue(headers: Record<string, string> | null | undefined, name: string): string | null {
  if (!headers) return null;
  const k = Object.keys(headers).find((h) => h.toLowerCase() === name);
  return k ? headers[k] : null;
}

/** Parses a drop-box mail into the reply it carries. */
export function parseInboundReply(mail: InboundMail): ParsedReply {
  const text = (mail.text ?? "").replace(/\r\n?/g, "\n");
  const lines = text.split("\n");
  const block = findForwardBlock(lines);
  const referencedIds = [
    ...messageRowIdFrom(headerValue(mail.headers, "in-reply-to")),
    ...messageRowIdFrom(headerValue(mail.headers, "references")),
    ...messageRowIdFrom(text),
  ];
  const ids = [...new Set(referencedIds)];
  if (block) {
    const body = lines
      .slice(block.end)
      .join("\n")
      .replace(/^\s+/, "")
      .trim();
    const before = lines.slice(0, block.start).join("\n").trim();
    return {
      from: parseAddress(block.headers.from),
      subject: block.headers.subject?.trim() || null,
      date: parseDate(block.headers.date),
      body: body || before,
      forwarded: true,
      referencedIds: ids,
    };
  }
  return {
    from: parseAddress(mail.from),
    subject: mail.subject?.trim() || null,
    date: parseDate(headerValue(mail.headers, "date") ?? undefined),
    body: text.trim(),
    forwarded: false,
    referencedIds: ids,
  };
}

export interface ThreadCandidate {
  /** Our `messages` row id of the outgoing email. */
  id: string;
  applicationId: string | null;
  contactId: string | null;
  toAddr: string | null;
  subject: string | null;
  gmailThreadId: string | null;
  createdAt: Date;
}

export type MatchedBy = "header" | "sender_subject" | "sender" | "subject";

/** The outgoing email this reply answers, best evidence first. */
export function matchReplyThread(reply: Pick<ParsedReply, "from" | "subject" | "referencedIds">, candidates: ThreadCandidate[]): { candidate: ThreadCandidate; by: MatchedBy } | null {
  const newestFirst = [...candidates].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  for (const id of reply.referencedIds) {
    const hit = newestFirst.find((c) => c.id === id);
    if (hit) return { candidate: hit, by: "header" };
  }
  const subject = normalizeSubject(reply.subject);
  const sameSubject = (c: ThreadCandidate) => {
    const s = normalizeSubject(c.subject);
    return Boolean(subject && s && (s === subject || (s.length >= 12 && subject.includes(s)) || (subject.length >= 12 && s.includes(subject))));
  };
  const sender = reply.from?.email ?? null;
  const bySender = sender ? newestFirst.filter((c) => (c.toAddr ?? "").toLowerCase() === sender) : [];
  const both = bySender.find(sameSubject);
  if (both) return { candidate: both, by: "sender_subject" };
  if (bySender[0]) return { candidate: bySender[0], by: "sender" };
  const bySubject = newestFirst.filter(sameSubject);
  // A subject alone is weak evidence: only when it points at exactly one application.
  const apps = new Set(bySubject.map((c) => c.applicationId ?? c.id));
  if (bySubject[0] && apps.size === 1) return { candidate: bySubject[0], by: "subject" };
  return null;
}

/** Plain text of an HTML-only mail (some clients forward without a text part). */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Gmail's "forwarding confirmation" mail: when the person adds their drop-box address as a
 * forwarding address, Google sends a code there. We pass the code to the person (never act on
 * the mail's link ourselves). Returns null for every other mail.
 */
export function gmailForwardingConfirmation(mail: Pick<InboundMail, "from" | "subject" | "text">): { code: string; requester: string | null } | null {
  const sender = parseAddress(mail.from)?.email ?? "";
  if (sender !== "forwarding-noreply@google.com") return null;
  const subject = mail.subject ?? "";
  const code = /\(#(\d{6,12})\)/.exec(subject)?.[1] ?? /confirmation code:?\s*(\d{6,12})/i.exec(mail.text ?? "")?.[1] ?? null;
  if (!code) return null;
  const requester = /receive mail from\s+(\S+@\S+)/i.exec(subject)?.[1]?.replace(/[.,;]$/, "").toLowerCase() ?? null;
  return { code, requester };
}

export interface Verdict {
  classification: "interested" | "meeting" | "rejected" | "needs_info" | "auto_reply" | "other";
  summary: string;
  nextStep: string;
  confidence: number;
}

/**
 * Corrects the classifier where a wrong label would mislead the person: an opt-out or a plain
 * "not interested" is a no, whatever words like "interested" appear in it.
 */
export function refineVerdict(text: string, v: Verdict, locale: "en" | "zh" = "en"): Verdict {
  const optOut = isOptOut(text);
  const notInterested = /\bnot (interested|a fit|the right fit)\b|不感兴趣|没有兴趣|暂不考虑/i.test(text);
  if (!optOut && !(notInterested && v.classification === "interested")) return v;
  if (optOut) {
    return {
      classification: "rejected",
      summary: locale === "zh" ? "对方请求不要再联系。" : "They asked not to be contacted again.",
      nextStep: locale === "zh" ? "我们不会再给对方发邮件。" : "We won't email them again.",
      confidence: Math.max(v.confidence, 0.9),
    };
  }
  return {
    classification: "rejected",
    summary: locale === "zh" ? "对方表示不感兴趣。" : "They said it's not a fit for them.",
    nextStep: locale === "zh" ? "这条已结束；我们会继续推荐新的机会。" : "This one is closed; we'll keep finding new opportunities.",
    confidence: Math.max(v.confidence, 0.8),
  };
}
