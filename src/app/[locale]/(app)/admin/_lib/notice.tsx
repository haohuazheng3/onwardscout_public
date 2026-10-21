import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/admin/AdminUi";
import type { Locale } from "@/i18n/routing";
import { one } from "./data";

/** Outcome messages the admin actions redirect back with (`?notice=…`). */
export const NOTICE_TONES = {
  invalid: "bad",
  notFound: "bad",
  jobRetried: "ok",
  jobRetryRefused: "bad",
  jobCancelled: "ok",
  jobCancelRefused: "bad",
  sourceQueued: "ok",
  sourceAlreadyQueued: "info",
  approved: "ok",
  rejected: "ok",
  expired: "ok",
  saved: "ok",
  creditsGranted: "ok",
  creditsExisting: "info",
  creditsFailed: "bad",
  resolved: "ok",
  reopened: "ok",
  allResolved: "ok",
  messageUpdated: "ok",
} as const;

export type NoticeKey = keyof typeof NOTICE_TONES;

export function isNoticeKey(v: unknown): v is NoticeKey {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(NOTICE_TONES, v);
}

export async function AdminNotice({ sp, locale }: { sp: Record<string, string | string[] | undefined>; locale: Locale }) {
  const key = one(sp.notice);
  if (!isNoticeKey(key)) return null;
  const t = await getTranslations({ locale, namespace: "admin.notices" });
  const amount = Number(one(sp.n) ?? 0) || 0;
  const reason = (one(sp.r) ?? "").slice(0, 200);
  return <Notice tone={NOTICE_TONES[key]}>{t(key, { amount, reason })}</Notice>;
}
