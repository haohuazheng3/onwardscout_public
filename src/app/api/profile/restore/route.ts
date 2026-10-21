import { z } from "zod";
import { withErrorCapture } from "@/lib/errors";
import { restoreVersion } from "@/lib/profile/actions";
import { knownError, ok, readBody, trackEvent } from "@/lib/profile/http";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({ version: z.number().int().positive() });

/** Brings an earlier profile version back as the newest one. */
export const POST = withErrorCapture("/api/profile/restore", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`profile:restore:${session.userId}`, 10, 600);
  if (!rl.ok) return tooMany(rl);
  const body = await readBody(req, Body);
  if ("error" in body) return body.error;
  try {
    const res = await restoreVersion(session.userId, body.data.version);
    await trackEvent(session.userId, "profile_restored", { from: body.data.version, version: res.version });
    return ok(res);
  } catch (err) {
    return knownError(err);
  }
});
