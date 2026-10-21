import { describe, expect, it } from "vitest";
import { localClassifyReply, stripQuoted } from "@/lib/llm/local/reply";

const cls = (text: string, subject?: string, language: "en" | "zh" = "en") => localClassifyReply({ text, subject, language });

describe("classifyReply (local)", () => {
  it.each([
    ["Thanks Avery — we'd love to learn more. Could you share your availability for a 30-minute call next week?", "meeting"],
    ["Here's my Calendly: https://calendly.com/someone/30min — grab any slot.", "meeting"],
    ["We'd like to invite you to a first-round interview with our design lead.", "meeting"],
    ["Unfortunately we've decided to move forward with other candidates whose experience more closely matches our needs.", "rejected"],
    ["Thanks for reaching out. This is outside our thesis, so we'll pass on this one.", "rejected"],
    ["Interesting! Could you send the deck and your latest financials?", "needs_info"],
    ["Please complete the attached form and send us your transcript.", "needs_info"],
    ["I'm out of the office until Monday with limited access to email.", "auto_reply"],
    ["Thank you for your application. We have received your submission and our team will review it.", "auto_reply"],
    ["This sounds great — I'm keen to hear more about how Tallyfern works.", "interested"],
    ["Got it.", "other"],
  ])("%s → %s", (text, expected) => {
    expect(cls(text).classification).toBe(expected);
  });

  it.each([
    ["您好，看了您的简历很感兴趣，方便约个时间电话沟通吗？", "meeting"],
    ["很遗憾，经过综合评估，您暂不符合本岗位的要求。", "rejected"],
    ["请补充一下您的作品集和期望薪资。", "needs_info"],
    ["【自动回复】我正在休假中，将于10月28日回复您的邮件。", "auto_reply"],
    ["您的项目很不错，期待进一步了解。", "interested"],
  ])("%s → %s", (text, expected) => {
    expect(cls(text, undefined, "zh").classification).toBe(expected);
  });

  it("an out-of-office subject is decisive, even with 'unfortunately' in the body", () => {
    expect(cls("Unfortunately I'm away this week.", "Automatic reply: Your application").classification).toBe("auto_reply");
  });

  it("a declined time slot is still a meeting, not a rejection", () => {
    expect(cls("Unfortunately Tuesday doesn't work for me — are you free Thursday at 3pm?").classification).toBe("meeting");
  });

  it("ignores the quoted original message", () => {
    const text = "Thanks, could you send your portfolio?\n\nOn Mon, Oct 20, 2026 at 9:00 AM Avery <avery@example.com> wrote:\n> Unfortunately I missed the deadline, but I'm interested in a call.";
    expect(stripQuoted(text)).toBe("Thanks, could you send your portfolio?");
    expect(cls(text).classification).toBe("needs_info");
  });

  it("summarises in the requested language with the next step", () => {
    const r = cls("We'd like to schedule a call next week.", undefined, "zh");
    expect(r.summary).toMatch(/^对方希望约时间沟通或面试：「We'd like to schedule a call next week\.」$/);
    expect(r.nextStep).toMatch(/选定时间/);
    expect(r.confidence).toBeGreaterThan(0.5);
  });
});

describe("classifyReply (local): realistic replies", () => {
  it.each([
    // Interested
    ["Hi Sam, thanks for the note. This looks really interesting and I'd love to learn more about the traction you mentioned.", "interested"],
    ["We were impressed by your application and you've been shortlisted for the next stage.", "interested"],
    ["Sounds promising! Happy to connect you with our partner who covers climate.", "interested"],
    // Meeting requests
    ["We have received your application and would like to invite you to an interview next week.", "meeting"],
    ["Would you be available for a 30 min call on Thursday? Here's my calendar: https://calendly.com/jlee/30min", "meeting"],
    ["Unfortunately Tuesday doesn't work for me, but are you free on Wednesday afternoon?", "meeting"],
    ["Could you share your availability for a technical interview with the team?", "meeting"],
    ["I'm out next week, but let's set up a call the week after.", "meeting"],
    // Rejections
    ["Thank you for applying. Unfortunately, we will not be moving forward with your application at this time.", "rejected"],
    ["We're not interested at this stage, but best of luck with the raise.", "rejected"],
    ["After careful consideration we decided to go in a different direction.", "rejected"],
    ["I don't think it's a good fit for our fund right now.", "rejected"],
    ["The position has been filled. We'll keep your CV on file.", "rejected"],
    ["You were not selected for this year's cohort.", "rejected"],
    ["Thanks for sharing — we'll pass on this one.", "rejected"],
    // Needs info
    ["Before we go further, can you send over your latest financials and the cap table?", "needs_info"],
    ["Please complete the attached reference form and return it by Friday.", "needs_info"],
    ["What is your expected salary and notice period?", "needs_info"],
    // Auto-replies
    ["Thank you for your email. I am currently on annual leave and will return on Monday 3 November.", "auto_reply"],
    ["This mailbox is not monitored. Please do not reply to this email.", "auto_reply"],
    ["Thank you for your application! We will review it and get back to you if your profile matches.", "auto_reply"],
    // Other
    ["Thanks, noted.", "other"],
    ["We'll pass your deck to our partners and come back to you.", "other"],
  ])("%s → %s", (text, expected) => {
    expect(cls(text).classification).toBe(expected);
  });

  it.each([
    ["您好，我们对您的项目很感兴趣，想进一步了解贵司的融资计划。", "interested"],
    ["恭喜您通过了初筛，进入下一轮。", "interested"],
    ["感谢您的投递！我们已收到您的简历，想约个时间电话聊聊，您什么时候方便？", "meeting"],
    ["您好，我下周外出，周三之后可以安排一次视频会议吗？", "meeting"],
    ["感谢您的关注，我们对这个方向暂时不感兴趣。", "rejected"],
    ["很遗憾地通知您，您未能通过本轮评审。", "rejected"],
    ["经过评估，该项目不在我们的投资范围内。", "rejected"],
    ["麻烦发一下最新的BP和财务数据。", "needs_info"],
    ["请补充您的推荐信和成绩单。", "needs_info"],
    ["此邮件为系统自动发送，请勿直接回复。", "auto_reply"],
    ["您好，我正在休假中，10月30日后回复您。", "auto_reply"],
    ["已收到您的申请，我们会尽快处理。", "auto_reply"],
    ["好的，收到。", "other"],
  ])("%s → %s", (text, expected) => {
    expect(cls(text, undefined, "zh").classification).toBe(expected);
  });

  it("an out-of-office subject wins over anything in the body", () => {
    expect(cls("We'd love to schedule a call.", "Out of Office: Re: your application").classification).toBe("auto_reply");
  });
});
