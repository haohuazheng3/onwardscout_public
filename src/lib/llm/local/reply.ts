import { ClassifyReplyInput, type ReplyClass, type ReplyClassification } from "../types";
import { clip, collapse } from "./text";

/*
 * Reply classification by keywords (English + Chinese). The quoted original message is
 * removed first so our own words don't classify the reply. Precedence, when several
 * classes match: auto_reply > rejected > meeting > needs_info > interested > other —
 * "Unfortunately I'm out of office" is an auto-reply, "interested — could you send the
 * deck?" is a request for information (the actionable part).
 */

type Lang = "en" | "zh";

/** Drops quoted history ("> …", "On … wrote:", "-----Original Message-----", "发件人：…"). */
export function stripQuoted(text: string): string {
  const out: string[] = [];
  for (const line of text.replace(/\r\n?/g, "\n").split("\n")) {
    if (/^\s*>/.test(line)) continue;
    if (/^\s*(on .{3,120} wrote:|-{2,}\s*original message\s*-{2,}|-{2,}\s*forwarded message\s*-{2,}|from:\s.+@.+|sent from my (iphone|ipad|android|phone)|发件人[:：]|-{2,}\s*原始邮件\s*-{2,}|在\s*.{2,60}写道[:：]?)/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").trim();
}

interface Rule {
  cls: ReplyClass;
  re: RegExp;
  weight: number;
}

const RULES: Rule[] = [
  // Auto-replies
  { cls: "auto_reply", re: /\b(out of (the )?office|ooo\b|automatic reply|auto[- ]?reply|autoreply|i am (currently )?(away|out|on (annual )?leave|travell?ing)|on vacation|on holiday|limited access to (my )?e-?mail|will (be back|return) on|this mailbox is (not|no longer) monitored|do not reply to this (e-?mail|message)|no[- ]reply|we have received your (application|message|email)|thank you for (your )?(applying|application|submission)[,.! ]+(we|our team) (will|have)|your application has been received)\b/i, weight: 3 },
  { cls: "auto_reply", re: /自动回复|休假中|不在办公室|外出|将于.{1,12}回复|此邮件为系统自动发送|请勿直接回复|已收到您的(申请|来信|邮件)/, weight: 3 },
  // Rejections
  { cls: "rejected", re: /\b(unfortunately|regret to (inform|let you know)|not (be )?(moving|proceeding) forward|decided (to|not to) (move forward|proceed|pursue)|move forward with other (candidates|applicants)|not (a|the right) fit|won'?t be (able to )?(moving|proceeding|offering)|pass(ing)? on (this|the opportunity|investing)|not able to (offer|invest|accept|move)|position has been filled|no longer (hiring|considering|accepting)|not selected|were not selected|unable to offer|will not be (moving|proceeding|taking)|outside (of )?our (focus|thesis|scope)|not investing in|declin(e|ed|ing) (to|your))\b/i, weight: 3 },
  { cls: "rejected", re: /很遗憾|遗憾地通知|不合适|未能通过|没有通过|暂不考虑|婉拒|不符合|无法提供|不再招聘|已招满|不在我们的投资范围|不投/, weight: 3 },
  // Meetings
  { cls: "meeting", re: /\b(schedule (a|an|some) (call|time|chat|meeting|interview)|set up (a|an) (call|time|meeting|chat|interview)|book (a|some) time|find (a )?time|are you (free|available)|when are you (free|available)|availability (for|next)|let'?s (chat|talk|meet|connect|grab)|hop on a call|jump on a call|(phone|video|first[- ]round|technical) (screen|interview)|invite you to (an )?interview|calendly\.com|cal\.com|meet (next|this) week|zoom|google meet|coffee chat)\b/i, weight: 2.5 },
  { cls: "meeting", re: /约(个|一下)?时间|面试|电话(沟通|聊)|视频(会议|沟通)|安排(会议|面谈|一次)|见面聊|什么时候方便|有空(吗|的话)|腾讯会议|飞书会议/, weight: 2.5 },
  // Needs info
  { cls: "needs_info", re: /\b(could you (please )?(send|share|provide|tell)|can you (please )?(send|share|provide|tell|clarify)|please (send|share|provide|submit|complete|fill (out|in))|would you (mind )?(send|share)|we('| woul)d need|we need (a|your|more)|need (a|your|more|additional) (copy|info|information|details|documents?)|additional (information|details|materials|documents)|missing (information|documents?)|what is your (expected|current)|do you have (a|any)|send (over )?(your|the) (deck|resume|cv|portfolio|transcript|references))\b/i, weight: 2 },
  { cls: "needs_info", re: /请(提供|发送|补充|填写|发)|能否(提供|发|补充)|麻烦(发|提供|补充)|需要(您|你)(提供|补充|发)|补充(材料|信息|资料)|发一下|发我一份/, weight: 2 },
  // Interest
  { cls: "interested", re: /\b(interested|keen to (learn|hear|talk)|love to (learn|hear|chat|talk|see)|would like to (learn|hear|chat|talk|move forward)|impressed|sounds (great|interesting|promising)|excited (to|about)|(happy|glad) to (chat|connect|help|introduce)|let'?s move forward|next steps?|shortlisted|moving (you )?(forward|to the next round)|great fit)\b/i, weight: 1.5 },
  { cls: "interested", re: /感兴趣|很不错|很好|期待(进一步|和你|与你)|想进一步了解|进入下一轮|通过了初筛|欢迎/, weight: 1.5 },
];

const PRECEDENCE: ReplyClass[] = ["auto_reply", "rejected", "meeting", "needs_info", "interested", "other"];

const NEXT_STEP: Record<ReplyClass, { en: string; zh: string }> = {
  interested: { en: "Reply within a day and propose two or three times to talk; we can draft the reply.", zh: "一天内回复，并提出两三个可约的时间；我们可以帮你起草回复。" },
  meeting: { en: "Pick a time and confirm it; add it to your calendar and we'll prepare a short brief for the call.", zh: "选定时间并确认，加入日历；我们会为这次沟通准备一份简要资料。" },
  rejected: { en: "Send a short thank-you if you like; we'll mark this closed and keep going with the next opportunities.", zh: "如愿意可以回一封简短的感谢信；我们会将此标记为结束，继续推进下一批机会。" },
  needs_info: { en: "Send what they asked for; we'll pull it from your profile and documents for you to confirm.", zh: "按对方要求补充材料；我们会从你的档案和文件中准备好，由你确认后发送。" },
  auto_reply: { en: "Nothing to do: this was an automatic reply. We'll follow up later if no one answers.", zh: "无需处理：这是自动回复。如果之后仍无人回复，我们会再跟进。" },
  other: { en: "Read the reply and tell us how to answer; we can draft it for you.", zh: "请查看回复内容并告诉我们如何回应；我们可以帮你起草。" },
};

const SUMMARY: Record<ReplyClass, { en: string; zh: string }> = {
  interested: { en: "They're interested", zh: "对方表示感兴趣" },
  meeting: { en: "They want to set up a call or interview", zh: "对方希望约时间沟通或面试" },
  rejected: { en: "They declined", zh: "对方婉拒了" },
  needs_info: { en: "They asked for more information", zh: "对方需要补充信息" },
  auto_reply: { en: "Automatic reply", zh: "自动回复" },
  other: { en: "A reply that needs your reading", zh: "需要你查看的回复" },
};

function firstSentence(text: string): string {
  const t = collapse(text.replace(/^(hi|hello|dear|hey)\b[^\n,]*[,，]?\s*/i, "").replace(/^(您好|你好)[^\n，,]*[，,：:]?\s*/, ""));
  const m = /^(.{8,220}?[.!?。！？])(\s|$)/.exec(t);
  return clip(m ? m[1] : t, 200);
}

export function localClassifyReply(raw: ClassifyReplyInput): ReplyClassification {
  const input = ClassifyReplyInput.parse(raw);
  const lang: Lang = input.language;
  const body = stripQuoted(input.text);
  const scanned = `${input.subject ?? ""}\n${body}`;
  const scores = new Map<ReplyClass, number>();
  for (const r of RULES) if (r.re.test(scanned)) scores.set(r.cls, (scores.get(r.cls) ?? 0) + r.weight);
  // Subject lines like "Automatic reply:" / "Out of Office:" are decisive.
  if (/^(automatic reply|auto[- ]?reply|out of office|自动回复)/i.test(input.subject ?? "")) scores.set("auto_reply", 10);

  let cls: ReplyClass = "other";
  for (const c of PRECEDENCE) {
    if ((scores.get(c) ?? 0) > 0) {
      cls = c;
      break;
    }
  }
  // "Unfortunately the 3pm slot doesn't work — how about Thursday?" is still a meeting.
  if (cls === "rejected" && (scores.get("meeting") ?? 0) > 0 && !/\b(not (moving|proceeding) forward|other candidates|not a fit|pass on|position has been filled)\b|很遗憾|不合适|未能通过/i.test(scanned)) cls = "meeting";
  const total = [...scores.values()].reduce((a, b) => a + b, 0);
  const confidence = cls === "other" ? 0.3 : Math.round(Math.min(0.95, 0.55 + (scores.get(cls) ?? 0) / Math.max(total, 1) * 0.3 + Math.min(0.1, (scores.get(cls) ?? 0) / 20)) * 100) / 100;
  const quote = body ? firstSentence(body) : "";
  const label = SUMMARY[cls][lang];
  return {
    classification: cls,
    summary: quote ? (lang === "zh" ? `${label}：「${quote}」` : `${label}: "${quote}"`) : label,
    nextStep: NEXT_STEP[cls][lang],
    confidence,
  };
}
