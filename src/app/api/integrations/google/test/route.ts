import { jsonError, withErrorCapture } from "@/lib/errors";
import { GmailNotConnectedError, GmailSendError, gmailStatus, sendGmail } from "@/lib/integrations/google/gmail";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { siteUrl, withLocale } from "@/lib/site";
import { getUserLocale, isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

function testEmail(locale: "en" | "zh", address: string): { subject: string; text: string } {
  const page = `${siteUrl()}${withLocale(locale, "/app/integrations")}`;
  if (locale === "zh") {
    return {
      subject: "Onward Scout 测试邮件",
      text: [
        "这是一封来自 Onward Scout 的测试邮件。",
        "",
        `看到这封邮件，说明 Onward Scout 可以从 ${address} 代你发信。我们只发送你确认过的邮件，每封只写给一个人，并且无法读取你的收件箱。`,
        "",
        `随时可以在这里断开 Gmail：${page}`,
        "",
        "— Onward Scout",
      ].join("\n"),
    };
  }
  return {
    subject: "Onward Scout test email",
    text: [
      "This is a test email from Onward Scout.",
      "",
      `If you can read it, Onward Scout can send from ${address}. We only send emails you approve, each written for one person, and we can't read your inbox.`,
      "",
      `You can disconnect Gmail at any time: ${page}`,
      "",
      "— Onward Scout",
    ].join("\n"),
  };
}

/** POST /api/integrations/google/test — sends a short test email to the connected address itself. */
export const POST = withErrorCapture("/api/integrations/google/test", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`google:test:${session.userId}`, 3, 3600);
  if (!rl.ok) return tooMany(rl);
  const status = await gmailStatus(session.userId);
  if (!status.connected || !status.email) return jsonError("Connect Gmail first.", 409);
  const locale = await getUserLocale(session.userId);
  const mail = testEmail(locale, status.email);
  try {
    const sent = await sendGmail(session.userId, { to: status.email, subject: mail.subject, text: mail.text });
    return Response.json({ ok: true, to: status.email, id: sent.id }, { headers: NO_STORE });
  } catch (err) {
    if (err instanceof GmailNotConnectedError) return jsonError(err.message, 409);
    if (err instanceof GmailSendError) return jsonError(err.message, err.retryable ? 503 : 502);
    throw err;
  }
});
