import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, lt, ne, or, sql } from "drizzle-orm";
import { db } from "./db";
import { creditEvents, creditLots, users, type CreditEventRow, type CreditLotRow } from "./db/schema";
import type { CreditEventKind, LotKind } from "./core/types";
import { newId } from "./ids";
import { OFFERS, TRIAL, type Sku } from "@/content/plans";

/*
 * The ONLY module that touches credit_lots / credit_events. This is money, so the rules live
 * here and nowhere else:
 *
 *  - A lot is a batch of credits with one expiry (trial, a Pro month, a pack, an adjustment).
 *    `remaining` drops the moment an application reserves and comes back only on a release; a
 *    debit moves nothing on the lot (the reservation already took the credits), it is the
 *    ledger entry that says "spent".
 *  - Reservations draw from the earliest-expiring usable lot first (FIFO by expires_at).
 *  - Every movement is an append-only credit_events row. An application touches each lot at most
 *    once per kind (unique index on application_id + lot_id + kind), so reserve / settle /
 *    release can be replayed by a retry, a callback and a cron at the same time without double
 *    counting.
 *  - An ended application can be reopened (expired/withdrawn → draft) and reserve again. Each
 *    reservation is a "round": round 1 is keyed by the application id itself, round n ≥ 2 by
 *    `<applicationId>#r<n>` in credit_events.application_id (`parseRoundKey` recovers the id).
 *    Settle and release always act on the latest round.
 *  - Neon over HTTP has no interactive transactions: lot updates are conditional UPDATEs
 *    (`remaining >= take`), so two concurrent reservations can never overdraw a lot, and a
 *    reservation that cannot complete is unwound.
 *  - Grants are idempotent on `source_key`. A failed or withdrawn application never costs a credit.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Credits expiring within this many days are announced on the billing page and in the shell. */
export const EXPIRING_SOON_DAYS = 14;

/** How long a lot that expired while an application held its credits stays usable after the release. */
export const RELEASE_GRACE_DAYS = 7;

/**
 * Sentinel lot id of a reservation claim. Before taking credits for a round, a reserver inserts
 * (application round, CLAIM_LOT, "reserve", amount 0): the unique index lets exactly one caller in,
 * so two concurrent calls for the same application can never hold credits on two different lots.
 * The claim is removed when the reservation completes; a claim left by a crashed caller goes stale.
 */
export const CLAIM_LOT = "claim";
const CLAIM_STALE_MS = 30_000;
const CLAIM_WAIT_MS = 8_000;

const isClaim = (e: { lotId: string }) => e.lotId === CLAIM_LOT;

export interface Lot {
  id: string;
  kind: LotKind;
  total: number;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface Balance {
  /** Credits a new application can reserve right now. */
  available: number;
  /** Credits held by applications that are being prepared or submitted. */
  reserved: number;
  /** The next credits to expire within EXPIRING_SOON_DAYS, if any. */
  expiringSoon: { amount: number; at: Date } | null;
  /** Every usable credit comes from the free trial. */
  trialOnly: boolean;
}

export type ReserveResult =
  | { ok: true; amount: number }
  | { ok: false; reason: "insufficient" | "invalid-amount"; available: number; needed: number };

type LotLike = Pick<Lot, "remaining" | "expiresAt"> & { status?: string };

/* ------------------------------------------------------------------ pure helpers (unit-tested) */

export function isUsable(lot: LotLike, now: Date = new Date()): boolean {
  if (lot.status && lot.status !== "active") return false;
  if (lot.remaining <= 0) return false;
  if (lot.expiresAt && lot.expiresAt.getTime() <= now.getTime()) return false;
  return true;
}

/** Lots a reservation may draw from: earliest expiry first (never-expiring last), then oldest first. */
export function orderForDebit<T extends LotLike & Pick<Lot, "createdAt">>(lots: T[], now: Date = new Date()): T[] {
  return lots
    .filter((l) => isUsable(l, now))
    .sort((a, b) => {
      const ea = a.expiresAt ? a.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      const eb = b.expiresAt ? b.expiresAt.getTime() : Number.POSITIVE_INFINITY;
      if (ea !== eb) return ea - eb;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
}

export function sumAvailable(lots: LotLike[], now: Date = new Date()): number {
  return lots.reduce((n, l) => (isUsable(l, now) ? n + l.remaining : n), 0);
}

/** How a reservation of `amount` splits across lots, or null when the lots cannot cover it. */
export function planReservation<T extends LotLike & Pick<Lot, "id" | "createdAt">>(
  lots: T[],
  amount: number,
  now: Date = new Date(),
): { lotId: string; take: number }[] | null {
  if (!Number.isInteger(amount) || amount <= 0) return null;
  const plan: { lotId: string; take: number }[] = [];
  let needed = amount;
  for (const lot of orderForDebit(lots, now)) {
    if (needed === 0) break;
    const take = Math.min(lot.remaining, needed);
    plan.push({ lotId: lot.id, take });
    needed -= take;
  }
  return needed === 0 ? plan : null;
}

/** `remaining` rebuilt from the ledger: total − reserved + released (debits mirror reserves and move nothing). */
export function remainingFromEvents(total: number, events: { kind: CreditEventKind; amount: number }[]): number {
  let remaining = total;
  for (const e of events) {
    if (e.kind === "reserve") remaining -= e.amount;
    else if (e.kind === "release") remaining += e.amount;
  }
  return Math.max(0, Math.min(total, remaining));
}

/** Credits still held per the ledger: reserves minus their debits and releases. */
export function reservedFromEvents(events: { kind: CreditEventKind; amount: number }[]): number {
  let held = 0;
  for (const e of events) {
    if (e.kind === "reserve") held += e.amount;
    else if (e.kind === "debit" || e.kind === "release") held -= e.amount;
  }
  return Math.max(0, held);
}

/**
 * The next credits to expire within `days`: the earliest expiry among usable lots and how many
 * credits expire at that moment (lots sharing the same expiry are added up). Null when nothing
 * usable expires inside the window.
 */
export function expiringSoon(lots: LotLike[], now: Date = new Date(), days: number = EXPIRING_SOON_DAYS): { amount: number; at: Date } | null {
  const horizon = now.getTime() + days * DAY_MS;
  const soon = lots.filter((l) => isUsable(l, now) && l.expiresAt && l.expiresAt.getTime() <= horizon);
  if (!soon.length) return null;
  const at = Math.min(...soon.map((l) => (l.expiresAt as Date).getTime()));
  const amount = soon.filter((l) => (l.expiresAt as Date).getTime() === at).reduce((n, l) => n + l.remaining, 0);
  return { amount, at: new Date(at) };
}

export type LotStatus = "active" | "revoked" | "expired" | "usedUp";

/** Pure: how a lot reads on the billing page. */
export function lotStatus(lot: Pick<Lot, "remaining" | "expiresAt"> & { status: string }, now: Date = new Date()): LotStatus {
  if (lot.status === "revoked") return "revoked";
  if (lot.expiresAt && lot.expiresAt.getTime() <= now.getTime()) return "expired";
  if (lot.remaining <= 0) return "usedUp";
  return "active";
}

/** True when the user holds credits and every usable one comes from the free trial. */
export function onlyTrial(lots: (LotLike & Pick<Lot, "kind">)[], now: Date = new Date()): boolean {
  const usable = lots.filter((l) => isUsable(l, now));
  return usable.length > 0 && usable.every((l) => l.kind === "trial");
}

/** Pure: the balance the shell and the billing page show, from usable lots and the ledger. */
export function computeBalance(
  lots: (LotLike & Pick<Lot, "kind">)[],
  events: { kind: CreditEventKind; amount: number }[],
  now: Date = new Date(),
): Balance {
  return {
    available: sumAvailable(lots, now),
    reserved: reservedFromEvents(events),
    expiringSoon: expiringSoon(lots, now),
    trialOnly: onlyTrial(lots, now),
  };
}

/** When credits bought under `sku` stop being usable. Pro: period end + rollover; packs: purchase + validity. */
export function lotExpiryFor(sku: Sku, input: { periodEnd?: Date; purchasedAt?: Date }): Date {
  const offer = OFFERS[sku];
  if (offer.interval === "month") {
    if (!input.periodEnd) throw new Error(`periodEnd is required for the ${sku} plan`);
    return new Date(input.periodEnd.getTime() + offer.rolloverDays * DAY_MS);
  }
  const bought = input.purchasedAt ?? new Date();
  return new Date(bought.getTime() + offer.rolloverDays * DAY_MS);
}

export function trialExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + TRIAL.expiryDays * DAY_MS);
}

export function trialSourceKey(userId: string): string {
  return `trial:${userId}`;
}

/** Idempotency key of a manual adjustment: one lot per (user, reason key). */
export function adjustSourceKey(userId: string, key: string): string {
  return `adjust:${userId}:${key}`;
}

/** Ids that are not people (anonymous drafts) never hold credits. */
export function isCreditHolder(userId: string): boolean {
  return Boolean(userId) && !userId.startsWith("anon_");
}

/** Ledger key of an application's n-th reservation round (round 1 = the application id itself). */
export function roundKey(applicationId: string, round: number): string {
  return round <= 1 ? applicationId : `${applicationId}#r${round}`;
}

/** The application id and round behind a credit_events.application_id value. */
export function parseRoundKey(key: string): { applicationId: string; round: number } {
  const m = /^(.+)#r(\d+)$/.exec(key);
  return m ? { applicationId: m[1], round: Number(m[2]) } : { applicationId: key, round: 1 };
}

export type RoundState = "none" | "held" | "debited" | "released";

/**
 * Pure: where an application's latest reservation round stands. `held` = reserved and neither
 * debited nor released; `reserved` is what that round reserved in total.
 */
export function latestRound(
  events: { applicationId: string | null; kind: CreditEventKind; amount: number }[],
): { round: number; key: string | null; state: RoundState; reserved: number } {
  let round = 0;
  let key: string | null = null;
  for (const e of events) {
    if (!e.applicationId) continue;
    const r = parseRoundKey(e.applicationId).round;
    if (r > round) {
      round = r;
      key = e.applicationId;
    }
  }
  if (!key) return { round: 0, key: null, state: "none", reserved: 0 };
  const mine = events.filter((e) => e.applicationId === key);
  const reserved = mine.filter((e) => e.kind === "reserve").reduce((n, e) => n + e.amount, 0);
  const state: RoundState = reserved === 0 ? "none" : mine.some((e) => e.kind === "debit") ? "debited" : mine.some((e) => e.kind === "release") ? "released" : "held";
  return { round, key, state, reserved };
}

/* ------------------------------------------------------------------ reads */

function toLot(r: CreditLotRow): Lot {
  return { id: r.id, kind: r.kind, total: r.total, remaining: r.remaining, expiresAt: r.expiresAt, createdAt: r.createdAt };
}

async function activeLots(userId: string): Promise<CreditLotRow[]> {
  return db
    .select()
    .from(creditLots)
    .where(and(eq(creditLots.userId, userId), eq(creditLots.status, "active"), or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, sql`now()`))))
    .orderBy(asc(creditLots.expiresAt), asc(creditLots.createdAt));
}

async function heldByUser(userId: string): Promise<number> {
  const rows = await db
    .select({
      held: sql<number>`coalesce(sum(case when ${creditEvents.kind} = 'reserve' then ${creditEvents.amount} when ${creditEvents.kind} in ('debit','release') then -${creditEvents.amount} else 0 end), 0)::int`,
    })
    .from(creditEvents)
    .where(eq(creditEvents.userId, userId));
  return Math.max(0, Number(rows[0]?.held ?? 0));
}

/**
 * Self-heal for accounts that never got their trial (signed up before billing existed, or the
 * first-run hook failed): a real user with no lot at all receives it now. Idempotent on
 * `trial:<userId>`; an expired or spent trial is a lot, so it is never granted twice.
 */
async function healTrial(userId: string): Promise<boolean> {
  if (!isCreditHolder(userId)) return false;
  const any = await db.select({ id: creditLots.id }).from(creditLots).where(eq(creditLots.userId, userId)).limit(1);
  if (any.length) return false;
  const person = await db.select({ id: users.id }).from(users).where(eq(users.id, userId)).limit(1);
  if (!person.length) return false;
  // Re-read either way: when the first-run hook (ensureUser) granted the trial concurrently, this
  // grant is a no-op (created: false) but the lot now exists and must be counted.
  await grantTrial(userId);
  return true;
}

export async function getBalance(userId: string): Promise<Balance> {
  let [lots, held] = await Promise.all([activeLots(userId), heldByUser(userId)]);
  if (lots.length === 0 && held === 0 && (await healTrial(userId))) {
    [lots, held] = await Promise.all([activeLots(userId), heldByUser(userId)]);
  }
  const usable = lots.map((r) => ({ ...toLot(r), status: r.status }));
  return {
    available: sumAvailable(usable),
    reserved: held,
    expiringSoon: expiringSoon(usable),
    trialOnly: onlyTrial(usable),
  };
}

export type LotView = Lot & { status: CreditLotRow["status"]; sourceKey: string; orderId: string | null };

/** Every lot the user ever had, newest first (billing page). */
export async function listLots(userId: string, limit = 100): Promise<LotView[]> {
  const rows = await db.select().from(creditLots).where(eq(creditLots.userId, userId)).orderBy(desc(creditLots.createdAt)).limit(limit);
  return rows.map((r) => ({ ...toLot(r), status: r.status, sourceKey: r.sourceKey, orderId: r.orderId }));
}

/** The user's most recent ledger entries, newest first (billing page activity, admin). */
export async function listEvents(userId: string, limit = 50): Promise<CreditEventRow[]> {
  return db
    .select()
    .from(creditEvents)
    .where(and(eq(creditEvents.userId, userId), ne(creditEvents.lotId, CLAIM_LOT)))
    .orderBy(desc(creditEvents.createdAt))
    .limit(limit);
}

/** Every ledger row of an application, all reservation rounds included. */
async function eventsForApplication(applicationId: string): Promise<CreditEventRow[]> {
  return db
    .select()
    .from(creditEvents)
    .where(or(eq(creditEvents.applicationId, applicationId), sql`starts_with(${creditEvents.applicationId}, ${`${applicationId}#r`})`));
}

/** What the ledger says about one application: credits held now, spent and given back (all rounds). */
export async function applicationCredits(applicationId: string): Promise<{ reserved: number; debited: number; released: number }> {
  const events = (await eventsForApplication(applicationId)).filter((e) => !isClaim(e));
  const sum = (k: CreditEventKind) => events.filter((e) => e.kind === k).reduce((n, e) => n + e.amount, 0);
  const latest = latestRound(events);
  return { reserved: latest.state === "held" ? latest.reserved : 0, debited: sum("debit"), released: sum("release") };
}

/* ------------------------------------------------------------------ writes */

async function insertEvent(input: { userId: string; lotId: string; applicationId: string | null; kind: CreditEventKind; amount: number }): Promise<boolean> {
  const rows = await db
    .insert(creditEvents)
    .values({ id: newId("cev"), ...input })
    .onConflictDoNothing()
    .returning({ id: creditEvents.id });
  return rows.length > 0;
}

/** Conditional decrement: succeeds only if the lot is still active, unexpired and holds `take`. */
async function takeFromLot(lotId: string, take: number): Promise<boolean> {
  const rows = await db
    .update(creditLots)
    .set({ remaining: sql`${creditLots.remaining} - ${take}` })
    .where(
      and(
        eq(creditLots.id, lotId),
        eq(creditLots.status, "active"),
        sql`${creditLots.remaining} >= ${take}`,
        or(isNull(creditLots.expiresAt), gt(creditLots.expiresAt, sql`now()`)),
      ),
    )
    .returning({ id: creditLots.id });
  return rows.length > 0;
}

/**
 * Puts credits back, never above the lot's total (a revoked lot stays at 0). A lot that expired
 * while an application held its credits comes back holding exactly the released credits, usable
 * for a grace period: "a failed application never costs a credit" holds at the end of a billing
 * month too. Whatever else was left in the expired lot stays expired.
 */
async function giveBackToLot(lotId: string, amount: number): Promise<void> {
  const expired = sql`${creditLots.expiresAt} is not null and ${creditLots.expiresAt} <= now()`;
  await db
    .update(creditLots)
    .set({
      remaining: sql`least(${creditLots.total}, case when ${expired} then ${amount} else ${creditLots.remaining} + ${amount} end)`,
      expiresAt: sql`case when ${expired} then now() + make_interval(days => ${RELEASE_GRACE_DAYS}) else ${creditLots.expiresAt} end`,
    })
    .where(and(eq(creditLots.id, lotId), eq(creditLots.status, "active")));
}


/** Another reservation for the same application is still running; retry shortly. */
export class CreditsBusyError extends Error {
  constructor(applicationId: string) {
    super(`Another reservation for ${applicationId} is still running. Try again in a moment.`);
    this.name = "CreditsBusyError";
  }
}

async function dropClaim(key: string, olderThan?: Date): Promise<void> {
  await db
    .delete(creditEvents)
    .where(
      and(
        eq(creditEvents.applicationId, key),
        eq(creditEvents.lotId, CLAIM_LOT),
        eq(creditEvents.kind, "reserve"),
        olderThan ? lt(creditEvents.createdAt, olderThan) : undefined,
      ),
    );
}

/** Takes `amount` credits FIFO for one claimed round. Up to three passes against concurrent drains. */
async function takeForRound(userId: string, key: string, amount: number): Promise<ReserveResult> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const lots = (await activeLots(userId)).map(toLot);
    const plan = planReservation(lots, amount);
    if (!plan) return { ok: false, reason: "insufficient", available: sumAvailable(lots), needed: amount };

    const taken: { lotId: string; take: number }[] = [];
    let complete = true;
    for (const step of plan) {
      // Conditional decrement: another application may have drained the lot since planning.
      if (!(await takeFromLot(step.lotId, step.take))) {
        complete = false;
        break;
      }
      if (!(await insertEvent({ userId, lotId: step.lotId, applicationId: key, kind: "reserve", amount: step.take }))) {
        // Cannot happen under the claim; never keep credits nobody recorded.
        await giveBackToLot(step.lotId, step.take);
        complete = false;
        break;
      }
      taken.push(step);
    }
    if (complete) return { ok: true, amount };

    // Unwind the partial hold of this round (ours: the claim keeps everyone else out), then plan again.
    for (const step of taken) {
      await db
        .delete(creditEvents)
        .where(and(eq(creditEvents.applicationId, key), eq(creditEvents.lotId, step.lotId), eq(creditEvents.kind, "reserve")));
      await giveBackToLot(step.lotId, step.take);
    }
  }
  const lots = (await activeLots(userId)).map(toLot);
  return { ok: false, reason: "insufficient", available: sumAvailable(lots), needed: amount };
}

/**
 * Reserve `amount` credits for one application (at "Apply for me", or when an ended application
 * is reopened). Idempotent per application: while a reservation is held, another call returns it
 * without taking more; concurrent calls wait for the first one. On a shortfall nothing is held.
 * `amount` 0 (practice) holds nothing. Throws CreditsBusyError only if another reservation for the
 * same application is still running after several seconds.
 */
export async function reserveForApplication(input: { userId: string; applicationId: string; amount: number }): Promise<ReserveResult> {
  const { userId, applicationId, amount } = input;
  if (amount === 0) return { ok: true, amount: 0 };
  if (!Number.isInteger(amount) || amount < 0 || !applicationId || applicationId.includes("#") || !isCreditHolder(userId)) {
    return { ok: false, reason: "invalid-amount", available: 0, needed: amount };
  }

  const deadline = Date.now() + CLAIM_WAIT_MS;
  for (;;) {
    const latest = latestRound((await eventsForApplication(applicationId)).filter((e) => !isClaim(e)));
    // Already held, or already paid for (a replay after submission): nothing more to take.
    if (latest.state === "held" || latest.state === "debited") return { ok: true, amount: latest.reserved };
    const round = latest.state === "released" ? latest.round + 1 : Math.max(1, latest.round);
    const key = roundKey(applicationId, round);

    if (await insertEvent({ userId, lotId: CLAIM_LOT, applicationId: key, kind: "reserve", amount: 0 })) {
      try {
        // Under the claim, look once more: a reserver that finished a moment ago has dropped its claim.
        const now = latestRound((await eventsForApplication(applicationId)).filter((e) => !isClaim(e)));
        if (now.state === "held" || now.state === "debited") return { ok: true, amount: now.reserved };
        if (now.round > round || (now.round === round && now.state === "released")) continue; // that round is over; claim the next
        return await takeForRound(userId, key, amount);
      } finally {
        await dropClaim(key);
      }
    }

    // Someone else is reserving this round: wait for them, and take over a claim a crashed caller left.
    if (Date.now() > deadline) throw new CreditsBusyError(applicationId);
    await new Promise((resolve) => setTimeout(resolve, 200));
    await dropClaim(key, new Date(Date.now() - CLAIM_STALE_MS));
  }
}

/** The application was submitted: its held reservation becomes a debit. Idempotent; a no-op without a held reservation. */
export async function settleApplication(applicationId: string): Promise<{ debited: number }> {
  const events = (await eventsForApplication(applicationId)).filter((e) => !isClaim(e));
  const latest = latestRound(events);
  if (latest.state !== "held" || !latest.key) return { debited: 0 };
  let debited = 0;
  for (const r of events.filter((e) => e.applicationId === latest.key && e.kind === "reserve" && !isClaim(e))) {
    const inserted = await insertEvent({ userId: r.userId, lotId: r.lotId, applicationId: latest.key, kind: "debit", amount: r.amount });
    if (inserted) debited += r.amount;
  }
  return { debited };
}

/** The application failed, expired or was withdrawn: the held reservation comes back. Idempotent; never after a debit. */
export async function releaseApplication(applicationId: string): Promise<{ released: number }> {
  const events = (await eventsForApplication(applicationId)).filter((e) => !isClaim(e));
  const latest = latestRound(events);
  if (latest.state !== "held" || !latest.key) return { released: 0 };
  let released = 0;
  for (const r of events.filter((e) => e.applicationId === latest.key && e.kind === "reserve" && !isClaim(e))) {
    const inserted = await insertEvent({ userId: r.userId, lotId: r.lotId, applicationId: latest.key, kind: "release", amount: r.amount });
    if (!inserted) continue;
    await giveBackToLot(r.lotId, r.amount);
    released += r.amount;
  }
  return { released };
}

export interface GrantInput {
  userId: string;
  kind: LotKind;
  total: number;
  /** Idempotency key: checkout session id, `subscriptionId:periodStart`, `trial:<userId>`, `adjust:<userId>:<key>`. */
  sourceKey: string;
  expiresAt: Date | null;
  orderId?: string | null;
}

/** Creates a lot once per sourceKey. Returns the lot and whether this call created it. */
export async function grantLot(input: GrantInput): Promise<{ lot: Lot; created: boolean }> {
  if (!Number.isInteger(input.total) || input.total <= 0) throw new Error("a credit grant must be a positive whole number");
  if (!isCreditHolder(input.userId)) throw new Error("credits can only be granted to a signed-in account");
  const id = newId("lot");
  const inserted = await db
    .insert(creditLots)
    .values({
      id,
      userId: input.userId,
      kind: input.kind,
      total: input.total,
      remaining: input.total,
      status: "active",
      sourceKey: input.sourceKey,
      orderId: input.orderId ?? null,
      expiresAt: input.expiresAt,
    })
    .onConflictDoNothing({ target: creditLots.sourceKey })
    .returning();
  if (inserted[0]) {
    await insertEvent({ userId: input.userId, lotId: id, applicationId: null, kind: "grant", amount: input.total });
    return { lot: toLot(inserted[0]), created: true };
  }
  const rows = await db.select().from(creditLots).where(eq(creditLots.sourceKey, input.sourceKey)).limit(1);
  const existing = rows[0];
  if (!existing) throw new Error(`credit lot ${input.sourceKey} was not persisted`);
  if (existing.userId !== input.userId) throw new Error(`credit lot ${input.sourceKey} belongs to another account`);
  // The invoice webhook may land before the checkout session is recorded: link the lot to its order now.
  if (input.orderId && !existing.orderId) {
    await db.update(creditLots).set({ orderId: input.orderId }).where(and(eq(creditLots.id, existing.id), isNull(creditLots.orderId)));
  }
  return { lot: toLot(existing), created: false };
}

/** Refund or open dispute: the lot's unspent credits are gone. Applications already holding credits keep them. */
export async function revokeLot(sourceKey: string): Promise<{ revoked: number; userId: string } | null> {
  const rows = await db
    .update(creditLots)
    .set({ status: "revoked", remaining: 0 })
    .where(and(eq(creditLots.sourceKey, sourceKey), eq(creditLots.status, "active")))
    .returning({ id: creditLots.id, userId: creditLots.userId, total: creditLots.total });
  const row = rows[0];
  if (!row) return null;
  // What was lost is what the ledger says was still unspent (RETURNING shows the post-update row).
  const events = await db.select({ kind: creditEvents.kind, amount: creditEvents.amount }).from(creditEvents).where(eq(creditEvents.lotId, row.id));
  const remaining = remainingFromEvents(row.total, events.filter((e) => e.kind !== "grant" && e.kind !== "revoke"));
  await insertEvent({ userId: row.userId, lotId: row.id, applicationId: null, kind: "revoke", amount: remaining });
  return { revoked: remaining, userId: row.userId };
}

/** Dispute won: the lot comes back with whatever the ledger says is still unspent. */
export async function restoreLot(sourceKey: string): Promise<{ restored: number; userId: string } | null> {
  const rows = await db.select().from(creditLots).where(and(eq(creditLots.sourceKey, sourceKey), eq(creditLots.status, "revoked"))).limit(1);
  const lot = rows[0];
  if (!lot) return null;
  const events = await db.select({ kind: creditEvents.kind, amount: creditEvents.amount }).from(creditEvents).where(eq(creditEvents.lotId, lot.id));
  const remaining = remainingFromEvents(lot.total, events.filter((e) => e.kind !== "grant" && e.kind !== "revoke"));
  const updated = await db
    .update(creditLots)
    .set({ status: "active", remaining })
    .where(and(eq(creditLots.id, lot.id), eq(creditLots.status, "revoked")))
    .returning({ id: creditLots.id });
  if (!updated.length) return null;
  await insertEvent({ userId: lot.userId, lotId: lot.id, applicationId: null, kind: "grant", amount: remaining });
  return { restored: remaining, userId: lot.userId };
}

/** The free trial (TRIAL.credits for TRIAL.expiryDays) on the first sign-in. Idempotent per user. */
export async function grantTrial(userId: string): Promise<{ created: boolean }> {
  const { created } = await grantLot({ userId, kind: "trial", total: TRIAL.credits, sourceKey: trialSourceKey(userId), expiresAt: trialExpiry() });
  return { created };
}

/**
 * A manual adjustment (admin goodwill, a support fix). Idempotent per (user, key): the same key
 * never grants twice. `expiresInDays` null = never expires.
 */
export async function grantAdjustment(input: { userId: string; amount: number; key: string; expiresInDays?: number | null }): Promise<{ created: boolean; lotId: string }> {
  const days = input.expiresInDays === undefined ? 180 : input.expiresInDays;
  const { lot, created } = await grantLot({
    userId: input.userId,
    kind: "adjust",
    total: input.amount,
    sourceKey: adjustSourceKey(input.userId, input.key),
    expiresAt: days === null ? null : new Date(Date.now() + days * DAY_MS),
  });
  return { created, lotId: lot.id };
}

/** Applications that still hold credits, from the ledger (cannot drift from application status). */
export async function applicationsHoldingCredits(userId: string): Promise<string[]> {
  const rows = await db
    .select({ applicationId: creditEvents.applicationId, kind: creditEvents.kind })
    .from(creditEvents)
    .where(and(eq(creditEvents.userId, userId), inArray(creditEvents.kind, ["reserve", "debit", "release"]), ne(creditEvents.lotId, CLAIM_LOT)));
  const open = new Set<string>();
  const closed = new Set<string>();
  for (const r of rows) {
    if (!r.applicationId) continue;
    if (r.kind === "reserve") open.add(r.applicationId);
    else closed.add(r.applicationId);
  }
  // Keyed per round; only a held latest round counts, reported by application id.
  const held = new Set<string>();
  for (const key of open) if (!closed.has(key)) held.add(parseRoundKey(key).applicationId);
  return [...held];
}

/**
 * Every application (any person) whose latest reservation round is still held, oldest first —
 * the input of the daily credit reconciliation (`reconcileApplicationCredits`).
 */
export async function allApplicationsHoldingCredits(limit = 500): Promise<string[]> {
  // One row per reservation round key: held = it has a reserve and neither a debit nor a release.
  const rows = await db
    .select({ key: creditEvents.applicationId })
    .from(creditEvents)
    .where(and(inArray(creditEvents.kind, ["reserve", "debit", "release"]), ne(creditEvents.lotId, CLAIM_LOT), sql`${creditEvents.applicationId} is not null`))
    .groupBy(creditEvents.applicationId)
    .having(sql`bool_or(${creditEvents.kind} = 'reserve') and not bool_or(${creditEvents.kind} in ('debit', 'release'))`)
    .orderBy(sql`min(${creditEvents.createdAt})`)
    .limit(Math.max(1, Math.min(limit, 2000)));
  return [...new Set(rows.map((r) => (r.key ? parseRoundKey(r.key).applicationId : "")).filter(Boolean))];
}
