/**
 * Blog taxonomy. /blog is a navigation hub; every article lives at
 * /blog/<category>/<slug>, and each category is a hub that can rank on its own: its own
 * title, meta description and intro, breadcrumbs, and a paginated archive (10 per page).
 * A hub without published articles is noindex and stays out of the sitemap.
 *
 * Pure data (no imports): safe in server code, route handlers and tests.
 */

export interface Category {
  slug: string;
  /** Short name for navigation, chips and breadcrumbs. */
  name: string;
  /** The hub page's <title> (also its H1). */
  title: string;
  /** The hub page's meta description. */
  description: string;
  /** Opening paragraph of the hub page. */
  intro: string;
  /** Opportunity type slugs (/opportunities/<slug>) the hub points to when they have live listings. */
  opportunityTypes: string[];
}

export const CATEGORIES: readonly Category[] = [
  {
    slug: "applications-that-win",
    name: "Applications that win",
    title: "Cover letter tips and application writing that gets read",
    description:
      "Cover letter tips with free tools: a generator built from the job post, a length checker, opening and closing builders, letters of interest and professional bios.",
    intro:
      "Most applications are decided by a few lines: the opening of a letter, the last paragraph, a 100-word bio. These pages take one of those pieces at a time, give you a free tool that drafts or checks it in your browser, and explain what the person reading it is looking for.",
    opportunityTypes: ["fellowships", "scholarships", "accelerators", "grants"],
  },
  {
    slug: "careers-and-jobs",
    name: "Careers & jobs",
    title: "Job search tips that turn applications into interviews",
    description:
      "Job search tips you can act on today: free tools for résumé keywords, follow-up emails, interview answers and tracking every application, with the timelines employers use.",
    intro:
      "A job search is a pipeline: the right roles in, the right material out, and steady follow-up in between. Each page here handles one step with a free tool that runs in your browser: pull keywords from a posting, time a follow-up, draft an answer, track what you sent.",
    opportunityTypes: ["graduate-programs", "returnships", "ngo-jobs", "volunteering"],
  },
  {
    slug: "funding-and-startups",
    name: "Funding & startups",
    title: "How to find investors and funding for a startup",
    description:
      "How to find investors and win funding: pitch deck builders, the YC application, SAFE notes, valuation and cap table calculators, accelerators and grant proposals.",
    intro:
      "Founders apply for things constantly: accelerators, competitions, grants, investor intros. These pages give you the calculators and builders for each step (valuation, dilution, deck, application answers) and explain how each kind of application is judged.",
    opportunityTypes: ["accelerators", "incubators", "startup-competitions", "pitch-events", "grants", "government-programs"],
  },
  {
    slug: "academic-life",
    name: "Academic life",
    title: "PhD application and academic job materials, step by step",
    description:
      "PhD application and faculty job guides with free builders: emails to professors, research and teaching statements, research proposals and conference abstracts.",
    intro:
      "Academic careers run on documents that repeat every year: the email to a possible supervisor, the research statement, the teaching statement, the proposal, the abstract. Each page here has a builder for one of them and explains what a committee reads first.",
    opportunityTypes: ["phd-positions", "postdocs", "conference-cfps", "visiting-scholar-programs", "grants"],
  },
  {
    slug: "scholarships-and-fellowships",
    name: "Scholarships & fellowships",
    title: "How to win scholarships, fellowships and grad school places",
    description:
      "How to win scholarships and fellowships: essay outlines, word counters, statement of purpose builders, recommendation requests and how many programs to apply to.",
    intro:
      "Funded programs ask for more than a form: statements, references, essays with hard word limits. Each page here has a free tool for one of those pieces, and the advice is about the same thing every time: say something specific and true, then make it easy for the reader to say yes.",
    opportunityTypes: ["scholarships", "fellowships", "exchange-programs", "degree-programs"],
  },
  {
    slug: "creative-careers",
    name: "Creative careers",
    title: "Open calls for artists, grants and the materials juries ask for",
    description:
      "Open calls for artists, grants and residencies, plus free builders for the materials juries ask for: artist statement, artist bio, artist CV and a creator media kit.",
    intro:
      "Creative opportunities are scattered across thousands of small calls, each with its own format. Residencies, grants and film and music open calls are one click away; the pages here help with what every call asks for: a statement, a bio, a CV and, for creators, a media kit.",
    opportunityTypes: ["open-calls", "residencies", "grants", "awards", "competitions", "brand-partnerships"],
  },
];

export function categoryBySlug(slug: string): Category | null {
  return CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function isCategorySlug(slug: string): boolean {
  return CATEGORIES.some((c) => c.slug === slug);
}
