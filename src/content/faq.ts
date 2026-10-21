/**
 * Questions people actually ask before trusting a service to apply on their behalf. Used by
 * /faq (all, grouped, FAQPage JSON-LD), /pricing (billing group) and the home page teaser.
 * Answers are plain text (they go into JSON-LD verbatim) and must stay true to how the product
 * works today: if a behaviour changes, change the answer in the same commit.
 *
 * Copy is bilingual: `bi("English", "中文")`. tests/i18n-parity.test.ts fails on English left in `zh`.
 */
import { bi, type Bilingual } from "./site-copy";

export const FAQ_GROUPS = ["how", "honesty", "data", "channels", "billing", "accounts"] as const;
export type FaqGroup = (typeof FAQ_GROUPS)[number];

export const FAQ_GROUP_LABELS: Record<FaqGroup, Bilingual> = {
  how: bi("How it works", "工作方式"),
  honesty: bi("Honesty and safety", "诚实与安全"),
  data: bi("Data and privacy", "数据与隐私"),
  channels: bi("Channels and platforms", "通道与平台"),
  billing: bi("Billing and credits", "账单与额度"),
  accounts: bi("Your account", "你的账户"),
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
    q: bi("What does Onward Scout actually do?", "Onward Scout 到底是做什么的？"),
    a: bi(
      "It turns the documents you already have into a profile where every fact has a source, finds real opportunities you can win — jobs, internships, investors, accelerators, grants, fellowships, calls for papers, residencies, competitions and more — and prepares each application for you. You tap the ones you want, confirm, and we submit, follow up and keep going toward the goal you set.",
      "它把你已有的文档变成一份每条信息都有出处的档案，为你找到真正有机会拿下的机会——岗位、实习、投资人、加速器、基金、Fellowship 项目、会议征稿、驻留项目、比赛等等——并为你准备好每一份申请。你点选想要的、确认一下，我们就会提交、跟进，并朝着你设定的目标持续推进。",
    ),
    more: { href: "/how-it-works", label: bi("How it works", "工作方式") },
  },
  {
    id: "what-to-upload",
    group: "how",
    q: bi("What do I need to upload?", "我需要上传什么？"),
    a: bi(
      "Whatever you already have: a résumé or CV, a pitch deck, a portfolio, a transcript, papers, certificates, or links to your website, GitHub or ORCID. PDF, Word, PowerPoint and plain text all work. LinkedIn can't be read automatically, so save your LinkedIn profile as a PDF and upload that. Please don't upload passports or ID cards; we don't need them.",
      "你已有的任何材料：简历或 CV、融资 BP、作品集、成绩单、论文、证书，或者你的个人网站、GitHub、ORCID 链接。PDF、Word、PowerPoint 和纯文本都可以。LinkedIn 无法自动读取，所以请把你的 LinkedIn 主页存为 PDF 后上传。请不要上传护照或身份证，我们不需要它们。",
    ),
  },
  {
    id: "do-i-write",
    group: "how",
    q: bi("Do I have to fill in forms or write anything?", "我需要填表或写东西吗？"),
    a: bi(
      "Rarely. Fields are filled from your profile, and when something is missing we ask with options to tap, at most three questions at a time. When an application asks something only you can answer — why you want this particular role or program — we ask you for a sentence or two instead of inventing your motivation.",
      "很少需要。表单字段会根据你的档案填好；缺少信息时，我们会给出选项让你点选，一次最多问三个问题。当申请问到只有你能回答的问题——比如你为什么想要这个岗位或项目——我们会请你写一两句话，而不是替你编造动机。",
    ),
  },
  {
    id: "what-it-finds",
    group: "how",
    q: bi("What kinds of opportunities can it find?", "它能找到哪些机会？"),
    a: bi(
      "Jobs and internships, graduate programs and returnships; investors, accelerators, incubators, pitch competitions and trade shows; grants, fellowships, scholarships, awards and hackathons; calls for papers, journals, PhD, postdoc and visiting positions; residencies, open calls and brand partnerships; speaking slots, podcasts and media; communities and events. The library grows as we add sources.",
      "岗位和实习、校招项目和重返职场计划；投资人、加速器、孵化器、路演比赛和展会；基金、Fellowship 项目、奖学金、奖项和黑客松；会议征稿、期刊、博士、博士后和访问学者职位；驻留项目、公开征集和品牌合作；演讲机会、播客和媒体；社群和活动。随着我们接入更多来源，机会库会持续扩大。",
    ),
    more: { href: "/opportunities", label: bi("Browse opportunities", "浏览机会") },
  },
  {
    id: "how-ranked",
    group: "how",
    q: bi("How are opportunities chosen for me?", "为我挑选机会的依据是什么？"),
    a: bi(
      "First we remove what you aren't eligible for: wrong level, location, language, work authorization or a passed deadline. Then we rank the rest by fit, your chances and the effort involved, and show the reasons and the gaps for each one. Tell us why something isn't for you, and the next picks take it into account.",
      "首先，我们剔除你不符合资格的机会：级别、地点、语言、工作许可不符，或已过截止日期。然后按匹配度、你的成功几率和所需投入为其余机会排序，并为每一个列出理由和差距。告诉我们某个机会为什么不适合你，下一批精选就会把它考虑进去。",
    ),
  },
  {
    id: "two-goals",
    group: "how",
    q: bi("Can I pursue more than one goal at a time?", "我可以同时追求多个目标吗？"),
    a: bi(
      "Yes. You can run a job search and a PhD application, or a fundraise and a speaking push, side by side. Each goal has its own success definition and milestones; your board shows them together.",
      "可以。你可以同时找工作和申请博士，或者一边融资一边争取演讲机会。每个目标都有自己的成功定义和里程碑；你的看板会把它们放在一起展示。",
    ),
  },

  /* ------------------------------------------------------------ honesty and safety */
  {
    id: "make-things-up",
    group: "honesty",
    q: bi("Will you exaggerate or make things up to improve my chances?", "你们会为了提高我的机会而夸大或编造内容吗？"),
    a: bi(
      "No. Every fact in a generated document traces to a document you uploaded or something you confirmed. Claims we can't source are highlighted for you, never sent quietly. We reflect a posting's keywords only where your record supports them.",
      "不会。生成文档中的每一条信息，都能追溯到你上传的文档或你确认过的内容。找不到出处的说法会高亮提示你，绝不会悄悄发出去。只有在你的履历确实支持时，我们才会呼应职位描述中的关键词。",
    ),
  },
  {
    id: "without-me",
    group: "honesty",
    q: bi("Can anything be submitted without me knowing?", "会不会有什么在我不知情的情况下被提交？"),
    a: bi(
      "No. Each application and each email waits for your tap. The only exception is a standing authorization you switch on yourself in Settings for a category you choose — for example, automatic follow-ups, which come with Pro — and you can switch it off at any time. Every submission keeps a record of what you approved and when.",
      "不会。每一份申请、每一封邮件都要等你点一下。唯一的例外是你自己在「设置」中为你选定的类别开启的长期授权——例如 Pro 会员附带的自动跟进——而且你可以随时关闭。每一次提交都会记录你批准了什么、何时批准。",
    ),
  },
  {
    id: "ai-labels",
    group: "honesty",
    q: bi("What do “Drafted from your profile” and “Written with AI” mean?", "“根据你的档案起草”和“由 AI 撰写”是什么意思？"),
    a: bi(
      "They tell you how a draft was made. “Drafted from your profile” means our own engine assembled it from your sourced facts, without sending anything to an AI provider. “Written with AI” means a language model polished it, using only your facts. Either way, every sentence shows the facts it used.",
      "它们告诉你草稿是怎么写出来的。“根据你的档案起草”表示由我们自己的引擎根据你有出处的信息组装而成，没有向任何 AI 服务商发送内容。“由 AI 撰写”表示由语言模型润色，但只使用你的信息。无论哪种方式，每一句话都会显示它用到的信息。",
    ),
  },
  {
    id: "guarantee",
    group: "honesty",
    q: bi("Do you guarantee I'll get the job, the funding or the place?", "你们保证我能拿到工作、融资或名额吗？"),
    a: bi(
      "No, and nobody honest can. Decisions belong to the organisations you apply to. What we can promise is that you'll see more of the right opportunities, apply to more of them with less effort, and never be misrepresented.",
      "不保证，任何诚实的人都无法保证。决定权属于你申请的机构。我们能承诺的是：你会看到更多合适的机会，用更少的力气申请更多机会，而且绝不会被歪曲。",
    ),
  },
  {
    id: "spam",
    group: "honesty",
    q: bi("How do you stop outreach from turning into spam?", "你们如何防止外联邮件变成垃圾邮件？"),
    a: bi(
      "Each email is written for one person and sent from your own Gmail, never in bulk. There are daily and weekly limits; we never start a new conversation with the same person within 30 days; a thread gets at most 2 polite follow-ups, which stop as soon as a reply is recorded (forward it to your reply address or tap “they replied”). Anyone whose reply asks not to be contacted is never emailed again by any Onward Scout user.",
      "每封邮件都只写给一个人，并从你自己的 Gmail 发出，绝不群发。每天和每周都有发送上限；30 天内不会与同一个人开始新的对话；同一封邮件最多跟进 2 次，一旦记录到回复就会停止（把回复转发到你的回复地址，或点“对方已回复”）。只要对方在回复中要求不再联系，任何 Onward Scout 用户都不会再给他发邮件。",
    ),
  },
  {
    id: "minors",
    group: "honesty",
    q: bi("Can high-school students use Onward Scout?", "高中生可以使用 Onward Scout 吗？"),
    a: bi(
      "Yes, with a parent or guardian: we ask for a guardian's email on your profile before your first submission, and outreach email is switched off for under-18s. Onward Scout is not for children under 13.",
      "可以，但需要父母或监护人参与：首次提交前，我们会请你在档案中填写监护人的邮箱，并为 18 岁以下用户关闭外联邮件功能。Onward Scout 不面向 13 岁以下的儿童。",
    ),
  },

  /* ------------------------------------------------------------ data and privacy */
  {
    id: "who-sees",
    group: "data",
    q: bi("Who can see my documents?", "谁能看到我的文档？"),
    a: bi(
      "You, and the organisations you approve an application to. Files are kept in private storage and opened through short-lived links. They are sent to a service provider only when it's needed for a task you asked for — for example, to an AI provider for drafting when AI drafting is switched on. Our analytics tool can also record the pages where you upload, including images, unless you turn analytics off in Cookie settings.",
      "你本人，以及你批准投递申请的机构。文件保存在私有存储中，通过短时有效的链接打开。只有在完成你要求的任务确有需要时，才会发送给服务商——例如，开启 AI 起草后，发送给 AI 服务商用于起草。此外，除非你在“Cookie 设置”中关闭统计，我们的统计工具也可能记录你上传文件的页面，包括图片。",
    ),
    more: { href: "/privacy", label: bi("Privacy policy", "隐私政策") },
  },
  {
    id: "training",
    group: "data",
    q: bi("Do you use my data to train AI models?", "你们会用我的数据训练 AI 模型吗？"),
    a: bi(
      "No. We don't train models on your data, and under our AI provider's commercial terms the content we send through its API isn't used to train its models either. Today most drafting runs on our own engine, which sends nothing anywhere.",
      "不会。我们不用你的数据训练模型；根据我们的 AI 服务商的商业条款，我们通过其 API 发送的内容也不会被用于训练其模型。目前大部分起草工作都在我们自己的引擎上完成，不会向任何地方发送内容。",
    ),
  },
  {
    id: "delete",
    group: "data",
    q: bi("How do I export or delete my data?", "如何导出或删除我的数据？"),
    a: bi(
      "In Settings you can download everything we hold about you and delete your account. Deleting removes your profile, documents, applications and messages; billing records are kept as long as accounting law requires.",
      "在「设置」中，你可以下载我们保存的关于你的全部数据，也可以删除你的账户。删除会移除你的档案、文档、申请和消息；账单记录按会计法规要求的期限保留。",
    ),
  },
  {
    id: "gmail-read",
    group: "data",
    q: bi("Do you read my Gmail?", "你们会读我的 Gmail 吗？"),
    a: bi(
      "No. If you connect Gmail, we ask only for permission to send email on your behalf, plus your address so we know which account it is. We can't read your inbox. To let us see a reply, forward it to your personal drop-box address or paste it into the application.",
      "不会。如果你连接 Gmail，我们只申请代你发送邮件的权限，外加你的邮箱地址，以便知道是哪个账户。我们无法读取你的收件箱。想让我们看到某封回信，请把它转发到你的个人回信转存地址，或粘贴到对应的申请中。",
    ),
  },
  {
    id: "analytics",
    group: "data",
    q: bi("What does your analytics tool record?", "你们的统计工具会记录什么？"),
    a: bi(
      "We use one analytics tool, FlowGlance. Besides page views and clicks, its detailed capture records text typed into forms on our site and images uploaded through it. In the EU, the UK and Switzerland it only runs after you accept; elsewhere it runs by default and you can opt out from “Cookie settings” in the footer.",
      "我们只使用一个统计工具 FlowGlance。除了页面浏览和点击，它的详细采集功能还会记录你在本站表单中输入的文字和通过本站上传的图片。在欧盟、英国和瑞士，只有在你同意后才会运行；在其他地区默认运行，你可以通过页脚的“Cookie 设置”选择退出。",
    ),
    more: { href: "/cookie-policy", label: bi("Cookie policy", "Cookie 政策") },
  },

  /* ------------------------------------------------------------ channels and platforms */
  {
    id: "linkedin",
    group: "channels",
    q: bi("Why can't you apply on LinkedIn or Indeed for me?", "为什么你们不能替我在 LinkedIn 或 Indeed 上申请？"),
    a: bi(
      "Because those platforms forbid automated applications, and doing it anyway would put your account at risk. Instead we prepare a handoff: your cover letter, answers and files in the order their form asks for them, with the exact link. You paste them in and tap “I submitted it”.",
      "因为这些平台禁止自动化申请，强行这么做会让你的账户面临风险。我们会准备一份交接材料：你的求职信、回答和文件，按对方表单要求的顺序排好，并附上确切的链接。你粘贴进去，再点一下“我已提交”即可。",
    ),
  },
  {
    id: "handoff",
    group: "channels",
    q: bi("What is a handoff?", "什么是交接？"),
    a: bi(
      "The moment a person is genuinely needed — a CAPTCHA, a login, a payment, a signature, or a platform that forbids automation. We stop, tell you exactly what's needed, and have everything else ready: you open the official form, paste the prepared fields in order and submit. That usually takes a few minutes, with nothing to write. A single quick action, like sending a ready email from your mail app, takes seconds.",
      "就是真正需要你本人出场的那一刻——验证码、登录、付款、签名，或者平台禁止自动化。我们会停下来，准确告诉你需要做什么，其余一切都已备好：你打开官方表单，按顺序粘贴准备好的字段再提交。通常需要几分钟，但不用写任何东西。如果只是一个简单动作，比如用你的邮件应用发出已写好的邮件，只需几秒。",
    ),
    more: { href: "/how-it-works#handoff", label: bi("The handoff, explained", "交接详细说明") },
  },
  {
    id: "captcha",
    group: "channels",
    q: bi("What happens when a form has a CAPTCHA or needs a login?", "如果表单有验证码或需要登录，会怎样？"),
    a: bi(
      "We never try to get around it. The application moves to “Needs you”, you get a notification, and the handoff panel shows the link, the step that's needed and every prepared field. Once you've done it, tap “I submitted it” and we carry on with the follow-up.",
      "我们绝不会试图绕过。这份申请会移到“需要你处理”，你会收到通知，交接面板会显示链接、需要你完成的步骤和每一个已准备好的字段。完成后点一下“我已提交”，我们就会接着跟进。",
    ),
  },
  {
    id: "email-how",
    group: "channels",
    q: bi("How do you send emails for me?", "你们怎么替我发邮件？"),
    a: bi(
      "Connect your Gmail once, with send-only permission. Each email is drafted for one recipient, shown to you, and sent from your own address after you approve it. Without Gmail, you get the finished text and a link that opens it in your own email app.",
      "只需连接一次你的 Gmail，授权仅限发送。每封邮件都为一位收件人起草，先给你看，在你批准后从你自己的邮箱发出。没有 Gmail 时，你会拿到写好的正文，以及一个能在你自己的邮件应用中打开它的链接。",
    ),
  },
  {
    id: "practice",
    group: "channels",
    q: bi("What is a practice application?", "什么是练习申请？"),
    a: bi(
      "A free, complete run of the whole flow against our own test form: we prepare the answers and documents, you confirm, we submit and show you the confirmation. Nothing reaches a real organisation, and it costs no credits.",
      "在我们自己的测试表单上免费、完整地跑一遍整个流程：我们准备回答和文档，你确认，我们提交并给你看确认回执。不会发到任何真实机构，也不消耗额度。",
    ),
  },

  /* ------------------------------------------------------------ billing and credits */
  {
    id: "credit",
    group: "billing",
    q: bi("What is a credit?", "什么是额度？"),
    a: bi(
      "One credit is one application submitted for you through any channel, including a handoff you confirm, or one outreach email to a new contact. Follow-ups, drafts and practice applications don't use credits.",
      "1 个额度 = 通过任意通道替你提交 1 份申请（包括你确认过的本人提交交接），或向 1 位新联系人发送 1 封外联邮件。跟进、草稿和练习申请都不消耗额度。",
    ),
  },
  {
    id: "free",
    group: "billing",
    q: bi("What can I do for free?", "哪些可以免费使用？"),
    a: bi(
      "Build your profile, get matched and ranked picks, see previews and document drafts, send follow-ups and run practice applications — all free, with no time limit. New accounts also get 3 credits, valid for 60 days, to submit their first real applications.",
      "建立档案、获得匹配并排好序的精选、查看预览和文档草稿、发送跟进邮件、进行练习申请——全部免费，没有时间限制。新账户还会获赠 3 个额度，60 天内有效，用来提交你的头几份真实申请。",
    ),
  },
  {
    id: "failed",
    group: "billing",
    q: bi("What happens to my credit if a submission fails?", "如果提交失败，我的额度会怎样？"),
    a: bi(
      "You keep it. A credit is reserved when you confirm and only spent once the application is actually submitted. If it fails, you withdraw it, or the deadline passes first, the credit comes back automatically.",
      "额度还是你的。你确认时额度只是被保留，只有申请真正提交成功时才会消耗。如果提交失败、你撤回申请，或先过了截止日期，额度会自动退回。",
    ),
  },
  {
    id: "cancel",
    group: "billing",
    q: bi("Can I cancel Pro at any time?", "Pro 可以随时取消吗？"),
    a: bi(
      "Yes. Cancel from Billing in your account. You keep Pro until the end of the period you paid for, and credits from that period stay usable for 30 days after it ends. Nothing renews after you cancel.",
      "可以。在你账户的「账单」中取消即可。你可以继续使用 Pro 直到已付费周期结束，该周期的额度在周期结束后仍可使用 30 天。取消后不会再续费。",
    ),
  },
  {
    id: "expiry",
    group: "billing",
    q: bi("Do credits expire?", "额度会过期吗？"),
    a: bi(
      "Yes. Free starter credits last 60 days. Pro credits stay usable for 30 days after the month they belong to. Pack credits last 180 days from purchase.",
      "会。免费起步额度有效期 60 天。Pro 额度在所属月份结束后仍可使用 30 天。额度包中的额度自购买起 180 天内有效。",
    ),
  },
  {
    id: "refund",
    group: "billing",
    q: bi("Can I get a refund?", "可以退款吗？"),
    a: bi(
      "Yes, within 14 days of a charge, if none of the credits from that charge have been used. Write to contact@onwardscout.com from the email you sign in with. Credits spent on submitted applications can't be refunded, and failed submissions never use a credit in the first place.",
      "可以：扣费后 14 天内，只要该笔费用对应的额度一个都没用过。请用你登录所用的邮箱写信到 contact@onwardscout.com。已用于成功提交申请的额度不能退款；而提交失败本来就不会消耗额度。",
    ),
    more: { href: "/refund-policy", label: bi("Refund policy", "退款政策") },
  },

  /* ------------------------------------------------------------ accounts */
  {
    id: "no-account",
    group: "accounts",
    q: bi("Do I need an account to start?", "我需要先注册账户才能开始吗？"),
    a: bi(
      "No. You can drop in your documents and see what we find before signing in. To save your profile and apply, sign in with your email; the draft you started moves into your account.",
      "不需要。你可以先丢进你的文档，在登录前看看我们找到了什么。想保存档案并开始申请时，用你的邮箱登录即可；你开始的草稿会转入你的账户。",
    ),
  },
  {
    id: "sign-in",
    group: "accounts",
    q: bi("How do I sign in?", "怎么登录？"),
    a: bi(
      "With your email address and a one-time code we send to it. There's no password to remember and no separate sign-up: a new email creates your account in the same step.",
      "用你的邮箱地址和我们发送到该邮箱的一次性验证码。不用记密码，也没有单独的注册：新邮箱会在同一步自动创建账户。",
    ),
  },
  {
    id: "languages",
    group: "accounts",
    q: bi("Which languages does Onward Scout support?", "Onward Scout 支持哪些语言？"),
    a: bi(
      "The site and the app are in English and Chinese. Your documents can be in any language, and drafts can be written in English or Chinese, whichever the opportunity calls for.",
      "网站和应用提供英文和中文。你的文档可以是任何语言，草稿可以用英文或中文撰写，取决于机会的要求。",
    ),
  },
  {
    id: "contact",
    group: "accounts",
    q: bi("How do I reach a person?", "怎样联系到真人？"),
    a: bi(
      "Write to contact@onwardscout.com or use the contact form. We reply to every message within two business days.",
      "写信到 contact@onwardscout.com，或使用联系表单。每一封来信我们都会在两个工作日内回复。",
    ),
    more: { href: "/contact", label: bi("Contact", "联系我们") },
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
