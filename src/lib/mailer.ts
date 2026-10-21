import "server-only";
import { env } from "./env";

/*
 * Product email to USERS (weekly digest, "needs you", follow-up reminders). Sent through the
 * Resend REST API when RESEND_API_KEY and MAIL_FROM are configured (sending domain verified by
 * scripts/ops/resend-dns.mjs); otherwise nothing is sent and the caller keeps the in-app
 * notification as the only channel. Owner alerts go through src/lib/notify.ts instead, and user
 * OUTREACH (CH4) is sent from the user's own Gmail, never from here.
 */

export interface UserEmail {
  to: string;
  subject: string;
  text: string;
  html?: string;
  replyTo?: string;
  /** Resend de-duplicates retries with the same key for 24 h (e.g. `digest:<userId>:<week>`). */
  idempotencyKey?: string;
  /** One-click unsubscribe URL (RFC 8058) for recurring mail such as the weekly digest. */
  unsubscribeUrl?: string;
  /** Searchable tags in the Resend dashboard, e.g. { kind: "digest" }. ASCII letters, digits, _ and - only. */
  tags?: Record<string, string>;
}

export type SendResult = { sent: true; id: string | null } | { sent: false; reason: string };

const EMAIL = /^[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}$/i;

export function isEmailAddress(v: string): boolean {
  return EMAIL.test(v.trim());
}

/** Whether product email can be sent at all on this deployment. */
export function mailerConfigured(): boolean {
  return Boolean(env("RESEND_API_KEY") && env("MAIL_FROM"));
}

function tagValue(v: string): string {
  return v.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 256);
}

/** The JSON body sent to Resend (exported for tests). */
export function resendPayload(from: string, mail: UserEmail): Record<string, unknown> {
  const headers: Record<string, string> = {};
  if (mail.unsubscribeUrl) {
    headers["List-Unsubscribe"] = `<${mail.unsubscribeUrl}>`;
    headers["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click";
  }
  return {
    from,
    to: [mail.to.trim()],
    subject: mail.subject.replace(/[\r\n]+/g, " ").trim().slice(0, 300),
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
    ...(mail.replyTo ? { reply_to: mail.replyTo } : {}),
    ...(Object.keys(headers).length ? { headers } : {}),
    ...(mail.tags ? { tags: Object.entries(mail.tags).map(([name, value]) => ({ name: tagValue(name), value: tagValue(value) })) } : {}),
  };
}

/**
 * Sends one email to one user. Never throws: the result says whether it went out, and why not.
 * The caller records `notifications.emailed_at` only when `sent` is true.
 */
export async function sendUserEmail(mail: UserEmail): Promise<SendResult> {
  const key = env("RESEND_API_KEY");
  const from = env("MAIL_FROM");
  if (!key || !from) return { sent: false, reason: "Email delivery is not configured (RESEND_API_KEY / MAIL_FROM)." };
  if (!isEmailAddress(mail.to)) return { sent: false, reason: "The recipient address is not a valid email address." };
  if (!mail.subject.trim() || !mail.text.trim()) return { sent: false, reason: "Subject and text are required." };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
        ...(mail.idempotencyKey ? { "Idempotency-Key": mail.idempotencyKey.slice(0, 256) } : {}),
      },
      body: JSON.stringify(resendPayload(from, mail)),
      signal: AbortSignal.timeout(10_000),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string; name?: string };
    if (!res.ok) {
      const reason = `Resend answered ${res.status}${body.name ? ` ${body.name}` : ""}: ${(body.message ?? "").slice(0, 200)}`;
      console.error("[mailer]", reason);
      return { sent: false, reason };
    }
    return { sent: true, id: typeof body.id === "string" ? body.id : null };
  } catch (err) {
    const reason = `Resend request failed: ${err instanceof Error ? err.message : String(err)}`;
    console.error("[mailer]", reason);
    return { sent: false, reason };
  }
}
