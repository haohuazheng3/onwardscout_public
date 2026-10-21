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
