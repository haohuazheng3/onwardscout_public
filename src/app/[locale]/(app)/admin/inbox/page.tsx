import { desc, eq } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { AdminTitle, EmptyRow, FilterPills, UserLink, ago, fmtDate, fmtInt, statusTone } from "@/components/admin/AdminUi";
import { Tag } from "@/components/ui";
import { db } from "@/lib/db";
import { inboxMessages } from "@/lib/db/schema";
import { adminLocale, one, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";

export const dynamic = "force-dynamic";

/** The first six-digit code in the subject or body (same rule as GET /api/inbox). */
function extractCode(subject: string | null, text: string | null): string | null {
  return /\b(\d{6})\b/.exec(`${subject ?? ""}\n${text ?? ""}`)?.[1] ?? null;
}

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

export default async function AdminInboxPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const raw = one(sp.kind);
  const kind = raw === "test" || raw === "reply" ? raw : null;
  const t = await getTranslations({ locale, namespace: "admin.inbox" });
  const rows = await db
    .select()
    .from(inboxMessages)
    .where(kind ? eq(inboxMessages.kind, kind) : undefined)
    .orderBy(desc(inboxMessages.receivedAt))
    .limit(100);

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} count={fmtInt(rows.length, locale)} lede={t("lede")} />
      <FilterPills
        label={t("title")}
        items={[
          { href: "/admin/inbox", label: t("kindAll"), active: !kind },
          { href: "/admin/inbox?kind=test", label: t("kindTest"), active: kind === "test" },
          { href: "/admin/inbox?kind=reply", label: t("kindReply"), active: kind === "reply" },
        ]}
      />
      {rows.length === 0 ? (
        <EmptyRow>{t("empty")}</EmptyRow>
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => {
            const code = extractCode(m.subject, m.textBody);
            const headerCount = m.headers ? Object.keys(m.headers).length : 0;
            return (
              <li key={m.id} className="pane p-5">
                <p className="flex flex-wrap items-center gap-2 text-[0.82rem] text-ink-3">
                  <Tag tone={statusTone(m.spf)}>SPF {m.spf ?? "?"}</Tag>
                  <Tag tone={statusTone(m.dkim)}>DKIM {m.dkim ?? "?"}</Tag>
                  <Tag tone={statusTone(m.dmarc)}>DMARC {m.dmarc ?? "?"}</Tag>
                  <Tag tone={m.kind === "reply" ? "pine" : "default"}>{m.kind}</Tag>
                  {code ? <Tag tone="accent">{t("code", { code })}</Tag> : null}
                  <span title={fmtDate(m.receivedAt, locale)}>{ago(m.receivedAt, locale)}</span>
                  <span>· {fmtBytes(m.rawSize)}</span>
                  {m.userId ? <UserLink id={m.userId} /> : null}
                </p>
                <p className="mt-2 break-words font-semibold text-ink">{m.subject ?? "(no subject)"}</p>
                <p className="break-all text-[0.85rem] text-ink-3">
                  {m.fromAddr} → {m.toAddr}
                </p>
                {m.textBody ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.82rem] text-ink-3">{t("body")}</summary>
                    <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-pane-2 p-3 text-[0.78rem] text-ink-3">{m.textBody}</pre>
                  </details>
                ) : null}
                {headerCount > 0 && m.headers ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[0.82rem] text-ink-3">{t("headers", { count: headerCount })}</summary>
                    <dl className="mt-2 max-h-72 overflow-auto rounded-xl bg-pane-2 p-3 text-[0.75rem] text-ink-3">
                      {Object.entries(m.headers).map(([k, v]) => (
                        <div key={k} className="break-all">
                          <dt className="inline font-semibold text-ink-2">{k}: </dt>
                          <dd className="inline">{v}</dd>
                        </div>
                      ))}
                    </dl>
                  </details>
                ) : null}
                {m.authResults ? <p className="mt-2 break-all text-[0.72rem] text-ink-4">{m.authResults}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
