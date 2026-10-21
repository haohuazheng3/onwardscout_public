import "server-only";
import { cache } from "react";
import { auth, currentUser } from "@clerk/nextjs/server";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { grantTrial } from "./credits";
import { db } from "./db";
import { users, userTombstones, type UserRow } from "./db/schema";
import { tombstoneHash } from "./crypto";
import { env } from "./env";
import { captureError } from "./errors";
import { randomString } from "./ids";
import { inboundAddress, localeOfPath, RETURN_PATH_HEADER, signInPath, withLocale, type Locale } from "./site";

/*
 * Who is asking. Clerk owns identity (email-code sign-in, one flow for sign-in and sign-up);
 * the local `users` row is keyed by the Clerk user id and carries the email, the UI locale,
 * the reply drop-box token and the Stripe customer.
 */

/**
 * Clerk is configured for this deployment. Without its keys the site runs in degraded mode:
 * public pages and APIs work, the personal area answers 503 at the proxy, and nobody is
 * signed in (auth() must not be called then: clerkMiddleware never ran).
 */
export function clerkConfigured(): boolean {
  return Boolean(env("CLERK_SECRET_KEY") && env("NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY"));
}

export interface SessionUser {
  userId: string;
  /** The verified email address, lowercased. */
  email: string;
}

/* ---------- email resolution (Clerk Backend API calls are rate limited: cache them) ---------- */

const EMAIL_TTL_MS = 10 * 60 * 1000;
const EMAIL_CACHE_MAX = 5000;
const emailCache = new Map<string, { email: string; at: number }>();

function remember(userId: string, email: string): void {
  if (emailCache.size >= EMAIL_CACHE_MAX) {
    const oldest = emailCache.keys().next().value;
    if (oldest !== undefined) emailCache.delete(oldest);
  }
  emailCache.set(userId, { email, at: Date.now() });
}

/**
 * The verified email of the signed-in user, lowercased, or null. Read from the session token
 * when the Clerk session is customized with an `email` claim, else from a short in-memory
 * cache, else from Clerk (once per user per 10 minutes per instance). Only a verified address
 * counts: sign-in is by email code, so the primary address is verified by construction.
 */
const resolveEmail = cache(async (userId: string, claimEmail: string | null): Promise<string | null> => {
  if (claimEmail) return claimEmail.trim().toLowerCase();
  const hit = emailCache.get(userId);
  if (hit && Date.now() - hit.at < EMAIL_TTL_MS) return hit.email;
  const u = await currentUser();
  if (!u || u.id !== userId) return null;
  const verified = (e: { verification: { status: string | null } | null } | null | undefined) => e?.verification?.status === "verified";
  const primary = verified(u.primaryEmailAddress) ? u.primaryEmailAddress : u.emailAddresses.find(verified);
  const address = primary?.emailAddress?.trim().toLowerCase() ?? null;
  if (address) remember(userId, address);
  return address;
});

function claimEmailOf(claims: unknown): string | null {
  const v = (claims as { email?: unknown } | null | undefined)?.email;
  return typeof v === "string" && v.includes("@") ? v : null;
}

async function currentReturnPath(): Promise<string | null> {
  try {
    return (await headers()).get(RETURN_PATH_HEADER);
  } catch {
    return null;
  }
}

/**
 * Pages, layouts and server actions: the signed-in user, or a redirect to the localized
 * sign-in page that comes back here afterwards. The proxy already redirects signed-out
 * visitors of /app and /checkout; this is the second check every page relies on.
 */
export async function requireUser(opts: { locale?: Locale; returnTo?: string } = {}): Promise<SessionUser> {
  const a = await auth();
  if (!a.userId) {
    const back = opts.returnTo ?? (await currentReturnPath());
    const locale = opts.locale ?? (back ? localeOfPath(back) : "en");
    redirect(signInPath(locale, back ?? withLocale(locale, "/app")));
  }
  const email = await resolveEmail(a.userId, claimEmailOf(a.sessionClaims));
  if (!email) {
    // Not reachable with email-code sign-in; refusing is safer than guessing an address
    // (and redirecting to /sign-in would loop, since the session itself is valid).
    throw new Error("Your account has no verified email address. Sign out and sign in again with your email code.");
  }
  return { userId: a.userId, email };
}

const signInRequired = () =>
  Response.json({ error: "Please sign in to continue." }, { status: 401, headers: { "Cache-Control": "no-store" } });

/** Route handlers: the signed-in user, or a ready-made 401 JSON response. */
export async function requireUserApi(): Promise<SessionUser | Response> {
  if (!clerkConfigured()) {
    return Response.json(
      { error: "Sign-in is being set up. Please try again in a few minutes." },
      { status: 503, headers: { "Cache-Control": "no-store", "Retry-After": "300" } },
    );
  }
  const a = await auth();
  if (!a.userId) return signInRequired();
  const email = await resolveEmail(a.userId, claimEmailOf(a.sessionClaims));
  if (!email) return signInRequired();
  return { userId: a.userId, email };
}

/** The signed-in user or null, without redirecting (e.g. public pages that adapt when signed in). */
export async function optionalUser(): Promise<SessionUser | null> {
  if (!clerkConfigured()) return null;
  const a = await auth();
  if (!a.userId) return null;
  const email = await resolveEmail(a.userId, claimEmailOf(a.sessionClaims));
  return email ? { userId: a.userId, email } : null;
}

export function isResponse(v: unknown): v is Response {
  return v instanceof Response;
}

/* ---------- the local users row ---------- */

/** 16 characters of the id alphabet (80 bits): the reply drop-box token, see `inboundAddress()`. */
export function newInboundToken(): string {
  return randomString(16);
}

function isUniqueViolation(err: unknown, constraint: string): boolean {
  const e = err as { code?: unknown; constraint?: unknown; cause?: { code?: unknown; constraint?: unknown } } | null;
  const code = e?.code ?? e?.cause?.code;
  const name = e?.constraint ?? e?.cause?.constraint;
  return code === "23505" && (name === undefined || name === constraint);
}

const upsertUser = cache(async (userId: string, email: string, locale: Locale | null): Promise<UserRow & { isNew: boolean }> => {
  for (let attempt = 0; ; attempt++) {
    try {
      const rows = await db
        .insert(users)
        .values({ id: userId, email, locale: locale ?? "en", inboundToken: newInboundToken() })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email,
            lastSeenAt: sql`now()`,
            // Minted once: an existing token is never replaced (it is printed in the user's mail filters).
            inboundToken: sql`coalesce(${users.inboundToken}, excluded.inbound_token)`,
          },
        })
        .returning({
          id: users.id,
          email: users.email,
          locale: users.locale,
          inboundToken: users.inboundToken,
          stripeCustomerId: users.stripeCustomerId,
          createdAt: users.createdAt,
          lastSeenAt: users.lastSeenAt,
          isNew: sql<boolean>`(xmax = 0)`,
        });
      const r = rows[0];
      if (!r) throw new Error("user row was not persisted");
      if (r.isNew) {
        // A deleted account whose session is still valid for a few seconds must not come back
        // as an empty account (with a fresh trial): undo the insert and refuse.
        if (await isDeletedAccount(r.id)) {
          await db.delete(users).where(eq(users.id, r.id));
          throw new DeletedAccountError();
        }
        await firstRun(r.id);
      }
      return r;
    } catch (err) {
      // An 80-bit token colliding is astronomically unlikely; one retry with a fresh token covers it.
      if (attempt === 0 && isUniqueViolation(err, "users_inbound_token_uq")) continue;
      throw err;
    }
  }
});

export class DeletedAccountError extends Error {
  constructor() {
    super("This account was deleted.");
    this.name = "DeletedAccountError";
  }
}

/** The account was deleted (see `user_tombstones`). */
export async function isDeletedAccount(userId: string): Promise<boolean> {
  const rows = await db.select({ h: userTombstones.userHash }).from(userTombstones).where(eq(userTombstones.userHash, tombstoneHash(userId))).limit(1);
  return rows.length > 0;
}

/**
 * First sign-in: the trial credits (contracts §2; idempotent on `trial:<userId>`, and
 * `getBalance` self-heals a missed grant, so a failure here is logged, never fatal).
 */
async function firstRun(userId: string): Promise<void> {
  try {
    await grantTrial(userId);
  } catch (err) {
    await captureError(err, { route: "ensureUser (trial grant)", source: "server", severity: "warn" });
  }
}

/**
 * Upserts the local row from the session: `{id, email}` on the first authenticated request
 * (with the locale the person signed up in, and a fresh drop-box token), email + last_seen_at
 * afterwards. Deduplicated per request. `isNew` is true exactly once per user; the trial grant
 * (P4, idempotent on `trial:<userId>`) keys off it.
 */
export async function ensureUser(session?: SessionUser, opts: { locale?: Locale } = {}): Promise<UserRow & { isNew: boolean }> {
  const s = session ?? (await requireUser({ locale: opts.locale }));
  return upsertUser(s.userId, s.email, opts.locale ?? null);
}

export async function getUserRow(userId: string): Promise<UserRow | null> {
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0] ?? null;
}

/** The user's interface language ('en' when the row does not exist yet). */
export async function getUserLocale(userId: string): Promise<Locale> {
  const rows = await db.select({ locale: users.locale }).from(users).where(eq(users.id, userId)).limit(1);
  return rows[0]?.locale === "zh" ? "zh" : "en";
}

export async function setUserLocale(userId: string, locale: Locale): Promise<void> {
  await db.update(users).set({ locale }).where(eq(users.id, userId));
}

/** `in+<token>@onwardscout.com` for this user, minting the token if an old row has none. */
export async function getInboundAddress(userId: string): Promise<string | null> {
  const found = await db.select({ token: users.inboundToken }).from(users).where(eq(users.id, userId)).limit(1);
  if (!found[0]) return null;
  let token = found[0].token;
  if (!token) {
    const rows = await db
      .update(users)
      .set({ inboundToken: sql`coalesce(${users.inboundToken}, ${newInboundToken()})` })
      .where(eq(users.id, userId))
      .returning({ token: users.inboundToken });
    token = rows[0]?.token ?? null;
  }
  return token ? inboundAddress(token) : null;
}

/** The user whose drop-box token this is (reply ingest). */
export async function userIdForInboundToken(token: string): Promise<string | null> {
  const rows = await db.select({ id: users.id }).from(users).where(eq(users.inboundToken, token.toLowerCase())).limit(1);
  return rows[0]?.id ?? null;
}
