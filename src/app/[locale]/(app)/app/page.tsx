import { and, count, desc, eq, inArray, ne, notLike } from "drizzle-orm";
import { Activity, ArrowRight, Bell, FileUp, Save } from "lucide-react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { hasLocale } from "next-intl";
import { getFormatter, getTranslations, setRequestLocale } from "next-intl/server";
import { DirectionPane, NextStepsPane } from "@/components/home/DirectionPanes";
import { FeedPane, NeedsYouPane, PicksPane, PipelinePane, type FeedItem, type NeedsYouItem, type PickItem } from "@/components/home/HomePanes";
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
import { profileSummary } from "@/lib/llm/local/directions";
import { refreshState, topMatches } from "@/lib/opportunities";
import { readAnonId } from "@/lib/profile/anon";
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

/**
 * /app — the dashboard: where the person is heading and why, what happens next, what needs them,
 * their picks, the pipeline, activity. A visitor who finished onboarding signed out sees their
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

  const [row, docCount, goals, needsYou, appCount, picks, pipeline, notes, activity, refresh] = await Promise.all([
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
    section("picks", () => topMatches(userId, 5)),
    section("pipeline", () => pipelineSummary(userId)),
    section("notifications", () => listNotifications(userId, { limit: 6 })),
    section("activity", () =>
      db
        .select({ id: events.id, kind: events.kind, data: events.data, createdAt: events.createdAt, name: opportunities.name })
        .from(events)
        .leftJoin(opportunities, eq(opportunities.id, events.opportunityId))
        // Status moves and milestone markers repeat what the named events already say.
        .where(and(eq(events.userId, userId), ne(events.kind, "application.status"), notLike(events.kind, "milestone.%")))
        .orderBy(desc(events.createdAt))
        .limit(8),
    ),
    section("refresh", () => refreshState(userId)),
  ]);

  const profile = row ? profileOf(row) : null;
  const isNew = !row || ((docCount ?? 0) === 0 && !profile?.roles.length && !(goals?.length ?? 0));
  const firstName = profile?.identity.name ? (locale === "zh" ? profile.identity.name : profile.identity.name.split(/\s+/)[0]) : null;
  const goal = goals?.[0] ?? null;
  const now = new Date();

  const pickItems: PickItem[] | null = picks
    ? picks.map((m) => ({
        opportunityId: m.opportunity.id,
        goalId: m.goalId,
        type: m.opportunity.type,
        channel: m.opportunity.channel,
        name: m.opportunity.name,
        orgName: m.opportunity.orgName,
        deadline: m.opportunity.deadline,
        rolling: m.opportunity.rolling,
        fit: m.fit,
        reason: m.reasons[0] ?? null,
        isNew: m.isNew,
      }))
    : null;

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
  const steps = [
    { text: pickCount ? t("next.picksReady", { count: pickCount }) : refresh?.refreshing ? t("next.picksFinding") : t("next.picksNone") },
    { text: t("next.apply") },
    signedIn ? { text: t("next.keepGoing") } : { text: t("next.save"), href: saveHref, cta: t("save.cta"), external: true },
  ];
  const directionGoals = (goals ?? []).map((g) => ({
    id: g.id,
    label: g.label,
    successDefinition: g.successDefinition,
    rationale: g.constraints.rationale ?? null,
    milestones: g.milestones.map((m) => ({ id: m.id, title: m.title, target: m.target, progress: m.progress })),
  }));

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

      {refresh?.refreshing && !pickCount && !planning ? <PicksRefresher /> : null}

      {!signedIn ? (
        <section className="pane mb-4 min-w-0 p-5 sm:p-6" aria-labelledby="save-title">
          <div className="flex items-start gap-4">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-pine-soft text-pine">
              <Save size={20} aria-hidden />
            </span>
            <div className="min-w-0">
              <h2 id="save-title" className="title text-[1.15rem] text-ink">
                {t("save.title")}
              </h2>
              <p className="mt-1 max-w-xl text-[0.95rem] leading-relaxed text-ink-3">{t("save.body")}</p>
              <ButtonLink href={saveHref} external size="sm" className="mt-3.5" iconRight={<ArrowRight size={15} aria-hidden />}>
                {t("save.cta")}
              </ButtonLink>
            </div>
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
      ) : (
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)] [&>*]:min-w-0">
        <div className="grid content-start gap-4">
          <DirectionPane
            summary={profile && directionGoals.length ? profileSummary(profile, locale) : null}
            goals={directionGoals}
            strings={{ eyebrow: t("direction.eyebrow"), change: t("direction.change"), empty: t("hero.empty"), emptyBody: t("hero.emptyBody"), start: t("hero.set"), also: t("direction.also") }}
          />
          {directionGoals.length ? <NextStepsPane title={t("next.title")} steps={steps} /> : null}
          {signedIn ? (
            <NeedsYouPane
              items={needsYouItems}
              locale={locale}
              strings={{ title: t("needsYou.title"), empty: t("needsYou.empty"), error: t("sectionError"), practice: t("needsYou.practice"), open: t("needsYou.open") }}
            />
          ) : null}
          <PicksPane
            items={pickItems}
            locale={locale}
            strings={{
              title: t("picks.title"),
              all: t("picks.all"),
              empty: refresh?.refreshing ? t("picks.finding") : t("picks.empty"),
              emptyBody: refresh?.refreshing ? t("picks.findingBody") : goal ? t("picks.emptyBody") : t("picks.emptyNoGoal"),
              error: t("sectionError"),
              fit: (fit: number) => t("picks.fit", { fit }),
              rolling: t("picks.rolling"),
              due: (iso: string) => t("picks.due", { date: format.dateTime(new Date(iso), { month: "short", day: "numeric" }) }),
              isNew: t("picks.new"),
              scout: t("picks.scout"),
            }}
          />
        </div>
        {signedIn ? (
          <div className="grid content-start gap-4">
            <PipelinePane counts={pipeline} locale={locale} strings={{ title: t("pipeline.title"), error: t("sectionError"), board: t("pipeline.board") }} />
            {appCount === 0 ? <PracticePane /> : null}
            <FeedPane id="notifications" icon={<Bell size={17} aria-hidden />} title={t("notifications.title")} items={feedNotes} empty={t("notifications.empty")} error={t("sectionError")} />
            <FeedPane id="activity" icon={<Activity size={17} aria-hidden />} title={t("activity.title")} items={feedActivity} empty={t("activity.empty")} error={t("sectionError")} />
          </div>
        ) : null}
      </div>
      )}
    </>
  );
}
