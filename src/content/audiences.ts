/**
 * The six audience landing pages (/for/[audience]). Each one is written for that audience —
 * their goals, the opportunity types we chase for them, a worked example, what to upload, what a
 * week looks like and what stays with them — not one template with the nouns swapped.
 *
 * Worked examples are illustrations (labelled "Example" on the page): no real person, no real
 * program names, no outcome numbers. Opportunity types are ids from src/lib/core/opportunity-types.
 *
 * TODO-zh: `todoZh("…")` repeats the English as the Chinese placeholder until the translation pass.
 */
import type { Audience } from "@/i18n/site-nav";
import type { IdentityGroup, OpportunityTypeId } from "@/lib/core/types";
import { todoZh, type Bilingual } from "./site-copy";

export interface AudienceGoal {
  title: Bilingual;
  body: Bilingual;
  types: OpportunityTypeId[];
}

export interface AudienceContent {
  slug: Audience;
  /** Identity groups (plan §2) this page speaks to. */
  groups: IdentityGroup[];
  metaTitle: Bilingual;
  metaDescription: Bilingual;
  eyebrow: Bilingual;
  title: Bilingual;
  lede: Bilingual;
  /** Four short items for the home page card. */
  teaser: Bilingual;
  goals: AudienceGoal[];
  /** The opportunity types we chase for this audience, each with one line on why. */
  types: { id: OpportunityTypeId; why: Bilingual }[];
  example: { persona: Bilingual; steps: { label: Bilingual; text: Bilingual }[] };
  uploads: { title: Bilingual; note: Bilingual }[];
  weekly: Bilingual[];
  /** What stays with the person, specific to this audience. */
  yours: Bilingual[];
  note?: Bilingual;
  faqs: { q: Bilingual; a: Bilingual }[];
}

const L = {
  drops: todoZh("Drops in"),
  profile: todoZh("Profile"),
  goal: todoZh("Goal"),
  picks: todoZh("This week's picks"),
  sent: todoZh("Prepared and submitted"),
  handoff: todoZh("Handoff"),
};

export const AUDIENCE_CONTENT: Record<Audience, AudienceContent> = {
  students: {
    slug: "students",
    groups: ["S"],
    metaTitle: todoZh("For students: internships, scholarships, summer programs and first jobs"),
    metaDescription: todoZh(
      "Drop in your CV and transcript. Onward Scout finds internships, scholarships, summer programs, hackathons and graduate schemes you're eligible for, prepares each application from your own record and submits it after your tap.",
    ),
    eyebrow: todoZh("For students"),
    title: todoZh("Your first yes, found and sent while you study."),
    lede: todoZh(
      "Between lectures, exams and a part-time job, nobody has hours for career portals. Drop in your CV and transcript: we find the internships, scholarships, summer programs and competitions you're eligible for, and prepare every application from your own record.",
    ),
    teaser: todoZh("Internships · scholarships · summer programs · hackathons"),
    goals: [
      {
        title: todoZh("A paid internship or a first job"),
        body: todoZh(
          "Internships and graduate programs ranked by fit and deadline, with a résumé tailored to each posting and answers prepared from your projects.",
        ),
        types: ["internship", "graduate_program", "job"],
      },
      {
        title: todoZh("Money for your studies"),
        body: todoZh(
          "Scholarships, bursaries and fellowships whose rules you actually meet — level, field, nationality, deadline — instead of a list of thousands.",
        ),
        types: ["scholarship", "fellowship", "grant"],
      },
      {
        title: todoZh("A place in a program"),
        body: todoZh(
          "Exchange semesters, summer schools and degree programs. University portals need your own account, so those arrive as handoffs with every essay and field ready.",
        ),
        types: ["exchange_program", "degree_program"],
      },
      {
        title: todoZh("A record that stands out"),
        body: todoZh("Hackathons, competitions and mentorship programs that turn coursework into results you can point to."),
        types: ["hackathon", "competition", "mentorship"],
      },
    ],
    types: [
      { id: "internship", why: todoZh("Hosted job boards publish their questions, so most answers are ready before you look.") },
      { id: "graduate_program", why: todoZh("Fixed intakes and early deadlines: we watch the dates so you don't miss the window.") },
      { id: "scholarship", why: todoZh("Matched on level, field and eligibility rules, not keywords.") },
      { id: "fellowship", why: todoZh("Funded programs for promising students, easy to miss because they're scattered.") },
      { id: "exchange_program", why: todoZh("Exchange semesters and summer schools, with their real deadlines.") },
      { id: "hackathon", why: todoZh("Short, concrete, and often a faster route to an interview than a cold application.") },
      { id: "competition", why: todoZh("Coding, design and writing prizes that fit the projects you already have.") },
      { id: "mentorship", why: todoZh("Programs that pair you with someone a few steps ahead.") },
      { id: "volunteer", why: todoZh("Volunteer roles that add real experience to a thin CV.") },
    ],
    example: {
      persona: todoZh("A second-year computer science student looking for a summer internship"),
      steps: [
        { label: L.drops, text: todoZh("Her CV and transcript, plus a link to her GitHub.") },
        {
          label: L.profile,
          text: todoZh("Undergraduate, software, graduating in 2028; three projects and a hackathon prize, each linked to the line in her CV it came from."),
        },
        { label: L.goal, text: todoZh("A paid summer internship in Europe or remote, accepted by the end of April.") },
        { label: L.picks, text: todoZh("Two internships on company job boards, one summer school and one scholarship.") },
        {
          label: L.sent,
          text: todoZh("The two internships and the summer school are filled from her profile and submitted after her tap; the confirmations are saved on her board."),
        },
        {
          label: L.handoff,
          text: todoZh(
            "The scholarship portal needs her own login, so every answer is ready to paste. Its “Why this field?” question asks her for two sentences instead of inventing her motivation.",
          ),
        },
      ],
    },
    uploads: [
      { title: todoZh("CV or résumé"), note: todoZh("Even a one-page draft is enough to start.") },
      { title: todoZh("Transcript"), note: todoZh("Optional. Used for eligibility and for programs that ask for grades.") },
      { title: todoZh("Awards and certificates"), note: todoZh("Prizes, language certificates, online courses.") },
      { title: todoZh("Links"), note: todoZh("GitHub, a portfolio or a personal site.") },
    ],
    weekly: [
      todoZh("New picks ranked against your goal and your deadline calendar"),
      todoZh("Applications prepared for the ones you tapped"),
      todoZh("Follow-ups on applications that haven't heard back"),
      todoZh("Your milestones updated: applications sent, replies, interviews"),
    ],
    yours: [
      todoZh("Online assessments, video interviews and tests"),
      todoZh("University portals that need your own account, prepared as handoffs"),
      todoZh("Application fees, if a program charges one"),
      todoZh("Asking your referees for recommendation letters"),
    ],
    note: todoZh("In high school? You can use Onward Scout with a parent or guardian's email. Outreach email is switched off for under-18s."),
    faqs: [
      {
        q: todoZh("I don't have much experience yet. Is it worth it?"),
        a: todoZh(
          "Yes. Matching looks at eligibility and fit, not length: many internships, scholarships and competitions are designed for people with little experience. Projects, coursework, volunteering and prizes all count as sourced facts.",
        ),
      },
      {
        q: todoZh("Will it write my personal statement?"),
        a: todoZh(
          "It drafts the parts it can source from your documents and asks you for the parts only you can say — why this subject, why this program. Your own reasons are what admissions readers look for, so we don't invent them.",
        ),
      },
    ],
  },

  professionals: {
    slug: "professionals",
    groups: ["E", "P"],
    metaTitle: todoZh("For professionals: better roles, promotions, speaking slots and awards"),
    metaDescription: todoZh(
      "Onward Scout finds roles, recruiters, speaking slots, awards and certifications that fit your experience, prepares each application from your own record and submits it after your tap — while you keep your current job.",
    ),
    eyebrow: todoZh("For professionals"),
    title: todoZh("The next role, without a second job of searching."),
    lede: todoZh(
      "You already have a full-time job. Drop in your résumé and we work the search around it: roles that fit your level, recruiters in your field, speaking slots and awards that build your name — each prepared from your record and sent after your tap.",
    ),
    teaser: todoZh("Roles · recruiters · speaking slots · awards"),
    goals: [
      {
        title: todoZh("Move to a better role"),
        body: todoZh(
          "Roles that match your level, function and location; a tailored résumé and cover letter for each, with the posting's keywords reflected but never invented.",
        ),
        types: ["job", "remote_job", "recruiter", "referral"],
      },
      {
        title: todoZh("Grow where you are"),
        body: todoZh("A promotion case and a negotiation script built from your own results, for the conversation with your manager."),
        types: ["internal_role"],
      },
      {
        title: todoZh("Become visible in your field"),
        body: todoZh("Calls for speakers, industry awards and guest articles, with talk proposals and bios drafted from your work."),
        types: ["speaking", "award", "media"],
      },
      {
        title: todoZh("Add a credential"),
        body: todoZh(
          "Certifications, courses and associations that fit where you're heading. Exam registrations come as handoffs because they need your account and payment.",
        ),
        types: ["certification", "course", "community"],
      },
    ],
    types: [
      { id: "job", why: todoZh("Hosted job forms first: answers to each posting's own questions are prepared from your record.") },
      { id: "remote_job", why: todoZh("Remote and cross-border roles, filtered by where you're allowed to work.") },
      { id: "recruiter", why: todoZh("Specialist recruiters in your field, one personal email each from your Gmail.") },
      { id: "referral", why: todoZh("People at the companies you're targeting, approached one at a time.") },
      { id: "internal_role", why: todoZh("A promotion, raise or transfer case drafted from your results.") },
      { id: "speaking", why: todoZh("Calls for speakers at conferences and meetups in your field.") },
      { id: "award", why: todoZh("Industry awards and lists you qualify for, with the nomination drafted.") },
      { id: "certification", why: todoZh("Certifications that move you forward, prepared for you to register.") },
      { id: "community", why: todoZh("Professional associations worth joining.") },
    ],
    example: {
      persona: todoZh("A product manager with seven years in B2B software"),
      steps: [
        { label: L.drops, text: todoZh("A résumé and her LinkedIn profile, saved as a PDF.") },
        {
          label: L.profile,
          text: todoZh("Mid-level product manager, B2B software, based in Berlin; two launches with their results quoted word for word from the résumé."),
        },
        { label: L.goal, text: todoZh("A senior product role, remote within the EU, within four months, with a salary floor used only for filtering.") },
        { label: L.picks, text: todoZh("Three roles on company job boards, one specialist recruiter and one conference call for speakers.") },
        {
          label: L.sent,
          text: todoZh(
            "The three roles use each posting's own questions; she reviews the answers and taps Submit. The recruiter email goes out from her Gmail once she approves it.",
          ),
        },
        {
          label: L.handoff,
          text: todoZh("A fourth role is only on LinkedIn, so it arrives as a handoff: cover letter and answers in the order the form asks for them."),
        },
      ],
    },
    uploads: [
      { title: todoZh("Résumé or CV"), note: todoZh("The more specific your results, the better the matching.") },
      { title: todoZh("LinkedIn profile as PDF"), note: todoZh("LinkedIn can't be read automatically; its “Save to PDF” export works.") },
      { title: todoZh("Performance records"), note: todoZh("Reviews or a list of wins, if you want a promotion case.") },
      { title: todoZh("Licences and certificates"), note: todoZh("For licensed professions: healthcare, law, accounting, architecture, teaching, finance.") },
    ],
    weekly: [
      todoZh("A short list of roles at your level, not a feed of hundreds"),
      todoZh("Follow-ups on applications and recruiter emails that haven't heard back"),
      todoZh("Replies sorted into interested, meeting, needs information or rejected"),
      todoZh("Milestones against your timeline, and a suggestion when the approach should change"),
    ],
    yours: [
      todoZh("Interviews and take-home assignments"),
      todoZh("LinkedIn, Indeed and other platforms that forbid automation, prepared as handoffs"),
      todoZh("Exam registrations and their fees"),
      todoZh("The final salary conversation"),
    ],
    note: todoZh("Licensed professional? Add your licence and where it's valid. We use it to judge fit, and a licence number only goes into an application you've approved."),
    faqs: [
      {
        q: todoZh("Will my employer find out?"),
        a: todoZh(
          "We only send what you approve, to the organisations you choose. Your profile is never published, and no recruiter hears from you unless you approved that email.",
        ),
      },
      {
        q: todoZh("Do you apply to hundreds of jobs at once?"),
        a: todoZh(
          "No. A few strong, tailored applications a week beat a hundred generic ones, and every submission needs your tap. Your weekly pace follows the plan you choose.",
        ),
      },
    ],
  },

  founders: {
    slug: "founders",
    groups: ["F"],
    metaTitle: todoZh("For founders: investors, accelerators, grants, competitions and trade shows"),
    metaDescription: todoZh(
      "Drop in your deck. Onward Scout finds investors, accelerators, pitch competitions, grants and trade shows that fit your stage and sector, writes one personal email per investor from your own Gmail and prepares every application for your tap.",
    ),
    eyebrow: todoZh("For founders"),
    title: todoZh("Raise, apply, pitch and exhibit — while you build."),
    lede: todoZh(
      "Fundraising and program applications eat the weeks you should spend on the product. Drop in your deck: we find investors whose focus fits your stage and sector, accelerators, competitions, grants and shows worth your time, and do the paperwork with your facts.",
    ),
    teaser: todoZh("Investors · accelerators · grants · pitch competitions"),
    goals: [
      {
        title: todoZh("Raise a round"),
        body: todoZh(
          "Angels and funds whose published focus covers your stage and sector. One personal email per investor, sent from your Gmail after your approval, with polite follow-ups.",
        ),
        types: ["investor"],
      },
      {
        title: todoZh("Join an accelerator or incubator"),
        body: todoZh("Cohorts with real deadlines; application forms filled from your deck and business plan."),
        types: ["accelerator", "incubator"],
      },
      {
        title: todoZh("Win stages and prizes"),
        body: todoZh("Pitch competitions, demo days and startup awards your stage is eligible for."),
        types: ["startup_competition", "pitch_event", "award"],
      },
      {
        title: todoZh("Find non-dilutive money and customers"),
        body: todoZh(
          "Grants and public programs (their portals usually need your company login, so they come as handoffs), trade shows and direct client leads.",
        ),
        types: ["grant", "government_program", "exhibition", "client_lead"],
      },
    ],
    types: [
      { id: "investor", why: todoZh("Matched on stage, sector, geography and cheque size, where the investor publishes them.") },
      { id: "accelerator", why: todoZh("Cohort programs with funding, mentors and a demo day.") },
      { id: "incubator", why: todoZh("Space and support for very early companies.") },
      { id: "startup_competition", why: todoZh("Prize money and exposure, often behind a simple online form.") },
      { id: "pitch_event", why: todoZh("Demo days and pitch nights in front of investors.") },
      { id: "government_program", why: todoZh("Public funds, subsidies and certifications, prepared as handoffs.") },
      { id: "grant", why: todoZh("Non-dilutive grants for research-heavy and impact companies.") },
      { id: "exhibition", why: todoZh("Trade shows where you can exhibit, pitch or speak.") },
      { id: "client_lead", why: todoZh("Companies that may buy what you sell, one tailored email each.") },
      { id: "cofounder_match", why: todoZh("Programs that help you find a co-founder.") },
    ],
    example: {
      persona: todoZh("Two founders of a climate-software startup, raising a pre-seed round"),
      steps: [
        { label: L.drops, text: todoZh("The pitch deck, a one-page summary and a link to the website.") },
        {
          label: L.profile,
          text: todoZh("Early-stage founders, climate software; problem, market, traction and the round they're raising, quoted directly from the deck."),
        },
        {
          label: L.goal,
          text: todoZh("Close the pre-seed within nine months. Milestones: materials ready, 50 matched investors contacted, 10 meetings, a term sheet."),
        },
        { label: L.picks, text: todoZh("Eight investors whose published focus covers climate software at pre-seed, two accelerators and one public innovation grant.") },
        {
          label: L.sent,
          text: todoZh(
            "Each investor gets a personal email from the founders' own Gmail, approved one by one. The accelerator forms are filled from the deck and submitted after a tap.",
          ),
        },
        {
          label: L.handoff,
          text: todoZh("The grant portal needs the company's own login, so it arrives as a handoff with every section drafted to its word limit."),
        },
        {
          label: todoZh("Course correction"),
          text: todoZh("No investor is emailed twice within 30 days. If replies stay low, the plan suggests an accelerator first, to build signal."),
        },
      ],
    },
    uploads: [
      { title: todoZh("Pitch deck"), note: todoZh("The most useful single file: problem, solution, traction, team, round.") },
      { title: todoZh("Business plan or one-pager"), note: todoZh("For programs and grants that ask for more detail.") },
      { title: todoZh("Financial summary"), note: todoZh("Only if you want it used. It's never sent without your approval.") },
      { title: todoZh("Links"), note: todoZh("Website, product page, app store listing, demo video.") },
    ],
    weekly: [
      todoZh("New investors and programs that fit your stage and sector"),
      todoZh("Approved investor emails sent from your Gmail within daily limits"),
      todoZh("Follow-ups after the number of days your plan sets, unless they replied"),
      todoZh("Your funnel: contacted, replied, meetings, term sheets"),
    ],
    yours: [
      todoZh("Pitch meetings and due diligence"),
      todoZh("Signing term sheets and agreements"),
      todoZh("Company logins for grant and government portals, prepared as handoffs"),
      todoZh("Exhibition and application fees"),
    ],
    faqs: [
      {
        q: todoZh("Won't investors see this as mass email?"),
        a: todoZh(
          "Each email is written for one investor, says why your company fits their published focus, and is sent from your own address. Daily limits apply, nobody is emailed twice within 30 days, and opt-outs are permanent.",
        ),
      },
      {
        q: todoZh("Do you share my deck with anyone?"),
        a: todoZh("Only with the investors and programs you approve, as part of an application or an email you confirmed."),
      },
    ],
  },

  researchers: {
    slug: "researchers",
    groups: ["R"],
    metaTitle: todoZh("For researchers: calls for papers, grants, fellowships and positions"),
    metaDescription: todoZh(
      "Drop in your CV and papers. Onward Scout finds conference calls, grants, fellowships, postdoc and visiting positions that fit your field and career stage, and prepares every application to its word limits from your own record.",
    ),
    eyebrow: todoZh("For researchers"),
    title: todoZh("Calls, grants and positions — prepared to the word count."),
    lede: todoZh(
      "Funding calls and conference deadlines are scattered across hundreds of sites, and every application wants the same CV in a different shape. Drop in your CV and papers: we find what fits your field and stage and prepare each application to its limits.",
    ),
    teaser: todoZh("Calls for papers · grants · fellowships · postdocs"),
    goals: [
      {
        title: todoZh("Publish and present"),
        body: todoZh(
          "Conference calls and journal special issues in your area. Submission systems need your own account, so we prepare title, abstract, keywords and cover letter as a handoff.",
        ),
        types: ["conference_cfp", "journal", "speaking"],
      },
      {
        title: todoZh("Fund your work"),
        body: todoZh(
          "Grants and fellowships matched on field, career stage and eligibility, with proposals drafted from your publications and highlighted where a claim needs you.",
        ),
        types: ["grant", "fellowship", "award"],
      },
      {
        title: todoZh("Take the next position"),
        body: todoZh("Postdoc, PhD and visiting positions, with a personal email to each lab whose recent work overlaps yours."),
        types: ["postdoc", "phd_position", "visiting_scholar"],
      },
      {
        title: todoZh("Collaborate"),
        body: todoZh("Researchers, reviewer calls and industry partners working on related problems."),
        types: ["collaborator", "editorial_role", "industry_partnership"],
      },
    ],
    types: [
      { id: "conference_cfp", why: todoZh("Calls for papers with their real deadlines, prepared as handoffs.") },
      { id: "journal", why: todoZh("Special issues and journals open for submission.") },
      { id: "grant", why: todoZh("Research grants matched on field, stage and eligibility.") },
      { id: "fellowship", why: todoZh("Independent fellowships and early-career awards.") },
      { id: "postdoc", why: todoZh("Postdoctoral positions, with a tailored email to the lab.") },
      { id: "phd_position", why: todoZh("Funded PhD openings in labs that fit your interests.") },
      { id: "visiting_scholar", why: todoZh("A term or a year at another institution.") },
      { id: "collaborator", why: todoZh("Researchers whose recent work overlaps yours.") },
      { id: "editorial_role", why: todoZh("Calls for reviewers and program committees.") },
      { id: "industry_partnership", why: todoZh("Companies and tech-transfer offices looking for research partners.") },
    ],
    example: {
      persona: todoZh("A postdoc in computational biology looking for an independent position"),
      steps: [
        { label: L.drops, text: todoZh("Her CV, two papers as PDFs and her ORCID iD.") },
        { label: L.profile, text: todoZh("Postdoc, computational biology; publications with venues and years, methods and grants, each linked to its source.") },
        { label: L.goal, text: todoZh("A faculty-track position or an independent fellowship within twelve months.") },
        { label: L.picks, text: todoZh("Two early-career fellowships, one workshop call for papers and three labs whose recent papers overlap her methods.") },
        {
          label: L.sent,
          text: todoZh(
            "The fellowship forms are filled from her CV, with a research statement drafted from her own abstracts; sentences that need her confirmation are highlighted. Each lab gets one personal email from her Gmail, after she approves it.",
          ),
        },
        { label: L.handoff, text: todoZh("The workshop uses OpenReview, so title, abstract, keywords and author list arrive as a handoff.") },
      ],
    },
    uploads: [
      { title: todoZh("CV"), note: todoZh("Your academic CV with publications, grants and teaching.") },
      { title: todoZh("Papers"), note: todoZh("PDFs of the work you want to lead with.") },
      {
        title: todoZh("ORCID iD"),
        note: todoZh("We read your public ORCID record. Google Scholar pages can't be read automatically, so keep your publication list in the CV."),
      },
      { title: todoZh("Previous proposals"), note: todoZh("Summaries of funded or submitted proposals, if you want them reused.") },
    ],
    weekly: [
      todoZh("New calls and positions in your field, ordered by deadline"),
      todoZh("Applications prepared to each call's word limits"),
      todoZh("Follow-ups on emails to labs that haven't replied"),
      todoZh("A deadline calendar set against your milestones"),
    ],
    yours: [
      todoZh("The research itself, and the final word on every claim"),
      todoZh("Submission systems that need your account, prepared as handoffs"),
      todoZh("Letters from your referees"),
      todoZh("Institutional sign-offs and signatures"),
    ],
    faqs: [
      {
        q: todoZh("Can it write my research proposal?"),
        a: todoZh(
          "It drafts sections from your own CV, abstracts and papers, cites the facts each sentence uses and highlights anything it couldn't source. The science, the aims and the final wording are yours.",
        ),
      },
      {
        q: todoZh("Why don't you submit to OpenReview or EasyChair directly?"),
        a: todoZh(
          "Those systems need your own account and identity, and automating them would break their rules. We prepare everything in their order, so submitting takes minutes.",
        ),
      },
    ],
  },

  creators: {
    slug: "creators",
    groups: ["C"],
    metaTitle: todoZh("For creators and freelancers: clients, brand deals, residencies and open calls"),
    metaDescription: todoZh(
      "Drop in your portfolio. Onward Scout finds clients, brand partnerships, residencies, grants and open calls that fit your work, writes one personal email per client from your Gmail and prepares every application for your tap.",
    ),
    eyebrow: todoZh("For creators and freelancers"),
    title: todoZh("More clients and open calls. More time for the work."),
    lede: todoZh(
      "Pitching, applying and chasing replies can take more hours than the work itself. Drop in your portfolio: we find clients who buy what you make, brand programs, residencies, grants and open calls, and prepare each pitch from your real credits.",
    ),
    teaser: todoZh("Clients · brand deals · residencies · open calls"),
    goals: [
      {
        title: todoZh("Find clients"),
        body: todoZh(
          "Companies and publications that commission your kind of work, one tailored email each with the pieces that fit them. Marketplace briefs come as handoffs because they need your account.",
        ),
        types: ["client_lead", "freelance_project"],
      },
      {
        title: todoZh("Land brand partnerships"),
        body: todoZh("Creator programs and sponsorships, pitched with a media kit built from numbers you can stand behind."),
        types: ["brand_partnership", "podcast"],
      },
      {
        title: todoZh("Residencies, grants and open calls"),
        body: todoZh("Calls matched to your medium and stage, with artist statements drafted from how you describe your own work."),
        types: ["residency", "grant", "open_call", "competition"],
      },
      {
        title: todoZh("Get signed or licensed"),
        body: todoZh("Agencies, publishers, platforms and stock libraries that take on creators like you."),
        types: ["platform_signing", "book_publisher", "licensing"],
      },
    ],
    types: [
      { id: "client_lead", why: todoZh("Companies that buy what you make, approached one at a time.") },
      { id: "freelance_project", why: todoZh("Marketplace briefs, prepared as handoffs.") },
      { id: "brand_partnership", why: todoZh("Creator programs and sponsorships that fit your audience.") },
      { id: "residency", why: todoZh("Time and space to make work, with their real deadlines.") },
      { id: "open_call", why: todoZh("Exhibitions, anthologies, festivals and showcases.") },
      { id: "grant", why: todoZh("Creative grants and micro-grants.") },
      { id: "competition", why: todoZh("Design, writing, photography and music prizes.") },
      { id: "platform_signing", why: todoZh("Agencies, networks and platforms that sign talent.") },
      { id: "licensing", why: todoZh("Stock libraries and licensing marketplaces.") },
      { id: "book_publisher", why: todoZh("Publishers and agents accepting proposals.") },
    ],
    example: {
      persona: todoZh("An independent illustrator who wants steadier editorial work"),
      steps: [
        { label: L.drops, text: todoZh("A portfolio PDF and a link to her website.") },
        { label: L.profile, text: todoZh("Illustrator; clients, published pieces and exhibitions listed with their sources; style tags she can change in a tap.") },
        { label: L.goal, text: todoZh("Two recurring editorial clients and one residency this year.") },
        { label: L.picks, text: todoZh("Two residencies, one open call and five art directors at publications that commission illustration.") },
        {
          label: L.sent,
          text: todoZh(
            "The residency and open-call forms are filled, with an artist statement drafted from her own descriptions, and submitted after her tap. Each art director gets one email with three relevant pieces, sent from her Gmail once she approves it.",
          ),
        },
        {
          label: L.handoff,
          text: todoZh("A brief on a freelance marketplace needs her account, so the proposal arrives ready to paste. Any submission fee is shown before she decides."),
        },
      ],
    },
    uploads: [
      { title: todoZh("Portfolio"), note: todoZh("A PDF, or links to the pieces you want to lead with.") },
      { title: todoZh("Media kit"), note: todoZh("Audience numbers you can stand behind, for brand programs.") },
      { title: todoZh("Links"), note: todoZh("Your site and public profiles.") },
      { title: todoZh("Rates"), note: todoZh("Only if you want them used in proposals.") },
    ],
    weekly: [
      todoZh("New clients, programs and calls that fit your medium"),
      todoZh("Approved pitches sent from your Gmail within daily limits"),
      todoZh("Follow-ups on pitches that haven't been answered"),
      todoZh("Your pipeline: pitched, replied, commissioned"),
    ],
    yours: [
      todoZh("Contracts, invoices and rights negotiations"),
      todoZh("Marketplace accounts and their proposals, prepared as handoffs"),
      todoZh("Submission fees, which we always show up front"),
      todoZh("The work itself"),
    ],
    faqs: [
      {
        q: todoZh("Do you publish my portfolio anywhere?"),
        a: todoZh("No. Your work is only sent as part of a pitch or an application you approved, to the person or organisation you chose."),
      },
      {
        q: todoZh("Can I pitch brands with the audience I have?"),
        a: todoZh("Yes, as long as the numbers are true. They come from your media kit or your confirmation, and we never round them up."),
      },
    ],
  },

  "career-changers": {
    slug: "career-changers",
    groups: ["T"],
    metaTitle: todoZh("For career changers: bridge roles, retraining and returning to work"),
    metaDescription: todoZh(
      "Changing field, returning after a break, moving countries or starting again? Onward Scout shows which of your skills carry over, finds bridge roles, returnships and funded courses, and prepares each application honestly.",
    ),
    eyebrow: todoZh("For career changers"),
    title: todoZh("A new direction, told with your true facts."),
    lede: todoZh(
      "Switching fields, coming back after a break or starting over in a new country is hard enough without a blank form asking for “relevant experience”. Drop in what you have: we show which of your skills carry over, find roles and programs that welcome people like you, and explain the switch without inventing a thing.",
    ),
    teaser: todoZh("Bridge roles · returnships · funded courses · mentors"),
    goals: [
      {
        title: todoZh("A bridge role in the new field"),
        body: todoZh("Roles where your transferable skills count, with cover letters that explain the move using facts from your own history."),
        types: ["job", "part_time", "volunteer"],
      },
      {
        title: todoZh("Retrain with support"),
        body: todoZh("Bootcamps, funded course seats and certifications. Enrolment and payment stay with you."),
        types: ["course", "certification"],
      },
      {
        title: todoZh("Come back after a break"),
        body: todoZh("Returnships and programs designed for people returning to work after caring, illness or time away."),
        types: ["returnship", "mentorship"],
      },
      {
        title: todoZh("Start over somewhere new"),
        body: todoZh("Remote roles, visa pathways and the evidence each route needs, for people moving countries."),
        types: ["remote_job", "visa_pathway", "community"],
      },
    ],
    types: [
      { id: "job", why: todoZh("Roles that value what you already do well.") },
      { id: "returnship", why: todoZh("Paid programs for people returning after a career break.") },
      { id: "course", why: todoZh("Bootcamps and funded course seats.") },
      { id: "certification", why: todoZh("Credentials that open the new field.") },
      { id: "mentorship", why: todoZh("People who made the same move.") },
      { id: "remote_job", why: todoZh("Roles you can take from where you live.") },
      { id: "visa_pathway", why: todoZh("Work and talent visa routes, with the evidence list for each.") },
      { id: "volunteer", why: todoZh("Experience in the new field that counts.") },
      { id: "part_time", why: todoZh("A smaller first step while you transition.") },
      { id: "community", why: todoZh("Associations and groups in the new field.") },
    ],
    example: {
      persona: todoZh("A secondary-school teacher moving into learning design"),
      steps: [
        { label: L.drops, text: todoZh("Her teaching CV and a course she built, as a PDF.") },
        {
          label: L.profile,
          text: todoZh(
            "Career changer, education to learning design; curriculum design, assessment and stakeholder communication shown as transferable skills, each quoted from her documents.",
          ),
        },
        { label: L.goal, text: todoZh("A learning-designer role within six months, open to a short course first.") },
        { label: L.picks, text: todoZh("Two junior learning-design roles, one funded course seat and one mentorship program.") },
        { label: L.sent, text: todoZh("Her cover letters explain the switch with facts from her own history — no invented experience — and go out after her tap.") },
        {
          label: todoZh("Gaps"),
          text: todoZh("Where a posting asks for a tool her documents don't show, it's listed as a gap so she can decide: add evidence, learn it, or skip that role."),
        },
      ],
    },
    uploads: [
      { title: todoZh("Résumé, gaps and all"), note: todoZh("Breaks and changes of direction are fine; we don't hide them or invent around them.") },
      { title: todoZh("Course certificates"), note: todoZh("Anything you've learned for the new field.") },
      { title: todoZh("Work samples"), note: todoZh("Projects that show the new skills in action.") },
      { title: todoZh("Links"), note: todoZh("A portfolio, a blog or a public project.") },
    ],
    weekly: [
      todoZh("Roles and programs open to people changing careers"),
      todoZh("Applications that explain your move with your own facts"),
      todoZh("The gaps between your profile and the roles you're shown, so you can decide what to work on"),
      todoZh("Milestones toward the first yes in the new field"),
    ],
    yours: [
      todoZh("Interviews and trial tasks"),
      todoZh("Course enrolment and payments"),
      todoZh("Visa applications and official documents"),
      todoZh("Deciding which gaps are worth closing"),
    ],
    note: todoZh(
      "Returning after caring for family, leaving the military, moving countries or starting a second career later in life — the same engine adapts to your situation.",
    ),
    faqs: [
      {
        q: todoZh("Will it hide my career break?"),
        a: todoZh("No, and it won't invent anything to fill it. Applications present your history truthfully and, where it helps, explain the break in your own words."),
      },
      {
        q: todoZh("What if I don't meet every requirement?"),
        a: todoZh("We show which requirements your documents support and which are gaps. Many roles hire people who meet most of them; you decide which to try."),
      },
    ],
  },
};

export function audienceContent(slug: string): AudienceContent | null {
  return (AUDIENCE_CONTENT as Record<string, AudienceContent>)[slug] ?? null;
}
