import type { MetadataRoute } from "next";
import { categoriesWithCounts, categoryPageUrl, pageCount, postUrl, publishedPosts } from "@/lib/blog";
import {
  CAREERS_PATH,
  GUIDES_PATH,
  LIST_PAGE_SIZE,
  OPPORTUNITIES_PATH,
  ORGANIZATIONS_PATH,
  SITEMAP_IDS,
  STATIC_SITEMAP_PAGES,
  careerPath,
  getIndexableTargets,
  getSeoData,
  isPrivatePath,
  lastmodOf,
  listingIndexable,
  opportunityPath,
  orgPath,
  organizationsOf,
  playbookPath,
  regionPath,
  typePath,
  zhPath,
  type SitemapId,
} from "@/lib/programmatic";
import { absoluteUrl } from "@/lib/seo";
import { CONTENT_UPDATED } from "@/lib/site";

/*
 * The sitemap, split by family (/sitemap/<id>.xml; the index at /sitemap.xml lists them).
 * Only indexable URLs go in: private paths, noindex pages (thin hubs, closed rounds, careers
 * below the quality rule, empty blog hubs) and /zh variants of English-only pages never do.
 * Every lastmod is a real date: the content date of a page, the newest listing change of a hub,
 * or an article's updatedAt.
 */

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)

type Entry = MetadataRoute.Sitemap[number];

export async function generateSitemaps() {
  return SITEMAP_IDS.map((id) => ({ id }));
}

function newest(dates: (string | null | undefined)[], fallback: string = CONTENT_UPDATED): string {
  return dates.reduce<string>((m, d) => (d && d > m ? d : m), "") || fallback;
}

function entry(path: string, lastModified: string, priority: number, changeFrequency: Entry["changeFrequency"] = "weekly"): Entry {
  return { url: absoluteUrl(path), lastModified, changeFrequency, priority };
}

function staticEntries(): Entry[] {
  const out: Entry[] = [];
  for (const p of STATIC_SITEMAP_PAGES) {
    const languages = { en: absoluteUrl(p.path), "zh-CN": absoluteUrl(zhPath(p.path)), "x-default": absoluteUrl(p.path) };
    out.push({ ...entry(p.path, CONTENT_UPDATED, p.priority, p.changeFrequency), alternates: { languages } });
    out.push({ ...entry(zhPath(p.path), CONTENT_UPDATED, Math.max(0.1, p.priority - 0.1), p.changeFrequency), alternates: { languages } });
  }
  return out;
}

async function opportunityEntries(): Promise<Entry[]> {
  const [{ listings }, targets] = await Promise.all([getSeoData(), getIndexableTargets()]);
  if (!targets.types.length) return [];
  const now = Date.now();
  const out: Entry[] = [entry(OPPORTUNITIES_PATH, newest(targets.types.map((t) => t.lastmod)), 0.9, "daily")];
  for (const t of targets.types) {
    out.push(entry(typePath(t.slug), t.lastmod ?? CONTENT_UPDATED, 0.8, "daily"));
    const pages = Math.ceil(t.count / LIST_PAGE_SIZE);
    for (let n = 2; n <= pages; n++) out.push(entry(typePath(t.slug, n), t.lastmod ?? CONTENT_UPDATED, 0.4, "daily"));
  }
  for (const r of targets.regions) out.push(entry(regionPath(r.typeSlug, r.region), r.lastmod ?? CONTENT_UPDATED, 0.6, "daily"));
  for (const l of listings) {
    if (listingIndexable(l, now)) out.push(entry(opportunityPath(l.type, l.slug), lastmodOf(l) ?? CONTENT_UPDATED, 0.6, "weekly"));
  }
  return out;
}

async function careerEntries(): Promise<Entry[]> {
  const { careers } = await getIndexableTargets();
  return [entry(CAREERS_PATH, newest(careers.map((c) => c.lastmod)), 0.7, "weekly"), ...careers.map((c) => entry(careerPath(c.code), c.lastmod ?? CONTENT_UPDATED, 0.6, "weekly"))];
}

async function organizationEntries(): Promise<Entry[]> {
  const { listings } = await getSeoData();
  const orgs = organizationsOf(listings);
  if (!orgs.length) return [];
  return [
    ...(orgs.length >= 3 ? [entry(ORGANIZATIONS_PATH, newest(orgs.map((o) => o.lastmod)), 0.5, "weekly")] : []),
    ...orgs.map((o) => entry(orgPath(o.slug), o.lastmod ?? CONTENT_UPDATED, 0.5, "weekly")),
  ];
}

async function guideEntries(): Promise<Entry[]> {
  // Playbooks only: a program guide's canonical URL is its listing page (in the opportunities shard).
  const targets = await getIndexableTargets();
  return [
    entry(GUIDES_PATH, newest(targets.types.map((t) => t.lastmod)), 0.7, "weekly"),
    ...targets.types.map((t) => entry(playbookPath(t.slug), t.lastmod ?? CONTENT_UPDATED, 0.6, "monthly")),
  ];
}

function blogEntries(): Entry[] {
  const posts = publishedPosts();
  if (!posts.length) return [];
  const out: Entry[] = [entry("/blog", newest(posts.map((p) => p.updatedAt)), 0.7, "weekly")];
  for (const c of categoriesWithCounts(posts)) {
    if (!c.count || !c.lastmod) continue;
    out.push(entry(categoryPageUrl(c.slug, 1), c.lastmod, 0.6, "weekly"));
    for (let n = 2; n <= pageCount(c.count); n++) out.push(entry(categoryPageUrl(c.slug, n), c.lastmod, 0.3, "weekly"));
  }
  for (const p of posts) out.push(entry(postUrl(p), p.updatedAt, p.featured ? 0.8 : 0.6, "monthly"));
  return out;
}

export default async function sitemap(props: { id: Promise<string> }): Promise<MetadataRoute.Sitemap> {
  const id = (await props.id) as SitemapId;
  let entries: Entry[];
  switch (id) {
    case "static":
      entries = staticEntries();
      break;
    case "opportunities":
      entries = await opportunityEntries();
      break;
    case "careers":
      entries = await careerEntries();
      break;
    case "organizations":
      entries = await organizationEntries();
      break;
    case "guides":
      entries = await guideEntries();
      break;
    case "blog":
      entries = blogEntries();
      break;
    default:
      entries = [];
  }
  // Belt and braces: nothing private ever leaves this function.
  return entries.filter((e) => !isPrivatePath(new URL(e.url).pathname));
}
