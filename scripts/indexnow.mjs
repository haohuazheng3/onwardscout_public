#!/usr/bin/env node
// IndexNow ping (Bing, Yandex, Seznam, Naver… share submissions through api.indexnow.org).
//
//   node scripts/indexnow.mjs                 → every URL in the live sitemap (sitemap indexes are followed)
//   node scripts/indexnow.mjs <url> [<url>…]  → only these (e.g. a page you just published)
//
// The key is public by design: it is served at <site>/indexnow.txt (src/app/indexnow.txt).
// INDEXNOW_KEY in the environment is used when set; otherwise the key is read from that file.
const SITE = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://onwardscout.com").replace(/\/+$/, "");
const host = new URL(SITE).host;
const keyLocation = `${SITE}/indexnow.txt`;
const BATCH = 10_000; // IndexNow accepts at most 10,000 URLs per request

const served = await fetch(keyLocation).then((r) => (r.ok ? r.text() : ""));
const key = (process.env.INDEXNOW_KEY ?? served).trim();
if (!key) throw new Error(`no IndexNow key: set INDEXNOW_KEY or serve ${keyLocation}`);
if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error("the IndexNow key must be 8–128 characters of a-z, A-Z, 0-9 and '-'");
if (served.trim() !== key) throw new Error(`${keyLocation} does not serve this key; search engines would reject the ping`);

async function sitemapUrls(url, depth = 0) {
  const xml = await fetch(url).then((r) => {
    if (!r.ok) throw new Error(`${url} answered ${r.status}`);
    return r.text();
  });
  const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1].replace(/&amp;/g, "&"));
  if (/<sitemapindex[\s>]/.test(xml) && depth < 2) {
    const all = [];
    for (const child of locs) all.push(...(await sitemapUrls(child, depth + 1)));
    return all;
  }
  return locs;
}

let urls = process.argv.slice(2);
if (!urls.length) urls = await sitemapUrls(`${SITE}/sitemap.xml`);
urls = [...new Set(urls)];
const foreign = urls.filter((u) => new URL(u).host !== host);
if (foreign.length) throw new Error(`URLs outside ${host}: ${foreign.slice(0, 5).join(", ")}${foreign.length > 5 ? "…" : ""}`);
if (!urls.length) throw new Error("nothing to submit");

let failed = false;
for (let i = 0; i < urls.length; i += BATCH) {
  const urlList = urls.slice(i, i + BATCH);
  const res = await fetch("https://api.indexnow.org/indexnow", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host, key, keyLocation, urlList }),
  });
  // 200 = accepted, 202 = accepted while the key file is being verified; anything else is a failure.
  console.log(`IndexNow ${res.status} ${res.statusText}: ${urlList.length} URL${urlList.length === 1 ? "" : "s"} for ${host}`);
  if (res.status !== 200 && res.status !== 202) {
    console.error((await res.text()).slice(0, 500));
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
