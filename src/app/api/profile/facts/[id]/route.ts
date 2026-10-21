import { z } from "zod";
import { withErrorCapture } from "@/lib/errors";
import { confirmFact, fixFact } from "@/lib/profile/actions";
import { knownError, localeSchema, ok, readBody } from "@/lib/profile/http";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { isResponse, requireUserApi } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.discriminatedUnion("action", [
  z.object({ action: z.literal("confirm"), locale: localeSchema }),
  z.object({ action: z.literal("fix"), value: z.union([z.string().max(2000), z.record(z.string(), z.union([z.string().max(2000), z.number(), z.null()]))]), locale: localeSchema }),
]);

/** "Confirm" a sourced fact, or "fix it" inline: either way it becomes the person's own word. */
export const PATCH = withErrorCapture("/api/profile/facts/[id]", async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`profile:facts:${session.userId}`, 120, 600);
  if (!rl.ok) return tooMany(rl);
  const body = await readBody(req, Body);
  if ("error" in body) return body.error;
  const { id } = await ctx.params;
  try {
    const locale = body.data.locale ?? "en";
    const fact = body.data.action === "confirm" ? await confirmFact(session.userId, id, locale) : await fixFact(session.userId, id, body.data.value, locale);
    return ok({ fact: { id: fact.id, path: fact.path, claim: fact.claim, value: fact.value, confirmedByUser: fact.confirmedByUser } });
  } catch (err) {
    return knownError(err);
  }
});
