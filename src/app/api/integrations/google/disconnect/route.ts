import { captureError, withErrorCapture } from "@/lib/errors";
import { revokeToken } from "@/lib/integrations/google/oauth";
import { clearGoogleIntegration, googleRefreshToken } from "@/lib/integrations/google/store";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "no-store" } as const;

/** POST /api/integrations/google/disconnect — revokes the grant at Google and erases our copy. */
export const POST = withErrorCapture("/api/integrations/google/disconnect", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`google:disconnect:${session.userId}`, 10, 600);
  if (!rl.ok) return tooMany(rl);

  let stored: { token: string } | null = null;
  try {
    stored = await googleRefreshToken(session.userId);
  } catch (err) {
    // An unreadable token (key rotated) is erased below all the same.
    await captureError(err, { route: "/api/integrations/google/disconnect", severity: "warn" });
  }
  if (stored) {
    try {
      await revokeToken(stored.token);
    } catch (err) {
      // We still forget the token; Google lists the grant under the person's third-party access until they remove it.
      await captureError(err, { route: "/api/integrations/google/disconnect", severity: "warn", context: { stage: "revoke" } });
    }
  }
  await clearGoogleIntegration(session.userId);
  return Response.json({ ok: true, connected: false }, { headers: NO_STORE });
});
