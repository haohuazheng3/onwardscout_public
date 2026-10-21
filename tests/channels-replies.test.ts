import { describe, expect, it } from "vitest";
import { gmailForwardingConfirmation, htmlToText, matchReplyThread, normalizeSubject, parseAddress, parseInboundReply, refineVerdict, type ThreadCandidate } from "@/lib/integrations/reply-parse";

const GMAIL_FORWARD = `FYI — see below.

---------- Forwarded message ---------
From: Sam Rivera <sam@northwind.vc>
Date: Tue, Oct 20, 2026 at 9:14 AM
Subject: Re: Kite — pre-seed, climate logistics
To: Mei Chen <mei@example.com>


Hi Mei,

Thanks for reaching out. Could you send over the deck and your latest metrics?

Best,
Sam

On Mon, Oct 19, 2026 at 4:02 PM Mei Chen <mei@example.com> wrote:
> Hi Sam, …`;

const OUTLOOK_FORWARD = `________________________________
From: Dana Fox <dana.fox@acme.example>
Sent: Wednesday, October 21, 2026 10:03 AM
To: Mei Chen <mei@example.com>
Subject: RE: Product Designer application

Hi Mei, we'd love to set up a call next week. Are you free Tuesday?`;

const APPLE_FORWARD = `Begin forwarded message:

From: "Prof. Ana Lima" <ana.lima@uni.example>
Subject: Re: PhD position in computational ecology
Date: October 20, 2026 at 18:22:41 GMT+2
To: Mei Chen <mei@example.com>

Dear Mei, unfortunately the position has been filled.`;

const QQ_FORWARD = `-------- 转发邮件信息 --------
发件人："王老师" <wang@lab.example.cn>
发送时间：2026年10月20日 星期二 下午3:10
收件人："Mei" <mei@example.com>
主题：回复：申请贵组博士生名额

你好，请补充一下成绩单和研究计划。`;

const candidates: ThreadCandidate[] = [
  { id: "msg_a1", applicationId: "app_vc", contactId: "cnt_sam", toAddr: "sam@northwind.vc", subject: "Kite — pre-seed, climate logistics", gmailThreadId: "t1", createdAt: new Date("2026-10-19T16:02:00Z") },
  { id: "msg_a2", applicationId: "app_acme", contactId: null, toAddr: "jobs@acme.example", subject: "Product Designer application", gmailThreadId: "t2", createdAt: new Date("2026-10-18T10:00:00Z") },
  { id: "msg_a3", applicationId: "app_phd", contactId: "cnt_ana", toAddr: "ana.lima@uni.example", subject: "PhD position in computational ecology", gmailThreadId: "t3", createdAt: new Date("2026-10-10T10:00:00Z") },
  { id: "msg_a4", applicationId: "app_wang", contactId: "cnt_wang", toAddr: "wang@lab.example.cn", subject: "申请贵组博士生名额", gmailThreadId: null, createdAt: new Date("2026-10-12T10:00:00Z") },
];

describe("forwarded replies", () => {
  it("reads Gmail's forward block", () => {
    const r = parseInboundReply({ from: "Mei Chen <mei@example.com>", subject: "Fwd: Re: Kite — pre-seed, climate logistics", text: GMAIL_FORWARD });
    expect(r.forwarded).toBe(true);
    expect(r.from).toEqual({ email: "sam@northwind.vc", name: "Sam Rivera" });
    expect(r.subject).toBe("Re: Kite — pre-seed, climate logistics");
    expect(r.date?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(r.body.startsWith("Hi Mei,")).toBe(true);
    expect(matchReplyThread(r, candidates)).toMatchObject({ candidate: { id: "msg_a1" }, by: "sender_subject" });
  });

  it("reads Outlook's forward block and matches on the subject when the sender is new", () => {
    const r = parseInboundReply({ from: "mei@example.com", subject: "FW: RE: Product Designer application", text: OUTLOOK_FORWARD });
    expect(r.from?.email).toBe("dana.fox@acme.example");
    expect(r.subject).toBe("RE: Product Designer application");
    expect(matchReplyThread(r, candidates)).toMatchObject({ candidate: { applicationId: "app_acme" }, by: "subject" });
  });

  it("reads Apple Mail's forward block", () => {
    const r = parseInboundReply({ from: "mei@example.com", subject: "Fwd: PhD", text: APPLE_FORWARD });
    expect(r.from).toEqual({ email: "ana.lima@uni.example", name: "Prof. Ana Lima" });
    expect(r.body).toMatch(/^Dear Mei/);
    expect(matchReplyThread(r, candidates)?.candidate.id).toBe("msg_a3");
  });

  it("reads Chinese mail clients' forward block", () => {
    const r = parseInboundReply({ from: "mei@example.com", subject: "转发：回复：申请贵组博士生名额", text: QQ_FORWARD });
    expect(r.from?.email).toBe("wang@lab.example.cn");
    expect(r.subject).toBe("回复：申请贵组博士生名额");
    expect(r.date?.toISOString().slice(0, 10)).toBe("2026-10-20");
    expect(r.body).toBe("你好，请补充一下成绩单和研究计划。");
    expect(matchReplyThread(r, candidates)).toMatchObject({ candidate: { id: "msg_a4" }, by: "sender_subject" });
  });
});

describe("auto-forwarded replies (headers kept)", () => {
  it("matches our Message-ID in In-Reply-To / References first", () => {
    const r = parseInboundReply({
      from: "Sam Rivera <sam@northwind.vc>",
      subject: "Re: something else entirely",
      text: "Let's meet Thursday.",
      headers: { "In-Reply-To": "<CAF=x@mail.gmail.com>", References: "<msg_a3@onwardscout.com> <CAF=x@mail.gmail.com>" },
    });
    expect(r.forwarded).toBe(false);
    expect(r.referencedIds).toEqual(["msg_a3"]);
    expect(matchReplyThread(r, candidates)).toMatchObject({ candidate: { id: "msg_a3" }, by: "header" });
  });

  it("falls back to the sender when the subject changed", () => {
    const r = parseInboundReply({ from: "Sam Rivera <sam@northwind.vc>", subject: "Quick question", text: "Are you raising a SAFE?" });
    expect(matchReplyThread(r, candidates)).toMatchObject({ candidate: { id: "msg_a1" }, by: "sender" });
  });

  it("refuses to guess when nothing points at one application", () => {
    const r = parseInboundReply({ from: "someone@else.example", subject: "Hello", text: "Hi" });
    expect(matchReplyThread(r, candidates)).toBeNull();
    const twoApps = [...candidates, { ...candidates[1], id: "msg_a5", applicationId: "app_other" }];
    const r2 = parseInboundReply({ from: "x@y.example", subject: "Re: Product Designer application", text: "Hi" });
    expect(matchReplyThread(r2, twoApps)).toBeNull();
  });
});

describe("helpers", () => {
  it("normalizes subjects across languages and repeated prefixes", () => {
    expect(normalizeSubject("Re: FW: RE:  Product   Designer application")).toBe("product designer application");
    expect(normalizeSubject("回复：转发：申请")).toBe("申请");
    expect(normalizeSubject("AW: Bewerbung")).toBe("bewerbung");
  });
  it("parses addresses", () => {
    expect(parseAddress('"Prof. Ana Lima" <ana.lima@uni.example>')).toEqual({ email: "ana.lima@uni.example", name: "Prof. Ana Lima" });
    expect(parseAddress("SAM@Northwind.VC")).toEqual({ email: "sam@northwind.vc", name: null });
    expect(parseAddress("no address here")).toBeNull();
  });
  it("turns HTML-only mail into text", () => {
    expect(htmlToText("<div>Hi&nbsp;Mei,<br>Let&#39;s talk.</div><style>p{}</style><p>Sam &amp; team</p>")).toBe("Hi Mei,\nLet's talk.\nSam & team");
  });
});

describe("Gmail forwarding confirmation", () => {
  it("hands the confirmation code to the person", () => {
    expect(
      gmailForwardingConfirmation({
        from: "Gmail Team <forwarding-noreply@google.com>",
        subject: "(#482913075) Gmail Forwarding Confirmation - Receive Mail from mei.chen@gmail.com",
        text: "mei.chen@gmail.com has requested to automatically forward mail to your email address.\nConfirmation code: 482913075",
      }),
    ).toEqual({ code: "482913075", requester: "mei.chen@gmail.com" });
  });
  it("ignores look-alikes from other senders", () => {
    expect(gmailForwardingConfirmation({ from: "forwarding-noreply@google.com.evil.example", subject: "(#482913075) Gmail Forwarding Confirmation", text: "" })).toBeNull();
    expect(gmailForwardingConfirmation({ from: "sam@northwind.vc", subject: "Re: Kite", text: "Confirmation code: 123456" })).toBeNull();
  });
});

describe("verdict corrections", () => {
  const interested = { classification: "interested" as const, summary: "They sound interested.", nextStep: "Reply soon.", confidence: 0.6 };
  it("turns an opt-out into a no and says we stop", () => {
    expect(refineVerdict("Not interested — please remove me from your list.", interested)).toMatchObject({ classification: "rejected", summary: "They asked not to be contacted again.", nextStep: "We won't email them again." });
    expect(refineVerdict("请不要再联系我", interested, "zh").summary).toBe("对方请求不要再联系。");
  });
  it("reads a plain 'not interested' as a no, and leaves real interest alone", () => {
    expect(refineVerdict("Thanks, but we're not interested at this stage.", interested).classification).toBe("rejected");
    expect(refineVerdict("We're very interested — can you send the deck?", interested)).toBe(interested);
  });
});
