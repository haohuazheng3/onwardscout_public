import { getTranslations } from "next-intl/server";
import { AdminTitle, Json, KeyValue, Section, ago } from "@/components/admin/AdminUi";
import { DiagnosticsDrills } from "@/components/admin/DiagnosticsDrills";
import { Tag } from "@/components/ui";
import { env, envProblems, features, REQUIRED_ENV, stripeKeyMode, VERCEL_ENV } from "@/lib/env";
import { SITE } from "@/lib/site";
import { adminLocale, appStateEntries, CRON_STATE_KEYS, lastRunOf, type LocaleParams, requireAdminOnce } from "../_lib/data";

export const dynamic = "force-dynamic";

/** Optional variables worth seeing at a glance: names and presence only, never values. */
const OPTIONAL_ENV = [
  "ANTHROPIC_API_KEY",
  "LLM_PROVIDER",
  "LLM_USER_MONTHLY_CENTS",
  "RESEND_API_KEY",
  "MAIL_FROM",
  "GOOGLE_OAUTH_CLIENT_ID",
  "GOOGLE_OAUTH_CLIENT_SECRET",
  "BROWSER_AGENT_ENABLED",
  "GITHUB_WEBHOOK_SECRET",
  "VERCEL_DEPLOY_HOOK_URL",
  "SITE_INDEXABLE",
  "NEXT_PUBLIC_SITE_URL",
  "INDEXNOW_KEY",
  "STRIPE_PORTAL_CONFIG",
  "ALLOW_LIVE_CHECKOUT_NONPROD",
  "FLOWGLANCE_SITE_ID",
] as const;

function Presence({ name, set, unset }: { name: string; set: string; unset: string }) {
  const present = Boolean(env(name));
  return (
    <li className="flex items-center justify-between gap-3 py-1.5">
      <code className="break-all font-mono text-[0.82rem] text-ink-2">{name}</code>
      <Tag tone={present ? "ok" : "default"}>{present ? set : unset}</Tag>
    </li>
  );
}

export default async function AdminDiagnosticsPage({ params }: { params: LocaleParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const t = await getTranslations({ locale, namespace: "admin.diagnostics" });
  const to = await getTranslations({ locale, namespace: "admin.overview" });
  const state = await appStateEntries(Object.values(CRON_STATE_KEYS));
  const f = features();
  const problems = envProblems();
  const mode = stripeKeyMode();
  const filesReady = Boolean(env("FILES_BASE_URL") && env("FILES_API_TOKEN") && env("FILES_SIGNING_SECRET"));
  const mailReady = Boolean(env("MAIL_WORKER_URL") && env("MAIL_WORKER_TOKEN"));
  const onOff = (v: boolean) => <Tag tone={v ? "ok" : "default"}>{v ? t("on") : t("off")}</Tag>;
  const cfg = (v: boolean) => <Tag tone={v ? "ok" : "bad"}>{v ? t("configured") : t("notConfigured")}</Tag>;

  const crons: { key: keyof typeof CRON_STATE_KEYS; label: string }[] = [
    { key: "jobs", label: to("cronJobs") },
    { key: "digest", label: to("cronDigest") },
    { key: "followups", label: to("cronFollowups") },
    { key: "expire", label: to("cronExpire") },
    { key: "sources", label: to("cronSources") },
    { key: "reconcile", label: to("cronReconcile") },
  ];

  return (
    <div className="space-y-6">
      <AdminTitle title={t("title")} lede={t("lede")} />

      <section className="space-y-3">
        <h2 className="eyebrow">{t("drills")}</h2>
        <DiagnosticsDrills include={["throw", "client", "resolve", "ping-mail", "ping-files", "owner-alert", "notify-test", "digest-test"]} />
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={t("features")}>
          <KeyValue
            rows={[
              { label: t("deployment"), value: <Tag>{VERCEL_ENV}</Tag> },
              { label: t("siteUrl"), value: <code className="break-all font-mono text-[0.82rem]">{SITE.url}</code> },
              {
                label: t("provider"),
                value: (
                  <span className="inline-flex flex-wrap items-center justify-end gap-2">
                    <Tag tone={f.llmProvider === "anthropic" ? "ok" : f.llmProvider === "local" ? "pine" : "warn"}>{f.llmProvider}</Tag>
                    <span className="text-[0.8rem] text-ink-4">{t("providerRequested", { value: env("LLM_PROVIDER") ?? "—" })}</span>
                  </span>
                ),
              },
              { label: t("stripe"), value: <Tag tone={mode === "live" ? "ok" : mode === "test" ? "warn" : "bad"}>{mode}</Tag> },
              { label: t("mailer"), value: onOff(f.mailer) },
              { label: t("gmail"), value: onOff(f.gmail) },
              { label: t("browser"), value: onOff(f.browserAgent) },
              { label: t("files"), value: cfg(filesReady) },
              { label: t("mail"), value: cfg(mailReady) },
              {
                label: t("required"),
                value: problems.missing.length ? (
                  <span className="break-words text-bad">{t("missing", { list: problems.missing.join(", ") })}</span>
                ) : (
                  <Tag tone="ok">{t("allPresent", { count: REQUIRED_ENV.length })}</Tag>
                ),
              },
              ...problems.invalid.map((p) => ({ label: p.name, value: <span className="text-bad">{p.reason}</span> })),
            ]}
          />
        </Section>

        <Section title={t("scheduled")}>
          <ul className="divide-y divide-[var(--line)]">
            {crons.map((c) => {
              const entry = state.get(CRON_STATE_KEYS[c.key]);
              const at = lastRunOf(entry);
              return (
                <li key={c.key} className="py-2.5">
                  <div className="flex items-center justify-between gap-3 text-[0.9rem]">
                    <span className="text-ink-2">{c.label}</span>
                    <span className={at ? "text-ink" : "text-ink-4"}>{at ? ago(at, locale) : t("neverRan")}</span>
                  </div>
                  {entry ? (
                    <details className="mt-1">
                      <summary className="cursor-pointer text-[0.8rem] text-ink-4">{CRON_STATE_KEYS[c.key]}</summary>
                      <div className="mt-1.5">
                        <Json value={entry.value} max="max-h-48" />
                      </div>
                    </details>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </Section>

        <Section title={t("required")}>
          <ul className="divide-y divide-[var(--line)]">
            {REQUIRED_ENV.map((n) => (
              <Presence key={n} name={n} set={t("set")} unset={t("unset")} />
            ))}
          </ul>
        </Section>

        <Section title={t("optional")}>
          <ul className="divide-y divide-[var(--line)]">
            {OPTIONAL_ENV.map((n) => (
              <Presence key={n} name={n} set={t("set")} unset={t("unset")} />
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
