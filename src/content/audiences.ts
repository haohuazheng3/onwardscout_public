/**
 * The six audience landing pages (/for/[audience]). Each one is written for that audience —
 * their goals, the opportunity types we chase for them, a worked example, what to upload, what a
 * week looks like and what stays with them — not one template with the nouns swapped.
 *
 * Worked examples are illustrations (labelled "Example" on the page): no real person, no real
 * program names, no outcome numbers. Opportunity types are ids from src/lib/core/opportunity-types.
 *
 * Copy is bilingual: `bi("English", "中文")`. tests/i18n-parity.test.ts fails on English left in `zh`.
 */
import type { Audience } from "@/i18n/site-nav";
import type { IdentityGroup, OpportunityTypeId } from "@/lib/core/types";
import { bi, type Bilingual } from "./site-copy";

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
  drops: bi("Drops in", "丢进来的材料"),
  profile: bi("Profile", "档案"),
  goal: bi("Goal", "目标"),
  picks: bi("This week's picks", "本周精选"),
  sent: bi("Prepared and submitted", "已准备并提交"),
  handoff: bi("Handoff", "本人提交"),
};

export const AUDIENCE_CONTENT: Record<Audience, AudienceContent> = {
  students: {
    slug: "students",
    groups: ["S"],
    metaTitle: bi("For students: internships, scholarships, summer programs and first jobs", "面向学生：实习、奖学金、暑期项目和第一份工作"),
    metaDescription: bi(
      "Drop in your CV and transcript. Onward Scout finds internships, scholarships, summer programs, hackathons and graduate schemes you're eligible for, prepares each application from your own record and submits it after your tap.",
      "上传你的 CV 和成绩单。Onward Scout 为你找到你符合条件的实习、奖学金、暑期项目、黑客松和校招项目，用你自己的履历准备每一份申请，经你点一下后提交。",
    ),
    eyebrow: bi("For students", "面向学生"),
    title: bi("Your first yes, found and sent while you study.", "边上学，边拿到你的第一个“好”。"),
    lede: bi(
      "Between lectures, exams and a part-time job, nobody has hours for career portals. Drop in your CV and transcript: we find the internships, scholarships, summer programs and competitions you're eligible for, and prepare every application from your own record.",
      "上课、考试再加上兼职，谁都没时间泡在求职门户上。上传你的 CV 和成绩单：我们找到你符合条件的实习、奖学金、暑期项目和比赛，并用你自己的履历准备好每一份申请。",
    ),
    teaser: bi("Internships · scholarships · summer programs · hackathons", "实习 · 奖学金 · 暑期项目 · 黑客松"),
    goals: [
      {
        title: bi("A paid internship or a first job", "一份带薪实习或第一份工作"),
        body: bi(
          "Internships and graduate programs ranked by fit and deadline, with a résumé tailored to each posting and answers prepared from your projects.",
          "按匹配度和截止日期排序的实习和校招项目，每个职位都配一份定制简历，回答根据你的项目准备。",
        ),
        types: ["internship", "graduate_program", "job"],
      },
      {
        title: bi("Money for your studies", "求学的资金"),
        body: bi(
          "Scholarships, bursaries and fellowships whose rules you actually meet — level, field, nationality, deadline — instead of a list of thousands.",
          "奖学金、助学金和 Fellowship 项目——只列出你真正符合条件的（学历层次、专业、国籍、截止日期），而不是一份成千上万条的清单。",
        ),
        types: ["scholarship", "fellowship", "grant"],
      },
      {
        title: bi("A place in a program", "进入一个项目"),
        body: bi(
          "Exchange semesters, summer schools and degree programs. University portals need your own account, so those arrive as handoffs with every essay and field ready.",
          "交换学期、暑期学校和学位项目。高校门户需要你自己的账户，所以这些会以交接的形式交给你，每篇文书和每个字段都已备好。",
        ),
        types: ["exchange_program", "degree_program"],
      },
      {
        title: bi("A record that stands out", "一份脱颖而出的履历"),
        body: bi(
          "Hackathons, competitions and mentorship programs that turn coursework into results you can point to.",
          "黑客松、比赛和导师项目，把课程作业变成你拿得出手的成果。",
        ),
        types: ["hackathon", "competition", "mentorship"],
      },
    ],
    types: [
      { id: "internship", why: bi(
        "Hosted job boards publish their questions, so most answers are ready before you look.",
        "托管的招聘看板会公开其问题，所以在你查看之前，大部分回答就已经准备好了。",
      ) },
      { id: "graduate_program", why: bi(
        "Fixed intakes and early deadlines: we watch the dates so you don't miss the window.",
        "批次固定、截止较早：我们替你盯着日期，不让你错过时间窗口。",
      ) },
      { id: "scholarship", why: bi("Matched on level, field and eligibility rules, not keywords.", "按学历层次、专业和资格规则匹配，而不是靠关键词。") },
      { id: "fellowship", why: bi(
        "Funded programs for promising students, easy to miss because they're scattered.",
        "资助有潜力学生的项目，因为信息分散而很容易错过。",
      ) },
      { id: "exchange_program", why: bi("Exchange semesters and summer schools, with their real deadlines.", "交换学期和暑期学校，附上真实的截止日期。") },
      { id: "hackathon", why: bi(
        "Short, concrete, and often a faster route to an interview than a cold application.",
        "短小、具体，而且常常比冷投简历更快拿到面试。",
      ) },
      { id: "competition", why: bi(
        "Coding, design and writing prizes that fit the projects you already have.",
        "编程、设计和写作类奖项，正好契合你已有的项目。",
      ) },
      { id: "mentorship", why: bi("Programs that pair you with someone a few steps ahead.", "为你匹配一位比你领先几步的人的项目。") },
      { id: "volunteer", why: bi("Volunteer roles that add real experience to a thin CV.", "为单薄的 CV 增添真实经历的志愿者岗位。") },
    ],
    example: {
      persona: bi("A second-year computer science student looking for a summer internship", "一名计算机专业大二学生，正在找暑期实习"),
      steps: [
        { label: L.drops, text: bi("Her CV and transcript, plus a link to her GitHub.", "她的 CV 和成绩单，外加她的 GitHub 链接。") },
        {
          label: L.profile,
          text: bi(
            "Undergraduate, software, graduating in 2028; three projects and a hackathon prize, each linked to the line in her CV it came from.",
            "本科在读，软件方向，2028 年毕业；三个项目和一个黑客松奖项，每一项都链接到它在 CV 中对应的那一行。",
          ),
        },
        { label: L.goal, text: bi(
          "A paid summer internship in Europe or remote, accepted by the end of April.",
          "4 月底前拿到一份欧洲或远程的带薪暑期实习。",
        ) },
        { label: L.picks, text: bi(
          "Two internships on company job boards, one summer school and one scholarship.",
          "两个公司招聘看板上的实习、一个暑期学校和一项奖学金。",
        ) },
        {
          label: L.sent,
          text: bi(
            "The two internships and the summer school are filled from her profile and submitted after her tap; the confirmations are saved on her board.",
            "两份实习和暑期学校的申请根据她的档案填好，经她点一下后提交；确认回执都保存在她的看板上。",
          ),
        },
        {
          label: L.handoff,
          text: bi(
            "The scholarship portal needs her own login, so every answer is ready to paste. Its “Why this field?” question asks her for two sentences instead of inventing her motivation.",
            "奖学金门户需要她本人登录，所以每个回答都已备好，直接粘贴即可。其中“为什么选择这个专业？”一题会请她写两句话，而不是替她编造动机。",
          ),
        },
      ],
    },
    uploads: [
      { title: bi("CV or résumé", "CV 或简历"), note: bi("Even a one-page draft is enough to start.", "哪怕只有一页的草稿，也足够开始。") },
      { title: bi(
        "Transcript",
        "成绩单",
      ), note: bi(
        "Optional. Used for eligibility and for programs that ask for grades.",
        "选填。用于判断资格，以及申请要求提供成绩的项目。",
      ) },
      { title: bi("Awards and certificates", "奖项和证书"), note: bi("Prizes, language certificates, online courses.", "获奖经历、语言证书、在线课程。") },
      { title: bi("Links", "链接"), note: bi("GitHub, a portfolio or a personal site.", "GitHub、作品集或个人网站。") },
    ],
    weekly: [
      bi("New picks ranked against your goal and your deadline calendar", "根据你的目标和截止日期日历排序的新精选"),
      bi("Applications prepared for the ones you tapped", "为你点选的机会准备好的申请"),
      bi("Follow-ups on applications that haven't heard back", "对尚未收到回复的申请进行跟进"),
      bi("Your milestones updated: applications sent, replies, interviews", "更新你的里程碑：已发出的申请、收到的回复、面试"),
    ],
    yours: [
      bi("Online assessments, video interviews and tests", "在线测评、视频面试和笔试"),
      bi("University portals that need your own account, prepared as handoffs", "需要你自己账户的高校门户，以交接形式准备好"),
      bi("Application fees, if a program charges one", "申请费（如果项目收取）"),
      bi("Asking your referees for recommendation letters", "请你的推荐人写推荐信"),
    ],
    note: bi(
      "In high school? You can use Onward Scout with a parent or guardian: add their email to your profile before your first submission. Outreach email is switched off for under-18s.",
      "还在读高中？你可以在父母或监护人的参与下使用 Onward Scout：首次提交前，请在档案中填写他们的邮箱。18 岁以下用户的外联邮件功能是关闭的。",
    ),
    faqs: [
      {
        q: bi("I don't have much experience yet. Is it worth it?", "我还没什么经验，值得用吗？"),
        a: bi(
          "Yes. Matching looks at eligibility and fit, not length: many internships, scholarships and competitions are designed for people with little experience. Projects, coursework, volunteering and prizes all count as sourced facts.",
          "值得。匹配看的是资格和契合度，而不是经历长短：很多实习、奖学金和比赛本来就是为经验不多的人设计的。项目、课程作业、志愿经历和获奖，都算作有出处的信息。",
        ),
      },
      {
        q: bi("Will it write my personal statement?", "它会替我写个人陈述吗？"),
        a: bi(
          "It drafts the parts it can source from your documents and asks you for the parts only you can say — why this subject, why this program. Your own reasons are what admissions readers look for, so we don't invent them.",
          "它会起草能从你的文档中找到出处的部分，并请你写只有你自己能说的部分——为什么选这个学科、为什么选这个项目。招生官看重的正是你自己的理由，所以我们不会替你编造。",
        ),
      },
    ],
  },

  professionals: {
    slug: "professionals",
    groups: ["E", "P"],
    metaTitle: bi("For professionals: better roles, promotions, speaking slots and awards", "面向职场人：更好的岗位、晋升、演讲机会和奖项"),
    metaDescription: bi(
      "Onward Scout finds roles, recruiters, speaking slots, awards and certifications that fit your experience, prepares each application from your own record and submits it after your tap — while you keep your current job.",
      "Onward Scout 为你找到契合你经验的岗位、猎头、演讲机会、奖项和认证，用你自己的履历准备每一份申请，经你点一下后提交——而你照常做好现在的工作。",
    ),
    eyebrow: bi("For professionals", "面向职场人"),
    title: bi("The next role, without a second job of searching.", "找下一份工作，不必再打一份“找工作”的工。"),
    lede: bi(
      "You already have a full-time job. Drop in your résumé and we work the search around it: roles that fit your level, recruiters in your field, speaking slots and awards that build your name — each prepared from your record and sent after your tap.",
      "你已经有一份全职工作。上传你的简历，我们围绕它来安排求职：契合你级别的岗位、你所在领域的猎头、为你积累名声的演讲机会和奖项——每一项都根据你的履历准备，经你点一下后发出。",
    ),
    teaser: bi("Roles · recruiters · speaking slots · awards", "岗位 · 猎头 · 演讲机会 · 奖项"),
    goals: [
      {
        title: bi("Move to a better role", "换一个更好的岗位"),
        body: bi(
          "Roles that match your level, function and location; a tailored résumé and cover letter for each, with the posting's keywords reflected but never invented.",
          "契合你的级别、职能和地点的岗位；每个都配一份定制简历和求职信，呼应职位描述中的关键词，但绝不编造。",
        ),
        types: ["job", "remote_job", "recruiter", "referral"],
      },
      {
        title: bi("Grow where you are", "在现单位成长"),
        body: bi(
          "A promotion case and a negotiation script built from your own results, for the conversation with your manager.",
          "根据你自己的业绩整理出的晋升理由和谈判话术，供你和上级沟通时使用。",
        ),
        types: ["internal_role"],
      },
      {
        title: bi("Become visible in your field", "在你的领域被看见"),
        body: bi(
          "Calls for speakers, industry awards and guest articles, with talk proposals and bios drafted from your work.",
          "演讲者征集、行业奖项和客座文章，演讲提案和个人简介根据你的工作起草。",
        ),
        types: ["speaking", "award", "media"],
      },
      {
        title: bi("Add a credential", "增加一项资质"),
        body: bi(
          "Certifications, courses and associations that fit where you're heading. Exam registrations come as handoffs because they need your account and payment.",
          "契合你发展方向的认证、课程和行业协会。考试报名需要你自己的账户和付款，所以会以交接形式交给你。",
        ),
        types: ["certification", "course", "community"],
      },
    ],
    types: [
      { id: "job", why: bi(
        "Hosted job forms first: answers to each posting's own questions are prepared from your record.",
        "优先处理托管的招聘表单：每个职位自己的问题，都根据你的履历准备好回答。",
      ) },
      { id: "remote_job", why: bi("Remote and cross-border roles, filtered by where you're allowed to work.", "远程和跨境岗位，按你可以合法工作的地区筛选。") },
      { id: "recruiter", why: bi(
        "Specialist recruiters in your field, one personal email each from your Gmail.",
        "你所在领域的专业猎头，每人一封从你的 Gmail 发出的专属邮件。",
      ) },
      { id: "referral", why: bi("People at the companies you're targeting, approached one at a time.", "你目标公司里的人，一次联系一位。") },
      { id: "internal_role", why: bi("A promotion, raise or transfer case drafted from your results.", "根据你的业绩起草的晋升、加薪或转岗理由。") },
      { id: "speaking", why: bi("Calls for speakers at conferences and meetups in your field.", "你所在领域的会议和线下活动的演讲者征集。") },
      { id: "award", why: bi("Industry awards and lists you qualify for, with the nomination drafted.", "你符合条件的行业奖项和榜单，提名材料已起草好。") },
      { id: "certification", why: bi("Certifications that move you forward, prepared for you to register.", "能让你更进一步的认证，准备好由你去报名。") },
      { id: "community", why: bi("Professional associations worth joining.", "值得加入的行业协会。") },
    ],
    example: {
      persona: bi("A product manager with seven years in B2B software", "一位在 B2B 软件领域有七年经验的产品经理"),
      steps: [
        { label: L.drops, text: bi("A résumé and her LinkedIn profile, saved as a PDF.", "一份简历，以及她存为 PDF 的 LinkedIn 主页。") },
        {
          label: L.profile,
          text: bi(
            "Mid-level product manager, B2B software, based in Berlin; two launches with their results quoted word for word from the résumé.",
            "中级产品经理，B2B 软件，常驻柏林；两次产品发布及其成果，均逐字引自简历。",
          ),
        },
        { label: L.goal, text: bi(
          "A senior product role, remote within the EU, within four months, with a salary floor used only for filtering.",
          "四个月内拿到一个欧盟境内远程的高级产品岗位，设定的薪资下限只用于筛选。",
        ) },
        { label: L.picks, text: bi(
          "Three roles on company job boards, one specialist recruiter and one conference call for speakers.",
          "三个公司招聘看板上的岗位、一位专业猎头，以及一个行业会议的演讲者征集。",
        ) },
        {
          label: L.sent,
          text: bi(
            "The three roles use each posting's own questions; she reviews the answers and taps Submit. The recruiter email goes out from her Gmail once she approves it.",
            "三个岗位都按各自职位的问题准备回答；她检查后点一下「提交」。发给猎头的邮件在她批准后从她的 Gmail 发出。",
          ),
        },
        {
          label: L.handoff,
          text: bi(
            "A fourth role is only on LinkedIn, so it arrives as a handoff: cover letter and answers in the order the form asks for them.",
            "第四个岗位只在 LinkedIn 上发布，所以它以交接的形式交给她：求职信和回答按表单要求的顺序排好。",
          ),
        },
      ],
    },
    uploads: [
      { title: bi("Résumé or CV", "简历或 CV"), note: bi("The more specific your results, the better the matching.", "你的成果写得越具体，匹配就越精准。") },
      { title: bi(
        "LinkedIn profile as PDF",
        "存为 PDF 的 LinkedIn 主页",
      ), note: bi(
        "LinkedIn can't be read automatically; its “Save to PDF” export works.",
        "LinkedIn 无法自动读取；用它的“存为 PDF”导出即可。",
      ) },
      { title: bi(
        "Performance records",
        "绩效记录",
      ), note: bi(
        "Reviews or a list of wins, if you want a promotion case.",
        "绩效评估或成绩清单，如果你想准备晋升理由的话。",
      ) },
      { title: bi(
        "Licences and certificates",
        "执照和证书",
      ), note: bi(
        "For licensed professions: healthcare, law, accounting, architecture, teaching, finance.",
        "适用于持证职业：医疗、法律、会计、建筑、教育、金融。",
      ) },
    ],
    weekly: [
      bi("A short list of roles at your level, not a feed of hundreds", "一份契合你级别的简短岗位清单，而不是几百条的信息流"),
      bi("Follow-ups on applications and recruiter emails that haven't heard back", "对尚未收到回复的申请和猎头邮件进行跟进"),
      bi("Replies sorted into interested, meeting, needs information or rejected", "把回复分类为感兴趣、约见面、需要补充信息或拒绝"),
      bi("Milestones against your timeline, and a suggestion when the approach should change", "按你的时间线追踪里程碑，并在需要调整策略时给出建议"),
    ],
    yours: [
      bi("Interviews and take-home assignments", "面试和带回家完成的作业"),
      bi("LinkedIn, Indeed and other platforms that forbid automation, prepared as handoffs", "LinkedIn、Indeed 和其他禁止自动化的平台，以交接形式准备好"),
      bi("Exam registrations and their fees", "考试报名及其费用"),
      bi("The final salary conversation", "最后的薪资谈判"),
    ],
    note: bi(
      "Licensed professional? Add your licence and where it's valid. We use it to judge fit, and a licence number only goes into an application you've approved.",
      "你是持证专业人士？请添加你的执照及其有效地区。我们用它来判断匹配度，执照编号只会出现在你批准过的申请中。",
    ),
    faqs: [
      {
        q: bi("Will my employer find out?", "我的雇主会发现吗？"),
        a: bi(
          "We only send what you approve, to the organisations you choose. Your profile is never published, and no recruiter hears from you unless you approved that email.",
          "我们只发送你批准的内容，只发给你选择的机构。你的档案从不公开，除非你批准了那封邮件，否则任何猎头都不会收到你的消息。",
        ),
      },
      {
        q: bi("Do you apply to hundreds of jobs at once?", "你们会一次投几百个岗位吗？"),
        a: bi(
          "No. A few strong, tailored applications a week beat a hundred generic ones, and every submission needs your tap. Your weekly pace follows the plan you choose.",
          "不会。每周几份有分量的定制申请，胜过一百份千篇一律的申请，而且每一次提交都需要你点一下。你每周的节奏按你选择的计划来。",
        ),
      },
    ],
  },

  founders: {
    slug: "founders",
    groups: ["F"],
    metaTitle: bi("For founders: investors, accelerators, grants, competitions and trade shows", "面向创业者：投资人、加速器、基金、比赛和展会"),
    metaDescription: bi(
      "Drop in your deck. Onward Scout finds investors, accelerators, pitch competitions, grants and trade shows that fit your stage and sector, writes one personal email per investor from your own Gmail and prepares every application for your tap.",
      "上传你的融资 BP。Onward Scout 为你找到契合你阶段和赛道的投资人、加速器、路演比赛、基金和展会，从你自己的 Gmail 给每位投资人写一封专属邮件，并把每一份申请准备好，等你点一下。",
    ),
    eyebrow: bi("For founders", "面向创业者"),
    title: bi("Raise, apply, pitch and exhibit — while you build.", "融资、申请、路演、参展——一边做产品一边搞定。"),
    lede: bi(
      "Fundraising and program applications eat the weeks you should spend on the product. Drop in your deck: we find investors whose focus fits your stage and sector, accelerators, competitions, grants and shows worth your time, and do the paperwork with your facts.",
      "融资和项目申请吞掉的，正是你本该花在产品上的时间。上传你的融资 BP：我们找到关注方向契合你阶段和赛道的投资人，以及值得你花时间的加速器、比赛、基金和展会，并用你的信息把文书工作做好。",
    ),
    teaser: bi("Investors · accelerators · grants · pitch competitions", "投资人 · 加速器 · 基金 · 路演比赛"),
    goals: [
      {
        title: bi("Raise a round", "完成一轮融资"),
        body: bi(
          "Angels and funds whose published focus covers your stage and sector. One personal email per investor, sent from your Gmail after your approval, with polite follow-ups.",
          "公开的投资方向覆盖你的阶段和赛道的天使投资人和基金。每位投资人一封专属邮件，在你批准后从你的 Gmail 发出，并附带礼貌的跟进。",
        ),
        types: ["investor"],
      },
      {
        title: bi("Join an accelerator or incubator", "加入加速器或孵化器"),
        body: bi(
          "Cohorts with real deadlines; application forms filled from your deck and business plan.",
          "有真实截止日期的批次项目；申请表根据你的 BP 和商业计划书填写。",
        ),
        types: ["accelerator", "incubator"],
      },
      {
        title: bi("Win stages and prizes", "赢得舞台和奖项"),
        body: bi("Pitch competitions, demo days and startup awards your stage is eligible for.", "你的阶段符合条件的路演比赛、Demo Day 和创业奖项。"),
        types: ["startup_competition", "pitch_event", "award"],
      },
      {
        title: bi("Find non-dilutive money and customers", "找到非稀释性资金和客户"),
        body: bi(
          "Grants and public programs (their portals usually need your company login, so they come as handoffs), trade shows and direct client leads.",
          "基金和政府项目（其门户通常需要你的公司账户登录，所以会以交接形式交给你）、展会和直客线索。",
        ),
        types: ["grant", "government_program", "exhibition", "client_lead"],
      },
    ],
    types: [
      { id: "investor", why: bi(
        "Matched on stage, sector, geography and cheque size, where the investor publishes them.",
        "在投资人公开了相关信息的前提下，按阶段、赛道、地域和单笔投资额匹配。",
      ) },
      { id: "accelerator", why: bi("Cohort programs with funding, mentors and a demo day.", "提供资金、导师和 Demo Day 的批次制项目。") },
      { id: "incubator", why: bi("Space and support for very early companies.", "为非常早期的公司提供场地和扶持。") },
      { id: "startup_competition", why: bi("Prize money and exposure, often behind a simple online form.", "奖金和曝光，通常只需填一份简单的在线表单。") },
      { id: "pitch_event", why: bi("Demo days and pitch nights in front of investors.", "在投资人面前展示的 Demo Day 和路演之夜。") },
      { id: "government_program", why: bi(
        "Public funds, subsidies and certifications, prepared as handoffs.",
        "政府资金、补贴和资质认定，以交接形式准备好。",
      ) },
      { id: "grant", why: bi("Non-dilutive grants for research-heavy and impact companies.", "面向研发密集型和社会影响力公司的非稀释性资助。") },
      { id: "exhibition", why: bi("Trade shows where you can exhibit, pitch or speak.", "可以参展、路演或演讲的展会。") },
      { id: "client_lead", why: bi("Companies that may buy what you sell, one tailored email each.", "可能购买你产品的公司，每家一封定制邮件。") },
      { id: "cofounder_match", why: bi("Programs that help you find a co-founder.", "帮你找到合伙人的项目。") },
    ],
    example: {
      persona: bi("Two founders of a climate-software startup, raising a pre-seed round", "一家气候软件创业公司的两位创始人，正在进行天使前（pre-seed）融资"),
      steps: [
        { label: L.drops, text: bi("The pitch deck, a one-page summary and a link to the website.", "融资 BP、一页纸项目概要和官网链接。") },
        {
          label: L.profile,
          text: bi(
            "Early-stage founders, climate software; problem, market, traction and the round they're raising, quoted directly from the deck.",
            "早期创始人，气候软件；痛点、市场、业务进展和正在融的这一轮，均直接引自 BP。",
          ),
        },
        {
          label: L.goal,
          text: bi(
            "Close the pre-seed within nine months. Milestones: materials ready, 50 matched investors contacted, 10 meetings, a term sheet.",
            "九个月内完成天使前融资。里程碑：材料就绪、联系 50 位匹配的投资人、10 次会面、一份投资条款清单。",
          ),
        },
        { label: L.picks, text: bi(
          "Eight investors whose published focus covers climate software at pre-seed, two accelerators and one public innovation grant.",
          "八位公开投资方向覆盖天使前阶段气候软件的投资人、两个加速器和一项政府创新基金。",
        ) },
        {
          label: L.sent,
          text: bi(
            "Each investor gets a personal email from the founders' own Gmail, approved one by one. The accelerator forms are filled from the deck and submitted after a tap.",
            "每位投资人都会收到一封从创始人自己的 Gmail 发出的专属邮件，逐封批准。加速器申请表根据 BP 填写，经点一下后提交。",
          ),
        },
        {
          label: L.handoff,
          text: bi(
            "The grant portal needs the company's own login, so it arrives as a handoff with every section drafted to its word limit.",
            "基金门户需要公司自己的账户登录，所以它以交接形式交给他们，每个部分都已按字数限制起草好。",
          ),
        },
        {
          label: bi("Course correction", "调整方向"),
          text: bi(
            "We never start a new conversation with the same investor within 30 days. If replies stay low, the plan suggests an accelerator first, to build signal.",
            "30 天内不会与同一位投资人开始新的对话。如果回复一直不多，计划会建议先申请加速器，积累背书。",
          ),
        },
      ],
    },
    uploads: [
      { title: bi(
        "Pitch deck",
        "融资 BP",
      ), note: bi(
        "The most useful single file: problem, solution, traction, team, round.",
        "最有用的单个文件：痛点、方案、业务进展、团队、本轮融资。",
      ) },
      { title: bi(
        "Business plan or one-pager",
        "商业计划书或一页纸概要",
      ), note: bi(
        "For programs and grants that ask for more detail.",
        "用于要求更多细节的项目和基金。",
      ) },
      { title: bi(
        "Financial summary",
        "财务摘要",
      ), note: bi(
        "Only if you want it used. It's never sent without your approval.",
        "只在你希望使用时才会用到。未经你批准绝不会发出。",
      ) },
      { title: bi("Links", "链接"), note: bi("Website, product page, app store listing, demo video.", "官网、产品页面、应用商店页面、演示视频。") },
    ],
    weekly: [
      bi("New investors and programs that fit your stage and sector", "契合你阶段和赛道的新投资人和新项目"),
      bi("Approved investor emails sent from your Gmail within daily limits", "你批准的投资人邮件，在每日上限内从你的 Gmail 发出"),
      bi("Follow-ups after the number of days your plan sets, until a reply is recorded", "按你计划设定的天数进行跟进，直到记录到对方回复为止"),
      bi("Your funnel: contacted, replied, meetings, term sheets", "你的漏斗：已联系、已回复、会面、投资条款清单"),
    ],
    yours: [
      bi("Pitch meetings and due diligence", "路演会面和尽职调查"),
      bi("Signing term sheets and agreements", "签署投资条款清单和协议"),
      bi("Company logins for grant and government portals, prepared as handoffs", "基金和政府门户的公司账户登录，以交接形式准备好"),
      bi("Exhibition and application fees", "参展费和申请费"),
    ],
    faqs: [
      {
        q: bi("Won't investors see this as mass email?", "投资人会不会觉得这是群发邮件？"),
        a: bi(
          "Each email is written for one investor, says why your company fits their published focus, and is sent from your own address. Daily limits apply, no new conversation with the same person within 30 days, and an investor whose reply asks to stop is never emailed again by anyone on Onward Scout.",
          "每封邮件都只写给一位投资人，说明你的公司为什么契合对方公开的投资方向，并从你自己的邮箱发出。有每日上限，30 天内不会与同一个人开始新的对话；只要投资人在回复中要求停止，任何 Onward Scout 用户都不会再给他发邮件。",
        ),
      },
      {
        q: bi("Do you share my deck with anyone?", "你们会把我的 BP 分享给别人吗？"),
        a: bi(
          "Only with the investors and programs you approve, as part of an application or an email you confirmed.",
          "只会分享给你批准的投资人和项目，作为你确认过的申请或邮件的一部分。",
        ),
      },
    ],
  },

  researchers: {
    slug: "researchers",
    groups: ["R"],
    metaTitle: bi("For researchers: calls for papers, grants, fellowships and positions", "面向研究者：会议征稿、科研基金、Fellowship 项目和学术职位"),
    metaDescription: bi(
      "Drop in your CV and papers. Onward Scout finds conference calls, grants, fellowships, postdoc and visiting positions that fit your field and career stage, and prepares every application to its word limits from your own record.",
      "上传你的 CV 和论文。Onward Scout 为你找到契合你研究领域和职业阶段的会议征稿、科研基金、Fellowship 项目、博士后和访问学者职位，并用你自己的履历，按字数限制准备好每一份申请。",
    ),
    eyebrow: bi("For researchers", "面向研究者"),
    title: bi("Calls, grants and positions — prepared to the word count.", "征稿、基金和职位——按字数要求准备好。"),
    lede: bi(
      "Funding calls and conference deadlines are scattered across hundreds of sites, and every application wants the same CV in a different shape. Drop in your CV and papers: we find what fits your field and stage and prepare each application to its limits.",
      "基金申报和会议截稿信息散落在几百个网站上，而每份申请都要同一份 CV 换个格式。上传你的 CV 和论文：我们找到契合你领域和阶段的机会，并按每份申请的限制准备好。",
    ),
    teaser: bi("Calls for papers · grants · fellowships · postdocs", "会议征稿 · 科研基金 · Fellowship 项目 · 博士后"),
    goals: [
      {
        title: bi("Publish and present", "发表与报告"),
        body: bi(
          "Conference calls and journal special issues in your area. Submission systems need your own account, so we prepare title, abstract, keywords and cover letter as a handoff.",
          "你研究方向的会议征稿和期刊专题征稿。投稿系统需要你自己的账户，所以我们把标题、摘要、关键词和投稿信准备成交接材料。",
        ),
        types: ["conference_cfp", "journal", "speaking"],
      },
      {
        title: bi("Fund your work", "为你的研究争取资助"),
        body: bi(
          "Grants and fellowships matched on field, career stage and eligibility, with proposals drafted from your publications and highlighted where a claim needs you.",
          "按研究领域、职业阶段和资格要求匹配的科研基金和 Fellowship 项目，申请书根据你的发表成果起草，需要你确认的说法会高亮标出。",
        ),
        types: ["grant", "fellowship", "award"],
      },
      {
        title: bi("Take the next position", "迈向下一个职位"),
        body: bi(
          "Postdoc, PhD and visiting positions, with a personal email to each lab whose recent work overlaps yours.",
          "博士后、博士和访问学者职位，并给每个近期研究与你有交集的实验室写一封专属邮件。",
        ),
        types: ["postdoc", "phd_position", "visiting_scholar"],
      },
      {
        title: bi("Collaborate", "开展合作"),
        body: bi("Researchers, reviewer calls and industry partners working on related problems.", "研究相近问题的学者、审稿人征集和产业合作伙伴。"),
        types: ["collaborator", "editorial_role", "industry_partnership"],
      },
    ],
    types: [
      { id: "conference_cfp", why: bi("Calls for papers with their real deadlines, prepared as handoffs.", "附真实截止日期的会议征稿，以交接形式准备好。") },
      { id: "journal", why: bi("Special issues and journals open for submission.", "正在接受投稿的期刊专题和期刊。") },
      { id: "grant", why: bi("Research grants matched on field, stage and eligibility.", "按领域、阶段和资格要求匹配的科研基金。") },
      { id: "fellowship", why: bi("Independent fellowships and early-career awards.", "独立 Fellowship 项目和青年学者奖项。") },
      { id: "postdoc", why: bi("Postdoctoral positions, with a tailored email to the lab.", "博士后职位，附一封写给实验室的定制邮件。") },
      { id: "phd_position", why: bi("Funded PhD openings in labs that fit your interests.", "契合你研究兴趣的实验室提供的带资助博士名额。") },
      { id: "visiting_scholar", why: bi("A term or a year at another institution.", "到另一所机构访问一学期或一年。") },
      { id: "collaborator", why: bi("Researchers whose recent work overlaps yours.", "近期研究与你有交集的学者。") },
      { id: "editorial_role", why: bi("Calls for reviewers and program committees.", "审稿人和程序委员会征集。") },
      { id: "industry_partnership", why: bi("Companies and tech-transfer offices looking for research partners.", "寻找科研合作伙伴的企业和技术转移机构。") },
    ],
    example: {
      persona: bi("A postdoc in computational biology looking for an independent position", "一位计算生物学博士后，正在寻找独立职位"),
      steps: [
        { label: L.drops, text: bi("Her CV, two papers as PDFs and her ORCID iD.", "她的 CV、两篇 PDF 论文和她的 ORCID iD。") },
        { label: L.profile, text: bi(
          "Postdoc, computational biology; publications with venues and years, methods and grants, each linked to its source.",
          "博士后，计算生物学；发表成果（附期刊/会议和年份）、方法和基金，每一项都链接到出处。",
        ) },
        { label: L.goal, text: bi(
          "A faculty-track position or an independent fellowship within twelve months.",
          "十二个月内拿到一个教职轨道职位或一个独立 Fellowship 项目。",
        ) },
        { label: L.picks, text: bi(
          "Two early-career fellowships, one workshop call for papers and three labs whose recent papers overlap her methods.",
          "两个青年学者 Fellowship 项目、一个研讨会征稿，以及三个近期论文与她的方法有交集的实验室。",
        ) },
        {
          label: L.sent,
          text: bi(
            "The fellowship forms are filled from her CV, with a research statement drafted from her own abstracts; sentences that need her confirmation are highlighted. Each lab gets one personal email from her Gmail, after she approves it.",
            "Fellowship 项目的申请表根据她的 CV 填写，研究陈述根据她自己的论文摘要起草；需要她确认的句子会高亮标出。每个实验室都会收到一封她批准后从她的 Gmail 发出的专属邮件。",
          ),
        },
        { label: L.handoff, text: bi(
          "The workshop uses OpenReview, so title, abstract, keywords and author list arrive as a handoff.",
          "这个研讨会使用 OpenReview，所以标题、摘要、关键词和作者列表会以交接形式交给她。",
        ) },
      ],
    },
    uploads: [
      { title: bi("CV", "CV"), note: bi("Your academic CV with publications, grants and teaching.", "包含发表成果、基金和教学经历的学术 CV。") },
      { title: bi("Papers", "论文"), note: bi("PDFs of the work you want to lead with.", "你想重点展示的成果的 PDF。") },
      {
        title: bi("ORCID iD", "ORCID iD"),
        note: bi(
          "We read your public ORCID record. Google Scholar pages can't be read automatically, so keep your publication list in the CV.",
          "我们会读取你公开的 ORCID 记录。Google Scholar 页面无法自动读取，所以请把发表清单保留在 CV 中。",
        ),
      },
      { title: bi(
        "Previous proposals",
        "以往的申请书",
      ), note: bi(
        "Summaries of funded or submitted proposals, if you want them reused.",
        "已获资助或已提交的申请书摘要，如果你希望复用的话。",
      ) },
    ],
    weekly: [
      bi("New calls and positions in your field, ordered by deadline", "你所在领域的新征集和新职位，按截止日期排序"),
      bi("Applications prepared to each call's word limits", "按每个征集的字数限制准备好的申请"),
      bi("Follow-ups on emails to labs that haven't replied", "对尚未回复的实验室邮件进行跟进"),
      bi("A deadline calendar set against your milestones", "对照你的里程碑排好的截止日期日历"),
    ],
    yours: [
      bi("The research itself, and the final word on every claim", "研究本身，以及对每一个说法的最终把关"),
      bi("Submission systems that need your account, prepared as handoffs", "需要你自己账户的投稿系统，以交接形式准备好"),
      bi("Letters from your referees", "推荐人的推荐信"),
      bi("Institutional sign-offs and signatures", "所在机构的审批和签字"),
    ],
    faqs: [
      {
        q: bi("Can it write my research proposal?", "它能替我写研究计划书吗？"),
        a: bi(
          "It drafts sections from your own CV, abstracts and papers, cites the facts each sentence uses and highlights anything it couldn't source. The science, the aims and the final wording are yours.",
          "它会根据你自己的 CV、摘要和论文起草各个部分，为每句话注明所用的信息，并高亮任何找不到出处的内容。科学内容、研究目标和最终措辞都由你决定。",
        ),
      },
      {
        q: bi("Why don't you submit to OpenReview or EasyChair directly?", "为什么不直接替我在 OpenReview 或 EasyChair 上投稿？"),
        a: bi(
          "Those systems need your own account and identity, and automating them would break their rules. We prepare everything in their order, so submitting takes minutes.",
          "这些系统需要你自己的账户和身份，自动化操作会违反它们的规则。我们按它们的顺序把一切准备好，所以提交只需几分钟。",
        ),
      },
    ],
  },

  creators: {
    slug: "creators",
    groups: ["C"],
    metaTitle: bi(
      "For creators and freelancers: clients, brand deals, residencies and open calls",
      "面向创作者和自由职业者：客户、品牌合作、驻留项目和公开征集",
    ),
    metaDescription: bi(
      "Drop in your portfolio. Onward Scout finds clients, brand partnerships, residencies, grants and open calls that fit your work, writes one personal email per client from your Gmail and prepares every application for your tap.",
      "上传你的作品集。Onward Scout 为你找到契合你作品的客户、品牌合作、驻留项目、创作资助和公开征集，从你的 Gmail 给每位客户写一封专属邮件，并把每一份申请准备好，等你点一下。",
    ),
    eyebrow: bi("For creators and freelancers", "面向创作者和自由职业者"),
    title: bi("More clients and open calls. More time for the work.", "更多客户和征集，更多时间留给创作。"),
    lede: bi(
      "Pitching, applying and chasing replies can take more hours than the work itself. Drop in your portfolio: we find clients who buy what you make, brand programs, residencies, grants and open calls, and prepare each pitch from your real credits.",
      "自荐、申请、追回复，花的时间可能比创作本身还多。上传你的作品集：我们找到会购买你作品的客户、品牌计划、驻留项目、创作资助和公开征集，并根据你真实的作品履历准备每一份自荐。",
    ),
    teaser: bi("Clients · brand deals · residencies · open calls", "客户 · 品牌合作 · 驻留项目 · 公开征集"),
    goals: [
      {
        title: bi("Find clients", "找到客户"),
        body: bi(
          "Companies and publications that commission your kind of work, one tailored email each with the pieces that fit them. Marketplace briefs come as handoffs because they need your account.",
          "委托你这类作品的公司和出版物，每家一封定制邮件，附上最契合他们的作品。接单平台上的需求需要你自己的账户，所以会以交接形式交给你。",
        ),
        types: ["client_lead", "freelance_project"],
      },
      {
        title: bi("Land brand partnerships", "拿下品牌合作"),
        body: bi(
          "Creator programs and sponsorships, pitched with a media kit built from numbers you can stand behind.",
          "创作者计划和赞助，用一份基于你能为之担保的数据制作的媒体资料包去自荐。",
        ),
        types: ["brand_partnership", "podcast"],
      },
      {
        title: bi("Residencies, grants and open calls", "驻留项目、创作资助和公开征集"),
        body: bi(
          "Calls matched to your medium and stage, with artist statements drafted from how you describe your own work.",
          "按你的创作媒介和阶段匹配的征集，艺术家陈述根据你对自己作品的描述起草。",
        ),
        types: ["residency", "grant", "open_call", "competition"],
      },
      {
        title: bi("Get signed or licensed", "签约或授权"),
        body: bi("Agencies, publishers, platforms and stock libraries that take on creators like you.", "签约像你这样的创作者的经纪机构、出版方、平台和图库。"),
        types: ["platform_signing", "book_publisher", "licensing"],
      },
    ],
    types: [
      { id: "client_lead", why: bi("Companies that buy what you make, approached one at a time.", "会购买你作品的公司，一次联系一家。") },
      { id: "freelance_project", why: bi("Marketplace briefs, prepared as handoffs.", "接单平台上的需求，以交接形式准备好。") },
      { id: "brand_partnership", why: bi("Creator programs and sponsorships that fit your audience.", "契合你受众的创作者计划和赞助。") },
      { id: "residency", why: bi("Time and space to make work, with their real deadlines.", "提供创作时间和空间的驻留项目，附真实截止日期。") },
      { id: "open_call", why: bi("Exhibitions, anthologies, festivals and showcases.", "展览、作品合集、电影节/艺术节和展演。") },
      { id: "grant", why: bi("Creative grants and micro-grants.", "创作资助和小额资助。") },
      { id: "competition", why: bi("Design, writing, photography and music prizes.", "设计、写作、摄影和音乐奖项。") },
      { id: "platform_signing", why: bi("Agencies, networks and platforms that sign talent.", "签约人才的经纪机构、网络和平台。") },
      { id: "licensing", why: bi("Stock libraries and licensing marketplaces.", "图库和授权交易平台。") },
      { id: "book_publisher", why: bi("Publishers and agents accepting proposals.", "接受投稿提案的出版方和经纪人。") },
    ],
    example: {
      persona: bi("An independent illustrator who wants steadier editorial work", "一位希望获得更稳定的编辑类约稿的独立插画师"),
      steps: [
        { label: L.drops, text: bi("A portfolio PDF and a link to her website.", "一份作品集 PDF 和她的个人网站链接。") },
        { label: L.profile, text: bi(
          "Illustrator; clients, published pieces and exhibitions listed with their sources; style tags she can change in a tap.",
          "插画师；客户、已发表作品和展览都附出处列出；风格标签点一下就能修改。",
        ) },
        { label: L.goal, text: bi("Two recurring editorial clients and one residency this year.", "今年拿到两个长期合作的编辑类客户和一个驻留项目。") },
        { label: L.picks, text: bi(
          "Two residencies, one open call and five art directors at publications that commission illustration.",
          "两个驻留项目、一个公开征集，以及五位在委托插画的出版物任职的艺术总监。",
        ) },
        {
          label: L.sent,
          text: bi(
            "The residency and open-call forms are filled, with an artist statement drafted from her own descriptions, and submitted after her tap. Each art director gets one email with three relevant pieces, sent from her Gmail once she approves it.",
            "驻留项目和公开征集的申请表已填好，艺术家陈述根据她自己的描述起草，经她点一下后提交。每位艺术总监都会收到一封附三件相关作品的邮件，在她批准后从她的 Gmail 发出。",
          ),
        },
        {
          label: L.handoff,
          text: bi(
            "A brief on a freelance marketplace needs her account, so the proposal arrives ready to paste. Any submission fee is shown before she decides.",
            "一个自由职业平台上的需求需要她本人的账户，所以提案以可直接粘贴的形式交给她。任何投稿费都会在她做决定前先显示出来。",
          ),
        },
      ],
    },
    uploads: [
      { title: bi("Portfolio", "作品集"), note: bi("A PDF, or links to the pieces you want to lead with.", "一份 PDF，或你想重点展示的作品链接。") },
      { title: bi(
        "Media kit",
        "媒体资料包",
      ), note: bi(
        "Audience numbers you can stand behind, for brand programs.",
        "你能为之担保的受众数据，用于品牌计划。",
      ) },
      { title: bi("Links", "链接"), note: bi("Your site and public profiles.", "你的网站和公开主页。") },
      { title: bi("Rates", "报价"), note: bi("Only if you want them used in proposals.", "只在你希望写进提案时才会使用。") },
    ],
    weekly: [
      bi("New clients, programs and calls that fit your medium", "契合你创作媒介的新客户、新计划和新征集"),
      bi("Approved pitches sent from your Gmail within daily limits", "你批准的自荐邮件，在每日上限内从你的 Gmail 发出"),
      bi("Follow-ups on pitches that haven't been answered", "对尚未得到答复的自荐进行跟进"),
      bi("Your pipeline: pitched, replied, commissioned", "你的进度：已自荐、已回复、已委托"),
    ],
    yours: [
      bi("Contracts, invoices and rights negotiations", "合同、发票和版权谈判"),
      bi("Marketplace accounts and their proposals, prepared as handoffs", "接单平台账户及其提案，以交接形式准备好"),
      bi("Submission fees, which we always show up front", "投稿费，我们总会事先显示"),
      bi("The work itself", "创作本身"),
    ],
    faqs: [
      {
        q: bi("Do you publish my portfolio anywhere?", "你们会把我的作品集发布到什么地方吗？"),
        a: bi(
          "No. Your work is only sent as part of a pitch or an application you approved, to the person or organisation you chose.",
          "不会。你的作品只会作为你批准的自荐或申请的一部分，发给你选择的个人或机构。",
        ),
      },
      {
        q: bi("Can I pitch brands with the audience I have?", "我能用我现有的受众规模去找品牌合作吗？"),
        a: bi(
          "Yes, as long as the numbers are true. They come from your media kit or your confirmation, and we never round them up.",
          "可以，只要数据是真实的。这些数据来自你的媒体资料包或你的确认，我们绝不会往上凑整。",
        ),
      },
    ],
  },

  "career-changers": {
    slug: "career-changers",
    groups: ["T"],
    metaTitle: bi("For career changers: bridge roles, retraining and returning to work", "面向职业转型者：过渡岗位、再培训和重返职场"),
    metaDescription: bi(
      "Changing field, returning after a break, moving countries or starting again? Onward Scout shows which of your skills carry over, finds bridge roles, returnships and funded courses, and prepares each application honestly.",
      "换领域、休息一段时间后回归、移居他国，或者重新开始？Onward Scout 告诉你哪些技能可以迁移，找到过渡岗位、重返职场计划和受资助的课程，并诚实地准备每一份申请。",
    ),
    eyebrow: bi("For career changers", "面向职业转型者"),
    title: bi("A new direction, told with your true facts.", "一个新方向，用你真实的经历来讲述。"),
    lede: bi(
      "Switching fields, coming back after a break or starting over in a new country is hard enough without a blank form asking for “relevant experience”. Drop in what you have: we show which of your skills carry over, find roles and programs that welcome people like you, and explain the switch without inventing a thing.",
      "转换领域、在空窗期后回归，或在新的国家从头开始，本身就够难了，更别说面对一张要你填写“相关经验”的空白表格。把你已有的材料丢进来：我们告诉你哪些技能可以迁移，找到欢迎像你这样的人的岗位和项目，并在不编造任何内容的前提下讲清楚你的转型。",
    ),
    teaser: bi("Bridge roles · returnships · funded courses · mentors", "过渡岗位 · 重返职场计划 · 受资助课程 · 导师"),
    goals: [
      {
        title: bi("A bridge role in the new field", "新领域的过渡岗位"),
        body: bi(
          "Roles where your transferable skills count, with cover letters that explain the move using facts from your own history.",
          "看重你可迁移技能的岗位，求职信用你自己经历中的事实来解释这次转型。",
        ),
        types: ["job", "part_time", "volunteer"],
      },
      {
        title: bi("Retrain with support", "在支持下再培训"),
        body: bi(
          "Bootcamps, funded course seats and certifications. Enrolment and payment stay with you.",
          "训练营、受资助的课程名额和认证。报名和付款由你本人完成。",
        ),
        types: ["course", "certification"],
      },
      {
        title: bi("Come back after a break", "空窗期后回归"),
        body: bi(
          "Returnships and programs designed for people returning to work after caring, illness or time away.",
          "为因照顾家人、生病或暂离职场后重返工作的人设计的重返职场计划和项目。",
        ),
        types: ["returnship", "mentorship"],
      },
      {
        title: bi("Start over somewhere new", "在新的地方重新开始"),
        body: bi(
          "Remote roles, visa pathways and the evidence each route needs, for people moving countries.",
          "面向移居他国的人：远程岗位、签证路径，以及每条路径所需的证明材料。",
        ),
        types: ["remote_job", "visa_pathway", "community"],
      },
    ],
    types: [
      { id: "job", why: bi("Roles that value what you already do well.", "看重你已经擅长之事的岗位。") },
      { id: "returnship", why: bi("Paid programs for people returning after a career break.", "为职业空窗后重返职场的人提供的带薪项目。") },
      { id: "course", why: bi("Bootcamps and funded course seats.", "训练营和受资助的课程名额。") },
      { id: "certification", why: bi("Credentials that open the new field.", "打开新领域大门的资质证书。") },
      { id: "mentorship", why: bi("People who made the same move.", "走过同样转型之路的人。") },
      { id: "remote_job", why: bi("Roles you can take from where you live.", "在你现居地就能做的岗位。") },
      { id: "visa_pathway", why: bi("Work and talent visa routes, with the evidence list for each.", "工作签证和人才签证路径，附每条路径的证明材料清单。") },
      { id: "volunteer", why: bi("Experience in the new field that counts.", "在新领域里算数的经历。") },
      { id: "part_time", why: bi("A smaller first step while you transition.", "转型期间更小的第一步。") },
      { id: "community", why: bi("Associations and groups in the new field.", "新领域的协会和社群。") },
    ],
    example: {
      persona: bi("A secondary-school teacher moving into learning design", "一位正在转向学习设计的中学教师"),
      steps: [
        { label: L.drops, text: bi("Her teaching CV and a course she built, as a PDF.", "她的教师简历，以及她设计的一门课程（PDF）。") },
        {
          label: L.profile,
          text: bi(
            "Career changer, education to learning design; curriculum design, assessment and stakeholder communication shown as transferable skills, each quoted from her documents.",
            "职业转型者，从教育转向学习设计；课程设计、评估和与相关方沟通被呈现为可迁移技能，每一项都引自她的文档。",
          ),
        },
        { label: L.goal, text: bi(
          "A learning-designer role within six months, open to a short course first.",
          "六个月内拿到一个学习设计师岗位，也愿意先上一门短期课程。",
        ) },
        { label: L.picks, text: bi(
          "Two junior learning-design roles, one funded course seat and one mentorship program.",
          "两个初级学习设计岗位、一个受资助的课程名额和一个导师项目。",
        ) },
        { label: L.sent, text: bi(
          "Her cover letters explain the switch with facts from her own history — no invented experience — and go out after her tap.",
          "她的求职信用她自己经历中的事实解释这次转型——没有编造任何经验——在她点一下后发出。",
        ) },
        {
          label: bi("Gaps", "差距"),
          text: bi(
            "Where a posting asks for a tool her documents don't show, it's listed as a gap so she can decide: add evidence, learn it, or skip that role.",
            "当某个职位要求的工具在她的文档中找不到时，会被列为差距，由她来决定：补充证明、去学，或者跳过这个岗位。",
          ),
        },
      ],
    },
    uploads: [
      { title: bi(
        "Résumé, gaps and all",
        "简历，空窗期和转折都照实写",
      ), note: bi(
        "Breaks and changes of direction are fine; we don't hide them or invent around them.",
        "职业空窗和转向都没关系；我们不会隐瞒，也不会编造内容去掩盖。",
      ) },
      { title: bi("Course certificates", "课程证书"), note: bi("Anything you've learned for the new field.", "你为新领域学过的任何东西。") },
      { title: bi("Work samples", "作品样例"), note: bi("Projects that show the new skills in action.", "能体现新技能的项目。") },
      { title: bi("Links", "链接"), note: bi("A portfolio, a blog or a public project.", "作品集、博客或公开项目。") },
    ],
    weekly: [
      bi("Roles and programs open to people changing careers", "向职业转型者开放的岗位和项目"),
      bi("Applications that explain your move with your own facts", "用你自己的事实解释转型的申请"),
      bi(
        "The gaps between your profile and the roles you're shown, so you can decide what to work on",
        "你的档案与推荐岗位之间的差距，让你决定该在哪方面下功夫",
      ),
      bi("Milestones toward the first yes in the new field", "朝着新领域第一个“好”迈进的里程碑"),
    ],
    yours: [
      bi("Interviews and trial tasks", "面试和试工任务"),
      bi("Course enrolment and payments", "课程报名和付款"),
      bi("Visa applications and official documents", "签证申请和官方文件"),
      bi("Deciding which gaps are worth closing", "决定哪些差距值得去弥补"),
    ],
    note: bi(
      "Returning after caring for family, leaving the military, moving countries or starting a second career later in life — the same engine adapts to your situation.",
      "照顾家人后重返职场、退伍转业、移居他国，或者人生后半程开启第二职业——同一个引擎会适应你的处境。",
    ),
    faqs: [
      {
        q: bi("Will it hide my career break?", "它会隐瞒我的职业空窗吗？"),
        a: bi(
          "No, and it won't invent anything to fill it. Applications present your history truthfully and, where it helps, explain the break in your own words.",
          "不会，也不会编造任何内容去填补。申请会如实呈现你的经历，在有帮助时，用你自己的话解释这段空窗。",
        ),
      },
      {
        q: bi("What if I don't meet every requirement?", "如果我不满足所有要求怎么办？"),
        a: bi(
          "We show which requirements your documents support and which are gaps. Many roles hire people who meet most of them; you decide which to try.",
          "我们会告诉你哪些要求有你的文档支持、哪些是差距。很多岗位会录用满足大部分要求的人；尝试哪些由你决定。",
        ),
      },
    ],
  },
};

export function audienceContent(slug: string): AudienceContent | null {
  return (AUDIENCE_CONTENT as Record<string, AudienceContent>)[slug] ?? null;
}
