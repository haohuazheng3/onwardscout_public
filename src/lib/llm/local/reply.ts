import { ClassifyReplyInput, type ReplyClass, type ReplyClassification } from "../types";
import { clip, collapse } from "./text";

/*
 * Reply classification by keywords (English + Chinese). The quoted original message is
 * removed first so our own words don't classify the reply. Every class has STRONG signals
 * (decisive on their own) and some have WEAK ones (count only when nothing stronger speaks):
 *
 *   1. an auto-reply subject, or a strong auto-reply marker (out of office, "this mailbox is not
 *      monitored", 自动回复)                                                   → auto_reply
 *   2. a strong rejection ("move forward with other candidates", "not interested", "pass on
 *      this", 未能通过, 不感兴趣)                                                 → rejected
 *   3. a meeting request (a call, an interview, availability, a booking link)   → meeting
 *   4. a request for information or documents                                  → needs_info
 *   5. a weak rejection ("unfortunately", 很遗憾) with nothing above            → rejected
 *   6. interest, never negated ("not interested" is a rejection)               → interested
 *   7. a receipt confirmation ("we have received your application") alone     → auto_reply
 *
 * So "Unfortunately Tuesday doesn't work — are you free Thursday?" is a meeting, "We have
 * received your application and would like to invite you to an interview" is a meeting, and
 * "I'm out next week, can we talk after?" is not an auto-reply.
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

type Strength = "strong" | "weak";

interface Rule {
  cls: ReplyClass;
  strength: Strength;
  re: RegExp;
}

/* Negated interest and fit are rejections, and must never count as interest. */
const NEGATED_INTEREST_EN = /\b(not|no longer|aren'?t|are not|isn'?t|is not|wasn'?t|won'?t be|don'?t think (we|it|this|that)('re|'s| is| are)?|doesn'?t (seem|look) (to be )?)\s+(really |currently |quite |particularly |that )?(interested|a (good |great |strong |right )?fit|the right fit)\b/i;
const NEGATED_INTEREST_ZH = /不感兴趣|没有兴趣|没兴趣|暂无兴趣|不太感兴趣|兴趣不大/;

const RULES: Rule[] = [
  // Auto-replies: out-of-office and system mail (strong); receipt confirmations (weak: a person
  // often starts with "we received your application" and goes on to invite or decline).
  {
    cls: "auto_reply",
    strength: "strong",
    re: /\b(out of (the )?office|ooo|automatic reply|auto[- ]?reply|autoreply|this is an automated (message|response|reply|e-?mail)|(this|the) (e-?mail address|mailbox|inbox) is (not|no longer|un)monitored|(this|the) (e-?mail address|mailbox|inbox) is not (being )?monitored|do not reply (directly )?to this (e-?mail|message)|i am (currently )?(out of the office|on (annual |parental |sick |maternity |paternity )?leave|on vacation|on holiday|away from (the office|my desk))|limited access to (my )?e-?mail|will (be back|return) (in the office|to the office|on [a-z]+ \d|after)|(noreply|no-reply|do-not-reply|donotreply)@)/i,
  },
  { cls: "auto_reply", strength: "strong", re: /自动回复|系统自动发送|此邮件由系统自动|请勿(直接)?回复(此|本)?邮件|(正在|目前)?休假(中|期间)|不在办公室|外出(期间|中)[，,。]|出差中[，,。].{0,20}(回复|联系)/ },
  {
    cls: "auto_reply",
    strength: "weak",
    re: /\b(we('ve| have) received your (application|message|e-?mail|submission|cv|resume)|your (application|submission|message) (has been|was) (successfully )?received|(thank you|thanks) for (your )?(applying|application|submission|interest)[^?]{0,80}?\b(we|our team) will (review|be in touch|get back|contact))/i,
  },
  { cls: "auto_reply", strength: "weak", re: /已收到(您|你)的(申请|来信|邮件|简历|投递)|感谢(您|你)的投递|我们会尽快(处理|查看|审核)/ },

  // Rejections. "Unfortunately" alone is weak: it also opens "unfortunately Tuesday doesn't work".
  {
    cls: "rejected",
    strength: "strong",
    re: /\b(regret to (inform|let you know|say)|not (be )?(moving|proceeding|going) (forward|ahead)|decided (not to|to not) (move forward|proceed|pursue|invest|continue)|(move|moving|go|going) (forward|ahead) with (other|another) (candidates?|applicants?|companies|projects|options)|decided to (go|move) (in )?(a different|another) direction|won'?t be (able to )?(moving|proceeding|offering|investing|taking (this|it) further)|(we('ll| will)|i('ll| will)|we('re| are) going to|we have to|we must|we('ve| have) decided to) pass(\s+on\s+(this|it|the opportunity|investing)( one| round| time)?)?\s*[.,;!—–-]|pass(ing)? on (this|the opportunity|investing|it)\b|not able to (offer|invest|accept|move forward|proceed)|unable to (offer|invest|accept|move forward|proceed)|position (has been|is|was) (filled|closed)|no longer (hiring|considering|accepting|interested)|(were|was|have|has) not (been )?selected|(haven'?t|hasn'?t) been selected|not (been )?selected|will not be (moving|proceeding|taking|offering)|outside (of )?our (focus|thesis|scope|mandate|criteria)|not investing in|declin(e|ed|ing) (to|your)|not (a|the) (good |great |strong |right )?fit)/i,
  },
  {
    cls: "rejected",
    strength: "strong",
    re: /遗憾地通知|未能通过|没有通过|暂不考虑|婉拒|不合适|暂不符合|不符合(本|该|我们的?)?(岗位|职位|项目)?的?(要求|条件)|无法(提供|录用|继续)|不再招聘|已招满|职位已满|不在我们的投资(范围|方向)|暂不投资|不予录用|未被录取|没有被录取|未能入选|没有入选/,
  },
  { cls: "rejected", strength: "weak", re: /\b(unfortunately|sadly|regrettably)\b/i },
  { cls: "rejected", strength: "weak", re: /很遗憾|遗憾的是|抱歉地/ },

  // Meetings.
  {
    cls: "meeting",
    strength: "strong",
    re: /\b(schedule (a|an|some|the) (call|time|chat|meeting|interview)|set up (a|an|some) (call|time|meeting|chat|interview)|book (a|some) time|find (a )?(good )?time|are you (free|available)|when (are|would) you (be )?(free|available)|(share|send|let me know) (me )?(your|a few|some) (availability|times|time slots)|your availability|availability (for|next|this)|let'?s (chat|talk|meet|connect|grab|set up)|hop on a call|jump on a call|(phone|video|first[- ]round|second[- ]round|final[- ]round|technical|onsite|on-site) (screen|interview|call)|invite you (to|for) (an |a )?(interview|call|meeting|chat)|calendly\.com|cal\.com|savvycal|meet (next|this) week|(zoom|teams|google meet) (call|meeting|link)|coffee chat|(15|20|30|45|60)[- ]?min(ute)?s? (call|chat|meeting))/i,
  },
  { cls: "meeting", strength: "strong", re: /约(个|一下)?时间|面试|电话(沟通|聊|面谈)|视频(会议|沟通|面试)|安排(会议|面谈|一次|时间)|见面聊|什么时候方便|方便的时间|有空(吗|的话)|腾讯会议|飞书会议|线上(沟通|会议)/ },

  // Requests for information or documents.
  {
    cls: "needs_info",
    strength: "strong",
    re: /\b(could you (please )?(send|share|provide|tell|clarify|confirm|forward)|can you (please )?(send|share|provide|tell|clarify|confirm|forward)|please (send|share|provide|submit|complete|fill (out|in)|attach|forward)|would you (mind )?(send|share|provid)|we('| woul)d need|we need (a|an|your|more|the|some)|need (a|your|more|additional|some) (copy|info|information|details|documents?|materials)|additional (information|details|materials|documents)|missing (information|documents?|materials)|what (is|are) your (expected|current|salary|availability|notice period|visa)|do you have (a|an|any) (deck|portfolio|cv|resume|references?|writing samples?|demo|data room|financials)|send (over )?(your|the) (deck|resume|cv|portfolio|transcript|references|financials|data room))/i,
  },
  { cls: "needs_info", strength: "strong", re: /请(提供|发送|补充|填写|发|上传|附上)|能否(提供|发|补充|说明)|麻烦(发|提供|补充|说明)|需要(您|你)(提供|补充|发|说明)|补充(材料|信息|资料)|发一下|发我一份|期望薪资是多少/ },

  // Interest (never when negated: checked below).
  {
    cls: "interested",
    strength: "strong",
    re: /\b(interested|keen to (learn|hear|talk|chat)|love to (learn|hear|chat|talk|see)|would like to (learn|hear|chat|talk|move forward)|impressed|sounds (great|interesting|promising|exciting)|excited (to|about)|(happy|glad) to (chat|connect|help|introduce|move forward)|let'?s move forward|(discuss|talk about) (the )?next steps|shortlisted|moving (you )?(forward|to the next (round|stage))|(great|strong|good) fit)\b/i,
  },
  { cls: "interested", strength: "strong", re: /(?<!不|没|没有)感兴趣|很不错|期待(进一步|和你|与你|和您|与您)|想进一步了解|希望进一步(了解|沟通)|进入下一轮|进入复试|通过了初筛|通过初筛/ },
];

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

/** The class a reply's signals decide (see the module comment for the order). Pure, exported for tests. */
export function decideReply(text: string, subject?: string | null): { cls: ReplyClass; scores: Map<ReplyClass, number> } {
  const scanned = `${subject ?? ""}\n${text}`;
  const strong = new Set<ReplyClass>();
  const weak = new Set<ReplyClass>();
  const scores = new Map<ReplyClass, number>();
  for (const r of RULES) {
    if (!r.re.test(scanned)) continue;
    (r.strength === "strong" ? strong : weak).add(r.cls);
    scores.set(r.cls, (scores.get(r.cls) ?? 0) + (r.strength === "strong" ? 3 : 1));
  }
  // "Not interested", "not a good fit", 不感兴趣: a rejection, and never interest.
  if (NEGATED_INTEREST_EN.test(scanned) || NEGATED_INTEREST_ZH.test(scanned)) {
    strong.add("rejected");
    scores.set("rejected", (scores.get("rejected") ?? 0) + 3);
    if (!/\b(very|really|still|definitely|we'?re|we are|i'?m|i am) interested\b/i.test(scanned.replace(NEGATED_INTEREST_EN, ""))) {
      strong.delete("interested");
      scores.delete("interested");
    }
  }
  if (/^\s*(automatic reply|auto[- ]?reply|out of (the )?office|ooo\b|自动回复)/i.test(subject ?? "")) {
    scores.set("auto_reply", 10);
    return { cls: "auto_reply", scores };
  }
  const order: [ReplyClass, boolean][] = [
    ["auto_reply", strong.has("auto_reply")],
    ["rejected", strong.has("rejected")],
    ["meeting", strong.has("meeting")],
    ["needs_info", strong.has("needs_info")],
    ["rejected", weak.has("rejected")],
    ["interested", strong.has("interested")],
    ["auto_reply", weak.has("auto_reply")],
  ];
  const hit = order.find(([, on]) => on);
  return { cls: hit ? hit[0] : "other", scores };
}

export function localClassifyReply(raw: ClassifyReplyInput): ReplyClassification {
  const input = ClassifyReplyInput.parse(raw);
  const lang: Lang = input.language;
  const body = stripQuoted(input.text);
  const { cls, scores } = decideReply(body, input.subject);
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
