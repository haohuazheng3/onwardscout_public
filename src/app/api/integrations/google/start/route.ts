import { NextResponse } from "next/server";
import { withErrorCapture } from "@/lib/errors";
import { buildAuthUrl, createPkce, googleOAuthConfigured, googleRedirectUri, newState, OAUTH_COOKIE, OAUTH_COOKIE_PATH, sealState } from "@/lib/integrations/google/oauth";
import { rateLimit } from "@/lib/ratelimit";
import { withLocale } from "@/lib/site";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/integrations/google/start?locale=en|zh — the "Connect Gmail" button navigates here.
 * Seals a PKCE verifier + CSRF state into an httpOnly cookie (10 minutes, scoped to this API
 * path) and redirects to Google's consent screen for `openid email gmail.send`.
 */
export const GET = withErrorCapture("/api/integrations/google/start", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const url = new URL(req.url);
  const locale = url.searchParams.get("locale") === "zh" ? "zh" : "en";
  const back = (flash: string) => {
    const res = NextResponse.redirect(new URL(`${withLocale(locale, "/app/integrations")}?gmail=${flash}`, req.url), 303);
    res.headers.set("Cache-Control", "no-store");
    return res;
  };
  if (!googleOAuthConfigured()) return back("unavailable");
  const rl = await rateLimit(`google:start:${session.userId}`, 10, 600);
  if (!rl.ok) return back("error");

  const pkce = createPkce();
  const state = newState();
  const sealed = sealState({ state, verifier: pkce.verifier, userId: session.userId, returnTo: "/app/integrations", locale, createdAt: Date.now() });
  const res = NextResponse.redirect(buildAuthUrl({ redirectUri: googleRedirectUri(req.url), state, codeChallenge: pkce.challenge }), 303);
  res.cookies.set(OAUTH_COOKIE, sealed, {
    httpOnly: true,
    secure: url.protocol === "https:",
    sameSite: "lax",
    path: OAUTH_COOKIE_PATH,
    maxAge: 600,
  });
  res.headers.set("Cache-Control", "no-store");
  return res;
});
