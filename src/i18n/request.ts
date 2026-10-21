import { hasLocale, IntlErrorCode } from "next-intl";
import { getRequestConfig } from "next-intl/server";
import { messageFallback } from "./fallback";
import { loadMessages } from "./messages";
import { routing, type Locale } from "./routing";

/*
 * Per-request next-intl configuration (wired by `createNextIntlPlugin("./src/i18n/request.ts")`
 * in next.config.ts). The locale comes from the `[locale]` segment via `setRequestLocale`,
 * which every layout and page calls first; anything unknown falls back to English.
 */

const isProd = process.env.NODE_ENV === "production";

/** Dates and times render in UTC on the server and the client, so hydration never disagrees. */
export const TIME_ZONE = "UTC";

/**
 * The browser's own time zone, remembered in a cookie by `TimeZoneCookie` (src/components). The
 * personal area (dynamic) reads it and hands it to its IntlProvider, so times there show in the
 * person's zone on the server and the client alike; public pages stay static, in UTC.
 */
export const TIME_ZONE_COOKIE = "os_tz";

/** A valid IANA zone name from the cookie, else UTC. */
export function timeZoneFrom(value: string | null | undefined): string {
  const tz = value?.trim();
  if (!tz || tz.length > 64 || !/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$|^UTC$/.test(tz)) return TIME_ZONE;
  try {
    new Intl.DateTimeFormat("en", { timeZone: tz });
    return tz;
  } catch {
    return TIME_ZONE;
  }
}

export default getRequestConfig(async ({ requestLocale, locale: explicit }) => {
  const requested = explicit ?? (await requestLocale);
  const locale: Locale = hasLocale(routing.locales, requested) ? requested : routing.defaultLocale;

  return {
    locale,
    messages: await loadMessages(locale),
    timeZone: TIME_ZONE,
    onError(error) {
      // Missing keys already fall back to English (merge) or a humanised key (below):
      // they are a translation gap, not an outage. Formatting errors are real bugs.
      if (error.code === IntlErrorCode.MISSING_MESSAGE) {
        if (!isProd) console.warn(`[i18n] ${error.message}`);
        return;
      }
      console.error(`[i18n] ${error.code}: ${error.message}`);
    },
    getMessageFallback({ namespace, key }) {
      return messageFallback({ namespace, key });
    },
  };
});
