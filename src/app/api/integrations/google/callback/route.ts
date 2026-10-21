import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { captureError, withErrorCapture } from "@/lib/errors";
import {
  emailFromIdToken,
  exchangeCode,
  GMAIL_SEND_SCOPE,
  GoogleAuthError,
  grantedScopes,
  googleRedirectUri,
  OAUTH_COOKIE,
  OAUTH_COOKIE_PATH,
  openState,
  revokeToken,
} from "@/lib/integrations/google/oauth";
import { saveGoogleIntegration } from "@/lib/integrations/google/store";
import { withLocale } from "@/lib/site";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/integrations/google/callback — Google sends the person back here. The state must
 * match the sealed cookie of the same signed-in user (CSRF), the PKCE verifier proves we
 * started the flow, and `gmail.send` must actually have been granted. The refresh token is
 * stored encrypted; the person lands back on /app/integrations with a one-word outcome.
 */

const Query = z.object({
  code: z.string().min(1).max(2048).optional(),
  state: z.string().min(1).max(512).optional(),
  error: z.string().max(200).optional(),
});

export const GET = withErrorCapture("/api/integrations/google/callback", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const jar = await cookies();
  const sealed = jar.get(OAUTH_COOKIE)?.value;
  const saved = openState(sealed, session.userId);
  const locale = saved?.locale ?? "en";

  const back = (flash: string) => {
    const res = NextResponse.redirect(new URL(`${withLocale(locale, saved?.returnTo ?? "/app/integrations")}?gmail=${flash}`, req.url), 303);
    res.cookies.set(OAUTH_COOKIE, "", { httpOnly: true, path: OAUTH_COOKIE_PATH, maxAge: 0 });
    res.headers.set("Cache-Control", "no-store");
    return res;
  };

  const q = Query.safeParse(Object.fromEntries(new URL(req.url).searchParams));
  if (!q.success) return back("error");
  if (q.data.error) return back(q.data.error === "access_denied" ? "denied" : "error");
  if (!saved || !q.data.state || q.data.state !== saved.state || !q.data.code) return back("expired");

  try {
    const tokens = await exchangeCode({ code: q.data.code, verifier: saved.verifier, redirectUri: googleRedirectUri(req.url) });
    const scopes = grantedScopes(tokens.scope);
    if (!scopes.includes(GMAIL_SEND_SCOPE)) {
      await revokeToken(tokens.refresh_token ?? tokens.access_token).catch(() => false);
      return back("scope");
    }
    const who = emailFromIdToken(tokens.id_token);
    if (!tokens.refresh_token || !who) {
      await captureError(new Error("Google token response without refresh token or email"), { route: "/api/integrations/google/callback", severity: "warn" });
      return back("error");
    }
    await saveGoogleIntegration({ userId: session.userId, refreshToken: tokens.refresh_token, email: who.email, scopes });
    return back("connected");
  } catch (err) {
    if (!(err instanceof GoogleAuthError && err.code === "invalid_grant")) await captureError(err, { route: "/api/integrations/google/callback" });
    return back(err instanceof GoogleAuthError && err.code === "invalid_grant" ? "expired" : "error");
  }
});
