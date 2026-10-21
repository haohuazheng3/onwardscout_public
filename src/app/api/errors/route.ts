import { z } from "zod";
import { captureError, clientSeverity } from "@/lib/errors";
import { clientIp, ipHash, rateLimit } from "@/lib/ratelimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const Body = z.object({
  name: z.string().max(200).default("Error"),
  message: z.string().max(2000).default("(no message)"),
  stack: z.string().max(8000).optional(),
  route: z.string().max(300).optional(),
  source: z.string().max(60).optional(),
  severity: z.enum(["error", "warn"]).default("warn"),
  userAgent: z.string().max(400).optional(),
});

/**
 * Client-side error ingest (sendBeacon from src/instrumentation-client.ts). Always answers 204
 * so the browser never retries or logs noise. Anonymous input: the severity is re-derived from
 * the stack, the per-IP window is tight and an hourly cap bounds how many inbox rows one
 * address can create.
 */
export async function POST(req: Request) {
  try {
    const ip = ipHash(clientIp(req.headers));
    const [minute, hour] = await Promise.all([rateLimit(`errors:m:${ip}`, 30, 60), rateLimit(`errors:h:${ip}`, 120, 3600)]);
    if (!minute.ok || !hour.ok) return new Response(null, { status: 204 });
    const raw = await req.text();
    if (raw.length > 20000) return new Response(null, { status: 204 });
    let json: unknown;
    try {
      json = JSON.parse(raw || "{}");
    } catch {
      return new Response(null, { status: 204 });
    }
    const parsed = Body.safeParse(json);
    if (!parsed.success) return new Response(null, { status: 204 });
    const d = parsed.data;
    const err = Object.assign(new Error(d.message), { name: d.name, stack: d.stack ?? "" });
    await captureError(err, {
      route: d.route?.split("?")[0] ?? null,
      source: "client",
      severity: clientSeverity(d.severity, d.stack),
      context: { via: d.source, userAgent: d.userAgent },
    });
  } catch (e) {
    console.error("[api/errors] ingest failed", e);
  }
  return new Response(null, { status: 204 });
}
