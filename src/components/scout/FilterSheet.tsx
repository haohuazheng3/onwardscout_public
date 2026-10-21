"use client";

import { useLocale, useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { DEADLINE_WINDOWS, EFFORT_FILTERS, REMOTE_FILTERS, type BoardFilters } from "@/lib/opportunities/filters";
import { countryLabel } from "@/lib/opportunities/present";
import { Button, Chip } from "@/components/ui";
import { Dialog } from "@/components/ui-client";

function Group({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <fieldset className="min-w-0">
      <legend className="text-[0.95rem] font-semibold text-ink">{title}</legend>
      {hint ? <p className="mt-0.5 text-[0.84rem] text-ink-3">{hint}</p> : null}
      <div className="mt-3 flex flex-wrap gap-2">{children}</div>
    </fieldset>
  );
}

/**
 * Remote, region, deadline and time filters. Every chip applies at once (the board reloads
 * behind the sheet with skeleton panes); "Done" only closes it.
 */
export function FilterSheet({
  open,
  onClose,
  filters,
  regions,
  onChange,
  onClear,
}: {
  open: boolean;
  onClose: () => void;
  filters: BoardFilters;
  regions: string[];
  onChange: (patch: Partial<BoardFilters>) => void;
  onClear: () => void;
}) {
  const t = useTranslations("scout.filters");
  const locale = useLocale();
  const regionList = filters.country && !regions.includes(filters.country) ? [filters.country, ...regions] : regions;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={t("title")}
      description={t("description")}
      footer={
        <>
          <Button variant="ghost" onClick={onClear}>
            {t("clear")}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t("done")}
          </Button>
        </>
      }
    >
      <div className="grid gap-6">
        <Group title={t("remote.title")}>
          <Chip size="sm" selected={!filters.remote} onClick={() => onChange({ remote: null })}>
            {t("remote.any")}
          </Chip>
          {REMOTE_FILTERS.map((r) => (
            <Chip key={r} size="sm" selected={filters.remote === r} onClick={() => onChange({ remote: filters.remote === r ? null : r })}>
              {t(`remote.${r}`)}
            </Chip>
          ))}
        </Group>

        <Group title={t("region.title")} hint={regionList.length ? t("region.hint") : t("region.empty")}>
          <Chip size="sm" selected={!filters.country} onClick={() => onChange({ country: null })}>
            {t("region.any")}
          </Chip>
          {regionList.map((c) => (
            <Chip key={c} size="sm" selected={filters.country === c} onClick={() => onChange({ country: filters.country === c ? null : c })}>
              {countryLabel(c, locale)}
            </Chip>
          ))}
        </Group>

        <Group title={t("deadline.title")}>
          <Chip size="sm" selected={!filters.deadline} onClick={() => onChange({ deadline: null })}>
            {t("deadline.any")}
          </Chip>
          {DEADLINE_WINDOWS.map((d) => (
            <Chip key={d} size="sm" selected={filters.deadline === d} onClick={() => onChange({ deadline: filters.deadline === d ? null : d })}>
              {t(`deadline.${d}`)}
            </Chip>
          ))}
        </Group>

        <Group title={t("effort.title")} hint={t("effort.hint")}>
          <Chip size="sm" selected={!filters.effort} onClick={() => onChange({ effort: null })}>
            {t("effort.any")}
          </Chip>
          {EFFORT_FILTERS.map((e) => (
            <Chip key={e} size="sm" selected={filters.effort === e} onClick={() => onChange({ effort: filters.effort === e ? null : e })}>
              {t(`effort.${e}`)}
            </Chip>
          ))}
        </Group>
      </div>
    </Dialog>
  );
}
