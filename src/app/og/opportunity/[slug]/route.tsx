import { getOpportunityType, opportunityTypeBySlug } from "@/lib/core/opportunity-types";
import { getListingDetail, isClosed, timingOf } from "@/lib/programmatic";
import { captureError } from "@/lib/errors";
import { SITE } from "@/lib/site";
import { ogCard } from "../../card";

/**
 * Per-listing share image: /og/opportunity/<slug>. Only public listings of public types are
 * drawn; anything else gets the plain brand card, so the route never reveals a private listing.
 */
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  let d: Awaited<ReturnType<typeof getListingDetail>> = null;
  try {
    d = await getListingDetail(slug);
  } catch (err) {
    await captureError(err, { route: "/og/opportunity/[slug]", severity: "warn" });
  }
  if (!d || !d.isPublic || !opportunityTypeBySlug(d.typeSlug)) {
    return ogCard({ eyebrow: "Opportunities", title: SITE.tagline, subtitle: "Real programs, checked at the source, prepared for your tap." });
  }
  const timing = timingOf(d);
  return ogCard({
    eyebrow: getOpportunityType(d.type).label.en,
    title: d.name,
    subtitle: d.orgName ?? d.summary,
    badge: isClosed(d) ? "This round has closed" : timing.date ? timing.label : timing.tone === "rolling" ? "Rolling" : null,
  });
}
