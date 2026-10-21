import { buildExport, collectUserData, exportFilename } from "@/lib/data-export";
import { withErrorCapture } from "@/lib/errors";
import { recordEvent } from "@/lib/notifications";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** "Download my data": everything we store about the signed-in person, as one JSON file. */
export const GET = withErrorCapture("/api/settings/export", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`settings:export:${session.userId}`, 10, 3600);
  if (!rl.ok) return tooMany(rl);
  const now = new Date();
  const doc = buildExport(await collectUserData(session.userId), now);
  await recordEvent({ userId: session.userId, kind: "data.exported" });
  return new Response(JSON.stringify(doc, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${exportFilename(now)}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
});
