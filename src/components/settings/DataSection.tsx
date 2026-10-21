"use client";

import { useClerk } from "@clerk/nextjs";
import { Database, Download, Trash2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Button, Field, Input, Pane, fieldDescribedBy } from "@/components/ui";
import { Dialog, toast } from "@/components/ui-client";
import { localizePath } from "@/i18n/paths";
import type { Locale } from "@/i18n/routing";

/*
 * "Your data": the JSON export and account deletion. Both buttons react on press (spinner,
 * aria-busy); a failure leaves everything as it was and says why in a toast. Deletion needs the
 * word DELETE typed into the dialog, then signs out and lands on the home page.
 */

const CONFIRM_WORD = "DELETE";

function filenameFrom(disposition: string | null): string {
  return /filename="([^"]+)"/.exec(disposition ?? "")?.[1] ?? "onward-scout-data.json";
}

export function DataSection({ locale }: { locale: Locale }) {
  const t = useTranslations("settings.data");
  const tc = useTranslations("common");
  const { signOut } = useClerk();
  const [exporting, setExporting] = useState(false);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);

  async function exportData() {
    if (exporting) return;
    setExporting(true);
    try {
      const res = await fetch("/api/settings/export", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error(((await res.json().catch(() => null)) as { error?: string } | null)?.error ?? tc("errors.generic"));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filenameFrom(res.headers.get("Content-Disposition"));
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast.success(t("exported"));
    } catch (err) {
      toast.error(t("exportFailed"), { body: err instanceof Error ? err.message : undefined });
    } finally {
      setExporting(false);
    }
  }

  async function deleteAccount() {
    if (deleting || typed !== CONFIRM_WORD) return;
    setDeleting(true);
    try {
      const res = await fetch("/api/settings/delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: typed }),
      });
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(data?.error ?? tc("errors.generic"));
      toast.success(t("deleted"));
      const home = localizePath("/", locale);
      try {
        await signOut({ redirectUrl: home });
      } catch (err) {
        // The Clerk user is already gone, so its session may refuse a clean sign-out: leave anyway.
        console.warn("[settings] sign-out after deletion", err);
        window.location.assign(home);
      }
    } catch (err) {
      setDeleting(false);
      toast.error(t("deleteFailed"), { body: err instanceof Error ? err.message : undefined });
    }
  }

  const hint = t("typeHint");

  return (
    <Pane as="section" id="data" pad="md" className="scroll-mt-28">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid h-10 w-10 shrink-0 place-items-center rounded-[14px] bg-pine-soft text-pine" aria-hidden="true">
          <Database size={19} />
        </span>
        <h2 className="title min-w-0 text-[1.25rem] text-ink">{t("title")}</h2>
      </div>

      <div className="pane-inset mt-5 px-4 py-5 sm:px-5">
        <h3 className="font-semibold text-ink">{t("exportTitle")}</h3>
        <p className="mt-1 text-[0.92rem] leading-relaxed text-ink-3">{t("exportBody")}</p>
        <Button variant="ghost" size="sm" className="mt-4" icon={<Download size={16} aria-hidden />} loading={exporting} onClick={() => void exportData()}>
          {exporting ? t("exporting") : t("exportButton")}
        </Button>
      </div>

      <div className="mt-4 rounded-[var(--radius-inner)] px-4 py-5 shadow-[inset_0_0_0_1px_color-mix(in_oklab,var(--bad)_30%,transparent)] sm:px-5">
        <h3 className="font-semibold text-ink">{t("deleteTitle")}</h3>
        <p className="mt-1 text-[0.92rem] leading-relaxed text-ink-3">{t("deleteBody")}</p>
        <Button
          variant="danger"
          size="sm"
          className="mt-4"
          icon={<Trash2 size={16} aria-hidden />}
          onClick={() => {
            setTyped("");
            setOpen(true);
          }}
        >
          {t("deleteButton")}
        </Button>
      </div>

      <Dialog
        open={open}
        onClose={() => (deleting ? undefined : setOpen(false))}
        title={t("dialogTitle")}
        description={t("dialogBody")}
        footer={
          <>
            <Button variant="quiet" onClick={() => setOpen(false)} disabled={deleting}>
              {tc("buttons.cancel")}
            </Button>
            <Button variant="danger" loading={deleting} disabled={typed !== CONFIRM_WORD} onClick={() => void deleteAccount()}>
              {deleting ? t("deleting") : t("confirmButton")}
            </Button>
          </>
        }
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void deleteAccount();
          }}
        >
          <Field id="delete-confirm" label={t("typeLabel")} hint={hint}>
            <Input
              id="delete-confirm"
              value={typed}
              onChange={(e) => setTyped(e.currentTarget.value.trim())}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              aria-describedby={fieldDescribedBy("delete-confirm", { hint })}
              placeholder={CONFIRM_WORD}
            />
          </Field>
        </form>
      </Dialog>
    </Pane>
  );
}
