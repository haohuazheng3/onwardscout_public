"use client";

import { History, RotateCcw } from "lucide-react";
import { useFormatter, useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Tag } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { useRouter } from "@/i18n/navigation";
import { api } from "@/components/onboarding/api";

/*
 * Profile versions: every extraction, confirmation and restore starts one. "Restore" brings
 * an earlier one back as the newest (nothing is deleted).
 */

export interface VersionItem {
  version: number;
  createdAt: string;
  counts: { experience: number; education: number; skills: number; roles: number };
}

export function VersionsPanel({ current, versions }: { current: number; versions: VersionItem[] }) {
  const t = useTranslations("profile.versions");
  const tc = useTranslations("common");
  const format = useFormatter();
  const router = useRouter();
  const [confirming, setConfirming] = useState<VersionItem | null>(null);
  const [busy, setBusy] = useState(false);

  async function restore(v: VersionItem) {
    setBusy(true);
    try {
      const res = await api<{ version: number }>("/api/profile/restore", { method: "POST", json: { version: v.version } }, { network: tc("errors.network"), generic: tc("errors.generic") });
      toast.success(t("restored", { version: v.version, now: res.version }));
      setConfirming(null);
      router.refresh();
    } catch (err) {
      toast.error(tc("errors.rolledBack"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="pane min-w-0 p-5 sm:p-7" aria-labelledby="versions-title">
      <div className="flex items-center gap-2.5">
        <span className="grid h-9 w-9 place-items-center rounded-full bg-pane-2 text-ink-2 shadow-[inset_0_0_0_1px_var(--line)]">
          <History size={17} aria-hidden />
        </span>
        <h2 id="versions-title" className="title text-[1.18rem] text-ink">
          {t("title")}
        </h2>
      </div>
      <p className="mt-2 text-[0.9rem] text-ink-3">{t("lede")}</p>
      {versions.length ? (
        <ul className="mt-4 divide-y divide-[var(--line)]">
          {versions.map((v) => (
            <li key={v.version} className="flex min-w-0 items-center gap-3 py-3">
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-2 text-[0.95rem] font-medium text-ink">
                  {t("version", { version: v.version })}
                  {v.version === current ? <Tag tone="pine">{t("current")}</Tag> : null}
                </p>
                <p className="mt-0.5 truncate text-[0.84rem] text-ink-3">
                  {format.dateTime(new Date(v.createdAt), { dateStyle: "medium", timeStyle: "short" })} · {t("summary", { roles: v.counts.experience, schools: v.counts.education, skills: v.counts.skills })}
                </p>
              </div>
              {v.version !== current ? (
                <Button variant="quiet" size="sm" icon={<RotateCcw size={15} aria-hidden />} onClick={() => setConfirming(v)}>
                  {t("restore")}
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-4 text-[0.92rem] text-ink-4">{t("none")}</p>
      )}
      <Dialog
        open={Boolean(confirming)}
        onClose={() => setConfirming(null)}
        title={t("confirmTitle", { version: confirming?.version ?? 0 })}
        description={t("confirmBody")}
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirming(null)}>
              {tc("buttons.cancel")}
            </Button>
            <Button loading={busy} onClick={() => confirming && void restore(confirming)}>
              {t("restore")}
            </Button>
          </>
        }
      />
    </section>
  );
}
