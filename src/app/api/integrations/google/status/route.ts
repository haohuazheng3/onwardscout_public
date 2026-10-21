import { withErrorCapture } from "@/lib/errors";
import { googleOAuthConfigured } from "@/lib/integrations/google/oauth";
import { getGoogleIntegration } from "@/lib/integrations/google/store";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/integrations/google/status — `{ configured, connected, email, status }` for the UI. */
export const GET = withErrorCapture("/api/integrations/google/status", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const configured = googleOAuthConfigured();
  const row = await getGoogleIntegration(session.userId);
  const connected = configured && row?.status === "active" && row.hasToken;
  return Response.json(
    { configured, connected, email: connected ? row?.accountEmail ?? null : null, status: row?.status ?? null },
    { headers: { "Cache-Control": "no-store" } },
  );
});
