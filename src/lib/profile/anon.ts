import "server-only";
import { cookies, headers } from "next/headers";
import { env } from "@/lib/env";
import { randomString } from "@/lib/ids";
import { clientIp, ipHash, rateLimit, tooMany } from "@/lib/ratelimit";
import { optionalUser } from "@/lib/user";
import { ANON_COOKIE, ANON_COOKIE_MAX_AGE, signAnonId, verifyAnonCookie } from "./anon-cookie";

/*
 * Who owns a draft on /app/start: the signed-in person, else the anonymous visitor named by
 * the signed `os_anon` cookie (contracts §8). New anonymous drafts are rate limited per IP
 * (3 a day — each draft then takes up to 10 files and 10 links), so the signed-out start
 * cannot be used as free bulk parsing.
 */

export const NEW_DRAFTS_PER_IP_PER_DAY = 3;

export function anonSecret(): string | null {
  return env("CRON_SECRET") ?? null;
}

/** The verified anonymous id from the request cookie, or null. */
export async function readAnonId(): Promise<string | null> {
  const jar = await cookies();
  return verifyAnonCookie(jar.get(ANON_COOKIE)?.value, anonSecret());
}

export interface DraftOwner {
  ownerId: string;
  anonymous: boolean;
  /** Set when this request created the anonymous draft. */
  minted?: boolean;
  /** The signed-in person's verified email (signed-in owners only). */
  email?: string;
}

const json503 = () =>
  Response.json({ error: "Starting without an account isn't available right now. Sign in to continue." }, { status: 503, headers: { "Cache-Control": "no-store" } });

/**
 * The owner of the current draft. With `create`, a signed-out visitor without a cookie gets
 * a new anonymous draft (cookie set on the response); without it, they get null.
 */
export async function resolveDraftOwner(opts: { create: boolean }): Promise<DraftOwner | Response | null> {
  const session = await optionalUser();
  if (session) return { ownerId: session.userId, anonymous: false, email: session.email };
  const secret = anonSecret();
  if (!secret) return opts.create ? json503() : null;
  const existing = await readAnonId();
  if (existing) return { ownerId: existing, anonymous: true };
  if (!opts.create) return null;
  const rl = await rateLimit(`drafts:new:ip:${ipHash(clientIp(await headers()))}`, NEW_DRAFTS_PER_IP_PER_DAY, 24 * 3600);
  if (!rl.ok) {
    return Response.json(
      { error: "You've started several drafts today. Sign in to keep going — it takes one email code.", signIn: true },
      { status: 429, headers: { "Cache-Control": "no-store", "Retry-After": String(Math.max(1, rl.resetIn)) } },
    );
  }
  const anonId = `anon_${randomString(16)}`;
  const jar = await cookies();
  jar.set(ANON_COOKIE, signAnonId(anonId, secret), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ANON_COOKIE_MAX_AGE,
  });
  return { ownerId: anonId, anonymous: true, minted: true };
}

/** Forget the anonymous draft cookie (after it was claimed). */
export async function clearAnonCookie(): Promise<void> {
  const jar = await cookies();
  jar.set(ANON_COOKIE, "", { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 0 });
}

/** Per-IP limit shared by every signed-out write (sign, link, note, patch). */
export async function anonWriteLimit(scope: string, limit: number, windowSeconds: number): Promise<Response | null> {
  const rl = await rateLimit(`drafts:${scope}:ip:${ipHash(clientIp(await headers()))}`, limit, windowSeconds);
  return rl.ok ? null : tooMany(rl);
}
