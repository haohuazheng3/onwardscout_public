import "server-only";
import { timingSafeEqual } from "node:crypto";
import { notFound } from "next/navigation";
import { auth, clerkClient } from "@clerk/nextjs/server";
import { isAdminEmail } from "./env";

/**
 * Defense in depth: the proxy already answers 404 to everyone who is not a verified admin;
 * every admin page, route handler and server action re-checks here. Admin = a verified Clerk
 * email address listed in ADMIN_EMAILS.
 */
export async function requireAdmin(): Promise<{ userId: string; email: string }> {
  const { userId } = await auth();
  if (!userId) notFound();
  const client = await clerkClient();
  const u = await client.users.getUser(userId);
  const email = u.emailAddresses.find((e) => e.verification?.status === "verified" && isAdminEmail(e.emailAddress))?.emailAddress;
  if (!email) notFound();
  return { userId, email: email.toLowerCase() };
}

/** Route handlers under /api/admin: the admin, or a 404 JSON response (never reveal the area). */
export async function requireAdminApi(): Promise<{ userId: string; email: string } | Response> {
  const { userId } = await auth();
  const no = () => Response.json({ error: "Not found." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  if (!userId) return no();
  try {
    const client = await clerkClient();
    const u = await client.users.getUser(userId);
    const email = u.emailAddresses.find((e) => e.verification?.status === "verified" && isAdminEmail(e.emailAddress))?.emailAddress;
    return email ? { userId, email: email.toLowerCase() } : no();
  } catch (err) {
    console.error("[admin] lookup failed", err);
    return no();
  }
}

/** Bearer-token check for operator endpoints (cron, inbox, ops); constant-time compare. */
export function bearerMatches(req: Request, secret: string | undefined): boolean {
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!secret || !got) return false;
  const a = Buffer.from(got, "utf8");
  const b = Buffer.from(secret, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
}
