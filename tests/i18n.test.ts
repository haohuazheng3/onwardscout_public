import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseAppStatus, sanitizePatch } from "@/components/app-status";
import { serializeJsonLd } from "@/components/JsonLd";
import { messageFallback } from "@/i18n/fallback";
import { loadMessages, loadNamespace, mergeMessages, pickNamespaces } from "@/i18n/messages";
import { APP_NAMESPACES, COMMON_NAMESPACES, NAMESPACES, isNamespace } from "@/i18n/namespaces";
import {
  ENGLISH_ONLY_PREFIXES,
  isEnglishOnlyPath,
  localizePath,
  localizeRedirect,
  safeRedirectPath,
  splitLocale,
  switchLocaleHref,
} from "@/i18n/paths";
import { AUDIENCES, audienceKey } from "@/i18n/site-nav";
import { DEFAULT_LOCALE, HTML_LANG, LOCALE_COOKIE, LOCALES, isLocale, routing } from "@/i18n/routing";

const ROOT = path.resolve(import.meta.dirname, "..");
const MESSAGES = path.join(ROOT, "messages");

type Tree = { [k: string]: string | Tree };

function readJson(locale: string, ns: string): unknown {
  return JSON.parse(fs.readFileSync(path.join(MESSAGES, locale, `${ns}.json`), "utf8"));
}

function flatten(tree: Tree, prefix = ""): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(tree)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") out[key] = v;
    else Object.assign(out, flatten(v, key));
  }
  return out;
}

/** ICU arguments ({count}, {language}) and rich-text tags (<em>, <terms>) a message uses. */
function placeholders(message: string): string[] {
  const args = new Set<string>();
  for (const m of message.matchAll(/\{\s*([A-Za-z_]\w*)\s*(?:\}|,\s*(?:plural|select|selectordinal|number|date|time)\b)/g)) args.add(`{${m[1]}}`);
  for (const m of message.matchAll(/<([a-z][\w-]*)>/g)) args.add(`<${m[1]}>`);
  return [...args].sort();
}

describe("message files", () => {
  it("exist for every namespace in both locales and are JSON objects", () => {
    for (const locale of LOCALES) {
      for (const ns of NAMESPACES) {
        const file = path.join(MESSAGES, locale, `${ns}.json`);
        expect(fs.existsSync(file), `${locale}/${ns}.json`).toBe(true);
        const data = readJson(locale, ns);
        expect(typeof data === "object" && data !== null && !Array.isArray(data), `${locale}/${ns}.json is an object`).toBe(true);
      }
    }
  });

  it("contain no namespace file that is not registered", () => {
    for (const locale of LOCALES) {
      const files = fs.readdirSync(path.join(MESSAGES, locale)).filter((f) => f.endsWith(".json"));
      for (const f of files) expect(isNamespace(f.replace(/\.json$/, "")), `${locale}/${f}`).toBe(true);
    }
  });

  it("common.json has identical key sets in en and zh", () => {
    const en = Object.keys(flatten(readJson("en", "common") as Tree)).sort();
    const zh = Object.keys(flatten(readJson("zh", "common") as Tree)).sort();
    expect(zh).toEqual(en);
  });

  it("common.json translations keep every ICU argument and rich-text tag", () => {
    const en = flatten(readJson("en", "common") as Tree);
    const zh = flatten(readJson("zh", "common") as Tree);
    for (const [key, text] of Object.entries(en)) {
      expect(placeholders(zh[key] ?? ""), `common.${key}`).toEqual(placeholders(text));
    }
  });

  it("common.json has no empty strings and no keys with dots", () => {
    for (const locale of LOCALES) {
      const flat = flatten(readJson(locale, "common") as Tree);
      for (const [key, value] of Object.entries(flat)) {
        expect(value.trim().length, `${locale} common.${key}`).toBeGreaterThan(0);
        expect(key.split(".").every((seg) => seg.length > 0)).toBe(true);
      }
    }
  });

  it("has a label and blurb for every audience", () => {
    const en = readJson("en", "common") as { audiences: Record<string, string> };
    for (const a of AUDIENCES) {
      expect(en.audiences[audienceKey(a)]).toBeTruthy();
      expect(en.audiences[`${audienceKey(a)}Blurb`]).toBeTruthy();
    }
  });
});

describe("namespaces", () => {
  it("are the fixed list from the contract", () => {
    expect([...NAMESPACES]).toEqual(["common", "site", "onboarding", "profile", "scout", "applications", "billing", "admin", "settings", "legal"]);
  });

  it("client subsets only name real namespaces and always include common", () => {
    for (const ns of [...COMMON_NAMESPACES, ...APP_NAMESPACES]) expect(isNamespace(ns)).toBe(true);
    expect(APP_NAMESPACES).toContain("common");
    expect(APP_NAMESPACES).not.toContain("site");
    expect(APP_NAMESPACES).not.toContain("legal");
  });
});

describe("routing config", () => {
  it("matches the contract", () => {
    expect([...routing.locales]).toEqual(["en", "zh"]);
    expect(routing.defaultLocale).toBe("en");
    expect(DEFAULT_LOCALE).toBe("en");
    expect(routing.localeDetection).toBe(false);
    const prefix = routing.localePrefix;
    expect(typeof prefix === "string" ? prefix : prefix?.mode).toBe("as-needed");
    expect(LOCALE_COOKIE).toBe("NEXT_LOCALE");
    expect(HTML_LANG).toEqual({ en: "en", zh: "zh-CN" });
  });

  it("recognises locales strictly", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("zh")).toBe(true);
    expect(isLocale("fr")).toBe(false);
    expect(isLocale("ZH")).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe("mergeMessages (English as the deep fallback)", () => {
  it("fills missing and empty keys from the base, keeps translated ones", () => {
    const base = { a: "A", b: { c: "C", d: "D" }, e: "E" };
    const zh = { a: "甲", b: { c: "" }, extra: "多" };
    expect(mergeMessages(base, zh)).toEqual({ a: "甲", b: { c: "C", d: "D" }, e: "E", extra: "多" });
  });

  it("never lets a broken translation remove a subtree", () => {
    expect(mergeMessages({ nav: { home: "Home" } }, { nav: "oops" })).toEqual({ nav: { home: "Home" } });
    expect(mergeMessages({ title: "Title" }, { title: { nested: "x" } })).toEqual({ title: "Title" });
  });

  it("treats an empty or missing override as no translation", () => {
    expect(mergeMessages({ a: "A" }, {})).toEqual({ a: "A" });
    expect(mergeMessages({ a: "A" }, undefined)).toEqual({ a: "A" });
    expect(mergeMessages({ a: "A" }, null)).toEqual({ a: "A" });
  });
});

describe("loadMessages", () => {
  it("loads every namespace for English", async () => {
    const m = await loadMessages("en");
    expect(Object.keys(m).sort()).toEqual([...NAMESPACES].sort());
    expect((m.common as Tree).brand).toMatchObject({ name: "Onward Scout" });
  });

  it("serves Chinese where translated and English everywhere else", async () => {
    const zh = await loadMessages("zh");
    const en = await loadMessages("en");
    expect(((zh.common as Tree).nav as Tree).signIn).toBe("登录");
    // Every English key exists in the merged Chinese messages, in every namespace.
    for (const ns of NAMESPACES) {
      const enKeys = Object.keys(flatten(en[ns] as Tree));
      const zhFlat = flatten(zh[ns] as Tree);
      for (const k of enKeys) expect(zhFlat[k], `${ns}.${k}`).toBeTruthy();
    }
  });

  it("falls back to English key by key for a partially translated namespace", async () => {
    const raw = await loadNamespace("zh", "common");
    expect(raw).toBeTypeOf("object");
    // Simulate a translation gap with the real merge used by loadMessages.
    const en = await loadNamespace("en", "common");
    const partial = { ...(raw as Tree), toasts: {} };
    const merged = mergeMessages(en, partial) as Tree;
    expect((merged.toasts as Tree).dismiss).toBe((en.toasts as Tree).dismiss);
    expect((merged.nav as Tree).signIn).toBe("登录");
  });

  it("can load a subset", async () => {
    const m = await loadMessages("zh", ["common"]);
    expect(Object.keys(m)).toEqual(["common"]);
  });
});

describe("pickNamespaces", () => {
  it("returns only the named namespaces, {} for missing ones", () => {
    const all = { common: { a: "A" }, site: { b: "B" } };
    expect(pickNamespaces(all, ["common", "scout"])).toEqual({ common: { a: "A" }, scout: {} });
  });
});

describe("messageFallback", () => {
  it("humanises the last key segment", () => {
    expect(messageFallback({ namespace: "common", key: "nav.startFree" })).toBe("Start free");
    expect(messageFallback({ key: "how-it-works" })).toBe("How it works");
    expect(messageFallback({ key: "cta_primary" })).toBe("Cta primary");
    expect(messageFallback({ namespace: "x", key: "" })).toBe("x.");
  });
});

describe("locale paths", () => {
  it("splits a browser path into locale and bare path", () => {
    expect(splitLocale("/zh/pricing")).toEqual({ locale: "zh", path: "/pricing" });
    expect(splitLocale("/zh")).toEqual({ locale: "zh", path: "/" });
    expect(splitLocale("/zh/")).toEqual({ locale: "zh", path: "/" });
    expect(splitLocale("/pricing/")).toEqual({ locale: "en", path: "/pricing" });
    expect(splitLocale("/en/app")).toEqual({ locale: "en", path: "/app" });
    expect(splitLocale("/")).toEqual({ locale: "en", path: "/" });
    expect(splitLocale("/zhuhai")).toEqual({ locale: "en", path: "/zhuhai" });
  });

  it("knows the English-only sections", () => {
    expect(ENGLISH_ONLY_PREFIXES).toEqual(["/opportunities", "/careers", "/organizations", "/guides", "/blog"]);
    expect(isEnglishOnlyPath("/blog")).toBe(true);
    expect(isEnglishOnlyPath("/opportunities/grants/x")).toBe(true);
    expect(isEnglishOnlyPath("/blogger")).toBe(false);
    expect(isEnglishOnlyPath("/pricing")).toBe(false);
  });

  it("localizes paths (English unprefixed, English-only stays English)", () => {
    expect(localizePath("/pricing", "en")).toBe("/pricing");
    expect(localizePath("/pricing", "zh")).toBe("/zh/pricing");
    expect(localizePath("/", "zh")).toBe("/zh");
    expect(localizePath("/", "en")).toBe("/");
    expect(localizePath("/guides/apply", "zh")).toBe("/guides/apply");
    expect(localizePath("app", "zh")).toBe("/zh/app");
  });

  it("switches language keeping path, query and hash", () => {
    expect(switchLocaleHref("/pricing", "zh", { search: "?buy=pro", hash: "#plans" })).toEqual({ href: "/zh/pricing?buy=pro#plans", englishOnly: false });
    expect(switchLocaleHref("/zh/app/scout", "en", { search: "?type=grant" })).toEqual({ href: "/app/scout?type=grant", englishOnly: false });
    expect(switchLocaleHref("/zh", "en")).toEqual({ href: "/", englishOnly: false });
    expect(switchLocaleHref("/", "zh", { search: "?" })).toEqual({ href: "/zh", englishOnly: false });
  });

  it("sends Chinese on an English-only page to the Chinese home, English stays put", () => {
    expect(switchLocaleHref("/blog/careers/how-to", "zh", { search: "?a=1" })).toEqual({ href: "/zh", englishOnly: true });
    expect(switchLocaleHref("/opportunities/grants", "en", { search: "?page=2" })).toEqual({ href: "/opportunities/grants?page=2", englishOnly: true });
  });
});

describe("sign-in redirect safety", () => {
  const origin = "https://onwardscout.com";

  it("accepts same-site paths and same-origin URLs", () => {
    expect(safeRedirectPath("/app/scout?type=grant#top", { siteOrigin: origin })).toBe("/app/scout?type=grant#top");
    expect(safeRedirectPath("/zh/app", { siteOrigin: origin })).toBe("/zh/app");
    expect(safeRedirectPath("https://onwardscout.com/pricing?buy=pro", { siteOrigin: origin })).toBe("/pricing?buy=pro");
    expect(safeRedirectPath("  /app  ", { siteOrigin: origin })).toBe("/app");
  });

  it("rejects other origins and tricks", () => {
    for (const bad of [
      "https://evil.example/app",
      "//evil.example/app",
      "/\\evil.example",
      "\\\\evil.example",
      "javascript:alert(1)",
      "data:text/html,hi",
      "https://onwardscout.com.evil.example/",
      "http://onwardscout.com/app",
      "/app\nSet-Cookie: x",
      "",
      "a".repeat(3000),
    ]) {
      expect(safeRedirectPath(bad, { siteOrigin: origin }), bad.slice(0, 40)).toBeNull();
    }
    expect(safeRedirectPath(undefined)).toBeNull();
    expect(safeRedirectPath(["/app"])).toBeNull();
    expect(safeRedirectPath("https://onwardscout.com/app")).toBeNull(); // no origin configured → only paths
  });

  it("refuses sign-in loops and API routes", () => {
    expect(safeRedirectPath("/sign-in")).toBeNull();
    expect(safeRedirectPath("/sign-in/factor-one")).toBeNull();
    expect(safeRedirectPath("/zh/sign-in?redirect_url=/app")).toBeNull();
    expect(safeRedirectPath("/api/me")).toBeNull();
    expect(safeRedirectPath("/sign-inside")).toBe("/sign-inside");
  });

  it("puts the destination in the visitor's language", () => {
    expect(localizeRedirect("/app/scout?x=1", "zh")).toBe("/zh/app/scout?x=1");
    expect(localizeRedirect("/app", "en")).toBe("/app");
    expect(localizeRedirect("/zh/app", "en")).toBe("/zh/app");
    expect(localizeRedirect("/en/pricing#a", "zh")).toBe("/pricing#a");
    expect(localizeRedirect("/blog/x", "zh")).toBe("/blog/x");
    expect(localizeRedirect("/", "zh")).toBe("/zh");
  });
});

describe("app shell status parsing", () => {
  it("reads what /api/me returns and ignores the rest", () => {
    expect(parseAppStatus({ balance: { available: 3, reserved: 1 }, unreadNotifications: 2, needsYou: 1, email: "x" })).toEqual({
      available: 3,
      reserved: 1,
      unreadNotifications: 2,
      needsYou: 1,
    });
    expect(parseAppStatus({ credits: 5 })).toEqual({ available: 5 });
    expect(parseAppStatus({ balance: { available: "3" } })).toEqual({});
    expect(parseAppStatus(null)).toEqual({});
  });

  it("sanitizes pushed patches", () => {
    expect(sanitizePatch({ available: 2.7, reserved: -1, needsYou: Number.NaN, unreadNotifications: 4 })).toEqual({ available: 2, unreadNotifications: 4 });
    expect(sanitizePatch("nope")).toEqual({});
  });
});

describe("JSON-LD serialization", () => {
  it("cannot close the script tag", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>", amp: "a&b", ls: `x${String.fromCharCode(0x2028)}y` });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
    expect(out).not.toContain(String.fromCharCode(0x2028));
    expect(JSON.parse(out)).toEqual({ name: "</script><script>alert(1)</script>", amp: "a&b", ls: `x${String.fromCharCode(0x2028)}y` });
  });
});
