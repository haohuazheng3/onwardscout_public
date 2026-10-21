import { createTranslator } from "next-intl";
import { messageFallback } from "@/i18n/fallback";
import { mergeMessages } from "@/i18n/messages";
import type { Locale } from "@/i18n/routing";
import en from "./messages/en.json";
import zh from "./messages/zh.json";

/*
 * Copy for the integrations page. P3b owns no namespace file in messages/, so its strings live
 * next to the code (English first; Chinese merged over English key by key, like the app's
 * own loader). The integrator may move them into messages/<locale>/settings.json under
 * `integrations` without touching the components: they only read the `integrations` namespace.
 */

export type IntegrationsMessages = typeof en;

export function integrationsMessages(locale: Locale): IntegrationsMessages {
  return (locale === "zh" ? mergeMessages(en, zh) : en) as IntegrationsMessages;
}

export type Translate = (key: string, values?: Record<string, string | number>) => string;

export function integrationsTranslator(locale: Locale): Translate {
  return createTranslator({
    locale,
    messages: { integrations: integrationsMessages(locale) },
    namespace: "integrations",
    onError: (error) => {
      if (error.code !== "MISSING_MESSAGE") console.error(`[i18n] ${error.code}: ${error.message}`);
    },
    getMessageFallback: ({ namespace, key }) => messageFallback({ namespace, key }),
  }) as unknown as Translate;
}
