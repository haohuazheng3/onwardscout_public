/**
 * Long-form copy for the marketing pages (home, how it works, about) as typed, bilingual data.
 * Short UI strings (headings, buttons, metadata) live in messages/<locale>/site.json; this module
 * holds the structured lists those pages render: the six steps, the automation boundary, the
 * principles, the channels in plain words, the handoff, the safety rules and the brand story.
 *
 * TODO-zh: every `todoZh("…")` repeats the English text as its Chinese placeholder until the
 * translation pass replaces it with `bi("English", "中文")`. Pure and isomorphic.
 */
import { bi, localize, type Bilingual } from "@/lib/core/labels";
import type { ChannelId, OpportunityTypeId } from "@/lib/core/types";

export type { Bilingual };

/** English now, Chinese later: the `zh` field repeats the English text. TODO-zh */
export function todoZh(en: string): Bilingual {
  return { en, zh: en };
}

/** The label for a locale (unknown locales read English). */
export function pick(label: Bilingual, locale: string): string {
  return localize(label, locale);
}

/* ------------------------------------------------------------------ the six steps */

export type StepId = "drop" | "profile" | "goals" | "tap" | "prepare" | "loop";

export interface Step {
  id: StepId;
  title: Bilingual;
  /** One or two sentences: the home page shows only this. */
  body: Bilingual;
  /** What the person does at this step (deep version on /how-it-works). */
  you: Bilingual;
  /** What Onward Scout does at this step. */
  we: Bilingual;
}

export const STEPS: readonly Step[] = [
  {
    id: "drop",
    title: todoZh("Drop in what you have"),
    body: todoZh("A résumé, a deck, a portfolio, a paper or a few links. No forms: we read them and tell you what we found."),
    you: todoZh("Drag in the files you already have, or paste links to your site, GitHub or ORCID. LinkedIn can't be read automatically, so export your profile as a PDF and drop that in."),
    we: todoZh(
      "We extract the text, recognise what each file is and pull out roles, education, projects, results, publications and skills. You can start before signing in; your draft is saved when you sign in with your email.",
    ),
  },
  {
    id: "profile",
    title: todoZh("Confirm your profile"),
    body: todoZh("Who you are, your field, stage and location as tags you can tap to change. Every fact links to the line it came from."),
    you: todoZh("Glance at the tags and tap to fix anything we read wrong. If something important is missing, we ask with options to pick — never more than three questions at once."),
    we: todoZh(
      "We keep a source for every fact: which document and which words. Anything we couldn't trace to your documents is flagged for you to confirm, never quietly added.",
    ),
  },
  {
    id: "goals",
    title: todoZh("Choose goals and define success"),
    body: todoZh("A role, a round, a grant, a publication — and what success means by when. We break it into milestones."),
    you: todoZh("Pick one or more goals (they are pre-selected from your profile) and choose a success definition, such as “a senior design role, remote, within four months”."),
    we: todoZh(
      "We turn the definition into three to six milestones you can check, and a weekly plan: which kinds of opportunity first, how many per week, when to follow up and when to change tack.",
    ),
  },
  {
    id: "tap",
    title: todoZh("Tap the openings you want"),
    body: todoZh("Real opportunities ranked by fit, each with the reasons, the deadline, what it asks for and what it needs from you."),
    you: todoZh("For each pick: Apply for me, Later, or Not for me (with a reason, so the next picks get better)."),
    we: todoZh(
      "We filter out what you aren't eligible for, rank the rest by fit, chance and effort, and show why each one made the list. Unknown details are shown as “check the official page”, never guessed.",
    ),
  },
  {
    id: "prepare",
    title: todoZh("We prepare, you confirm"),
    body: todoZh("We read the requirements, ask only for what's missing, draft the materials from your facts and fill the form or the email."),
    you: todoZh("Review the prepared application — every answer shows the facts it used — and tap Submit. If the site needs your login, a CAPTCHA or a payment, you get a short handoff with everything ready."),
    we: todoZh(
      "We pick the channel the opportunity allows (a hosted job form, a web form, an email from your Gmail or a handoff), submit after your tap and keep proof: the confirmation page, a reference or the sent message.",
    ),
  },
  {
    id: "loop",
    title: todoZh("We follow up and keep going"),
    body: todoZh("Follow-ups scheduled, replies sorted, new picks every week — until you reach the success you defined or change course."),
    you: todoZh("Look at your board when something needs you. Forward replies to your personal drop-box address, or tap “they replied”."),
    we: todoZh(
      "We schedule polite follow-ups, sort replies (interested, meeting, needs more information, rejected), move milestones forward and bring new picks each week. If something isn't working, we suggest a different route.",
    ),
  },
];

/* ------------------------------------------------------------------ automation boundary (plan §12.1) */

export type BoundaryTone = "auto" | "tap" | "you";

export interface BoundaryRow {
  step: Bilingual;
  who: Bilingual;
  how: Bilingual;
  tone: BoundaryTone;
}

export const BOUNDARY: readonly BoundaryRow[] = [
  {
    step: todoZh("Reading your documents, building your profile, matching, drafting documents"),
    who: todoZh("Automatic"),
    how: todoZh("Runs in the background. You check the result, with a source next to every fact."),
    tone: "auto",
  },
  {
    step: todoZh("Filling in web forms"),
    who: todoZh("Mostly automatic"),
    how: todoZh("Adapters for hosted job forms and common web forms; a browser agent for the rest. It stops and hands over at a CAPTCHA or a login."),
    tone: "auto",
  },
  {
    step: todoZh("Sending emails and follow-ups"),
    who: todoZh("Automatic once you connect Gmail"),
    how: todoZh("From your own Gmail, one person at a time, after your approval — or under a follow-up rule you switched on yourself."),
    tone: "auto",
  },
  {
    step: todoZh("Submitting an application"),
    who: todoZh("One tap from you"),
    how: todoZh("Every submission waits for your confirmation, unless you gave a standing authorization for that category in Settings."),
    tone: "tap",
  },
  {
    step: todoZh("Creating accounts and logging in to other sites"),
    who: todoZh("You, once"),
    how: todoZh("We never ask for or keep your passwords for other sites."),
    tone: "you",
  },
  {
    step: todoZh("CAPTCHAs and two-factor codes"),
    who: todoZh("You"),
    how: todoZh("We pause, tell you exactly where, and continue once you're through."),
    tone: "you",
  },
  {
    step: todoZh("Application fees and payments"),
    who: todoZh("You"),
    how: todoZh("We show the cost up front and take you to the payment step with everything else ready."),
    tone: "you",
  },
  {
    step: todoZh("Signatures, ID documents and contracts"),
    who: todoZh("You"),
    how: todoZh("We list what's needed so nothing is missing when you sign."),
    tone: "you",
  },
  {
    step: todoZh("Interviews, pitches and tests"),
    who: todoZh("You"),
    how: todoZh("We prepare the materials you'll bring. The conversation is yours."),
    tone: "you",
  },
];

/* ------------------------------------------------------------------ principles */

export type PrincipleId = "true-facts" | "your-tap" | "your-data";

export const PRINCIPLES: readonly { id: PrincipleId; title: Bilingual; body: Bilingual }[] = [
  {
    id: "true-facts",
    title: todoZh("Only true facts"),
    body: todoZh(
      "Everything we write for you traces to something you uploaded or confirmed. If a form asks for something we can't source, we ask you. We never invent a number, a title, a degree or a result.",
    ),
  },
  {
    id: "your-tap",
    title: todoZh("Nothing is sent without your tap"),
    body: todoZh(
      "Every application and every email waits for your confirmation, unless you set a standing rule for that category yourself. You can pause everything at any time.",
    ),
  },
  {
    id: "your-data",
    title: todoZh("Your data is yours"),
    body: todoZh(
      "Export it or delete it from Settings. Your documents are never sold, never used to train AI models, and only sent where they are needed to do the job you asked for.",
    ),
  },
];

/* ------------------------------------------------------------------ what it finds (home) */

/** Opportunity types shown on the home page, in display order (all exist in src/lib/core/opportunity-types). */
export const HOME_TYPES: readonly OpportunityTypeId[] = [
  "job",
  "internship",
  "remote_job",
  "investor",
  "accelerator",
  "startup_competition",
  "grant",
  "fellowship",
  "scholarship",
  "conference_cfp",
  "phd_position",
  "residency",
  "open_call",
  "speaking",
  "brand_partnership",
  "award",
  "hackathon",
  "exhibition",
  "government_program",
  "exchange_program",
  "mentorship",
  "podcast",
  "returnship",
];

/* ------------------------------------------------------------------ channels in plain words */

/** One plain sentence per channel; the label and "what you do" come from src/lib/core/channels. */
export const CHANNEL_PLAIN: Record<ChannelId, Bilingual> = {
  CH1: todoZh(
    "Job postings hosted on Greenhouse, Lever or Ashby publish their exact questions. We read them from the public posting and prepare every answer before anything is opened. Employers' private submission APIs need their key, so we never claim to use them.",
  ),
  CH2: todoZh(
    "Google Forms and simple web forms without CAPTCHAs: we fill each field, show you the filled form, submit when you tap and keep the confirmation page as proof.",
  ),
  CH3: todoZh(
    "Any other web form: a browser opens the official page, fills it from your profile and saves a screenshot of every step. It only goes to the opportunity's own site, treats page text as information rather than instructions, and stops at CAPTCHAs, logins and payments.",
  ),
  CH4: todoZh(
    "Email from your own Gmail, for investors, recruiters, professors, editors, brands and clients: one personal message per person, never a blast, with daily and weekly limits and no repeat email to the same person within 30 days. Without Gmail, you get the text ready to send yourself.",
  ),
  CH5: todoZh(
    "Documents: cover letters, one-pagers, statements, bios and answers drafted from your sourced facts, downloadable as PDF or Word, with each sentence linked to the facts it used.",
  ),
  CH6: todoZh(
    "Handoff: when a site needs your own login or forbids automation, every field, file and step is prepared in the form's order with the exact link, and you paste it in.",
  ),
  CH7: todoZh(
    "Direct connections with organisations that accept applications from Onward Scout. Not live yet: no organisation is connected today.",
  ),
};

/* ------------------------------------------------------------------ the handoff */

export const HANDOFF = {
  why: todoZh(
    "Some places can't or shouldn't be automated: LinkedIn, Indeed and Glassdoor forbid it, Chinese job apps and most government, university and journal systems need your own account, and CAPTCHAs, payments and two-factor codes exist precisely so that a person is present. We don't pretend otherwise. We prepare everything and hand you the last step.",
  ),
  short: todoZh(
    "When it's only a CAPTCHA, a login or a payment, it's a 30-second step: open the link, do the one thing, come back.",
  ),
  long: todoZh(
    "When a platform forbids automation entirely, you paste the prepared fields in order. It usually takes a few minutes, and there is nothing to write.",
  ),
  contains: [
    todoZh("The exact link to the official form or portal"),
    todoZh("Every field in the order the form asks for it, each with a one-tap copy button"),
    todoZh("Your files — tailored résumé, cover letter, statement — ready to download"),
    todoZh("Step-by-step notes that fit on a phone screen"),
    todoZh("An “I submitted it” button, with an optional confirmation link or screenshot as proof"),
  ],
  where: [
    todoZh("LinkedIn Easy Apply, Indeed and Glassdoor"),
    todoZh("Chinese job apps and campus-recruiting systems"),
    todoZh("Government, grant and public-sector portals"),
    todoZh("Conference and journal submission systems such as OpenReview or EasyChair"),
    todoZh("Common App and university application portals"),
    todoZh("Any form behind a login, a CAPTCHA or a payment"),
  ],
} as const;

/* ------------------------------------------------------------------ safety and honesty rules */

export const SAFETY_RULES: readonly { title: Bilingual; body: Bilingual }[] = [
  {
    title: todoZh("Facts come with sources"),
    body: todoZh(
      "Each fact in your profile records the document and the words it came from. Generated documents cite the facts behind each sentence; anything unsourced is highlighted for you instead of being sent.",
    ),
  },
  {
    title: todoZh("Your tap, or your rule"),
    body: todoZh(
      "Every submission and every email waits for your confirmation. The only exception is a standing authorization you switch on yourself in Settings, for a category you choose, and you can switch it off at any time.",
    ),
  },
  {
    title: todoZh("A record of what you approved"),
    body: todoZh(
      "Each application keeps a step log: what was prepared, what you confirmed and when, what was submitted and the proof that came back.",
    ),
  },
  {
    title: todoZh("Outreach that respects people"),
    body: todoZh(
      "Emails are written for one recipient at a time and sent from your own Gmail, with daily and weekly limits. Nobody is emailed twice within 30 days, and anyone who asks not to be contacted never is again.",
    ),
  },
  {
    title: todoZh("Only the official site"),
    body: todoZh(
      "Automated form filling only visits the opportunity's own website. Text on those pages is treated as information, never as instructions to follow.",
    ),
  },
  {
    title: todoZh("Real opportunities only"),
    body: todoZh(
      "Opportunities come from public postings and official program pages, with their real links. When a deadline, amount or rule is unknown, we say “check the official page” rather than guess.",
    ),
  },
  {
    title: todoZh("Extra care for under-18s"),
    body: todoZh("High-school students need a parent or guardian's email to use Onward Scout, and outreach email is switched off for them."),
  },
  {
    title: todoZh("Practice without consequences"),
    body: todoZh(
      "A free practice application runs the whole flow against our own test form, so you can see exactly what happens before anything reaches a real organisation.",
    ),
  },
];

/** How drafted text is labelled (production runs our own drafting engine until AI drafting is switched on). */
export const DRAFT_LABELS = {
  local: {
    label: todoZh("Drafted from your profile"),
    body: todoZh(
      "Assembled by our own engine from your sourced facts, sentence by sentence. Nothing leaves our servers to write it. Where an answer needs your own reasons — why this role, why this program — we ask you for a sentence or two instead of inventing them.",
    ),
  },
  ai: {
    label: todoZh("Written with AI"),
    body: todoZh(
      "When AI drafting is switched on, a language model polishes the draft using only your facts, and the result is labelled so you always know. The same rule applies: claims without a source are flagged, not sent.",
    ),
  },
} as const;

/* ------------------------------------------------------------------ about */

export const ABOUT = {
  story: [
    todoZh(
      "A scout goes ahead of the group. They find the way, notice the openings, and come back with what they found so everyone else can move with confidence.",
    ),
    todoZh("Onward is the direction: forward, toward the thing you decided you want."),
    todoZh(
      "Onward Scout is both at once. We go ahead into the job boards, program pages, funds, calls and inboxes you don't have time to search; we come back with the openings you can actually win; and then we carry the paperwork most of the remaining way, so the effort goes into what you're good at instead of into forms.",
    ),
  ],
  beliefs: [
    {
      title: todoZh("Opportunity is unevenly found, not unevenly deserved."),
      body: todoZh(
        "Most people miss the grant, the fellowship or the role they'd have won simply because they never saw it, or saw it the day after the deadline. Finding should not depend on having time, a network or someone who knows where to look.",
      ),
    },
    {
      title: todoZh("Effort belongs in the work, not in the forms."),
      body: todoZh(
        "Retyping the same history into the hundredth portal teaches nobody anything. The forms should take seconds of your attention; your craft, your research and your company should take the rest.",
      ),
    },
    {
      title: todoZh("Honesty compounds."),
      body: todoZh(
        "An application built on true, sourced facts can be defended in any interview. Invented polish wins nothing worth keeping, and it costs the trust of every reviewer who reads the next one.",
      ),
    },
    {
      title: todoZh("Automation should know its limits."),
      body: todoZh(
        "Some steps belong to you: your login, your signature, your payment, your conversation. We design those as a clear handoff instead of hiding them behind a promise of magic.",
      ),
    },
  ],
  howWeWork: [
    {
      title: todoZh("One profile, whoever you are"),
      body: todoZh(
        "Student, employee, founder, researcher, creator, licensed professional, between careers — or two of these at once. One engine, one profile, one board.",
      ),
    },
    {
      title: todoZh("Sources before sentences"),
      body: todoZh("Every fact has a source; every document cites its facts. Unsourced claims are flagged, never invented."),
    },
    {
      title: todoZh("Your tap before anything leaves"),
      body: todoZh("Nothing is submitted or sent without your confirmation, or a standing rule you set yourself."),
    },
    {
      title: todoZh("Real openings, real links"),
      body: todoZh("Opportunities come from public postings and official pages. Unknown details stay unknown: “check the official page”."),
    },
    {
      title: todoZh("Plain about what we can't do"),
      body: todoZh("CAPTCHAs, logins, payments, signatures and interviews stay with you, as a short, well-prepared handoff."),
    },
    {
      title: todoZh("Paid for by the people we help"),
      body: todoZh(
        "You pay when something is submitted for you. No ads, no selling data, no fees from the organisations you apply to.",
      ),
    },
  ],
  company: [
    todoZh(
      "Onward Scout is a new, independent product, launched in 2026 and in early access. You won't find a wall of logos, user counts or testimonials here: we'd rather show you exactly how the product works until there are real results to report.",
    ),
    todoZh(
      "We answer every message ourselves. If something is unclear, wrong or missing — an opportunity, a policy, a feature — write to us and it reaches a person.",
    ),
  ],
} as const;

/* ------------------------------------------------------------------ small shared lists */

/** What's free, everywhere it's listed (home teaser, pricing). */
export const FREE_INCLUDES: readonly Bilingual[] = [
  todoZh("Your profile, with a source for every fact"),
  todoZh("Matching and ranked picks for your goals"),
  todoZh("Previews and document drafts"),
  todoZh("Follow-up emails on applications you've sent"),
  todoZh("Practice applications, end to end"),
];

/** Bilingual helper re-exported for data files that do have both languages. */
export { bi };
