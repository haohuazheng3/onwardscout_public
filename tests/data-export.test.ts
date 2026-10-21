import { describe, expect, it } from "vitest";
import {
  anonymizedUserId,
  buildExport,
  EXPORT_FIELDS,
  EXPORT_FORMAT,
  EXPORT_VERSION,
  exportFilename,
  NEVER_EXPORTED,
  pick,
  renewingSubscription,
  type ExportSource,
} from "@/lib/data-export";

/*
 * "Download my data" (P6, pure parts): the export's shape, the allow-lists that keep secrets
 * out (the encrypted Gmail token, the drop-box token, Stripe references, storage keys), and the
 * rules around deletion. Secret-looking values are assembled at runtime, never written literally.
 */

const NOW = new Date("2026-10-21T10:00:00Z");
const ENCRYPTED = ["v1", "aaaabbbbcccc", "ddddeeeeffff", "gggghhhh"].join(".");
const INBOUND = ["k3v9", "q2m8", "x7p4", "n6r5"].join("");
const SESSION = ["cs", "live", "a1b2c3d4e5"].join("_");
const SUBSCRIPTION = ["sub", "9z8y7x6w5v"].join("_");
const OBJECT_KEY = ["docs", "user_1", "doc_1.pdf"].join("/");

function source(): ExportSource {
  return {
    user: { id: "user_1", email: "ada@example.com", locale: "en", inboundToken: INBOUND, stripeCustomerId: "cus_123", createdAt: NOW, lastSeenAt: NOW },
    profile: {
      id: "prf_1",
      userId: "user_1",
      version: 3,
      status: "confirmed",
      completeness: 80,
      summary: "Engineer",
      identity: { name: "Ada", email: "ada@example.com" },
      roles: [{ code: "E3", stage: null, since: null }],
      industries: [],
      functions: [],
      occupations: [],
      education: [],
      experience: [],
      projects: [],
      skills: [],
      achievements: [],
      publications: [],
      certifications: [],
      packs: {},
      createdAt: NOW,
      updatedAt: NOW,
    },
    profileVersions: [{ id: "pv_1", profileId: "prf_1", version: 3, snapshot: { summary: "Engineer" }, createdAt: NOW }],
    documents: [{ id: "doc_1", userId: "user_1", kind: "resume", objectKey: OBJECT_KEY, filename: "cv.pdf", contentType: "application/pdf", bytes: 1234, sourceUrl: null, extractedText: "long text", status: "parsed", error: null, createdAt: NOW }],
    facts: [{ id: "fct_1", userId: "user_1", profileId: "prf_1", path: "/skills/0", claim: "TypeScript", value: "TypeScript", sourceDocId: "doc_1", quote: "TypeScript", confidence: 0.9, confirmedByUser: false, createdAt: NOW, updatedAt: NOW }],
    goals: [{ id: "gol_1", userId: "user_1", family: "G1", sub: null, label: "A new job", successDefinition: "Offer by March", horizonMonths: 6, constraints: {}, status: "active", createdAt: NOW, updatedAt: NOW }],
    milestones: [],
    matches: [{ id: "mat_1", userId: "user_1", opportunityId: "opp_1", goalId: "gol_1", fit: 80, winProbability: null, effort: null, value: null, reasons: ["fits"], gaps: [], rank: 1, feedback: null, feedbackReason: null, createdAt: NOW, updatedAt: NOW }],
    opportunities: [{ id: "opp_1", type: "job", name: "Engineer", orgName: "Acme", url: "https://acme.example/jobs/1", deadline: null, status: "active" }],
    applications: [
      {
        id: "app_1",
        userId: "user_1",
        goalId: "gol_1",
        opportunityId: "opp_1",
        channel: "CH2",
        status: "submitted",
        needsYouReason: null,
        questions: [],
        answers: {},
        submittedAt: NOW,
        externalRef: "SBX-1",
        evidence: { confirmationText: "Thanks" },
        outcome: null,
        creditsReserved: 1,
        creditLotId: "lot_1",
        practice: false,
        followUpAt: null,
        followUpsSent: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
    applicationSteps: [{ id: "stp_1", applicationId: "app_1", n: 1, kind: "submit", status: "done", input: {}, output: {}, screenshotKey: "screens/user_1/app_1/1.png", error: null, startedAt: NOW, finishedAt: NOW }],
    generatedDocuments: [{ id: "gen_1", userId: "user_1", applicationId: "app_1", kind: "cover_letter", title: "Cover letter", language: "en", content: { format: "blocks", blocks: [] }, objectKey: "generated/user_1/gen_1.pdf", sources: ["fct_1"], version: 1, createdAt: NOW }],
    contacts: [],
    messages: [{ id: "msg_1", userId: "user_1", applicationId: "app_1", contactId: null, direction: "out", channel: "gmail", subject: "Hello", bodyText: "Hi", toAddr: "x@acme.example", fromAddr: "ada@example.com", gmailMessageId: "gm_1", gmailThreadId: "gt_1", status: "sent", classification: null, sentAt: NOW, receivedAt: null, createdAt: NOW }],
    events: [{ id: "evt_1", userId: "user_1", kind: "application.submitted", applicationId: "app_1", opportunityId: "opp_1", data: {}, createdAt: NOW }],
    notifications: [{ id: "ntf_1", userId: "user_1", kind: "submitted", title: "Submitted", body: null, href: "/app", readAt: null, emailedAt: null, createdAt: NOW }],
    authorizations: [{ id: "aut_1", userId: "user_1", scope: "weekly_digest", grantedAt: NOW, revokedAt: null }],
    integrations: [{ id: "int_1", userId: "user_1", provider: "google", scopes: ["gmail.send"], refreshTokenEnc: ENCRYPTED, accountEmail: "ada@example.com", status: "active", createdAt: NOW, updatedAt: NOW }],
    creditLots: [{ id: "lot_1", userId: "user_1", kind: "trial", total: 3, remaining: 2, status: "active", sourceKey: "trial:user_1", orderId: null, expiresAt: NOW, createdAt: NOW }],
    creditEvents: [{ id: "cev_1", userId: "user_1", lotId: "lot_1", applicationId: "app_1", kind: "debit", amount: 1, createdAt: NOW }],
    orders: [{ id: "ord_1", userId: "user_1", kind: "pack", sku: "pack10", stripeSessionId: SESSION, stripeSubscriptionId: null, stripePaymentIntent: "pi_1", stripeInvoiceId: null, amountTotal: 900, currency: "usd", status: "paid", promoCode: null, email: "ada@example.com", source: "webhook", createdAt: NOW, updatedAt: NOW }],
    subscriptions: [{ id: "sub_row", userId: "user_1", stripeSubscriptionId: SUBSCRIPTION, sku: "pro", status: "canceled", currentPeriodStart: NOW, currentPeriodEnd: NOW, cancelAtPeriodEnd: false, updatedAt: NOW }],
    contactMessages: [{ id: "cm_1", name: "Ada", email: "ada@example.com", topic: "support", message: "Hello", ipHash: "abc", userAgent: "UA", createdAt: NOW }],
    preferences: { emailUpdates: false },
  };
}

describe("buildExport", () => {
  const doc = buildExport(source(), NOW);
  const json = JSON.stringify(doc);

  it("has the documented shape", () => {
    expect(doc.format).toBe(EXPORT_FORMAT);
    expect(doc.version).toBe(EXPORT_VERSION);
    expect(doc.exportedAt).toBe(NOW.toISOString());
    expect(Object.keys(doc).sort()).toEqual(
      [
        "account",
        "applicationSteps",
        "applications",
        "authorizations",
        "contactMessages",
        "contacts",
        "credits",
        "documents",
        "events",
        "exportedAt",
        "facts",
        "format",
        "generatedDocuments",
        "goals",
        "importedOpportunities",
        "integrations",
        "matches",
        "messages",
        "milestones",
        "notes",
        "notifications",
        "opportunities",
        "orders",
        "preferences",
        "profile",
        "profileVersions",
        "sandboxSubmissions",
        "service",
        "subscriptions",
        "version",
      ].sort(),
    );
    expect(doc.account).toEqual({ id: "user_1", email: "ada@example.com", locale: "en", createdAt: NOW.toISOString(), lastSeenAt: NOW.toISOString() });
    expect(doc.preferences).toEqual({ emailUpdates: false, emailDigest: true });
    expect(doc.profile?.summary).toBe("Engineer");
    expect(doc.facts[0]).toMatchObject({ claim: "TypeScript", sourceDocId: "doc_1", quote: "TypeScript" });
    expect(doc.applications[0]).toMatchObject({ id: "app_1", status: "submitted", submittedAt: NOW.toISOString() });
    expect(doc.credits.lots[0]).toMatchObject({ kind: "trial", total: 3, remaining: 2 });
    expect(doc.integrations[0]).toEqual({ provider: "google", scopes: ["gmail.send"], accountEmail: "ada@example.com", status: "active", createdAt: NOW.toISOString(), updatedAt: NOW.toISOString() });
    expect(doc.notes.length).toBeGreaterThan(0);
  });

  it("lists documents by metadata only", () => {
    expect(doc.documents[0]).toEqual({ id: "doc_1", kind: "resume", filename: "cv.pdf", contentType: "application/pdf", bytes: 1234, sourceUrl: null, status: "parsed", error: null, createdAt: NOW.toISOString() });
    expect(json).not.toContain("long text");
  });

  it("never contains secrets, internal keys or Stripe references", () => {
    for (const secret of [ENCRYPTED, INBOUND, SESSION, SUBSCRIPTION, OBJECT_KEY, "cus_123", "pi_1", "gm_1", "gt_1", "screens/user_1"]) {
      expect(json).not.toContain(secret);
    }
    for (const field of NEVER_EXPORTED) expect(json).not.toContain(`"${field}"`);
  });

  it("has no allow-list that names a forbidden column", () => {
    for (const fields of Object.values(EXPORT_FIELDS)) {
      for (const f of fields) expect((NEVER_EXPORTED as readonly string[]).includes(f)).toBe(false);
    }
  });

  it("handles an account with nothing yet", () => {
    const empty = buildExport(
      {
        ...source(),
        user: null,
        profile: null,
        profileVersions: [],
        documents: [],
        facts: [],
        goals: [],
        matches: [],
        opportunities: [],
        applications: [],
        applicationSteps: [],
        generatedDocuments: [],
        messages: [],
        events: [],
        notifications: [],
        authorizations: [],
        integrations: [],
        creditLots: [],
        creditEvents: [],
        orders: [],
        subscriptions: [],
        contactMessages: [],
        preferences: null,
      },
      NOW,
    );
    expect(empty.account).toBeNull();
    expect(empty.profile).toBeNull();
    expect(empty.applications).toEqual([]);
    expect(empty.preferences).toEqual({ emailUpdates: true, emailDigest: true });
  });
});

describe("pick", () => {
  it("copies listed keys only, dates as ISO, missing as null", () => {
    expect(pick({ a: 1, b: NOW, c: "secret" } as Record<string, unknown>, ["a", "b", "d"])).toEqual({ a: 1, b: NOW.toISOString(), d: null });
  });
});

describe("deletion rules", () => {
  it("refuses while a subscription would keep renewing", () => {
    expect(renewingSubscription([{ status: "active", cancelAtPeriodEnd: false }])).not.toBeNull();
    expect(renewingSubscription([{ status: "past_due", cancelAtPeriodEnd: false }])).not.toBeNull();
    expect(renewingSubscription([{ status: "active", cancelAtPeriodEnd: true }])).toBeNull();
    expect(renewingSubscription([{ status: "canceled", cancelAtPeriodEnd: false }])).toBeNull();
    expect(renewingSubscription([])).toBeNull();
  });

  it("keeps orders for the books under an id that does not reveal the person", () => {
    const a = anonymizedUserId("user_1");
    expect(a).toMatch(/^deleted_[0-9a-f]{20}$/);
    expect(a).toBe(anonymizedUserId("user_1"));
    expect(a).not.toBe(anonymizedUserId("user_2"));
    expect(a).not.toContain("user_1");
  });

  it("names the file by date", () => {
    expect(exportFilename(NOW)).toBe("onward-scout-data-2026-10-21.json");
  });
});
