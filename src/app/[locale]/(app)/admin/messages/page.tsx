import { desc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { SubmitButton } from "@/components/admin/AdminClient";
import { AdminTitle, EmptyRow, StatusTag, UserLink, ago, fmtDate, fmtInt } from "@/components/admin/AdminUi";
import { Tag, cx } from "@/components/ui";
import { db } from "@/lib/db";
import { contactMessages } from "@/lib/db/schema";
import { SITE } from "@/lib/site";
import { setMessageStatusAction } from "../actions";
import { adminLocale, type LocaleParams, type SearchParams, requireAdminOnce } from "../_lib/data";
import { AdminNotice } from "../_lib/notice";

export const dynamic = "force-dynamic";

function replyHref(email: string, name: string | null): string {
  const subject = `Re: your message to ${SITE.name}`;
  const greeting = name ? `Hi ${name.split(/\s+/)[0]},` : "Hi,";
  return `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(`${greeting}\n\n`)}`;
}

export default async function AdminMessagesPage({ params, searchParams }: { params: LocaleParams; searchParams: SearchParams }) {
  const locale = await adminLocale(params);
  await requireAdminOnce();
  const sp = await searchParams;
  const t = await getTranslations({ locale, namespace: "admin.messages" });
  const rows = await db.select().from(contactMessages).orderBy(desc(contactMessages.createdAt)).limit(200);
  const unanswered = rows.filter((m) => m.status === "new").length;
  const path = "/admin/messages";

  const action = (id: string, status: "new" | "replied" | "archived", label: string, variant: "primary" | "ghost" | "quiet") => (
    <form action={setMessageStatusAction}>
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="path" value={path} />
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant={variant}>{label}</SubmitButton>
    </form>
  );

  return (
    <div className="space-y-5">
      <AdminTitle title={t("title")} count={fmtInt(unanswered, locale)} lede={`${t("lede")} ${SITE.replyTime}`} />
      <AdminNotice sp={sp} locale={locale} />
      {rows.length === 0 ? (
        <EmptyRow>{t("empty")}</EmptyRow>
      ) : (
        <ul className="space-y-3">
          {rows.map((m) => (
            <li key={m.id} className={cx("pane p-5", m.status === "archived" && "opacity-60")}>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2 text-[0.82rem] text-ink-4">
                    <StatusTag status={m.status} />
                    <Tag>{m.topic}</Tag>
                    {m.locale ? <Tag>{m.locale}</Tag> : null}
                    <span title={fmtDate(m.createdAt, locale)}>{ago(m.createdAt, locale)}</span>
                    <span>· {m.notified ? t("ownerEmailed") : t("ownerNotEmailed")}</span>
                  </p>
                  <p className="mt-2 break-words font-semibold text-ink">
                    {m.name ? `${m.name} · ` : ""}
                    <a className="text-accent-text underline-offset-2 hover:underline" href={replyHref(m.email, m.name)}>
                      {m.email}
                    </a>
                    {m.userId ? (
                      <span className="ml-2 font-normal text-ink-4">
                        {t("signedIn")} <UserLink id={m.userId} />
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-[0.95rem] leading-relaxed text-ink-2">{m.message}</p>
                </div>
                <div className="flex shrink-0 flex-wrap gap-2 sm:flex-col">
                  {m.status !== "replied" ? action(m.id, "replied", t("replied"), "primary") : null}
                  {m.status !== "archived" ? action(m.id, "archived", t("archive"), "ghost") : action(m.id, "new", t("reopen"), "quiet")}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
