/**
 * Long-form copy for the marketing pages (home, how it works, about) as typed, bilingual data.
 * Short UI strings (headings, buttons, metadata) live in messages/<locale>/site.json; this module
 * holds the structured lists those pages render: the six steps, the automation boundary, the
 * principles, the channels in plain words, the handoff, the safety rules and the brand story.
 *
 * Every string is `bi("English", "中文")`; tests/i18n-parity.test.ts fails on English left in
 * `zh`. Pure and isomorphic.
 */
import { bi, localize, type Bilingual } from "@/lib/core/labels";
import type { ChannelId, OpportunityTypeId } from "@/lib/core/types";

export type { Bilingual };

/**
 * Placeholder for copy written before its translation: the `zh` field repeats the English text.
 * tests/i18n-parity.test.ts rejects it in shipped copy, so replace it with `bi(en, zh)`.
 */
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
    title: bi("Drop in what you have", "丢进你已有的材料"),
    body: bi(
      "A résumé, a deck, a portfolio, a paper or a few links. No forms: we read them and tell you what we found.",
      "一份简历、一份 BP、作品集、论文或几个链接。不用填表：我们来读，再告诉你我们找到了什么。",
    ),
    you: bi(
      "Drag in the files you already have, or paste links to your site, GitHub or ORCID. LinkedIn can't be read automatically, so export your profile as a PDF and drop that in.",
      "把你已有的文件拖进来，或粘贴你的个人网站、GitHub 或 ORCID 链接。LinkedIn 无法自动读取，所以请把你的主页导出为 PDF 再拖进来。",
    ),
    we: bi(
      "We extract the text, recognise what each file is and pull out roles, education, projects, results, publications and skills. You can start before signing in; your draft is saved when you sign in with your email.",
      "我们提取文字，识别每个文件是什么，并从中整理出你的经历、教育、项目、成果、发表和技能。你可以在登录前就开始；用邮箱登录后，你的草稿就会被保存。",
    ),
  },
  {
    id: "profile",
    title: bi("Confirm your profile", "确认你的档案"),
    body: bi(
      "Who you are, your field, stage and location as tags you can tap to change. Every fact links to the line it came from.",
      "你是谁、你的领域、阶段和所在地，都以标签呈现，点一下就能修改。每一条信息都链接到它所来自的那一行原文。",
    ),
    you: bi(
      "Glance at the tags and tap to fix anything we read wrong. If something important is missing, we ask with options to pick — never more than three questions at once.",
      "扫一眼标签，哪里读错了就点一下修正。如果缺少重要信息，我们会给出选项让你选——一次绝不超过三个问题。",
    ),
    we: bi(
      "We keep a source for every fact: which document and which words. Anything we couldn't trace to your documents is flagged for you to confirm, never quietly added.",
      "每一条信息我们都保留出处：来自哪份文档、哪句原话。无法追溯到你文档的内容，都会标记出来请你确认，绝不悄悄加进去。",
    ),
  },
  {
    id: "goals",
    title: bi("Choose goals and define success", "选择目标，定义成功"),
    body: bi(
      "A role, a round, a grant, a publication — and what success means by when. We break it into milestones.",
      "一个岗位、一轮融资、一笔资助、一篇发表——以及到什么时候、怎样才算成功。我们把它拆成里程碑。",
    ),
    you: bi(
      "Pick one or more goals (they are pre-selected from your profile) and choose a success definition, such as “a senior design role, remote, within four months”.",
      "选择一个或多个目标（已根据你的档案预先选好），再选一个成功定义，比如“四个月内拿到一个远程的高级设计岗位”。",
    ),
    we: bi(
      "We turn the definition into three to six milestones you can check, and a weekly plan: which kinds of opportunity first, how many per week, when to follow up and when to change tack.",
      "我们把这个定义转化为三到六个可核对的里程碑，以及一份每周计划：先找哪类机会、每周申请几个、什么时候跟进、什么时候换个方向。",
    ),
  },
  {
    id: "tap",
    title: bi("Tap the openings you want", "点选你想要的机会"),
    body: bi(
      "Real opportunities ranked by fit, each with the reasons, the deadline, what it asks for and what it needs from you.",
      "真实的机会，按匹配度排序，每一个都附有理由、截止日期、申请要求，以及需要你提供什么。",
    ),
    you: bi(
      "For each pick: Apply for me, Later, or Not for me (with a reason, so the next picks get better).",
      "对每个精选机会：替我申请、稍后，或者不适合我（附上理由，让下一批精选更准）。",
    ),
    we: bi(
      "We filter out what you aren't eligible for, rank the rest by fit, chance and effort, and show why each one made the list. Unknown details are shown as “check the official page”, never guessed.",
      "我们剔除你不符合资格的机会，按匹配度、成功几率和所需投入为其余的排序，并说明每一个为什么入选。未知的细节会显示为“请查看官方页面”，绝不靠猜。",
    ),
  },
  {
    id: "prepare",
    title: bi("We prepare, you confirm", "我们准备，你来确认"),
    body: bi(
      "We read the requirements, ask only for what's missing, draft the materials from your facts and fill the form or the email.",
      "我们读取申请要求，只问缺少的内容，根据你的信息起草材料，并填好表单或邮件。",
    ),
    you: bi(
      "Review the prepared application — every answer shows the facts it used — and tap Submit. If the site needs your login, a CAPTCHA or a payment, you get a short handoff with everything ready.",
      "检查准备好的申请——每个回答都会显示它用到的信息——然后点一下「提交」。如果对方网站需要你登录、完成验证码或付款，你会收到一个简短的交接，其余一切都已备好。",
    ),
    we: bi(
      "We pick the channel the opportunity allows (a hosted job form, a web form, an email from your Gmail or a handoff), submit after your tap and keep proof: the confirmation page, a reference or the sent message.",
      "我们选择该机会允许的通道（托管的招聘表单、网页表单、从你的 Gmail 发出的邮件，或本人提交交接），在你点一下后提交，并保留凭证：确认页面、编号或已发送的消息。",
    ),
  },
  {
    id: "loop",
    title: bi("We follow up and keep going", "我们持续跟进，一路推进"),
    body: bi(
      "Follow-ups scheduled, replies sorted, new picks every week — until you reach the success you defined or change course.",
      "按时跟进、整理回复、每周推送新精选——直到你达成自己定义的成功，或决定转换方向。",
    ),
    you: bi(
      "Look at your board when something needs you. Forward replies to your personal drop-box address, or tap “they replied”.",
      "有事需要你时，看一眼看板就好。把回信转发到你的个人回信转存地址，或者点一下“对方回复了”。",
    ),
    we: bi(
      "We schedule polite follow-ups, sort replies (interested, meeting, needs more information, rejected), move milestones forward and bring new picks each week. If something isn't working, we suggest a different route.",
      "我们安排礼貌的跟进，整理回复（感兴趣、约见面、需要更多信息、拒绝），推进里程碑，并每周带来新的精选。如果某条路走不通，我们会建议换一条。",
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
    step: bi("Reading your documents, building your profile, matching, drafting documents", "读取你的文档、生成档案、匹配机会、起草文档"),
    who: bi("Automatic", "自动"),
    how: bi("Runs in the background. You check the result, with a source next to every fact.", "在后台运行。你来核对结果，每条信息旁边都有出处。"),
    tone: "auto",
  },
  {
    step: bi("Filling in web forms", "填写网页表单"),
    who: bi("Partly automatic", "部分自动"),
    how: bi(
      "Google Forms and plain web forms are filled and submitted after your tap. Forms that need a browser (hosted job forms, form builders) are prepared field by field for you to paste until our browser agent is switched on, and a CAPTCHA or a login always hands over to you.",
      "Google 表单和普通网页表单会在你点一下之后自动填写并提交。需要浏览器的表单（托管招聘表单、表单搭建工具）在浏览器代理开启之前，会逐项准备好由你粘贴；遇到验证码或登录时，一律交给你来完成。",
    ),
    tone: "auto",
  },
  {
    step: bi("Sending emails and follow-ups", "发送邮件和跟进"),
    who: bi("Automatic once you connect Gmail", "连接 Gmail 后自动"),
    how: bi(
      "From your own Gmail, one person at a time, after your approval — or under a follow-up rule you switched on yourself.",
      "从你自己的 Gmail 发出，一次只发给一个人，在你批准之后——或按你自己开启的跟进规则发送。",
    ),
    tone: "auto",
  },
  {
    step: bi("Submitting an application", "提交申请"),
    who: bi("One tap from you", "你点一下"),
    how: bi(
      "Every submission waits for your confirmation, unless you gave a standing authorization for that category in Settings.",
      "每一次提交都要等你确认，除非你在「设置」中为该类别开启了长期授权。",
    ),
    tone: "tap",
  },
  {
    step: bi("Creating accounts and logging in to other sites", "在其他网站注册账户和登录"),
    who: bi("You", "你本人"),
    how: bi(
      "We never ask for or keep your passwords for other sites. Behind a login, you submit the prepared form yourself.",
      "我们绝不索要，也绝不保存你在其他网站的密码。需要登录的网站，由你本人提交准备好的表单。",
    ),
    tone: "you",
  },
  {
    step: bi("CAPTCHAs and two-factor codes", "验证码和双重验证码"),
    who: bi("You", "你本人"),
    how: bi(
      "We stop there and hand the form to you with every field prepared, so you finish it on the official site.",
      "我们会在那一步停下，把每个字段都已备好的表单交给你，由你在官方网站上完成。",
    ),
    tone: "you",
  },
  {
    step: bi("Application fees and payments", "申请费和付款"),
    who: bi("You", "你本人"),
    how: bi(
      "We show the cost up front and take you to the payment step with everything else ready.",
      "我们会事先显示费用，并带你到付款这一步，其余一切都已备好。",
    ),
    tone: "you",
  },
  {
    step: bi("Signatures, ID documents and contracts", "签名、身份证件和合同"),
    who: bi("You", "你本人"),
    how: bi("We list what's needed so nothing is missing when you sign.", "我们会列出所需的一切，让你签字时什么都不缺。"),
    tone: "you",
  },
  {
    step: bi("Interviews, pitches and tests", "面试、路演和测试"),
    who: bi("You", "你本人"),
    how: bi("We prepare the materials you'll bring. The conversation is yours.", "我们准备好你要带去的材料。对话由你来完成。"),
    tone: "you",
  },
];

/* ------------------------------------------------------------------ principles */

export type PrincipleId = "true-facts" | "your-tap" | "your-data";

export const PRINCIPLES: readonly { id: PrincipleId; title: Bilingual; body: Bilingual }[] = [
  {
    id: "true-facts",
    title: bi("Only true facts", "只写真实信息"),
    body: bi(
      "Everything we write for you traces to something you uploaded or confirmed. If a form asks for something we can't source, we ask you. We never invent a number, a title, a degree or a result.",
      "我们为你写的一切，都能追溯到你上传或确认过的内容。如果表单问到我们找不到出处的内容，我们会问你。我们绝不编造数字、头衔、学位或成果。",
    ),
  },
  {
    id: "your-tap",
    title: bi("Nothing is sent without your tap", "没有你点一下，什么都不会发出"),
    body: bi(
      "Every application and every email waits for your confirmation, unless you set a standing rule for that category yourself. You can pause everything at any time.",
      "每一份申请、每一封邮件都要等你确认，除非你自己为该类别设定了长期规则。你可以随时暂停一切。",
    ),
  },
  {
    id: "your-data",
    title: bi("Your data is yours", "你的数据属于你"),
    body: bi(
      "Export it or delete it from Settings. Your documents are never sold, never used to train AI models, and only sent where they are needed to do the job you asked for.",
      "你可以在「设置」中导出或删除它。你的文档绝不会被出售，绝不会被用来训练 AI 模型，只会发送到完成你所要求的事情确实需要的地方。",
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
  CH1: bi(
    "Job postings hosted on Greenhouse, Lever or Ashby publish their exact questions. We read them from the public posting and prepare every answer before anything is opened. Employers' private submission APIs need their key, so we never claim to use them.",
    "托管在 Greenhouse、Lever 或 Ashby 上的职位会公开其确切问题。我们从公开职位页读取这些问题，在打开任何页面之前就准备好每一个回答。雇主的私有提交 API 需要雇主自己的密钥，所以我们绝不声称使用了它们。",
  ),
  CH2: bi(
    "Google Forms and simple web forms without CAPTCHAs: we fill each field, show you the filled form, submit when you tap and keep the confirmation page as proof.",
    "Google 表单和没有验证码的简单网页表单：我们填好每个字段，给你看填好的表单，在你点一下后提交，并保存确认页面作为凭证。",
  ),
  CH3: bi(
    "Any other web form: a browser opens the official page, fills it from your profile and saves a screenshot of every step. It only goes to the opportunity's own site, treats page text as information rather than instructions, and stops at CAPTCHAs, logins and payments.",
    "其他任何网页表单：由浏览器打开官方页面，根据你的档案填写，并为每一步保存截图。它只访问该机会自己的网站，把页面文字当作信息而不是指令，遇到验证码、登录和付款就会停下。",
  ),
  CH4: bi(
    "Email from your own Gmail, for investors, recruiters, professors, editors, brands and clients: one personal message per person, never a blast, with daily and weekly limits and no repeat email to the same person within 30 days. Without Gmail, you get the text ready to send yourself.",
    "从你自己的 Gmail 发出的邮件，面向投资人、招聘方、教授、编辑、品牌方和客户：每人一封专属邮件，绝不群发，有每日和每周上限，30 天内不会给同一个人重复发信。没有 Gmail 时，你会拿到写好的正文，由你本人发送。",
  ),
  CH5: bi(
    "Documents: cover letters, one-pagers, statements, bios and answers drafted from your sourced facts, downloadable as PDF or Word, with each sentence linked to the facts it used.",
    "文档：求职信、一页纸介绍、个人陈述、个人简介和回答，全部根据你有出处的信息起草，可下载为 PDF 或 Word，每一句话都链接到它用到的信息。",
  ),
  CH6: bi(
    "Handoff: when a site needs your own login or forbids automation, every field, file and step is prepared in the form's order with the exact link, and you paste it in.",
    "本人提交交接：当网站需要你自己的登录或禁止自动化时，每个字段、文件和步骤都按表单顺序准备好，并附上确切链接，由你粘贴提交。",
  ),
  CH7: bi(
    "Direct connections with organisations that accept applications from Onward Scout. Not live yet: no organisation is connected today.",
    "与接受 Onward Scout 申请的机构直接对接。尚未上线：目前还没有任何机构接入。",
  ),
};

/* ------------------------------------------------------------------ the handoff */

export const HANDOFF = {
  why: bi(
    "Some places can't or shouldn't be automated: LinkedIn, Indeed and Glassdoor forbid it, Chinese job apps and most government, university and journal systems need your own account, and CAPTCHAs, payments and two-factor codes exist precisely so that a person is present. We don't pretend otherwise. We prepare everything and hand you the last step.",
    "有些地方无法、也不应该自动化：LinkedIn、Indeed 和 Glassdoor 禁止自动化；国内招聘 App 以及大多数政府、高校和期刊系统需要你自己的账户；验证码、付款和双重验证码存在的意义，正是要求真人在场。我们不假装这些不存在。我们把一切准备好，把最后一步交给你。",
  ),
  short: bi(
    "When only one quick action is left, such as sending a ready email from your own mail app, it takes seconds: open it, press send, come back.",
    "如果只剩一个简单动作，比如用你自己的邮件应用发出已写好的邮件，只需几秒：打开、点发送、回来即可。",
  ),
  long: bi(
    "When a site needs your login or a CAPTCHA, or forbids automation, you paste the prepared fields in order and submit. It usually takes a few minutes, and there is nothing to write.",
    "如果网站需要你登录、有验证码，或者禁止自动化，你按顺序粘贴准备好的字段再提交即可。通常只需几分钟，而且不用写任何东西。",
  ),
  contains: [
    bi("The exact link to the official form or portal", "官方表单或门户的确切链接"),
    bi("Every field in the order the form asks for it, each with a one-tap copy button", "按表单顺序排列的每一个字段，每个都有一键复制按钮"),
    bi("Your files — tailored résumé, cover letter, statement — ready to download", "你的文件——定制简历、求职信、个人陈述——随时可下载"),
    bi("Step-by-step notes that fit on a phone screen", "手机一屏就能看完的分步说明"),
    bi("An “I submitted it” button, with an optional confirmation link or screenshot as proof", "一个“我已提交”按钮，可选附上确认链接或截图作为凭证"),
  ],
  where: [
    bi("LinkedIn Easy Apply, Indeed and Glassdoor", "LinkedIn Easy Apply、Indeed 和 Glassdoor"),
    bi("Chinese job apps and campus-recruiting systems", "国内招聘 App 和校园招聘系统"),
    bi("Government, grant and public-sector portals", "政府、基金和公共部门的申报门户"),
    bi("Conference and journal submission systems such as OpenReview or EasyChair", "学术会议和期刊投稿系统，例如 OpenReview 或 EasyChair"),
    bi("Common App and university application portals", "Common App 和大学申请门户"),
    bi("Any form behind a login, a CAPTCHA or a payment", "任何需要登录、验证码或付款的表单"),
  ],
} as const;

/* ------------------------------------------------------------------ safety and honesty rules */

export const SAFETY_RULES: readonly { title: Bilingual; body: Bilingual }[] = [
  {
    title: bi("Facts come with sources", "信息都有出处"),
    body: bi(
      "Each fact in your profile records the document and the words it came from. Generated documents cite the facts behind each sentence; anything unsourced is highlighted for you instead of being sent.",
      "你档案中的每一条信息，都记录了它来自哪份文档、哪句原话。生成的文档会为每一句话注明依据的信息；没有出处的内容会高亮提示你，而不是直接发出去。",
    ),
  },
  {
    title: bi("Your tap, or your rule", "你点一下，或你定的规则"),
    body: bi(
      "Every submission and every email waits for your confirmation. The only exception is a standing authorization you switch on yourself in Settings, for a category you choose, and you can switch it off at any time.",
      "每一次提交、每一封邮件都要等你确认。唯一的例外是你自己在「设置」中为你选定的类别开启的长期授权，而且你可以随时关闭。",
    ),
  },
  {
    title: bi("A record of what you approved", "你批准过什么，都有记录"),
    body: bi(
      "Each application keeps a step log: what was prepared, what you confirmed and when, what was submitted and the proof that came back.",
      "每份申请都保留步骤记录：准备了什么、你在何时确认了什么、提交了什么，以及收到的凭证。",
    ),
  },
  {
    title: bi("Outreach that respects people", "尊重对方的外联"),
    body: bi(
      "Emails are written for one recipient at a time and sent from your own Gmail, with daily and weekly limits. We never start a new conversation with the same person within 30 days, a thread gets at most 2 polite follow-ups, and they stop once a reply is recorded. Anyone whose reply asks not to be contacted is never emailed again by any Onward Scout user.",
      "邮件一次只写给一位收件人，从你自己的 Gmail 发出，有每日和每周上限。30 天内不会与同一个人开始新的对话，同一封邮件最多跟进 2 次，一旦记录到回复就停止跟进。只要对方在回复中要求不再联系，任何 Onward Scout 用户都不会再给他发邮件。",
    ),
  },
  {
    title: bi("Only the official site", "只访问官方网站"),
    body: bi(
      "Automated form filling only visits the opportunity's own website. Text on those pages is treated as information, never as instructions to follow.",
      "自动填表只访问该机会自己的网站。这些页面上的文字只被当作信息，绝不会被当作要执行的指令。",
    ),
  },
  {
    title: bi("Real opportunities only", "只收录真实的机会"),
    body: bi(
      "Opportunities come from public postings and official program pages, with their real links. When a deadline, amount or rule is unknown, we say “check the official page” rather than guess.",
      "机会都来自公开发布的职位和官方项目页面，附有真实链接。当截止日期、金额或规则未知时，我们会写“请查看官方页面”，而不是去猜。",
    ),
  },
  {
    title: bi("Extra care for under-18s", "对 18 岁以下用户格外谨慎"),
    body: bi(
      "High-school students add a parent or guardian's email to their profile before their first submission, and outreach email is switched off for them.",
      "高中生在首次提交前需要在档案中填写父母或监护人的邮箱，并且会为他们关闭外联邮件功能。",
    ),
  },
  {
    title: bi("Practice without consequences", "零风险的练习"),
    body: bi(
      "A free practice application runs the whole flow against our own test form, so you can see exactly what happens before anything reaches a real organisation.",
      "一次免费的练习申请会在我们自己的测试表单上跑完整个流程，让你在任何内容发到真实机构之前，就清楚看到会发生什么。",
    ),
  },
];

/** How drafted text is labelled (production runs our own drafting engine until AI drafting is switched on). */
export const DRAFT_LABELS = {
  local: {
    label: bi("Drafted from your profile", "根据你的档案起草"),
    body: bi(
      "Assembled by our own engine from your sourced facts, sentence by sentence. Nothing leaves our servers to write it. Where an answer needs your own reasons — why this role, why this program — we ask you for a sentence or two instead of inventing them.",
      "由我们自己的引擎根据你有出处的信息逐句组装。写作过程中没有任何内容离开我们的服务器。当某个回答需要你自己的理由——为什么是这个岗位、为什么是这个项目——我们会请你写一两句话，而不是替你编造。",
    ),
  },
  ai: {
    label: bi("Written with AI", "由 AI 撰写"),
    body: bi(
      "When AI drafting is switched on, a language model polishes the draft using only your facts, and the result is labelled so you always know. The same rule applies: claims without a source are flagged, not sent.",
      "开启 AI 起草后，语言模型只使用你的信息来润色草稿，结果会加上标注，让你始终知情。规则不变：没有出处的说法会被标记，而不是被发出去。",
    ),
  },
} as const;

/* ------------------------------------------------------------------ about */

export const ABOUT = {
  story: [
    bi(
      "A scout goes ahead of the group. They find the way, notice the openings, and come back with what they found so everyone else can move with confidence.",
      "侦察兵走在队伍前面。他们探明道路，留意可以通过的缺口，再带着发现回来，让其他人可以放心前进。",
    ),
    bi("Onward is the direction: forward, toward the thing you decided you want.", "Onward 是方向：向前，朝着你决定要争取的东西。"),
    bi(
      "Onward Scout is both at once. We go ahead into the job boards, program pages, funds, calls and inboxes you don't have time to search; we come back with the openings you can actually win; and then we carry the paperwork most of the remaining way, so the effort goes into what you're good at instead of into forms.",
      "Onward Scout 两者兼具。我们先行一步，走进那些你没时间去翻的招聘看板、项目页面、基金、征集和收件箱；带回你真正有机会拿下的机会；然后把剩下的大部分文书工作扛起来，让你的力气花在你擅长的事上，而不是花在填表上。",
    ),
  ],
  beliefs: [
    {
      title: bi("Opportunity is unevenly found, not unevenly deserved.", "机会分布不均，是因为被发现得不均，而不是因为有人更不配。"),
      body: bi(
        "Most people miss the grant, the fellowship or the role they'd have won simply because they never saw it, or saw it the day after the deadline. Finding should not depend on having time, a network or someone who knows where to look.",
        "大多数人错过那笔本可以拿到的资助、那个 Fellowship 项目或那个岗位，只是因为从来没看到，或者在截止后一天才看到。能不能找到机会，不应该取决于你有没有时间、有没有人脉，或有没有人知道去哪里找。",
      ),
    },
    {
      title: bi("Effort belongs in the work, not in the forms.", "力气应该花在工作上，而不是表格上。"),
      body: bi(
        "Retyping the same history into the hundredth portal teaches nobody anything. The forms should take seconds of your attention; your craft, your research and your company should take the rest.",
        "把同一段经历第一百次敲进又一个门户网站，谁也学不到什么。表单只应该占用你几秒钟的注意力；你的专业、你的研究和你的公司，才应该占据其余的时间。",
      ),
    },
    {
      title: bi("Honesty compounds.", "诚实会复利。"),
      body: bi(
        "An application built on true, sourced facts can be defended in any interview. Invented polish wins nothing worth keeping, and it costs the trust of every reviewer who reads the next one.",
        "建立在真实、有出处信息之上的申请，经得起任何面试的追问。编造出来的光鲜换不来任何值得留住的东西，还会透支每一位评审对下一份申请的信任。",
      ),
    },
    {
      title: bi("Automation should know its limits.", "自动化应该知道自己的边界。"),
      body: bi(
        "Some steps belong to you: your login, your signature, your payment, your conversation. We design those as a clear handoff instead of hiding them behind a promise of magic.",
        "有些步骤属于你：你的登录、你的签名、你的付款、你的对话。我们把它们设计成清晰的交接，而不是藏在“魔法”般的承诺后面。",
      ),
    },
  ],
  howWeWork: [
    {
      title: bi("One profile, whoever you are", "一份档案，无论你是谁"),
      body: bi(
        "Student, employee, founder, researcher, creator, licensed professional, between careers — or two of these at once. One engine, one profile, one board.",
        "学生、职场人、创业者、研究者、创作者、持证专业人士、职业转型中的人——或者同时是其中两种。一个引擎、一份档案、一块看板。",
      ),
    },
    {
      title: bi("Sources before sentences", "先有出处，再有句子"),
      body: bi(
        "Every fact has a source; every document cites its facts. Unsourced claims are flagged, never invented.",
        "每条信息都有出处；每份文档都注明它依据的信息。没有出处的说法会被标记，绝不编造。",
      ),
    },
    {
      title: bi("Your tap before anything leaves", "发出任何东西之前，先等你点一下"),
      body: bi(
        "Nothing is submitted or sent without your confirmation, or a standing rule you set yourself.",
        "没有你的确认，或你自己设定的长期规则，什么都不会被提交或发送。",
      ),
    },
    {
      title: bi("Real openings, real links", "真实的机会，真实的链接"),
      body: bi(
        "Opportunities come from public postings and official pages. Unknown details stay unknown: “check the official page”.",
        "机会来自公开发布的职位和官方页面。未知的细节就保持未知：“请查看官方页面”。",
      ),
    },
    {
      title: bi("Plain about what we can't do", "坦白说明我们做不到的事"),
      body: bi(
        "CAPTCHAs, logins, payments, signatures and interviews stay with you, as a short, well-prepared handoff.",
        "验证码、登录、付款、签名和面试都由你本人完成，以简短、准备充分的交接形式呈现。",
      ),
    },
    {
      title: bi("Paid for by the people we help", "由我们帮助的人付费"),
      body: bi(
        "You pay when something is submitted for you. No ads, no selling data, no fees from the organisations you apply to.",
        "只有在替你提交了内容时你才付费。没有广告，不出售数据，也不向你申请的机构收费。",
      ),
    },
  ],
  company: [
    bi(
      "Onward Scout is a new, independent product, launched in 2026 and in early access. You won't find a wall of logos, user counts or testimonials here: we'd rather show you exactly how the product works until there are real results to report.",
      "Onward Scout 是一个全新的独立产品，于 2026 年推出，目前处于抢先体验阶段。这里没有满墙的 logo、用户数或用户评价：在有真实成果可以报告之前，我们宁愿把产品到底怎么运作原原本本地展示给你。",
    ),
    bi(
      "We answer every message ourselves. If something is unclear, wrong or missing — an opportunity, a policy, a feature — write to us and it reaches a person.",
      "每一封来信都由我们亲自回复。如果有哪里不清楚、有错误或有缺漏——某个机会、某项政策、某个功能——写信给我们，都会有真人处理。",
    ),
  ],
} as const;

/* ------------------------------------------------------------------ small shared lists */

/** What's free, everywhere it's listed (home teaser, pricing). */
export const FREE_INCLUDES: readonly Bilingual[] = [
  bi("Your profile, with a source for every fact", "你的档案，每条信息都有出处"),
  bi("Matching and ranked picks for your goals", "针对你目标的匹配和排序精选"),
  bi("Previews and document drafts", "预览和文档草稿"),
  bi("Follow-up emails on applications you've sent", "对已发出申请的跟进邮件"),
  bi("Practice applications, end to end", "完整流程的练习申请"),
];

/** Bilingual helper re-exported for data files that do have both languages. */
export { bi };
