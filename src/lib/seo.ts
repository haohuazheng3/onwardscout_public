import type { Metadata } from "next";
import { isIndexable } from "./env";
import { SITE, SITE_ZH, withLocale, type Locale } from "./site";

/*
 * Metadata and schema.org JSON-LD. Pages never hand-write canonical/hreflang/OG tags: they call
 * pageMetadata() with the UNPREFIXED path ("/pricing") and their locale, and this module writes
 * the localized canonical, the en / zh-CN / x-default alternates and the Open Graph card.
 */

export function absoluteUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  return `${SITE.url}${path.startsWith("/") ? path : `/${path}`}`;
}

/** `/pricing` in a locale: English unprefixed, Chinese under `/zh` (`/` → `/zh`). */
export function localizedPath(locale: Locale, path: string): string {
  return withLocale(locale, path);
}

/** BCP 47 tag for `<html lang>`, hreflang and `inLanguage`. */
export function htmlLang(locale: Locale): "en" | "zh-CN" {
  return locale === "zh" ? "zh-CN" : "en";
}

export type HreflangKey = "en" | "zh-CN" | "x-default";

export interface PageMetaInput {
  title: string;
  description: string;
  /** The unprefixed path of the page, e.g. "/pricing" or "/opportunities/grants/some-grant". */
  path: string;
  /** Locale of this rendering (default "en"). */
  locale?: Locale;
  /** Open Graph / Twitter image path or URL; defaults to the site card (/opengraph-image). */
  image?: string;
  noindex?: boolean;
  type?: "website" | "article";
  /** Use the title as-is instead of the layout's title template. */
  absoluteTitle?: boolean;
  /** Programmatic SEO pages and blog posts exist in English only: no zh alternate. */
  englishOnly?: boolean;
  /** Override the hreflang map (absolute or site-relative URLs), or `false` for none. */
  alternates?: Partial<Record<HreflangKey, string>> | false;
  /** Articles: ISO dates for og:article tags. */
  publishedTime?: string;
  modifiedTime?: string;
}

/** The hreflang map for a page available in both locales (or English only). */
export function hreflangAlternates(path: string, englishOnly = false): Partial<Record<HreflangKey, string>> {
  const en = absoluteUrl(localizedPath("en", path));
  if (englishOnly) return { en, "x-default": en };
  return { en, "zh-CN": absoluteUrl(localizedPath("zh", path)), "x-default": en };
}

export function pageMetadata(input: PageMetaInput): Metadata {
  const locale: Locale = input.englishOnly ? "en" : (input.locale ?? "en");
  const url = absoluteUrl(localizedPath(locale, input.path));
  // A page-level openGraph object replaces the inherited one, so every page names its image;
  // the root /opengraph-image is the default (segment-level opengraph-image files still win).
  const image = absoluteUrl(input.image ?? "/opengraph-image");
  let languages: Record<string, string> | undefined;
  if (input.alternates === false) languages = undefined;
  else if (input.alternates) {
    languages = Object.fromEntries(Object.entries(input.alternates).filter(([, v]) => Boolean(v)).map(([k, v]) => [k, absoluteUrl(v as string)]));
  } else languages = hreflangAlternates(input.path, input.englishOnly);

  const noindex = input.noindex || !isIndexable();
  return {
    title: input.absoluteTitle ? { absolute: input.title } : input.title,
    description: input.description,
    alternates: { canonical: url, ...(languages ? { languages } : {}) },
    openGraph: {
      title: input.title,
      description: input.description,
      url,
      siteName: SITE.name,
      type: input.type === "article" ? "article" : "website",
      locale: locale === "zh" ? SITE_ZH.locale : SITE.locale,
      ...(input.englishOnly ? {} : { alternateLocale: [locale === "zh" ? SITE.locale : SITE_ZH.locale] }),
      images: [{ url: image, width: 1200, height: 630, alt: input.title }],
      ...(input.type === "article" && input.publishedTime ? { publishedTime: input.publishedTime } : {}),
      ...(input.type === "article" && input.modifiedTime ? { modifiedTime: input.modifiedTime } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: input.title,
      description: input.description,
      images: [image],
    },
    ...(noindex ? { robots: { index: false, follow: false, googleBot: { index: false, follow: false } } } : {}),
  };
}

/* ---------------------------------------------------------------- JSON-LD */

const ORG_ID = `${SITE.url}/#organization`;
const SITE_ID = `${SITE.url}/#website`;
const APP_ID = `${SITE.url}/#app`;

export function organizationLd() {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": ORG_ID,
    name: SITE.name,
    url: SITE.url,
    logo: { "@type": "ImageObject", url: absoluteUrl("/brand/logo-512.png"), width: 512, height: 512 },
    email: SITE.email,
    slogan: SITE.tagline,
    description: SITE.description,
    foundingDate: String(SITE.foundingYear),
    contactPoint: [
      { "@type": "ContactPoint", contactType: "customer support", email: SITE.email, availableLanguage: ["English", "Chinese"] },
    ],
  };
}

export function websiteLd(locale: Locale = "en") {
  return {
    "@context": "https://schema.org",
    "@type": "WebSite",
    "@id": SITE_ID,
    name: SITE.name,
    url: absoluteUrl(localizedPath(locale, "/")),
    description: locale === "zh" ? SITE_ZH.description : SITE.description,
    inLanguage: ["en", "zh-CN"],
    publisher: { "@id": ORG_ID },
  };
}

/** One sellable thing on /pricing; P4's plans map onto this shape. */
export interface OfferInput {
  sku: string;
  name: string;
  priceUsd: number;
  /** "month" for subscriptions, "once" for one-time packs. */
  interval: "month" | "once";
  description?: string;
}

/** The product itself, with one Offer per plan and pack. No ratings: we never publish ones we didn't collect. */
export function softwareApplicationLd(offers: OfferInput[], locale: Locale = "en") {
  return {
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    "@id": APP_ID,
    name: SITE.name,
    url: SITE.url,
    description: locale === "zh" ? SITE_ZH.description : SITE.description,
    applicationCategory: "BusinessApplication",
    operatingSystem: "Web",
    browserRequirements: "Requires JavaScript",
    inLanguage: htmlLang(locale),
    publisher: { "@id": ORG_ID },
    offers: offers.map((o) => ({
      "@type": "Offer",
      name: o.name,
      sku: o.sku,
      ...(o.description ? { description: o.description } : {}),
      price: o.priceUsd.toFixed(2),
      priceCurrency: "USD",
      url: absoluteUrl(localizedPath(locale, "/pricing")),
      availability: "https://schema.org/InStock",
      category: o.interval === "month" ? "subscription" : "one-time",
      seller: { "@id": ORG_ID },
      ...(o.interval === "month"
        ? {
            priceSpecification: {
              "@type": "UnitPriceSpecification",
              price: o.priceUsd.toFixed(2),
              priceCurrency: "USD",
              billingDuration: 1,
              billingIncrement: 1,
              unitCode: "MON",
            },
          }
        : {}),
    })),
  };
}

export function faqLd(faqs: { q: string; a: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** Breadcrumbs; `path` is the already-localized path of each crumb. */
export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      item: absoluteUrl(it.path),
    })),
  };
}

/** The fields an article needs for schema.org; the blog's post type satisfies it structurally. */
export interface ArticleInput {
  title: string;
  description: string;
  publishedAt: string;
  updatedAt: string;
  keywords?: string[];
  wordCount?: number;
  image?: { src: string } | string | null;
  /** Section name shown as articleSection (e.g. the blog category label). */
  section?: string;
  locale?: Locale;
}

export function articleLd(post: ArticleInput, path: string) {
  const image = typeof post.image === "string" ? post.image : post.image?.src;
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: post.title,
    description: post.description,
    datePublished: post.publishedAt,
    dateModified: post.updatedAt,
    mainEntityOfPage: { "@type": "WebPage", "@id": absoluteUrl(path) },
    url: absoluteUrl(path),
    image: absoluteUrl(image ?? "/opengraph-image"),
    author: { "@type": "Organization", "@id": ORG_ID, name: SITE.name, url: SITE.url },
    publisher: { "@id": ORG_ID },
    inLanguage: htmlLang(post.locale ?? "en"),
    ...(post.section ? { articleSection: post.section } : {}),
    ...(post.wordCount ? { wordCount: post.wordCount } : {}),
    ...(post.keywords?.length ? { keywords: post.keywords.join(", ") } : {}),
    isPartOf: { "@id": SITE_ID },
  };
}

export interface HowToStep {
  name: string;
  text: string;
  /** Localized path (with #fragment) the step is explained at; defaults to `${path}#step-n`. */
  path?: string;
}

/** /how-it-works and the application guides: ordered steps. */
export function howToLd(input: { name: string; description: string; path: string; steps: HowToStep[]; totalTime?: string; locale?: Locale; tools?: string[]; supplies?: string[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "HowTo",
    name: input.name,
    description: input.description,
    url: absoluteUrl(input.path),
    inLanguage: htmlLang(input.locale ?? "en"),
    ...(input.totalTime ? { totalTime: input.totalTime } : {}),
    ...(input.tools?.length ? { tool: input.tools.map((name) => ({ "@type": "HowToTool", name })) } : {}),
    ...(input.supplies?.length ? { supply: input.supplies.map((name) => ({ "@type": "HowToSupply", name })) } : {}),
    step: input.steps.map((s, i) => ({
      "@type": "HowToStep",
      position: i + 1,
      name: s.name,
      text: s.text,
      url: absoluteUrl(s.path ?? `${input.path}#step-${i + 1}`),
    })),
    publisher: { "@id": ORG_ID },
  };
}

export interface EventInput {
  name: string;
  description?: string;
  /** Localized path of the page describing the event. */
  path: string;
  /** ISO date or date-time. Required by schema.org Event; omit the whole block when unknown. */
  startDate: string;
  endDate?: string;
  /** Online, in person or both. */
  attendanceMode?: "online" | "offline" | "mixed";
  location?: { name?: string; city?: string; country?: string; address?: string } | null;
  organizer?: { name: string; url?: string } | null;
  /** The official page (the real source of the opportunity). */
  url?: string;
  image?: string;
  isAccessibleForFree?: boolean;
  eventStatus?: "scheduled" | "cancelled" | "postponed" | "rescheduled" | "movedOnline";
}

const ATTENDANCE = {
  online: "https://schema.org/OnlineEventAttendanceMode",
  offline: "https://schema.org/OfflineEventAttendanceMode",
  mixed: "https://schema.org/MixedEventAttendanceMode",
} as const;

const EVENT_STATUS = {
  scheduled: "https://schema.org/EventScheduled",
  cancelled: "https://schema.org/EventCancelled",
  postponed: "https://schema.org/EventPostponed",
  rescheduled: "https://schema.org/EventRescheduled",
  movedOnline: "https://schema.org/EventMovedOnline",
} as const;

/** Conferences, competitions, exhibitions, demo days: an Event with only the facts we have. */
export function eventLd(e: EventInput) {
  const mode = e.attendanceMode ?? (e.location ? "offline" : "online");
  const place =
    mode === "online"
      ? { "@type": "VirtualLocation", url: e.url ?? absoluteUrl(e.path) }
      : {
          "@type": "Place",
          name: e.location?.name ?? e.location?.city ?? e.location?.country ?? "To be announced",
          address: {
            "@type": "PostalAddress",
            ...(e.location?.address ? { streetAddress: e.location.address } : {}),
            ...(e.location?.city ? { addressLocality: e.location.city } : {}),
            ...(e.location?.country ? { addressCountry: e.location.country } : {}),
          },
        };
  return {
    "@context": "https://schema.org",
    "@type": "Event",
    name: e.name,
    ...(e.description ? { description: e.description } : {}),
    startDate: e.startDate,
    ...(e.endDate ? { endDate: e.endDate } : {}),
    eventAttendanceMode: ATTENDANCE[mode],
    eventStatus: EVENT_STATUS[e.eventStatus ?? "scheduled"],
    location: mode === "mixed" ? [place, { "@type": "VirtualLocation", url: e.url ?? absoluteUrl(e.path) }] : place,
    ...(e.organizer ? { organizer: { "@type": "Organization", name: e.organizer.name, ...(e.organizer.url ? { url: e.organizer.url } : {}) } } : {}),
    ...(e.image ? { image: absoluteUrl(e.image) } : {}),
    ...(typeof e.isAccessibleForFree === "boolean" ? { isAccessibleForFree: e.isAccessibleForFree } : {}),
    url: absoluteUrl(e.path),
    ...(e.url ? { sameAs: e.url } : {}),
  };
}

/** Hub pages: an ordered list of the items they link to (localized paths). */
export function itemListLd(input: { name: string; path: string; items: { name: string; path: string }[] }) {
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: input.name,
    url: absoluteUrl(input.path),
    numberOfItems: input.items.length,
    itemListElement: input.items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      url: absoluteUrl(it.path),
    })),
  };
}

/** JSON for a `<script type="application/ld+json">`; `<` is escaped so content can't close the tag. */
export function serializeLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029");
}
