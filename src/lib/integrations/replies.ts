import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { applications, contacts, inboxMessages, messages, users } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { getIntelligence, stripQuoted, type ReplyClassification } from "@/lib/llm";
import { notify, recordEvent } from "@/lib/notifications";
import { isOptOut } from "@/lib/channels/outreach-policy";
import { gmailForwardingConfirmation, htmlToText, matchReplyThread, parseInboundReply, refineVerdict, type InboundMail, type MatchedBy } from "./reply-parse";

/*
 * Reply drop-box (build contract "Mail"): mail to `in+<token>@onwardscout.com` was stored by
 * /api/inbox/ingest with its owner's user id. Here it becomes part of that person's outreach
 * thread: matched to the outgoing email it answers (our Message-ID in In-Reply-To/References,
 * then sender + subject, sender, subject), stored as an incoming `messages` row (channel
 * 'forward'), classified (Intelligence.classifyReply — local rules unless Claude is on), an
 * opt-out marks the contact do-not-contact, the application hears about it (P3a's
 * `recordReply` when the applications engine exports one, else a `reply_received` event), and
 * the person gets a notification. Idempotent per inbox row: re-running it never duplicates.
 */

export interface AttachResult {
  status: "attached" | "unmatched" | "duplicate" | "forwarding_code";
  messageId?: string;
  applicationId?: string | null;
  matchedBy?: MatchedBy | null;
  classification?: ReplyClassification["classification"];
}

type ReplyHook = (input: {
  userId: string;
  applicationId: string;
  messageId: string;
  classification: ReplyClassification["classification"];
  summary: string;
  nextStep: string;
}) => Promise<unknown>;

/** P3a's applications engine may export `recordReply` (status changes go through its state machine). */
async function applicationsReplyHook(): Promise<ReplyHook | null> {
  try {
    const mod = (await import("@/lib/applications")) as unknown as Record<string, unknown>;
    return typeof mod.recordReply === "function" ? (mod.recordReply as ReplyHook) : null;
  } catch (err) {
    await captureError(err, { route: "replies.applications-hook", severity: "warn" });
    return null;
  }
}

const TITLES = {
  en: {
    interested: (who: string) => `${who} replied with interest`,
    meeting: (who: string) => `${who} wants to set up a time`,
    rejected: (who: string) => `${who} replied: not this time`,
    needs_info: (who: string) => `${who} asked for more information`,
    auto_reply: (who: string) => `Automatic reply from ${who}`,
    other: (who: string) => `${who} replied`,
    unmatched: "We received a forwarded email",
    unmatchedBody: "We couldn't tell which application it belongs to. Open your applications to file it.",
    forwardingTitle: (code: string) => `Gmail forwarding code: ${code}`,
    forwardingBody: "Enter this code in Gmail → Settings → Forwarding and POP/IMAP to finish setting up automatic forwarding to your drop-box.",
  },
  zh: {
    interested: (who: string) => `${who}回复了，表示感兴趣`,
    meeting: (who: string) => `${who}想约个时间`,
    rejected: (who: string) => `${who}回复：这次不合适`,
    needs_info: (who: string) => `${who}需要更多信息`,
    auto_reply: (who: string) => `来自${who}的自动回复`,
    other: (who: string) => `${who}回复了`,
    unmatched: "收到一封转发的邮件",
    unmatchedBody: "我们没能判断它属于哪一份申请，请到申请列表中归档。",
    forwardingTitle: (code: string) => `Gmail 转发确认码：${code}`,
    forwardingBody: "在 Gmail「设置 → 转发和 POP/IMAP」中输入这个确认码，即可完成自动转发到你的回复收件箱。",
  },
} as const;

export interface AttachInput {
  inboxId: string;
  userId: string;
  mail: InboundMail;
}

export async function attachForwardedReply(input: AttachInput): Promise<AttachResult> {
  const { userId } = input;
  const userRows = await db.select({ email: users.email, locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  const user = userRows[0];
  const locale = user?.locale === "zh" ? "zh" : "en";

  // Setting up auto-forwarding: Google mails a confirmation code to the drop-box. Hand it over.
  const forwarding = gmailForwardingConfirmation(input.mail);
  if (forwarding) {
    await notify({ userId, kind: "system", title: TITLES[locale].forwardingTitle(forwarding.code), body: TITLES[locale].forwardingBody, href: "/app/integrations" });
    return { status: "forwarding_code" };
  }

  const reply = parseInboundReply(input.mail);
  // A manual forward without a recognisable header block comes "from" the person themselves.
  const counterpart = reply.from && reply.from.email !== user?.email?.toLowerCase() ? reply.from : null;

  const candidates = await db
    .select({
      id: messages.id,
      applicationId: messages.applicationId,
      contactId: messages.contactId,
      toAddr: messages.toAddr,
      subject: messages.subject,
      gmailThreadId: messages.gmailThreadId,
      createdAt: messages.createdAt,
    })
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt))
    .limit(300);
  const match = matchReplyThread({ from: counterpart, subject: reply.subject, referencedIds: reply.referencedIds }, candidates);
  let contactId = match?.candidate.contactId ?? null;
  if (!contactId && counterpart) {
    const c = await db
      .select({ id: contacts.id })
      .from(contacts)
      .where(and(eq(contacts.userId, userId), eq(contacts.email, counterpart.email)))
      .limit(1);
    contactId = c[0]?.id ?? null;
  }
  const applicationId = match?.candidate.applicationId ?? null;

  const body = reply.body.slice(0, 100_000);
  const id = newId("msg");
  const inserted = await db
    .insert(messages)
    .values({
      id,
      userId,
      applicationId,
      contactId,
      direction: "in",
      channel: "forward",
      subject: reply.subject?.slice(0, 1000) ?? null,
      bodyText: body,
      fromAddr: counterpart?.email ?? reply.from?.email ?? null,
      toAddr: user?.email ?? null,
      // Unique per drop-box mail: replaying the same inbox row is a no-op.
      gmailMessageId: `fwd:${input.inboxId}`,
      gmailThreadId: match?.candidate.gmailThreadId ?? null,
      status: "received",
      receivedAt: reply.date ?? new Date(),
    })
    .onConflictDoNothing()
    .returning({ id: messages.id });
  if (!inserted[0]) return { status: "duplicate" };

  const text = stripQuoted(body) || body;
  let verdict: ReplyClassification;
  try {
    verdict = await getIntelligence({ userId }).classifyReply({ text: text.slice(0, 20_000), subject: reply.subject ?? undefined, language: locale });
  } catch (err) {
    await captureError(err, { route: "replies.classify", context: { inboxId: input.inboxId } });
    verdict = { classification: "other", summary: "", nextStep: "", confidence: 0 };
  }
  verdict = refineVerdict(text, verdict, locale);
  await db.update(messages).set({ classification: verdict.classification }).where(and(eq(messages.id, id), eq(messages.userId, userId)));

  if (contactId && isOptOut(text)) {
    await db.update(contacts).set({ doNotContact: true }).where(and(eq(contacts.id, contactId), eq(contacts.userId, userId)));
  }

  const who = counterpart?.name ?? counterpart?.email ?? (locale === "zh" ? "对方" : "They");
  let opportunityId: string | null = null;
  if (applicationId) {
    const app = await db
      .select({ opportunityId: applications.opportunityId })
      .from(applications)
      .where(and(eq(applications.id, applicationId), eq(applications.userId, userId)))
      .limit(1);
    opportunityId = app[0]?.opportunityId ?? null;
    const hook = await applicationsReplyHook();
    let handled = false;
    if (hook) {
      try {
        await hook({ userId, applicationId, messageId: id, classification: verdict.classification, summary: verdict.summary, nextStep: verdict.nextStep });
        handled = true;
      } catch (err) {
        // A withdrawn/closed or deleted application is expected business, not a server fault.
        const expected = err instanceof Error && err.name === "ApplicationError";
        await captureError(err, { route: "replies.applications-hook", severity: expected ? "warn" : "error", context: { applicationId } });
      }
    }
    if (!handled) {
      await recordEvent({
        userId,
        kind: "reply_received",
        applicationId,
        ...(opportunityId ? { opportunityId } : {}),
        data: { messageId: id, classification: verdict.classification, summary: verdict.summary, nextStep: verdict.nextStep, from: counterpart?.email ?? null, matchedBy: match?.by ?? null },
      });
    }
  }

  const t = TITLES[locale];
  await notify({
    userId,
    kind: "reply",
    title: applicationId ? t[verdict.classification](who) : t.unmatched,
    body: applicationId ? [verdict.summary, verdict.nextStep].filter(Boolean).join(" ") || undefined : t.unmatchedBody,
    href: applicationId ? `/app/applications/${applicationId}` : "/app/applications",
    email: verdict.classification === "meeting" || verdict.classification === "interested" || verdict.classification === "needs_info",
  });

  return { status: applicationId ? "attached" : "unmatched", messageId: id, applicationId, matchedBy: match?.by ?? null, classification: verdict.classification };
}

/** Re-runs the drop-box handling for a stored inbox row (admin "retry"). */
export async function reattachInboxMessage(inboxId: string): Promise<AttachResult | null> {
  const rows = await db.select().from(inboxMessages).where(eq(inboxMessages.id, inboxId)).limit(1);
  const row = rows[0];
  if (!row || row.kind !== "reply" || !row.userId) return null;
  return attachForwardedReply({
    inboxId: row.id,
    userId: row.userId,
    mail: { from: row.fromAddr, subject: row.subject, text: row.textBody ?? (row.htmlBody ? htmlToText(row.htmlBody) : null), headers: (row.headers ?? null) as Record<string, string> | null },
  });
}
