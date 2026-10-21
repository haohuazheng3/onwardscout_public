import type { NotificationKind } from "@/lib/notifications";
import type { NotifyKey } from "./plan";

/*
 * Notification copy for application events, in the person's language (en/zh). Real, specific
 * sentences: what happened, to which opportunity, and the one thing to do next.
 */

type Lang = "en" | "zh";

interface Copy {
  kind: NotificationKind;
  email: boolean;
  title: (target: string) => { en: string; zh: string };
  body?: (target: string) => { en: string; zh: string };
}

const COPY: Record<NotifyKey, Copy> = {
  questions: {
    kind: "needs_you",
    email: false,
    title: (x) => ({ en: `A few quick taps for ${x}`, zh: `${x}：需要你点选几项` }),
    body: () => ({ en: "Answer the questions we couldn't find in your profile, and we'll finish the application.", zh: "回答档案里缺的几项，我们就能把申请准备完。" }),
  },
  ready: {
    kind: "needs_you",
    email: true,
    title: (x) => ({ en: `${x} is ready for your tap`, zh: `${x}已准备好，等你确认` }),
    body: () => ({ en: "Review the documents and answers, then confirm. Nothing is sent before you do.", zh: "核对材料和答案后点确认。你确认之前，什么都不会发出。" }),
  },
  submitted: {
    kind: "submitted",
    email: false,
    title: (x) => ({ en: `Submitted: ${x}`, zh: `已提交：${x}` }),
    body: () => ({ en: "The confirmation is saved on the application. We'll remind you to follow up.", zh: "提交凭证已保存在申请页。到时间会提醒你跟进。" }),
  },
  needs_you: {
    kind: "needs_you",
    email: true,
    title: (x) => ({ en: `Needs you (about 30 seconds): ${x}`, zh: `需要你（约 30 秒）：${x}` }),
    body: () => ({ en: "Everything is prepared in order. Copy each field, submit on the official site, then tap “I submitted it”.", zh: "所有内容已按顺序备好。逐项复制，在官方页面提交，然后点「我已提交」。" }),
  },
  submit_failed: {
    kind: "needs_you",
    email: true,
    title: (x) => ({ en: `We couldn't submit ${x} yet`, zh: `${x}暂时没能提交` }),
    body: () => ({ en: "Nothing was sent and your credit is back. Open it to try again.", zh: "没有发出任何内容，额度已退回。打开后可以重试。" }),
  },
  followup_ready: {
    kind: "needs_you",
    email: true,
    title: (x) => ({ en: `A follow-up for ${x} is ready`, zh: `${x}的跟进邮件已写好` }),
    body: () => ({ en: "Read it and tap send, or skip it. We never send without your tap.", zh: "看一眼再点发送，或者跳过。没有你的确认我们不会发送。" }),
  },
  followup_sent: {
    kind: "progress",
    email: false,
    title: (x) => ({ en: `Follow-up sent: ${x}`, zh: `已发送跟进：${x}` }),
  },
  check_status: {
    kind: "progress",
    email: false,
    title: (x) => ({ en: `Any news from ${x}?`, zh: `${x}有消息了吗？` }),
    body: () => ({ en: "If they replied, record it in one tap: interview, offer, not selected or no response.", zh: "如果有回复，点一下记录：面试、录用、未通过或无回复。" }),
  },
  closed_no_response: {
    kind: "progress",
    email: false,
    title: (x) => ({ en: `No reply from ${x}, so we closed it`, zh: `${x}一直没有回复，已归档` }),
    body: () => ({ en: "It counts toward your weekly review. Your scout keeps looking for better fits.", zh: "这会计入每周复盘，我们会继续为你寻找更合适的机会。" }),
  },
};

export function notificationFor(key: NotifyKey, target: string, lang: Lang): { kind: NotificationKind; title: string; body?: string; email: boolean } {
  const c = COPY[key];
  return { kind: c.kind, title: c.title(target)[lang], body: c.body?.(target)[lang], email: c.email };
}

/** Step text shown while a job works ("Reading the application form…"). Keys live in messages under `applications.working.*`. */
export const WORKING_STEP_KEYS = ["analyze", "gaps", "compose", "render", "preview", "confirm", "submit", "followup", "reply", "handoff"] as const;
