import type { MetadataRoute } from "next";
import { isIndexable } from "@/lib/env";
import { PRIVATE_PATHS, SITE } from "@/lib/site";

/*
 * robots.txt. Until launch (and on every non-production deployment) everything is disallowed;
 * the meta robots tag and the X-Robots-Tag header say noindex as well. In production with
 * SITE_INDEXABLE=1: everything public is allowed, the private areas are not (both locales,
 * the APIs and the sandbox form), and the sitemap index (/sitemap-index.xml) is announced.
 */
export default function robots(): MetadataRoute.Robots {
  if (!isIndexable()) {
    return { rules: [{ userAgent: "*", disallow: "/" }] };
  }
  const disallow = [...new Set<string>([...PRIVATE_PATHS, "/api/", "/sandbox/"])];
  return {
    rules: [{ userAgent: "*", allow: "/", disallow }],
    sitemap: `${SITE.url}/sitemap-index.xml`,
    host: SITE.url,
  };
}
