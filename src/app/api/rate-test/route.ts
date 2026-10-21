import { withErrorCapture } from "@/lib/errors";
import { clientIp, ipHash, rateLimit, tooMany } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Dedicated path for proving rate limiting works: 5 requests per minute per IP, then 429. */
export const GET = withErrorCapture("/api/rate-test", async (req: Request) => {
  const rl = await rateLimit(`ratetest:${ipHash(clientIp(req.headers))}`, 5, 60);
  if (!rl.ok) return tooMany(rl);
  return Response.json(
    { ok: true, count: rl.count, limit: rl.limit, resetIn: rl.resetIn },
    { headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
  );
});
