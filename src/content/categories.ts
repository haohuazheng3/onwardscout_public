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
}

export const CATEGORIES: readonly Category[] = [
  {
    slug: "applications-that-win",
    name: "Applications that win",
    title: "How to write applications that get accepted",
    description:
      "Practical guides to the parts of an application that decide it: the first lines of a cover letter, short answers, personal statements, pitch decks and follow-ups.",
    intro:
      "Most applications are decided by a few lines: the opening of a letter, a 150-word answer, the first slide of a deck. These guides take one of those pieces at a time and show what reviewers look for, how to say true things about yourself clearly, and what to leave out.",
  },
  {
    slug: "careers-and-jobs",
    name: "Careers & jobs",
    title: "Job search and career moves, step by step",
    description:
      "How to find roles worth applying to, tailor a résumé without inventing anything, get referrals, work with recruiters and move into a new field or a new country.",
    intro:
      "A job search is a pipeline: the right roles in, the right material out, and steady follow-up in between. These guides cover each stage, from finding openings that fit to answering screening questions and changing direction mid-career.",
  },
  {
    slug: "funding-and-startups",
    name: "Funding & startups",
    title: "Funding, accelerators and programs for founders",
    description:
      "Guides for founders: how accelerator and incubator applications are read, what to put in a deck and a one-pager, startup competitions, grants and government programs.",
    intro:
      "Founders apply for things constantly: accelerators, competitions, grants, demo days, investor intros. These guides explain how each kind of application is judged and how to prepare the deck, numbers and story once, then reuse them honestly.",
  },
  {
    slug: "academic-life",
    name: "Academic life",
    title: "Research careers: submissions, grants and positions",
    description:
      "Guides for researchers and PhD students: conference and journal submissions, research grants, PhD and postdoc applications, visiting positions and academic service.",
    intro:
      "Academic careers run on deadlines that repeat every year: calls for papers, grant rounds, PhD and postdoc intakes. These guides cover how each one works, what reviewers check first, and how to plan a year of submissions without missing the ones that matter.",
  },
  {
    slug: "scholarships-and-fellowships",
    name: "Scholarships & fellowships",
    title: "Scholarships, fellowships and funded programs",
    description:
      "How scholarship and fellowship selection works, how to read eligibility rules, write personal statements, ask for references and plan applications around deadlines.",
    intro:
      "Funded programs ask for more than money-free forms: statements, references, transcripts and sometimes interviews. These guides explain each part, how to check you are eligible before you start, and how to reuse one strong statement across several applications without making it generic.",
  },
  {
    slug: "creative-careers",
    name: "Creative careers",
    title: "Residencies, open calls and paid creative work",
    description:
      "Guides for artists, writers, designers and creators: residencies, open calls, creative grants, brand partnerships, platform programs and building a portfolio that gets selected.",
    intro:
      "Creative opportunities are scattered across thousands of small calls with their own formats. These guides cover how selection panels read a portfolio and an artist statement, how to judge whether a call is worth the fee, and how to pitch brands and platforms.",
  },
];

export function categoryBySlug(slug: string): Category | null {
  return CATEGORIES.find((c) => c.slug === slug) ?? null;
}

export function isCategorySlug(slug: string): boolean {
  return CATEGORIES.some((c) => c.slug === slug);
}
