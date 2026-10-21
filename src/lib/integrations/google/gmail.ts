import "server-only";
import { captureError } from "@/lib/errors";
import { buildMime, toBase64Url, type MimeAttachment } from "./mime";
import { GMAIL_SEND_SCOPE, GoogleAuthError, googleOAuthConfigured, refreshAccessToken } from "./oauth";
import { getGoogleIntegration, googleRefreshToken, markGoogleError } from "./store";

/*
 * Sending as the person through their own Gmail (`gmail.send` scope only — we cannot read
 * their mailbox). Contract (docs/contracts-features.md §4): `gmailStatus`, `sendGmail`.
 * Access tokens live only in memory (≈ 1 hour) per function instance.
 */

const SEND_URL = "https://gmail.googleapis.com/gmail/v1/users/me/messages/send";
/** Gmail's simple (non-upload) send endpoint accepts ~5 MB of raw message; base64 adds a third. */
export const MAX_ATTACHMENT_BYTES = 3.5 * 1024 * 1024;

export class GmailNotConnectedError extends Error {
  readonly code: "not_configured" | "not_connected" | "revoked";
  constructor(code: GmailNotConnectedError["code"], message: string) {
    super(message);
    this.name = "GmailNotConnectedError";
    this.code = code;
  }
}

export class GmailSendError extends Error {
  readonly retryable: boolean;
  readonly status: number;
  constructor(message: string, status: number, retryable: boolean) {
    super(message);
    this.name = "GmailSendError";
    this.status = status;
    this.retryable = retryable;
  }
}

export async function gmailStatus(userId: string): Promise<{ connected: boolean; email?: string }> {
  if (!googleOAuthConfigured()) return { connected: false };
  const row = await getGoogleIntegration(userId);
  if (!row || row.status !== "active" || !row.hasToken || !row.scopes.includes(GMAIL_SEND_SCOPE)) return { connected: false };
  return { connected: true, ...(row.accountEmail ? { email: row.accountEmail } : {}) };
}

const tokens = new Map<string, { token: string; exp: number; email: string | null }>();

async function accessToken(userId: string, force = false): Promise<{ token: string; email: string | null }> {
  if (!googleOAuthConfigured()) throw new GmailNotConnectedError("not_configured", "Gmail connection isn't available yet.");
  const hit = tokens.get(userId);
  if (!force && hit && hit.exp - Date.now() > 60_000) return hit;
  const stored = await googleRefreshToken(userId);
  if (!stored) throw new GmailNotConnectedError("not_connected", "Connect Gmail to send from your own address.");
  try {
    const t = await refreshAccessToken(stored.token);
    const entry = { token: t.access_token, exp: Date.now() + Math.max(60, t.expires_in) * 1000, email: stored.email };
    if (tokens.size > 2000) tokens.clear();
    tokens.set(userId, entry);
    return entry;
  } catch (err) {
    if (err instanceof GoogleAuthError && (err.code === "invalid_grant" || err.code === "unauthorized_client")) {
      tokens.delete(userId);
      await markGoogleError(userId);
      throw new GmailNotConnectedError("revoked", "Gmail access was removed in your Google account. Connect Gmail again to keep sending.");
    }
    throw err;
  }
}

export interface GmailMessage {
  to: string;
  subject: string;
  text: string;
  attachments?: { filename: string; contentType: string; bytes: Uint8Array }[];
  threadId?: string;
  /* ---- extensions (optional) ---- */
  /** Display name for the From header (the person's own name). */
  fromName?: string | null;
  /** Our Message-ID, so a forwarded reply can be matched back (`messageIdFor(rowId)`). */
  messageId?: string;
  inReplyTo?: string;
  references?: string[];
}

/** Sends one email from the person's Gmail. Throws GmailNotConnectedError / GmailSendError. */
export async function sendGmail(userId: string, msg: GmailMessage): Promise<{ id: string; threadId: string }> {
  const attachments: MimeAttachment[] = msg.attachments ?? [];
  const total = attachments.reduce((n, a) => n + a.bytes.byteLength, 0);
  if (total > MAX_ATTACHMENT_BYTES) {
    throw new GmailSendError("The attachments are larger than 3.5 MB together. Send a link to the files instead.", 413, false);
  }
  let auth = await accessToken(userId);
  const raw = toBase64Url(
    buildMime({
      from: auth.email ? { email: auth.email, name: msg.fromName ?? null } : null,
      to: msg.to,
      subject: msg.subject,
      text: msg.text,
      attachments,
      messageId: msg.messageId,
      inReplyTo: msg.inReplyTo,
      references: msg.references,
    }),
  );
  const body = JSON.stringify({ raw, ...(msg.threadId ? { threadId: msg.threadId } : {}) });

  for (let attempt = 0; attempt < 2; attempt++) {
    let res: Response;
    try {
      res = await fetch(SEND_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${auth.token}`, "Content-Type": "application/json" },
        body,
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch (err) {
      throw new GmailSendError(`Gmail could not be reached (${err instanceof Error ? err.message : "network error"}).`, 0, true);
    }
    if (res.ok) {
      const json = (await res.json().catch(() => null)) as { id?: string; threadId?: string } | null;
      if (!json?.id || !json.threadId) throw new GmailSendError("Gmail accepted the email but returned no message id.", res.status, false);
      return { id: json.id, threadId: json.threadId };
    }
    const detail = (await res.json().catch(() => null)) as { error?: { message?: string; status?: string } } | null;
    const message = detail?.error?.message ?? `Gmail answered ${res.status}.`;
    if (res.status === 401 && attempt === 0) {
      tokens.delete(userId);
      auth = await accessToken(userId, true);
      continue;
    }
    if (res.status === 401 || (res.status === 403 && /insufficient|scope|permission/i.test(message))) {
      tokens.delete(userId);
      await markGoogleError(userId);
      throw new GmailNotConnectedError("revoked", "Gmail no longer lets Onward Scout send for you. Connect Gmail again.");
    }
    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable) await captureError(new Error(`Gmail send failed: ${res.status} ${message}`), { route: "gmail.send", severity: "warn", context: { userId, status: res.status } });
    throw new GmailSendError(retryable ? "Gmail is busy right now; we'll try again shortly." : `Gmail refused the email: ${message}`, res.status, retryable);
  }
  throw new GmailSendError("Gmail could not send the email.", 0, true);
}
