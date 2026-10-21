import { describe, expect, it } from "vitest";
import { createTranslator } from "next-intl";
import settingsEn from "../messages/en/settings.json";
import {
  DIGEST_TOP,
  digestDedupeKey,
  digestWindow,
  isoWeek,
  renderDigest,
  selectDigestContent,
  startOfIsoWeek,
  type DigestData,
  type DigestMatchCandidate,
} from "@/lib/digest";

/*
 * The weekly brief (P6, pure parts): ISO-week bucketing (the dedupe key), the 7-day window,
 * what is selected for the brief, and the text it renders from the real English messages.
 */

const NOW = new Date("2026-10-26T14:00:00Z"); // a Monday, when the cron fires
const DAY = 86_400_000;

function match(over: Partial<DigestMatchCandidate> & { opportunityId: string }): DigestMatchCandidate {
  return { name: over.opportunityId, orgName: null, deadline: null, fit: 50, feedback: null, status: "active", ...over };
}

function data(over: Partial<DigestData> = {}): DigestData {
  return { now: NOW, matches: [], needsYou: [], submittedThisWeek: 0, replies: 0, movedForward: 0, milestones: [], ...over };
}

const t = createTranslator({ locale: "en", messages: { settings: settingsEn }, namespace: "settings.digest" }) as unknown as (
  key: string,
  values?: Record<string, string | number>,
) => string;

describe("isoWeek", () => {
  it.each([
    ["2026-10-21T12:00:00Z", "2026-W43"], // Wednesday
    ["2026-10-25T23:59:59Z", "2026-W43"], // Sunday ends the week
    ["2026-10-26T00:00:00Z", "2026-W44"], // Monday starts the next
    ["2026-01-01T00:00:00Z", "2026-W01"], // Thursday: week 1 of its own year
    ["2021-01-01T00:00:00Z", "2020-W53"], // Friday: last week of the previous year
    ["2024-12-30T00:00:00Z", "2025-W01"], // Monday: first week of the next year
    ["2020-12-31T00:00:00Z", "2020-W53"],
    ["2027-01-03T00:00:00Z", "2026-W53"], // 2026 has 53 ISO weeks
  ])("%s → %s", (iso, key) => {
    expect(isoWeek(new Date(iso)).key).toBe(key);
  });

  it("uses UTC, not the server's zone", () => {
    const w = isoWeek(new Date(Date.UTC(2026, 9, 25, 23, 30)));
    expect(w).toEqual({ year: 2026, week: 43, key: "2026-W43" });
  });

  it("gives one key per person per week, so the cron can run twice safely", () => {
    expect(digestDedupeKey("user_a", NOW)).toBe("digest.send:user_a:2026-W44");
    expect(digestDedupeKey("user_a", new Date(NOW.getTime() + 3 * DAY))).toBe(digestDedupeKey("user_a", NOW));
    expect(digestDedupeKey("user_a", new Date(NOW.getTime() + 7 * DAY))).not.toBe(digestDedupeKey("user_a", NOW));
  });
});

describe("startOfIsoWeek / digestWindow", () => {
  it("finds Monday 00:00 UTC", () => {
    expect(startOfIsoWeek(new Date("2026-10-21T12:00:00Z")).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(startOfIsoWeek(new Date("2026-10-25T23:00:00Z")).toISOString()).toBe("2026-10-19T00:00:00.000Z");
    expect(startOfIsoWeek(NOW).toISOString()).toBe("2026-10-26T00:00:00.000Z");
  });
  it("covers the seven days before the run", () => {
    const w = digestWindow(NOW);
    expect(w.to).toEqual(NOW);
    expect(NOW.getTime() - w.from.getTime()).toBe(7 * DAY);
  });
});

describe("selectDigestContent", () => {
  it("sends nothing when nothing happened, even with milestones", () => {
    const c = selectDigestContent(data({ milestones: [{ title: "10 applications", current: 2, target: 10, dueAt: null }] }));
    expect(c.send).toBe(false);
  });

  it("keeps only open, wanted, unique picks — best fit first, nearer deadline breaking ties", () => {
    const soon = new Date(NOW.getTime() + 3 * DAY);
    const later = new Date(NOW.getTime() + 30 * DAY);
    const c = selectDigestContent(
      data({
        matches: [
          match({ opportunityId: "opp_a", fit: 70, deadline: later }),
          match({ opportunityId: "opp_b", fit: 90 }),
          match({ opportunityId: "opp_c", fit: 70, deadline: soon }),
          match({ opportunityId: "opp_d", fit: 99, feedback: "not_interested" }),
          match({ opportunityId: "opp_e", fit: 98, status: "expired" }),
          match({ opportunityId: "opp_f", fit: 97, deadline: new Date(NOW.getTime() - DAY) }),
          match({ opportunityId: "opp_b", fit: 90 }),
          match({ opportunityId: "opp_g", fit: 10, feedback: "later" }),
        ],
      }),
    );
    expect(c.send).toBe(true);
    expect(c.newMatchCount).toBe(4);
    expect(c.topMatches.map((m) => m.opportunityId)).toEqual(["opp_b", "opp_c", "opp_a"]);
    expect(c.topMatches.length).toBe(DIGEST_TOP);
  });

  it("sends for waiting items, submissions, replies or progress alone", () => {
    expect(selectDigestContent(data({ needsYou: [{ applicationId: "app_1", name: "Acme", status: "needs_you" }] })).send).toBe(true);
    expect(selectDigestContent(data({ submittedThisWeek: 1 })).send).toBe(true);
    expect(selectDigestContent(data({ replies: 2 })).send).toBe(true);
    expect(selectDigestContent(data({ movedForward: 1 })).send).toBe(true);
  });

  it("caps lists at three and orders milestones by due date", () => {
    const needsYou = Array.from({ length: 5 }, (_, i) => ({ applicationId: `app_${i}`, name: `App ${i}`, status: "ready" }));
    const c = selectDigestContent(
      data({
        needsYou,
        milestones: [
          { title: "No date", current: 0, target: 5, dueAt: null },
          { title: "Late", current: 1, target: 5, dueAt: new Date(NOW.getTime() + 20 * DAY) },
          { title: "Soon", current: 1, target: 5, dueAt: new Date(NOW.getTime() + 2 * DAY) },
          { title: "Broken", current: 0, target: 0, dueAt: new Date(NOW.getTime() + DAY) },
          { title: "Mid", current: 1, target: 5, dueAt: new Date(NOW.getTime() + 9 * DAY) },
        ],
      }),
    );
    expect(c.needsYouCount).toBe(5);
    expect(c.needsYou.map((n) => n.applicationId)).toEqual(["app_0", "app_1", "app_2"]);
    expect(c.milestones.map((m) => m.title)).toEqual(["Soon", "Mid", "Late"]);
  });
});

describe("renderDigest", () => {
  it("summarises the week in the title and lists the details", () => {
    const content = selectDigestContent(
      data({
        matches: [
          match({ opportunityId: "opp_1", name: "Climate Fellowship", orgName: "Green Fund", fit: 80 }),
          match({ opportunityId: "opp_2", name: "Seed Grant", orgName: "Seed Grant", fit: 70 }),
          match({ opportunityId: "opp_3", name: "Design Residency", fit: 60 }),
          match({ opportunityId: "opp_4", name: "Hackathon", fit: 50 }),
        ],
        needsYou: [{ applicationId: "app_1", name: "Acme internship", status: "needs_you" }],
        submittedThisWeek: 2,
        replies: 1,
        movedForward: 1,
        milestones: [{ title: "Send 10 applications", current: 4, target: 10, dueAt: null }],
      }),
    );
    const { title, body } = renderDigest(content, t);
    expect(title).toBe("Your week: 4 new picks, 1 waiting for you, 2 submitted, 1 reply");
    expect(body).toContain("New picks: Climate Fellowship (Green Fund), Seed Grant, Design Residency, and 1 more");
    expect(body).toContain("Waiting for your tap: Acme internship");
    expect(body).toContain("This week: 2 applications submitted, 1 reply, 1 moving forward.");
    expect(body).toContain("Send 10 applications: 4 of 10");
    expect(body.split("\n").at(-1)).toBe("Open your board to review, approve or adjust.");
  });

  it("writes a quiet brief when forced with nothing new", () => {
    const { title, body } = renderDigest(selectDigestContent(data()), t);
    expect(title).toBe("Your week on Onward Scout");
    expect(body).toContain("A quiet week");
  });

  it("never prints more progress than the target", () => {
    const { body } = renderDigest(selectDigestContent(data({ replies: 1, milestones: [{ title: "Replies", current: 7, target: 5, dueAt: null }] })), t);
    expect(body).toContain("Replies: 5 of 5");
  });
});
