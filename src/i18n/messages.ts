import type { AbstractIntlMessages } from "next-intl";
import { NAMESPACES, type Namespace } from "./namespaces";
import { DEFAULT_LOCALE, type Locale } from "./routing";

/*
 * Message loading. Every namespace file is listed explicitly so the bundler can see each
 * one (no globbing at runtime) and so a missing file fails loudly in tests, not in
 * production. Chinese is merged over English key by key: any key the zh file does not
 * have (or has as an empty string) shows the English text instead of a raw key.
 */

export type Messages = Record<string, AbstractIntlMessages>;

type Loader = () => Promise<{ default: unknown }>;

const LOADERS: Record<Locale, Record<Namespace, Loader>> = {
  en: {
    common: () => import("../../messages/en/common.json"),
    site: () => import("../../messages/en/site.json"),
    onboarding: () => import("../../messages/en/onboarding.json"),
    profile: () => import("../../messages/en/profile.json"),
    scout: () => import("../../messages/en/scout.json"),
    applications: () => import("../../messages/en/applications.json"),
    billing: () => import("../../messages/en/billing.json"),
    admin: () => import("../../messages/en/admin.json"),
    settings: () => import("../../messages/en/settings.json"),
    legal: () => import("../../messages/en/legal.json"),
  },
  zh: {
    common: () => import("../../messages/zh/common.json"),
    site: () => import("../../messages/zh/site.json"),
    onboarding: () => import("../../messages/zh/onboarding.json"),
    profile: () => import("../../messages/zh/profile.json"),
    scout: () => import("../../messages/zh/scout.json"),
    applications: () => import("../../messages/zh/applications.json"),
    billing: () => import("../../messages/zh/billing.json"),
    admin: () => import("../../messages/zh/admin.json"),
    settings: () => import("../../messages/zh/settings.json"),
    legal: () => import("../../messages/zh/legal.json"),
  },
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Deep merge with `base` as the fallback for every leaf `override` does not provide.
 * - objects merge key by key (keys only in `override` are kept);
 * - a string leaf in `override` wins only when it is non-empty;
 * - a structural mismatch (object vs string) keeps `base`, so a broken translation can
 *   never remove a whole subtree the UI relies on.
 */
export function mergeMessages(base: unknown, override: unknown): unknown {
  if (isPlainObject(base)) {
    const o = isPlainObject(override) ? override : {};
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(base)) out[key] = mergeMessages(base[key], o[key]);
    for (const key of Object.keys(o)) if (!(key in base)) out[key] = o[key];
    return out;
  }
  if (base === undefined) return override;
  if (typeof base === "string") {
    return typeof override === "string" && override.trim() !== "" ? override : base;
  }
  if (Array.isArray(base)) {
    return Array.isArray(override) && override.length > 0 ? override : base;
  }
  return override ?? base;
}

/** Raw contents of one namespace file (no fallback). Throws if the file cannot be loaded. */
export async function loadNamespace(locale: Locale, namespace: Namespace): Promise<AbstractIntlMessages> {
  const mod = await LOADERS[locale][namespace]();
  const data = mod.default;
  if (!isPlainObject(data)) throw new Error(`messages/${locale}/${namespace}.json is not a JSON object`);
  return data as AbstractIntlMessages;
}

async function safeLoad(locale: Locale, namespace: Namespace): Promise<AbstractIntlMessages> {
  try {
    return await loadNamespace(locale, namespace);
  } catch (error) {
    // A broken translation file must degrade to English, never take the page down.
    console.error(`[i18n] could not load messages/${locale}/${namespace}.json`, error);
    return {};
  }
}

const cache = new Map<string, Promise<Messages>>();

async function build(locale: Locale, namespaces: readonly Namespace[]): Promise<Messages> {
  const entries = await Promise.all(
    namespaces.map(async (ns) => {
      const base = await safeLoad(DEFAULT_LOCALE, ns);
      if (locale === DEFAULT_LOCALE) return [ns, base] as const;
      const localized = await safeLoad(locale, ns);
      return [ns, mergeMessages(base, localized) as AbstractIntlMessages] as const;
    }),
  );
  return Object.fromEntries(entries);
}

/**
 * All messages for a locale, keyed by namespace, with English as the deep fallback.
 * Cached per process in production (messages are part of the build); rebuilt on every
 * call in development so edits to the JSON show up without a restart.
 */
export function loadMessages(locale: Locale, namespaces: readonly Namespace[] = NAMESPACES): Promise<Messages> {
  if (process.env.NODE_ENV !== "production") return build(locale, namespaces);
  const key = `${locale}:${namespaces.join(",")}`;
  let hit = cache.get(key);
  if (!hit) {
    hit = build(locale, namespaces).catch((error: unknown) => {
      cache.delete(key);
      throw error;
    });
    cache.set(key, hit);
  }
  return hit;
}

/** The subset of `messages` for the given namespaces (missing ones become `{}`). */
export function pickNamespaces(messages: Messages | AbstractIntlMessages, names: readonly string[]): Messages {
  const out: Messages = {};
  for (const name of names) {
    const value = (messages as Record<string, unknown>)[name];
    out[name] = isPlainObject(value) ? (value as AbstractIntlMessages) : {};
  }
  return out;
}

export { messageFallback } from "./fallback";
