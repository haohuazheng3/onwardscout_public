import "server-only";
import { env } from "./env";
import { SITE } from "./site";

/**
 * Sends an email to the OWNER through the Cloudflare mail worker (`POST /notify`), which uses
 * Email Routing's send_email binding to the verified owner address. For mail to users, see
 * src/lib/mailer.ts. Never throws: notification failures are logged loudly but must not break
 * the request that triggered them.
 */
export async function notifyOwner(input: { subject: string; text: string; replyTo?: string }): Promise<boolean> {
  const base = env("MAIL_WORKER_URL");
  const token = env("MAIL_WORKER_TOKEN");
  if (!base || !token) {
    console.error("[notify] MAIL_WORKER_URL / MAIL_WORKER_TOKEN missing; notification dropped:", input.subject);
    return false;
  }
  try {
    const res = await fetch(`${base.replace(/\/+$/, "")}/notify`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        subject: `[${SITE.name}] ${input.subject}`.replace(/[\r\n]+/g, " ").slice(0, 200),
        text: input.text.slice(0, 20000),
        replyTo: input.replyTo,
      }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) {
      console.error("[notify] worker answered", res.status, (await res.text().catch(() => "")).slice(0, 300));
      return false;
    }
    return true;
  } catch (err) {
    console.error("[notify] request failed", err);
    return false;
  }
}
