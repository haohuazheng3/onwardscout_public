import "server-only";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { contacts, messages, type Contact, type Message } from "@/lib/db/schema";
import type { ContactKind } from "@/lib/core/types";
import { captureError } from "@/lib/errors";
import { newId } from "@/lib/ids";
import { getIntelligence } from "@/lib/llm";
import { GmailNotConnectedError, GmailSendError, gmailStatus, sendGmail } from "@/lib/integrations/google/gmail";
import { messageIdFor } from "@/lib/integrations/google/mime";
import { loadPersonContext } from "./context";
import { loadPreparedFile, loadPreparedFiles } from "./files";
import { buildMailtoHandoff } from "./handoff";
import { isOutreachBlocked } from "./outreach-blocks";
import { checkFollowUpPolicy, checkOutreachPolicy, isPlainEmail, type PolicyResult } from "./outreach-policy";
import type { Channel, ChannelDeps, PersonContext, PreparedPackage, Requirements, SubmitContext, SubmitResult } from "./types";

/*
 * CH4 — personal email from the person's own Gmail (gmail.send only). One recipient per email,
 * composed for that person (P3a prepares `prepared.email`), rate-limited by
 * outreach-policy.ts, recorded in `messages` with our own Message-ID so a forwarded reply finds
 * its thread. Without Gmail the person gets the same email as a mailto handoff.
 */

const SENT = "sent" as const;

export function contactKindFor(opportunityType: string): ContactKind {
  switch (opportunityType) {
    case "investor":
      return "investor";
    case "recruiter":
    case "referral":
      return "recruiter";
    case "client_lead":
      return "client";
    case "phd_position":
    case "postdoc":
    case "collaborator":
    case "industry_partnership":
      return "professor";
    case "editorial_role":
    case "media":
    case "podcast":
    case "book_publisher":
      return "editor";
    case "brand_partnership":
      return "brand";
    default:
      return "organizer";
  }
}

async function analyze(opp: Parameters<Channel["analyze"]>[0]): Promise<Requirements> {
  const to = opp.apply.email?.trim() || null;
  return {
    channel: "CH4",
    fields: [],
    materials: [...new Set(["outreach_email", ...opp.requiredMaterials])],
    questions: [],
    requiresAccount: false,
    requiresPayment: false,
    captchaLikely: false,
    ...(to ? { submitUrl: `mailto:${to}` } : {}),
    notes: [
      "We write one personal email for this recipient and send it from your own Gmail after you approve it. Without Gmail, you send the same email from your mail app.",
      ...(to ? [] : ["We don't have this organisation's contact address yet; add one to write to them."]),
    ],
  };
}

/* ------------------------------------------------------------------ queries */

async function findContact(userId: string, email: string, contactId?: string): Promise<Contact | null> {
  const where = contactId ? and(eq(contacts.userId, userId), eq(contacts.id, contactId)) : and(eq(contacts.userId, userId), eq(contacts.email, email));
  const rows = await db.select().from(contacts).where(where).limit(1);
  return rows[0] ?? null;
}

async function ensureContact(userId: string, email: string, ctx: SubmitContext): Promise<Contact> {
  const existing = await findContact(userId, email);
  if (existing) return existing;
  await db
    .insert(contacts)
    .values({
      id: newId("cnt"),
      userId,
      kind: contactKindFor(ctx.opportunity.type),
      email,
      org: ctx.opportunity.orgName,
      url: ctx.opportunity.url,
      source: ctx.opportunity.url ?? ctx.opportunity.apply.url ?? "Onward Scout opportunity",
    })
    .onConflictDoNothing({ target: [contacts.userId, contacts.email] });
  const row = await findContact(userId, email);
  if (!row) throw new Error("contact row was not persisted");
  return row;
}

/** First emails of conversations started since `since` (follow-ups in a thread don't count). */
export async function newConversationsSince(userId: string, since: Date): Promise<number> {
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(messages)
    .where(
      sql`${messages.userId} = ${userId} and ${messages.direction} = 'out' and ${messages.status} = 'sent' and ${messages.sentAt} >= ${since}
        and not exists (select 1 from messages p where p.user_id = ${messages.userId} and p.direction = 'out' and p.status = 'sent'
          and p.gmail_thread_id is not null and p.gmail_thread_id = ${messages.gmailThreadId} and p.sent_at < ${messages.sentAt})`,
    );
  return rows[0]?.n ?? 0;
}

async function threadMessages(userId: string, applicationId: string): Promise<Message[]> {
  return db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.applicationId, applicationId)))
    .orderBy(asc(messages.createdAt));
}

async function loadAttachments(ctx: SubmitContext, deps?: ChannelDeps) {
  const { loaded, missing } = await loadPreparedFiles(ctx.userId, ctx.prepared.files, deps?.loadFile ?? loadPreparedFile);
  return { attachments: loaded.map((f) => ({ filename: f.filename, contentType: f.contentType, bytes: f.bytes })), missing };
}

function mailtoResult(email: NonNullable<PreparedPackage["email"]>, ctx: SubmitContext, note: string): SubmitResult {
  return { status: "needs_you", reason: "no_gmail", handoff: buildMailtoHandoff(email, ctx.prepared.files, [note]) };
}

const NO_GMAIL_NOTE = "Gmail isn't connected, so this email opens in your own mail app, ready to send. Connect Gmail under Integrations to have it sent for you next time.";

/** Records the outgoing message, sends it, and marks the result. */
async function sendRecorded(input: {
  ctx: SubmitContext;
  contact: Contact;
  to: string;
  subject: string;
  body: string;
  fromName: string | null;
  attachments: { filename: string; contentType: string; bytes: Uint8Array }[];
  threadId?: string;
  inReplyTo?: string;
  references?: string[];
}): Promise<{ id: string; gmailId: string; threadId: string; from?: string }> {
  const { ctx } = input;
  const rowId = newId("msg");
  await db.insert(messages).values({
    id: rowId,
    userId: ctx.userId,
    applicationId: ctx.application.id,
    contactId: input.contact.id,
    direction: "out",
    channel: "gmail",
    subject: input.subject,
    bodyText: input.body,
    toAddr: input.to,
    status: "queued",
  });
  try {
    const sent = await sendGmail(ctx.userId, {
      to: input.to,
      subject: input.subject,
      text: input.body,
      attachments: input.attachments,
      ...(input.threadId ? { threadId: input.threadId } : {}),
      fromName: input.fromName,
      messageId: messageIdFor(rowId),
      ...(input.inReplyTo ? { inReplyTo: input.inReplyTo } : {}),
      ...(input.references?.length ? { references: input.references } : {}),
    });
    const status = await gmailStatus(ctx.userId);
    await db
      .update(messages)
      .set({ status: SENT, gmailMessageId: sent.id, gmailThreadId: sent.threadId, fromAddr: status.email ?? null, sentAt: sql`now()` })
      .where(and(eq(messages.id, rowId), eq(messages.userId, ctx.userId)));
    await db.update(contacts).set({ lastContactedAt: sql`now()` }).where(and(eq(contacts.id, input.contact.id), eq(contacts.userId, ctx.userId)));
    return { id: rowId, gmailId: sent.id, threadId: sent.threadId, from: status.email };
  } catch (err) {
    await db.update(messages).set({ status: "failed" }).where(and(eq(messages.id, rowId), eq(messages.userId, ctx.userId)));
    throw err;
  }
}

function sendFailure(err: unknown, email: NonNullable<PreparedPackage["email"]>, ctx: SubmitContext): SubmitResult {
  if (err instanceof GmailNotConnectedError) return mailtoResult(email, ctx, err.message);
  if (err instanceof GmailSendError) return { status: "failed", error: err.message, retryable: err.retryable };
  return { status: "failed", error: "The email could not be sent. Nothing went out; we'll try again.", retryable: true };
}

/**
 * Without Gmail the person sends the email from their own mail app. We keep the draft as a
 * `mailto` message (status draft: not sent by us, not counted against limits) so a reply they
 * forward later still finds this application by sender and subject.
 */
async function recordMailtoDraft(ctx: SubmitContext, to: string, email: NonNullable<PreparedPackage["email"]>, history: Message[]): Promise<void> {
  if (history.some((m) => m.direction === "out" && m.channel === "mailto" && m.toAddr === to)) return;
  try {
    const contact = await ensureContact(ctx.userId, to, ctx);
    await db.insert(messages).values({
      id: newId("msg"),
      userId: ctx.userId,
      applicationId: ctx.application.id,
      contactId: contact.id,
      direction: "out",
      channel: "mailto",
      subject: email.subject,
      bodyText: email.body,
      toAddr: to,
      status: "draft",
    });
  } catch (err) {
    await captureError(err, { route: "channels.ch4.mailto-draft", severity: "warn", context: { applicationId: ctx.application.id } });
  }
}

/* ------------------------------------------------------------------ submit */

/**
 * The outreach rules that no retry can change (opt-out, global block list, 30-day rule, minor,
 * unusable address), checked when the person confirms — before a credit is reserved — so a
 * refused email is explained up front instead of failing after the tap. The daily/weekly caps
 * are left to `submit` (they only delay the email).
 */
export async function outreachPreflight(userId: string, applicationId: string, rawTo: string): Promise<PolicyResult> {
  const to = rawTo.trim().toLowerCase();
  const history = await threadMessages(userId, applicationId);
  if (history.some((m) => m.direction === "out" && m.status === "sent" && m.toAddr === to)) return { ok: true }; // a replay: already sent
  const [person, contact, blocked] = await Promise.all([loadPersonContext(userId), findContact(userId, to), isOutreachBlocked(to)]);
  const policy = checkOutreachPolicy({
    to,
    contact: contact ? { doNotContact: contact.doNotContact, lastContactedAt: contact.lastContactedAt } : null,
    newContactsLastDay: 0,
    newContactsLastWeek: 0,
    isMinor: person.isMinor,
    blocked,
    now: new Date(),
  });
  return policy;
}

async function submit(ctx: SubmitContext, deps?: ChannelDeps): Promise<SubmitResult> {
  const email = ctx.prepared.email;
  if (!email || !email.to.trim() || !email.body.trim()) return { status: "failed", error: "No email has been prepared for this application yet.", retryable: false };
  const to = email.to.trim().toLowerCase();
  if (!isPlainEmail(to)) return { status: "failed", error: `“${email.to.slice(0, 80)}” is not an email address we can write to.`, retryable: false, code: "invalid_email" };

  // Replays (a job retried after the email went out) never send twice.
  const history = await threadMessages(ctx.userId, ctx.application.id);
  const already = history.find((m) => m.direction === "out" && m.status === "sent" && m.toAddr === to);
  if (already) {
    return { status: "submitted", evidence: { messageId: already.gmailMessageId ?? already.id, confirmationText: `Sent to ${to}${already.sentAt ? ` on ${already.sentAt.toISOString().slice(0, 10)}` : ""}.` } };
  }

  const person = await (deps?.loadPerson ?? loadPersonContext)(ctx.userId);
  const contact = await findContact(ctx.userId, to, email.contactId);
  const now = new Date();
  const [lastDay, lastWeek] = await Promise.all([
    newConversationsSince(ctx.userId, new Date(now.getTime() - 24 * 3600_000)),
    newConversationsSince(ctx.userId, new Date(now.getTime() - 7 * 24 * 3600_000)),
  ]);
  const policy = checkOutreachPolicy({
    to,
    contact: contact ? { doNotContact: contact.doNotContact, lastContactedAt: contact.lastContactedAt } : null,
    newContactsLastDay: lastDay,
    newContactsLastWeek: lastWeek,
    isMinor: person.isMinor,
    blocked: await isOutreachBlocked(to),
    now,
  });
  if (!policy.ok) return { status: "failed", error: policy.message, retryable: policy.retryable, code: policy.code };

  const gmail = await gmailStatus(ctx.userId);
  if (!gmail.connected) {
    if (!ctx.dryRun) await recordMailtoDraft(ctx, to, email, history);
    return mailtoResult({ ...email, to }, ctx, NO_GMAIL_NOTE);
  }

  const { attachments, missing } = await loadAttachments(ctx, deps);
  if (missing.length) return { status: "failed", error: `These attachments couldn't be loaded: ${missing.join(", ")}.`, retryable: true };

  if (ctx.dryRun) {
    return { status: "submitted", evidence: { confirmationText: `Dry run — ready to send from ${gmail.email ?? "your Gmail"} to ${to}${attachments.length ? ` with ${attachments.length} attachment${attachments.length === 1 ? "" : "s"}` : ""}. Nothing was sent.` } };
  }

  try {
    const row = await ensureContact(ctx.userId, to, ctx);
    const sent = await sendRecorded({ ctx, contact: row, to, subject: email.subject, body: email.body, fromName: person.name, attachments });
    return { status: "submitted", evidence: { messageId: sent.gmailId, confirmationText: `Sent from ${sent.from ?? gmail.email ?? "your Gmail"} to ${to}.` } };
  } catch (err) {
    if (!(err instanceof GmailNotConnectedError) && !(err instanceof GmailSendError && !err.retryable)) {
      await captureError(err, { route: "channels.ch4.submit", context: { applicationId: ctx.application.id } });
    }
    return sendFailure(err, { ...email, to }, ctx);
  }
}

/* ------------------------------------------------------------------ follow-up */

function followUpTemplate(input: { name: string | null; contactName: string | null; subject: string; sentAt: Date | null; opportunity: string; language: "en" | "zh" }): string {
  const date = input.sentAt ? input.sentAt.toISOString().slice(0, 10) : null;
  if (input.language === "zh") {
    return [
      input.contactName ? `${input.contactName}，您好：` : "您好：",
      "",
      `${date ? `我在 ${date} ` : "此前"}给您发过一封关于「${input.opportunity}」的邮件，想轻轻跟进一下，看看您是否有机会看到。`,
      "如果需要更多信息，或者现在不是合适的时机，也请直接告诉我。感谢您的时间！",
      "",
      input.name ?? "",
    ]
      .join("\n")
      .trim();
  }
  return [
    input.contactName ? `Hi ${input.contactName.split(/\s+/)[0]},` : "Hi,",
    "",
    `I wanted to follow up on my note${date ? ` from ${date}` : ""} about ${input.opportunity}, in case it got buried.`,
    "If it would help, I'm happy to send anything else you need. And if now isn't the right time, just let me know. Thank you for your time.",
    "",
    input.name ? `Best,\n${input.name}` : "Best,",
  ].join("\n");
}

async function composeFollowUp(ctx: SubmitContext, person: PersonContext, contact: Contact | null, first: Message): Promise<string | null> {
  try {
    const doc = await getIntelligence({ userId: ctx.userId }).compose({
      kind: "email_follow_up",
      profile: person.profile,
      facts: person.facts,
      opportunity: { id: ctx.opportunity.id, type: ctx.opportunity.type, name: ctx.opportunity.name, orgName: ctx.opportunity.orgName, url: ctx.opportunity.url },
      contact: contact ? { name: contact.name, org: contact.org, role: contact.role, kind: contact.kind } : null,
      previous: { subject: first.subject, sentAt: first.sentAt },
      language: person.language,
    });
    const text = doc.blocks
      .filter((b) => b.role !== "subject" && b.role !== "gap")
      .map((b) => b.text.trim())
      .filter(Boolean)
      .join("\n\n");
    return text.length > 40 ? text : null;
  } catch (err) {
    await captureError(err, { route: "channels.ch4.followup.compose", severity: "warn", context: { applicationId: ctx.application.id } });
    return null;
  }
}

async function followUp(ctx: SubmitContext & { attempt: number }, deps?: ChannelDeps): Promise<SubmitResult> {
  const history = await threadMessages(ctx.userId, ctx.application.id);
  const outgoing = history.filter((m) => m.direction === "out" && m.status === "sent");
  const first = outgoing[0];
  const last = outgoing[outgoing.length - 1];
  const replied = history.some((m) => m.direction === "in");
  const contact = first?.contactId ? await findContact(ctx.userId, first.toAddr ?? "", first.contactId) : first?.toAddr ? await findContact(ctx.userId, first.toAddr) : null;
  const blocked = await isOutreachBlocked(first?.toAddr);
  const check = checkFollowUpPolicy({ attempt: ctx.attempt, replied, doNotContact: (contact?.doNotContact ?? false) || blocked, lastSentAt: last?.sentAt ?? null, now: new Date() });
  if (!check.ok) return { status: "failed", error: check.message, retryable: check.retryable };
  if (!first?.toAddr || !last) return { status: "failed", error: "There is no sent email to follow up on yet.", retryable: false };

  const person = await (deps?.loadPerson ?? loadPersonContext)(ctx.userId);
  const subjectBase = (first.subject ?? ctx.opportunity.name).replace(/^(re|fwd?|回复|答复)\s*[:：]\s*/i, "");
  const subject = `Re: ${subjectBase}`;
  // The applications engine passes the follow-up the person saw (and may have approved) as
  // `prepared.email`; we only write one ourselves when it didn't.
  let body: string | null = ctx.prepared.email?.body?.trim() || null;
  body ??= await composeFollowUp(ctx, person, contact, first);
  body ??= followUpTemplate({ name: person.name, contactName: contact?.name ?? null, subject: subjectBase, sentAt: first.sentAt, opportunity: ctx.opportunity.name, language: person.language });

  const gmail = await gmailStatus(ctx.userId);
  if (!gmail.connected) return mailtoResult({ to: first.toAddr, subject, body }, ctx, NO_GMAIL_NOTE);
  if (ctx.dryRun) return { status: "submitted", evidence: { confirmationText: `Dry run — follow-up ${ctx.attempt} ready for ${first.toAddr} in the same thread. Nothing was sent.` } };

  try {
    const row = contact ?? (await ensureContact(ctx.userId, first.toAddr, ctx));
    const sent = await sendRecorded({
      ctx,
      contact: row,
      to: first.toAddr,
      subject,
      body,
      fromName: person.name,
      attachments: [],
      threadId: last.gmailThreadId ?? first.gmailThreadId ?? undefined,
      inReplyTo: messageIdFor(last.id),
      references: outgoing.map((m) => messageIdFor(m.id)),
    });
    return { status: "submitted", evidence: { messageId: sent.gmailId, confirmationText: `Follow-up ${ctx.attempt} sent to ${first.toAddr} in the same thread.` } };
  } catch (err) {
    if (!(err instanceof GmailNotConnectedError) && !(err instanceof GmailSendError && !err.retryable)) {
      await captureError(err, { route: "channels.ch4.followup", context: { applicationId: ctx.application.id } });
    }
    return sendFailure(err, { to: first.toAddr, subject, body }, ctx);
  }
}

/** The latest outgoing email of an application (for UIs that show the thread). */
export async function latestOutgoing(userId: string, applicationId: string): Promise<Message | null> {
  const rows = await db
    .select()
    .from(messages)
    .where(and(eq(messages.userId, userId), eq(messages.applicationId, applicationId), eq(messages.direction, "out")))
    .orderBy(desc(messages.createdAt))
    .limit(1);
  return rows[0] ?? null;
}

export const ch4Email: Channel = { id: "CH4", analyze, submit, followUp };
