import { PACKS, PLANS, TRIAL, formatPrice } from "@/content/plans";
import { categoriesWithCounts, postUrl, publishedPosts } from "@/lib/blog";
import { CHANNELS } from "@/lib/core/channels";
import { opportunityTypeBySlug } from "@/lib/core/opportunity-types";
import { getIndexableTargets, getReadyProgramGuides, getSeoData, playbookPath, programGuidePath, regionPath, REGION_LABELS, typePath, typeCounts } from "@/lib/programmatic";
import { absoluteUrl } from "@/lib/seo";
import { SITE } from "@/lib/site";

/*
 * llms.txt: a plain-text map of the site for language models and answer engines. Facts only:
 * what the product does and does not do, prices from the catalogue, and links to the pages
 * that are indexable right now (thin hubs and empty blog topics are listed by name only).
 */

export const revalidate = 3600;

export async function GET() {
  const [{ counts }, targets, programs] = await Promise.all([getSeoData(), getIndexableTargets(), getReadyProgramGuides()]);
  const posts = publishedPosts();
  const indexableTypes = new Set(targets.types.map((t) => t.slug));
  const url = (p: string) => absoluteUrl(p);
  const pro = PLANS.pro;
  const packs = [PACKS.pack10, PACKS.pack40];

  const lines: string[] = [
    `# ${SITE.name}`,
    "",
    `> ${SITE.description}`,
    "",
    `${SITE.name} (${SITE.domain}) is an execution platform for opportunities. A person drops in what they already have (a résumé, a pitch deck, a portfolio, links); ${SITE.name} builds a profile in which every fact cites its source document, finds real opportunities the person can win (jobs, internships, investors, accelerators, competitions, grants, fellowships, scholarships, conference calls for papers, residencies, speaking slots, awards and more), and prepares each application for the person to approve with a tap. It then submits where that is allowed, follows up, and keeps going toward the goal the person set. The site is available in English and Chinese; the opportunity pages and the blog are English-only.`,
    "",
    "## What it will and will not do",
    "- Nothing is submitted without the person's tap, unless they granted a standing authorisation for that category in Settings.",
    "- Every fact in a generated document traces to the person's own documents or an explicit confirmation; unsourced claims are flagged, never invented.",
    "- CAPTCHAs, third-party logins, payments, signatures, ID documents and interviews stay with the person, as a short guided handoff.",
    "- Sites that forbid automation (for example LinkedIn, Common App, government portals, academic submission systems) are never automated: everything is prepared copy-ready for the person to submit.",
    "- Outreach email is personalised per recipient, rate-limited, sent from the person's own Gmail and never bulk.",
    "- Opportunity listings are real public programs linked to their official pages; unknown dates, amounts or rules are shown as \"check the official page\".",
    "",
    "## How applications are sent",
    ...CHANNELS.filter((c) => c.id !== "CH7").map((c) => `- ${c.label.en}: ${c.description.en}`),
    "",
    "## Pricing (USD)",
    `- Free: profile, discovery, matching, previews, document drafts, follow-ups and practice applications. New accounts get ${TRIAL.credits} credits, valid ${TRIAL.expiryDays} days.`,
    `- ${pro.name.en}: ${formatPrice(pro.priceUsd)}/month for ${pro.credits} credits a month. ${pro.features.en.join("; ")}.`,
    ...packs.map((p) => `- ${p.name.en}: ${formatPrice(p.priceUsd)} one-time.`),
    "- 1 credit = one application submitted (any channel, including a confirmed handoff) or one outreach email to a new contact.",
    "",
    "## Key pages",
    `- [How it works](${url("/how-it-works")})`,
    `- [Pricing](${url("/pricing")})`,
    `- [FAQ](${url("/faq")}) · [About](${url("/about")}) · [Contact](${url("/contact")})`,
    `- [Opportunities](${url("/opportunities")}): every kind of opportunity, with live listings and how to win each.`,
    `- [Careers](${url("/careers")}): what each role can apply for.`,
    `- [Guides](${url("/guides")}): playbooks and step-by-step program guides.`,
    ...(posts.length ? [`- [Blog](${url("/blog")})`] : []),
    `- [Terms](${url("/terms")}) · [Privacy](${url("/privacy")}) · [Acceptable use](${url("/acceptable-use")}) · [Refund policy](${url("/refund-policy")}) · [Cookie policy](${url("/cookie-policy")})`,
    "",
    "## Opportunity types",
    ...typeCounts(counts).map(({ def, count }) =>
      indexableTypes.has(def.slug)
        ? `- [${def.plural.en}](${url(typePath(def.slug))}) (${count} open): ${def.description.en} Playbook: ${url(playbookPath(def.slug))}`
        : `- ${def.plural.en}${count ? ` (${count} open)` : ""}: ${def.description.en} Playbook: ${url(playbookPath(def.slug))}`,
    ),
  ];

  if (targets.regions.length) {
    lines.push("", "## Opportunities by region");
    for (const r of targets.regions) {
      const name = opportunityTypeBySlug(r.typeSlug)?.plural.en ?? r.typeSlug;
      lines.push(`- [${name}: ${REGION_LABELS[r.region]}](${url(regionPath(r.typeSlug, r.region))}) (${r.count} open)`);
    }
  }

  if (programs.length) {
    lines.push("", "## Program guides");
    for (const l of programs.slice(0, 60)) lines.push(`- [How to apply to ${l.name}](${url(programGuidePath(l.slug))})${l.orgName ? ` (${l.orgName})` : ""}`);
  }

  lines.push("", "## Blog topics");
  for (const c of categoriesWithCounts(posts)) {
    lines.push(c.count ? `- [${c.name}](${url(`/blog/${c.slug}`)}) (${c.count} article${c.count === 1 ? "" : "s"}): ${c.description}` : `- ${c.name} (articles coming): ${c.description}`);
  }
  if (posts.length) {
    lines.push("", "## Articles");
    for (const p of posts) lines.push(`- [${p.title}](${url(postUrl(p))}) (updated ${p.updatedAt}): ${p.description}`);
  }

  lines.push("", `Contact: ${SITE.email}`, "");
  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600, stale-while-revalidate=86400" },
  });
}
