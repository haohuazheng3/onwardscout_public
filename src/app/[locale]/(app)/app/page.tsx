import { and, count, desc, eq, inArray, ne, notLike } from "drizzle-orm";
import { Activity, ArrowRight, Bell, FileUp, Save } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { FeedPane, NeedsYouPane, PipelinePane, type FeedItem, type NeedsYouItem } from "@/components/home/HomePanes";
import { PathHero } from "@/components/home/PathHero";
import { DeadlinesPane, GapsPane, OpenNowPane, PicksListPane, RoadmapPane, StandPane, ThisWeekPane, type CompactPick, type WeekStep } from "@/components/home/PlanPanes";
import { PicksRefresher } from "@/components/home/PicksRefresher";
import { PlanningPane } from "@/components/home/PlanningPane";
import { PracticePane } from "@/components/home/PracticePane";
import { ButtonLink, PageHeader } from "@/components/ui";
import { localizePath } from "@/i18n/paths";
import { routing } from "@/i18n/routing";
import { pipelineSummary } from "@/lib/applications";
import { db } from "@/lib/db";
import { applications, documents, events, opportunities } from "@/lib/db/schema";
import { captureError } from "@/lib/errors";
import { listNotifications } from "@/lib/notifications";
import { GAP_ACTIONS, LIFE_PATHS, type GapAction } from "@/lib/llm/types";
import { refreshState, topMatches } from "@/lib/opportunities";
import { readAnonId } from "@/lib/profile/anon";
import { directionCandidates, latestPlan, planCount } from "@/lib/profile/directions";
import { REPLANS, replansLeft } from "@/lib/profile/replans";
import { listGoals } from "@/lib/profile/goals";
import { getProfile, profileOf } from "@/lib/profile/store";
import { signInPath, withLocale } from "@/lib/site";
import { optionalUser } from "@/lib/user";
import { cookies } from "next/headers";
import { TIME_ZONE_COOKIE, timeZoneFrom } from "@/i18n/request";

type Props = { params: Promise<{ locale: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale: hasLocale(routing.locales, locale) ? locale : "en", namespace: "profile.home" });
  return { title: t("metaTitle") };
}

/** One section's data; a failure is logged and that pane says so, the rest of the page still renders. */
async function section<T>(name: string, run: () => Promise<T>): Promise<T | null> {
  try {
    return await run();
  } catch (err) {
    await captureError(err, { route: `/[locale]/app (home:${name})`, severity: "warn" });
    return null;
  }
}

const NEEDS_YOU = ["needs_info", "needs_you", "ready"] as const;

/** Where each gap's action is done: signed in on the profile and documents pages; signed out, uploads on /app/start, the rest after saving. */
function gapHref(action: GapAction, signedIn: boolean, saveHref: string): { href: string; external?: boolean } {
  const upload = action === "upload_resume" || action === "upload_deck";
  if (!signedIn) return upload ? { href: "/app/start?q=files" } : { href: saveHref, external: true };
  return { href: upload ? "/app/documents" : "/app/profile" };
}

/**
 * /app — the dashboard: the plan Onward Scout made (the path, the destination and why, the
 * compass of paths), this week's steps, the roadmap, where the person stands, what is open,
 * what would make them stronger, their best picks and the deadlines ahead; signed in, also what
 * needs them, the pipeline and activity. A visitor who finished onboarding signed out sees their
 * draft here too (no sign-up on the way in); saving it to an account is offered, never required.
 */
export default async function HomePage({ params, searchParams }: Props) {
  const { locale } = await params;
  // Straight from the questions: Onward Scout plans here first (PlanningPane), then this page reloads with the plan.
  const planning = (await searchParams).plan === "1";
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);
  const session = await optionalUser();
  const anonId = session ? null : await readAnonId();
  if (!session && !anonId) redirect(localizePath("/app/start", locale));
  const userId = session?.userId ?? anonId!;
  const signedIn = Boolean(session);
  const [t, format, jar] = await Promise.all([getTranslations({ locale, namespace: "profile.home" }), getFormatter({ locale }), cookies()]);
  // "Today" in the person's own time zone (remembered by TimeZoneCookie), not the server's UTC day.
  const timeZone = timeZoneFrom(jar.get(TIME_ZONE_COOKIE)?.value);

  const [row, docCount, goals, needsYou, appCount, picks, pipeline, notes, activity, refresh, stored, plans] = await Promise.all([
    getProfile(userId),
    section("documents", async () => Number((await db.select({ n: count() }).from(documents).where(eq(documents.userId, userId)))[0]?.n ?? 0)),
    section("goals", () => listGoals(userId, { onlyActive: true })),
    section("needs-you", () =>
      db
        .select({ id: applications.id, status: applications.status, reason: applications.needsYouReason, practice: applications.practice, name: opportunities.name, orgName: opportunities.orgName })
        .from(applications)
        .leftJoin(opportunities, eq(opportunities.id, applications.opportunityId))
        .where(and(eq(applications.userId, userId), inArray(applications.status, [...NEEDS_YOU])))
        .orderBy(desc(applications.updatedAt))
        .limit(6),
    ),
    section("applications", async () => Number((await db.select({ n: count() }).from(applications).where(eq(applications.userId, userId)))[0]?.n ?? 0)),
    // Thirty matches: the first five are the picks, all of them feed the deadline strip.
    section("picks", () => topMatches(userId, 30)),
    section("pipeline", () => pipelineSummary(userId)),
    section("notifications", () => listNotifications(userId, { limit: 6 })),
    section("activity", () =>
      db
        .select({ id: events.id, kind: events.kind, data: events.data, createdAt: events.createdAt, name: opportunities.name })
        .from(events)
        .leftJoin(opportunities, eq(opportunities.id, events.opportunityId))
        // Status moves, milestone markers and stored plans repeat what the named events and the plan pane already say.
        .where(and(eq(events.userId, userId), ne(events.kind, "application.status"), notLike(events.kind, "milestone.%"), notLike(events.kind, "plan.%")))
        .orderBy(desc(events.createdAt))
        .limit(8),
    ),
    section("refresh", () => refreshState(userId)),
    section("plan", () => latestPlan(userId)),
    section("plans", () => planCount(userId)),
  ]);

  const profile = row ? profileOf(row) : null;
  const isNew = !row || ((docCount ?? 0) === 0 && !profile?.roles.length && !(goals?.length ?? 0));
  const firstName = profile?.identity.name ? (locale === "zh" ? profile.identity.name : profile.identity.name.split(/\s+/)[0]) : null;
  const now = new Date();
  const plan = stored?.plan ?? null;
  // Live counts for the plan's directions (cached for a day, so this costs no extra database work most of the time).
  const candidates = plan && profile ? await section("open", () => directionCandidates(profile, locale)) : null;

  const pickItems: CompactPick[] | null = picks
    ? picks.slice(0, 5).map((m) => ({
        opportunityId: m.opportunity.id,
        goalId: m.goalId,
        type: m.opportunity.type,
        channel: m.opportunity.channel,
        name: m.opportunity.name,
        orgName: m.opportunity.orgName,
        deadline: m.opportunity.deadline,
        rolling: m.opportunity.rolling,
        fit: m.fit,
      }))
    : null;
  const deadlineItems = (picks ?? []).flatMap((m) => (m.opportunity.deadline ? [{ id: m.opportunity.id, name: m.opportunity.name, deadline: m.opportunity.deadline }] : []));

  const feedNotes: FeedItem[] | null = notes
    ? notes.map((n) => ({ id: n.id, title: n.title, body: n.body, href: n.href, when: format.relativeTime(new Date(n.createdAt), now), unread: !n.readAt }))
    : null;

  const needsYouItems: NeedsYouItem[] | null = needsYou
    ? needsYou.map((a) => ({ ...a, reason: a.reason && t.has(`needsYou.reasons.${a.reason}`) ? t(`needsYou.reasons.${a.reason}`) : null }))
    : null;

  const feedActivity: FeedItem[] | null = activity
    ? activity.map((e) => {
        const key = `events.${e.kind.replace(/[^a-zA-Z0-9_]/g, "_")}`;
        const label = t.has(key) ? t(key) : e.kind.replace(/[._]/g, " ").replace(/^\w/, (c) => c.toUpperCase());
        return { id: e.id, title: e.name ? `${label} · ${e.name}` : label, when: format.relativeTime(new Date(e.createdAt), now) };
      })
    : null;

  const saveHref = signInPath(locale, withLocale(locale, "/app"));
  const pickCount = pickItems?.length ?? 0;
  const steps: WeekStep[] = [
    { text: pickCount ? t("next.picksReady", { count: pickCount }) : refresh?.refreshing ? t("next.picksFinding") : t("next.picksNone") },
    { text: t("next.apply") },
    signedIn ? { text: t("next.keepGoing") } : { text: t("next.save"), href: saveHref, cta: t("save.cta"), external: true },
  ];
  const lead = goals?.[0] ?? null;
  const pathNames = Object.fromEntries(LIFE_PATHS.map((p) => [p, t(`plan.paths.${p}`)])) as Record<(typeof LIFE_PATHS)[number], string>;
  const openItems = plan
    ? plan.directions.flatMap((d) => {
        const c = candidates?.find((x) => x.id === d.id);
        return c ? [{ id: c.id, label: c.label, open: c.open }] : [];
      })
    : [];
  const gapItems = plan
    ? plan.gaps
        .filter((g) => (GAP_ACTIONS as readonly string[]).includes(g.action))
        .map((g) => ({ label: g.label, cta: t(`plan.gapCta.${g.action}`), ...gapHref(g.action, signedIn, saveHref) }))
    : [];

  return (
    <>
      <PageHeader
        eyebrow={t("eyebrow", { date: format.dateTime(now, { weekday: "long", month: "long", day: "numeric", timeZone }) })}
        title={firstName ? t("titleNamed", { name: firstName }) : t("title")}
        description={isNew ? t("ledeNew") : t("lede")}
        actions={
          isNew || !signedIn ? null : (
            <ButtonLink href="/app/scout" variant="ghost" size="sm" iconRight={<ArrowRight size={16} aria-hidden />}>
              {t("openScout")}
            </ButtonLink>
          )
        }
      />

      {refresh?.refreshing && !planning ? <PicksRefresher /> : null}

      {!signedIn ? (
        <section className="pane mb-4 min-w-0 p-4 sm:p-5" aria-labelledby="save-title">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-pine-soft text-pine">
              <Save size={18} aria-hidden />
            </span>
            <div className="min-w-0 flex-1 basis-56">
              <h2 id="save-title" className="title text-[1.05rem] text-ink">
                {t("save.title")}
              </h2>
              <p className="text-[0.9rem] leading-snug text-ink-3">{t("save.body", { bonus: REPLANS.accountBonus })}</p>
            </div>
            <ButtonLink href={saveHref} external size="sm" iconRight={<ArrowRight size={15} aria-hidden />}>
              {t("save.cta")}
            </ButtonLink>
          </div>
        </section>
      ) : null}

      {isNew && !planning ? (
        <section className="pane mb-4 min-w-0 p-6 sm:p-8" aria-labelledby="start-title">
          <div className="flex items-start gap-4">
            <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full bg-accent text-accent-ink">
              <FileUp size={22} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="start-title" className="title text-[1.35rem] text-ink">
                {t("start.title")}
              </h2>
              <p className="mt-1.5 max-w-xl text-[0.98rem] leading-relaxed text-ink-3">{t("start.body")}</p>
              <ButtonLink href="/app/start" className="mt-5" iconRight={<ArrowRight size={17} aria-hidden />}>
                {t("start.cta")}
              </ButtonLink>
            </div>
          </div>
        </section>
      ) : null}

      {planning ? (
        <PlanningPane signedIn={signedIn} locale={locale} />
      ) : isNew ? null : (
        <div className="grid gap-4 md:grid-flow-dense md:grid-cols-2 lg:grid-cols-3 [&>*]:min-w-0">
          {plan ? (
            <div className="md:col-span-2 lg:col-span-3">
              <PathHero
                signedIn={signedIn}
                locale={locale}
                path={plan.path}
                headline={plan.headline}
                reason={plan.pathReason}
                summary={plan.summary}
                scores={plan.pathScores}
                replans={{ left: replansLeft(plans ?? 1, signedIn), bonus: REPLANS.accountBonus, saveHref }}
                strings={{
                  eyebrow: t("plan.eyebrow", { months: plan.horizonMonths }),
                  change: t("plan.change"),
                  compass: t("plan.compass"),
                  current: t("plan.current"),
                  choose: t("plan.choose"),
                  planning: t("plan.planning"),
                  failed: t("plan.failed"),
                  footer: stored?.provider === "anthropic" ? t("plan.byAi") : t("plan.byRules"),
                  paths: pathNames,
                  left: t("plan.replans.left", { count: replansLeft(plans ?? 1, signedIn) }),
                  note: t("plan.replans.note"),
                  more: t("plan.replans.more", { bonus: REPLANS.accountBonus }),
                  hook: t("plan.replans.hook", { bonus: REPLANS.accountBonus }),
                  hookCta: t("plan.replans.hookCta"),
                  done: t("plan.replans.done"),
                }}
              />
            </div>
          ) : (
            <div className="md:col-span-2 lg:col-span-3">
              <PlanningPane signedIn={signedIn} locale={locale} manual />
            </div>
          )}

          <ThisWeekPane title={t("plan.week")} steps={steps} />

          {plan ? (
            <RoadmapPane
              className="md:col-span-2"
              stages={plan.roadmap}
              horizon={plan.horizonMonths}
              startedAt={stored!.createdAt}
              today={now}
              milestones={(lead?.milestones ?? []).map((m) => ({ id: m.id, title: m.title, target: m.target, progress: m.progress }))}
              strings={{
                title: t("plan.roadmap"),
                goal: lead?.successDefinition ?? null,
                tick: (d) => format.dateTime(d, { month: "short", timeZone }),
                span: (from, to) => t("plan.span", { from: format.dateTime(from, { month: "short", year: "numeric", timeZone }), to: format.dateTime(to, { month: "short", year: "numeric", timeZone }) }),
              }}
            />
          ) : null}

          {plan ? (
            <StandPane
              completeness={row?.completeness ?? 0}
              strengths={plan.strengths}
              {...(signedIn ? { improveHref: "/app/profile" } : { improveHref: saveHref, improveExternal: true })}
              strings={{ title: t("plan.stand"), profile: t("plan.profile"), profileBody: t("plan.profileBody"), improve: t("plan.improve"), ringLabel: t("plan.ringLabel", { value: Math.round(row?.completeness ?? 0) }) }}
            />
          ) : null}
          {openItems.length ? <OpenNowPane items={openItems} strings={{ title: t("plan.open"), note: t("plan.openNote"), count: (n) => t("plan.openCount", { count: n }) }} /> : null}
          {plan ? <GapsPane items={gapItems} strings={{ title: t("plan.gaps"), none: t("plan.gapsNone") }} /> : null}

          <PicksListPane
            className="md:col-span-2"
            items={pickItems}
            refreshing={Boolean(refresh?.refreshing)}
            locale={locale}
            strings={{
              title: t("picks.title"),
              all: t("picks.all"),
              empty: t("picks.empty"),
              emptyBody: t("picks.emptyBody"),
              finding: t("picks.finding"),
              updating: t("picks.updating"),
              error: t("sectionError"),
              fit: (fit: number) => t("picks.fit", { fit }),
              rolling: t("picks.rolling"),
              due: (iso: string) => t("picks.due", { date: format.dateTime(new Date(iso), { month: "short", day: "numeric", timeZone }) }),
            }}
          />
          <DeadlinesPane
            items={deadlineItems}
            today={now}
            strings={{
              title: t("plan.deadlines"),
              none: t("plan.deadlinesNone"),
              week: (d) => format.dateTime(d, { month: "numeric", day: "numeric", timeZone }),
              inDays: (n) => t("plan.inDays", { count: n }),
              more: (n) => t("plan.moreDeadlines", { count: n }),
            }}
          />

          {signedIn ? (
            <>
              <NeedsYouPane
                items={needsYouItems}
                locale={locale}
                strings={{ title: t("needsYou.title"), empty: t("needsYou.empty"), error: t("sectionError"), practice: t("needsYou.practice"), open: t("needsYou.open") }}
              />
              <PipelinePane counts={pipeline} locale={locale} strings={{ title: t("pipeline.title"), error: t("sectionError"), board: t("pipeline.board") }} />
              {appCount === 0 ? <PracticePane /> : null}
              <FeedPane id="notifications" icon={<Bell size={17} aria-hidden />} title={t("notifications.title")} items={feedNotes} empty={t("notifications.empty")} error={t("sectionError")} />
              <FeedPane id="activity" icon={<Activity size={17} aria-hidden />} title={t("activity.title")} items={feedActivity} empty={t("activity.empty")} error={t("sectionError")} />
            </>
          ) : null}
        </div>
      )}
    </>
  );
}
