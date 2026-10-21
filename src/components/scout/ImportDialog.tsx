"use client";

import { Link2 } from "lucide-react";
import { useTranslations } from "next-intl";
import { useEffect, useState, type FormEvent } from "react";
import { Button, Field, Input, fieldDescribedBy } from "@/components/ui";
import { Dialog } from "@/components/ui-client";

/**
 * "Add an opportunity you found": paste a link. The dialog closes the moment it is sent; the
 * board shows a reading placeholder on top until the opportunity lands (or a toast says why not).
 */
export function ImportDialog({ open, onClose, initialUrl, onSubmit }: { open: boolean; onClose: () => void; initialUrl: string; onSubmit: (url: string) => void }) {
  const t = useTranslations("scout.import");
  const [url, setUrl] = useState(initialUrl);
  const [error, setError] = useState<string | null>(null);

  const [lastOpen, setLastOpen] = useState(open);
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setUrl(initialUrl);
      setError(null);
    }
  }

  useEffect(() => {
    if (!open) return;
    const id = window.setTimeout(() => document.getElementById("scout-import-url")?.focus(), 60);
    return () => window.clearTimeout(id);
  }, [open]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const value = url.trim();
    if (value.length < 4 || !/[a-z0-9-]\.[a-z]{2,}/i.test(value)) {
      setError(t("invalid"));
      return;
    }
    onSubmit(value);
  }

  return (
    <Dialog open={open} onClose={onClose} title={t("title")} description={t("description")}>
      <form onSubmit={submit} noValidate className="grid gap-4">
        <Field id="scout-import-url" label={t("label")} hint={t("hint")} error={error ?? undefined}>
          <Input
            id="scout-import-url"
            type="url"
            inputMode="url"
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="https://"
            value={url}
            invalid={Boolean(error)}
            aria-describedby={fieldDescribedBy("scout-import-url", { hint: t("hint"), error: error ?? undefined })}
            onChange={(e) => {
              setUrl(e.target.value);
              if (error) setError(null);
            }}
          />
        </Field>
        <p className="text-[0.86rem] leading-relaxed text-ink-3">{t("privacy")}</p>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button type="submit" variant="primary" icon={<Link2 size={16} aria-hidden />}>
            {t("submit")}
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
