import { eq } from "drizzle-orm";
import { z } from "zod";
import { setNotificationPref } from "@/lib/authorizations";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { withErrorCapture } from "@/lib/errors";
import { absoluteAppUrl, translatorFor, verifyUnsubscribeToken } from "@/lib/notifications";
import { clientIp, ipHash, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * One-click unsubscribe for product email (RFC 8058). Emails carry
 * `List-Unsubscribe: <…/api/notifications/unsubscribe?u=&s=&t=>` with an HMAC token, so no
 * session is needed: the token names exactly one person and one kind of email.
 *  - POST (the mail client's one-click, or the button below) switches that email off;
 *  - GET shows a confirmation button only, so link scanners that open URLs change nothing.
 * The proxy must let this exact path through without a session (see the P6 integration notes).
 */

const Params = z.object({
  u: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
  s: z.enum(["digest", "updates"]),
  t: z.string().min(16).max(64),
});

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] ?? c);
}

function page(lang: string, title: string, body: string, form?: { action: string; button: string }): Response {
  const html = `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title></head>
<body style="margin:0;background:#F5F4F0;color:#121614;font:16px/1.55 system-ui,-apple-system,'Segoe UI',sans-serif">
<main style="max-width:520px;margin:12vh auto;padding:28px 24px;background:#fff;border-radius:28px;box-shadow:0 20px 50px -30px rgba(18,22,20,.35)">
<p style="margin:0 0 6px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#626A65">Onward Scout</p>
<h1 style="margin:0 0 12px;font-size:24px;line-height:1.25">${escapeHtml(title)}</h1>
<p style="margin:0 0 20px;color:#3E4541">${escapeHtml(body)}</p>
${form ? `<form method="post" action="${escapeHtml(form.action)}"><button type="submit" style="min-height:48px;padding:0 22px;border:0;border-radius:999px;background:#E4572E;color:#121614;font-weight:600;font-size:16px;cursor:pointer">${escapeHtml(form.button)}</button></form>` : ""}
</main></body></html>`;
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } });
}

async function resolve(req: Request) {
  const url = new URL(req.url);
  const parsed = Params.safeParse({ u: url.searchParams.get("u"), s: url.searchParams.get("s"), t: url.searchParams.get("t") });
  if (!parsed.success || !verifyUnsubscribeToken(parsed.data.u, parsed.data.s, parsed.data.t)) return null;
  const row = await db.select({ locale: users.locale }).from(users).where(eq(users.id, parsed.data.u)).limit(1);
  const locale = row[0]?.locale === "zh" ? ("zh" as const) : ("en" as const);
  return { ...parsed.data, locale, exists: Boolean(row[0]), action: `${url.pathname}${url.search}` };
}

export const GET = withErrorCapture("/api/notifications/unsubscribe", async (req: Request) => {
  const r = await resolve(req);
  if (!r) {
    const t = await translatorFor("en", "settings.unsubscribe");
    return page("en", t("invalidTitle"), t("invalidBody"));
  }
  const t = await translatorFor(r.locale, "settings.unsubscribe");
  return page(r.locale === "zh" ? "zh-CN" : "en", t(r.s === "digest" ? "confirmDigestTitle" : "confirmUpdatesTitle"), t("confirmBody"), { action: r.action, button: t("button") });
});

export const POST = withErrorCapture("/api/notifications/unsubscribe", async (req: Request) => {
  const rl = await rateLimit(`unsubscribe:ip:${ipHash(clientIp(req.headers))}`, 30, 600);
  const r = await resolve(req);
  if (!r || !rl.ok) {
    const t = await translatorFor("en", "settings.unsubscribe");
    return page("en", t("invalidTitle"), t("invalidBody"));
  }
  if (r.exists) await setNotificationPref(r.u, r.s === "digest" ? "emailDigest" : "emailUpdates", false);
  const t = await translatorFor(r.locale, "settings.unsubscribe");
  return page(r.locale === "zh" ? "zh-CN" : "en", t("doneTitle"), t("doneBody", { url: absoluteAppUrl("/app/settings#notifications", r.locale) }));
});
