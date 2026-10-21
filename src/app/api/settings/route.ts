import { z } from "zod";
import {
  AUTO_SUBMIT_GROUPS,
  getAuthorizationState,
  getNotificationPrefs,
  planPerks,
  PREF_KEYS,
  setAutoSubmitGroup,
  setNotificationPref,
  setStandingScope,
  type AuthorizationState,
  type NotificationPrefs,
} from "@/lib/authorizations";
import { features } from "@/lib/env";
import { jsonError, withErrorCapture } from "@/lib/errors";
import { LOCALE_COOKIE } from "@/i18n/routing";
import { recordEvent } from "@/lib/notifications";
import { rateLimit, tooMany } from "@/lib/ratelimit";
import { ensureUser, isResponse, requireUserApi, setUserLocale } from "@/lib/user";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" } as const;

/*
 * Settings writes (P6). One endpoint, one change per request, each idempotent:
 *   { type: "locale", locale }                         → users.locale + NEXT_LOCALE cookie
 *   { type: "autoSubmit", group, enabled }             → auto_submit:<every type of the group>
 *   { type: "scope", scope: auto_followup|weekly_digest, enabled }
 *   { type: "pref", key: emailUpdates|emailDigest, enabled }
 * Every answer carries the whole settings state, so the client can align after its optimistic flip.
 */

const Body = z.discriminatedUnion("type", [
  z.object({ type: z.literal("locale"), locale: z.enum(["en", "zh"]) }),
  z.object({ type: z.literal("autoSubmit"), group: z.enum(AUTO_SUBMIT_GROUPS), enabled: z.boolean() }),
  z.object({ type: z.literal("scope"), scope: z.enum(["auto_followup", "weekly_digest"]), enabled: z.boolean() }),
  z.object({ type: z.literal("pref"), key: z.enum(PREF_KEYS), enabled: z.boolean() }),
]);

export interface SettingsPayload {
  locale: "en" | "zh";
  authorizations: AuthorizationState;
  prefs: NotificationPrefs;
  perks: { autoFollowUps: boolean; weeklyDigest: boolean };
  mailer: boolean;
}

async function state(userId: string, locale: "en" | "zh"): Promise<SettingsPayload> {
  const [authorizations, prefs, perks] = await Promise.all([getAuthorizationState(userId), getNotificationPrefs(userId), planPerks(userId)]);
  return { locale, authorizations, prefs, perks: { autoFollowUps: perks.autoFollowUps, weeklyDigest: perks.weeklyDigest }, mailer: features().mailer };
}

export const GET = withErrorCapture("/api/settings", async () => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const row = await ensureUser(session);
  return Response.json(await state(session.userId, row.locale === "zh" ? "zh" : "en"), { headers: NO_STORE });
});

function localeCookie(locale: "en" | "zh", secure: boolean): string {
  return `${LOCALE_COOKIE}=${locale}; Path=/; Max-Age=${60 * 60 * 24 * 365}; SameSite=Lax${secure ? "; Secure" : ""}`;
}

export const PATCH = withErrorCapture("/api/settings", async (req: Request) => {
  const session = await requireUserApi();
  if (isResponse(session)) return session;
  const rl = await rateLimit(`settings:write:${session.userId}`, 60, 60);
  if (!rl.ok) return tooMany(rl);
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("That change is not valid. Reload the page and try again.", 400);
  const change = parsed.data;
  const row = await ensureUser(session);
  let locale: "en" | "zh" = row.locale === "zh" ? "zh" : "en";
  const headers = new Headers(NO_STORE);

  switch (change.type) {
    case "locale":
      await setUserLocale(session.userId, change.locale);
      locale = change.locale;
      headers.append("Set-Cookie", localeCookie(change.locale, new URL(req.url).protocol === "https:"));
      break;
    case "autoSubmit":
      await setAutoSubmitGroup(session.userId, change.group, change.enabled);
      await recordEvent({ userId: session.userId, kind: change.enabled ? "authorization.granted" : "authorization.revoked", data: { scope: `auto_submit:${change.group}` } });
      break;
    case "scope":
      await setStandingScope(session.userId, change.scope, change.enabled);
      await recordEvent({ userId: session.userId, kind: change.enabled ? "authorization.granted" : "authorization.revoked", data: { scope: change.scope } });
      break;
    case "pref":
      await setNotificationPref(session.userId, change.key, change.enabled);
      break;
  }
  return Response.json(await state(session.userId, locale), { headers });
});
