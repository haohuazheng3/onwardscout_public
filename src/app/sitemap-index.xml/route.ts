import { SITEMAP_IDS } from "@/lib/programmatic";
import { absoluteUrl } from "@/lib/seo";

/*
 * The sitemap index. src/app/sitemap.ts splits the sitemap with generateSitemaps (served at
 * /sitemap/<id>.xml) and Next writes no index for the shards. The index cannot live at
 * /sitemap.xml itself (Next reserves that path for the metadata route and refuses a second
 * route there), so it is served at /sitemap-index.xml; robots.txt announces it, and a
 * next.config rewrite /sitemap.xml → /sitemap-index.xml lets scripts/indexnow.mjs and
 * crawlers that guess /sitemap.xml find it too.
 */

export const revalidate = 86400; // freshness comes from the "opportunities" cache tag (sources run, expiry cron, admin edits)

export function GET() {
  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...SITEMAP_IDS.map((id) => `  <sitemap><loc>${absoluteUrl(`/sitemap/${id}.xml`)}</loc></sitemap>`),
    "</sitemapindex>",
    "",
  ].join("\n");
  return new Response(body, {
    headers: { "Content-Type": "application/xml; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
