/**
 * Questions people actually ask before trusting a service to apply on their behalf. Used by
 * /faq (all, grouped, FAQPage JSON-LD), /pricing (billing group) and the home page teaser.
 * Answers are plain text (they go into JSON-LD verbatim) and must stay true to how the product
 * works today: if a behaviour changes, change the answer in the same commit.
 *
 * TODO-zh: `todoZh("…")` repeats the English as the Chinese placeholder until the translation pass.
 */
import { todoZh, type Bilingual } from "./site-copy";

export const FAQ_GROUPS = ["how", "honesty", "data", "channels", "billing", "accounts"] as const;
export type FaqGroup = (typeof FAQ_GROUPS)[number];

export const FAQ_GROUP_LABELS: Record<FaqGroup, Bilingual> = {
  how: todoZh("How it works"),
  honesty: todoZh("Honesty and safety"),
  data: todoZh("Data and privacy"),
  channels: todoZh("Channels and platforms"),
  billing: todoZh("Billing and credits"),
  accounts: todoZh("Your account"),
};

export interface Faq {
  /** Stable anchor: /faq#<id>. */
  id: string;
  group: FaqGroup;
  q: Bilingual;
  a: Bilingual;
  /** Optional page that explains more (unprefixed path). */
  more?: { href: string; label: Bilingual };
}

export const FAQS: readonly Faq[] = [
  /* ------------------------------------------------------------ how it works */
  {
    id: "what-it-does",
    group: "how",
    q: todoZh("What does Onward Scout actually do?"),
    a: todoZh(
      "It turns the documents you already have into a profile where every fact has a source, finds real opportunities you can win — jobs, internships, investors, accelerators, grants, fellowships, calls for papers, residencies, competitions and more — and prepares each application for you. You tap the ones you want, confirm, and we submit, follow up and keep going toward the goal you set.",
    ),
    more: { href: "/how-it-works", label: todoZh("How it works") },
  },
  {
    id: "what-to-upload",
    group: "how",
    q: todoZh("What do I need to upload?"),
    a: todoZh(
      "Whatever you already have: a résumé or CV, a pitch deck, a portfolio, a transcript, papers, certificates, or links to your website, GitHub or ORCID. PDF, Word, PowerPoint and plain text all work. LinkedIn can't be read automatically, so save your LinkedIn profile as a PDF and upload that. Please don't upload passports or ID cards; we don't need them.",
    ),
  },
  {
    id: "do-i-write",
    group: "how",
    q: todoZh("Do I have to fill in forms or write anything?"),
    a: todoZh(
      "Rarely. Fields are filled from your profile, and when something is missing we ask with options to tap, at most three questions at a time. When an application asks something only you can answer — why you want this particular role or program — we ask you for a sentence or two instead of inventing your motivation.",
    ),
  },
  {
    id: "what-it-finds",
    group: "how",
    q: todoZh("What kinds of opportunities can it find?"),
    a: todoZh(
      "Jobs and internships, graduate programs and returnships; investors, accelerators, incubators, pitch competitions and trade shows; grants, fellowships, scholarships, awards and hackathons; calls for papers, journals, PhD, postdoc and visiting positions; residencies, open calls and brand partnerships; speaking slots, podcasts and media; communities and events. The library grows as we add sources.",
    ),
    more: { href: "/opportunities", label: todoZh("Browse opportunities") },
  },
  {
    id: "how-ranked",
    group: "how",
    q: todoZh("How are opportunities chosen for me?"),
    a: todoZh(
      "First we remove what you aren't eligible for: wrong level, location, language, work authorization or a passed deadline. Then we rank the rest by fit, your chances and the effort involved, and show the reasons and the gaps for each one. Tell us why something isn't for you, and the next picks take it into account.",
    ),
  },
  {
    id: "two-goals",
    group: "how",
    q: todoZh("Can I pursue more than one goal at a time?"),
    a: todoZh(
      "Yes. You can run a job search and a PhD application, or a fundraise and a speaking push, side by side. Each goal has its own success definition and milestones; your board shows them together.",
    ),
  },

  /* ------------------------------------------------------------ honesty and safety */
  {
    id: "make-things-up",
    group: "honesty",
    q: todoZh("Will you exaggerate or make things up to improve my chances?"),
    a: todoZh(
      "No. Every fact in a generated document traces to a document you uploaded or something you confirmed. Claims we can't source are highlighted for you, never sent quietly. We reflect a posting's keywords only where your record supports them.",
    ),
  },
  {
    id: "without-me",
    group: "honesty",
    q: todoZh("Can anything be submitted without me knowing?"),
    a: todoZh(
      "No. Each application and each email waits for your tap. The only exception is a standing authorization you switch on yourself in Settings for a category you choose — for example, automatic follow-ups — and you can switch it off at any time. Every submission keeps a record of what you approved and when.",
    ),
  },
  {
    id: "ai-labels",
    group: "honesty",
    q: todoZh("What do “Drafted from your profile” and “Written with AI” mean?"),
    a: todoZh(
      "They tell you how a draft was made. “Drafted from your profile” means our own engine assembled it from your sourced facts, without sending anything to an AI provider. “Written with AI” means a language model polished it, using only your facts. Either way, every sentence shows the facts it used.",
    ),
  },
  {
    id: "guarantee",
    group: "honesty",
    q: todoZh("Do you guarantee I'll get the job, the funding or the place?"),
    a: todoZh(
      "No, and nobody honest can. Decisions belong to the organisations you apply to. What we can promise is that you'll see more of the right opportunities, apply to more of them with less effort, and never be misrepresented.",
    ),
  },
  {
    id: "spam",
    group: "honesty",
    q: todoZh("How do you stop outreach from turning into spam?"),
    a: todoZh(
      "Each email is written for one person and sent from your own Gmail, never in bulk. There are daily and weekly limits, nobody is emailed twice within 30 days, and anyone who asks not to be contacted is never contacted again.",
    ),
  },
  {
    id: "minors",
    group: "honesty",
    q: todoZh("Can high-school students use Onward Scout?"),
    a: todoZh(
      "Yes, with a parent or guardian: we ask for a guardian's email, and outreach email is switched off for under-18s. Onward Scout is not for children under 13.",
    ),
  },

  /* ------------------------------------------------------------ data and privacy */
  {
    id: "who-sees",
    group: "data",
    q: todoZh("Who can see my documents?"),
    a: todoZh(
      "You, and the organisations you approve an application to. Files are kept in private storage and opened through short-lived links. They are sent to a service provider only when it's needed for a task you asked for — for example, to an AI provider for drafting when AI drafting is switched on.",
    ),
    more: { href: "/privacy", label: todoZh("Privacy policy") },
  },
  {
    id: "training",
    group: "data",
    q: todoZh("Do you use my data to train AI models?"),
    a: todoZh(
      "No. We don't train models on your data, and under our AI provider's commercial terms the content we send through its API isn't used to train its models either. Today most drafting runs on our own engine, which sends nothing anywhere.",
    ),
  },
  {
    id: "delete",
    group: "data",
    q: todoZh("How do I export or delete my data?"),
    a: todoZh(
      "In Settings you can download everything we hold about you and delete your account. Deleting removes your profile, documents, applications and messages; billing records are kept as long as accounting law requires.",
    ),
  },
  {
    id: "gmail-read",
    group: "data",
    q: todoZh("Do you read my Gmail?"),
    a: todoZh(
      "No. If you connect Gmail, we ask only for permission to send email on your behalf, plus your address so we know which account it is. We can't read your inbox. To let us see a reply, forward it to your personal drop-box address or paste it into the application.",
    ),
  },
  {
    id: "analytics",
    group: "data",
    q: todoZh("What does your analytics tool record?"),
    a: todoZh(
      "We use one analytics tool, FlowGlance. Besides page views and clicks, its detailed capture records text typed into forms on our site and images uploaded through it. In the EU, the UK and Switzerland it only runs after you accept; elsewhere it runs by default and you can opt out from “Cookie settings” in the footer.",
    ),
    more: { href: "/cookie-policy", label: todoZh("Cookie policy") },
  },

  /* ------------------------------------------------------------ channels and platforms */
  {
    id: "linkedin",
    group: "channels",
    q: todoZh("Why can't you apply on LinkedIn or Indeed for me?"),
    a: todoZh(
      "Because those platforms forbid automated applications, and doing it anyway would put your account at risk. Instead we prepare a handoff: your cover letter, answers and files in the order their form asks for them, with the exact link. You paste them in and tap “I submitted it”.",
    ),
  },
  {
    id: "handoff",
    group: "channels",
    q: todoZh("What is a 30-second handoff?"),
    a: todoZh(
      "The moment a person is genuinely needed — a CAPTCHA, a login, a payment, a signature. We stop, tell you exactly what's needed, and have everything else ready. A CAPTCHA or login takes seconds; pasting a whole prepared form into a platform that forbids automation takes a few minutes, with nothing to write.",
    ),
    more: { href: "/how-it-works#handoff", label: todoZh("The handoff, explained") },
  },
  {
    id: "captcha",
    group: "channels",
    q: todoZh("What happens when a form has a CAPTCHA or needs a login?"),
    a: todoZh(
      "We never try to get around it. The application moves to “Needs you”, you get a notification, and the handoff panel shows the link, the step that's needed and every prepared field. Once you've done it, tap “I submitted it” and we carry on with the follow-up.",
    ),
  },
  {
    id: "email-how",
    group: "channels",
    q: todoZh("How do you send emails for me?"),
    a: todoZh(
      "Connect your Gmail once, with send-only permission. Each email is drafted for one recipient, shown to you, and sent from your own address after you approve it. Without Gmail, you get the finished text and a link that opens it in your own email app.",
    ),
  },
  {
    id: "practice",
    group: "channels",
    q: todoZh("What is a practice application?"),
    a: todoZh(
      "A free, complete run of the whole flow against our own test form: we prepare the answers and documents, you confirm, we submit and show you the confirmation. Nothing reaches a real organisation, and it costs no credits.",
    ),
  },

  /* ------------------------------------------------------------ billing and credits */
  {
    id: "credit",
    group: "billing",
    q: todoZh("What is a credit?"),
    a: todoZh(
      "One credit is one application submitted for you through any channel, including a handoff you confirm, or one outreach email to a new contact. Follow-ups, drafts and practice applications don't use credits.",
    ),
  },
  {
    id: "free",
    group: "billing",
    q: todoZh("What can I do for free?"),
    a: todoZh(
      "Build your profile, get matched and ranked picks, see previews and document drafts, send follow-ups and run practice applications — all free, with no time limit. New accounts also get 3 credits, valid for 60 days, to submit their first real applications.",
    ),
  },
  {
    id: "failed",
    group: "billing",
    q: todoZh("What happens to my credit if a submission fails?"),
    a: todoZh(
      "You keep it. A credit is reserved when you confirm and only spent once the application is actually submitted. If it fails, you withdraw it, or the deadline passes first, the credit comes back automatically.",
    ),
  },
  {
    id: "cancel",
    group: "billing",
    q: todoZh("Can I cancel Pro at any time?"),
    a: todoZh(
      "Yes. Cancel from Billing in your account. You keep Pro until the end of the period you paid for, and credits from that period stay usable for 30 days after it ends. Nothing renews after you cancel.",
    ),
  },
  {
    id: "expiry",
    group: "billing",
    q: todoZh("Do credits expire?"),
    a: todoZh(
      "Yes. Free starter credits last 60 days. Pro credits stay usable for 30 days after the month they belong to. Pack credits last 180 days from purchase.",
    ),
  },
  {
    id: "refund",
    group: "billing",
    q: todoZh("Can I get a refund?"),
    a: todoZh(
      "Yes, within 14 days of a charge, if none of the credits from that charge have been used. Write to contact@onwardscout.com from the email you sign in with. Credits spent on submitted applications can't be refunded, and failed submissions never use a credit in the first place.",
    ),
    more: { href: "/refund-policy", label: todoZh("Refund policy") },
  },

  /* ------------------------------------------------------------ accounts */
  {
    id: "no-account",
    group: "accounts",
    q: todoZh("Do I need an account to start?"),
    a: todoZh(
      "No. You can drop in your documents and see what we find before signing in. To save your profile and apply, sign in with your email; the draft you started moves into your account.",
    ),
  },
  {
    id: "sign-in",
    group: "accounts",
    q: todoZh("How do I sign in?"),
    a: todoZh(
      "With your email address and a one-time code we send to it. There's no password to remember and no separate sign-up: a new email creates your account in the same step.",
    ),
  },
  {
    id: "languages",
    group: "accounts",
    q: todoZh("Which languages does Onward Scout support?"),
    a: todoZh(
      "The site and the app are in English and Chinese. Your documents can be in any language, and drafts can be written in English or Chinese, whichever the opportunity calls for.",
    ),
  },
  {
    id: "contact",
    group: "accounts",
    q: todoZh("How do I reach a person?"),
    a: todoZh("Write to contact@onwardscout.com or use the contact form. We reply to every message within two business days."),
    more: { href: "/contact", label: todoZh("Contact") },
  },
];

/** The home page teaser, in display order. */
export const HOME_FAQ_IDS = ["what-it-does", "do-i-write", "without-me", "linkedin", "free"] as const;

export function faqsByGroup(group: FaqGroup): Faq[] {
  return FAQS.filter((f) => f.group === group);
}

export function faqsById(ids: readonly string[]): Faq[] {
  const byId = new Map(FAQS.map((f) => [f.id, f]));
  return ids.map((id) => byId.get(id)).filter((f): f is Faq => Boolean(f));
}
