import { createHmac } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";

beforeAll(() => {
  process.env.FILES_SIGNING_SECRET = "test-secret";
  process.env.FILES_BASE_URL = "https://files.example.com/";
});

const hmac = (parts: string[]) => createHmac("sha256", "test-secret").update(parts.join("\n")).digest("hex");

describe("signed file URLs (must match infra/workers/files exactly)", () => {
  it("signs reads over key, exp, disposition and filename", async () => {
    const { signReadPayload, signedReadUrl } = await import("@/lib/files");
    expect(signReadPayload("docs/u 1/a.pdf", 100, "inline", "Résumé.pdf")).toBe(hmac(["docs/u 1/a.pdf", "100", "inline", "Résumé.pdf"]));
    const before = Math.floor(Date.now() / 1000);
    const url = new URL(signedReadUrl("generated/user_2abc/gen_x1.pdf", { disposition: "attachment", filename: "Cover letter.pdf", ttlSeconds: 60 }));
    expect(url.origin).toBe("https://files.example.com");
    expect(url.pathname).toBe("/d/generated/user_2abc/gen_x1.pdf");
    expect(url.searchParams.get("disp")).toBe("attachment");
    expect(url.searchParams.get("name")).toBe("Cover letter.pdf");
    const exp = Number(url.searchParams.get("exp"));
    expect(exp).toBeGreaterThanOrEqual(before + 60);
    expect(exp).toBeLessThanOrEqual(before + 61);
    expect(url.searchParams.get("sig")).toBe(hmac(["generated/user_2abc/gen_x1.pdf", String(exp), "attachment", "Cover letter.pdf"]));
  });

  it("signs uploads with the 'upload' prefix, content type and byte cap", async () => {
    const { signUploadPayload, signedUploadUrl } = await import("@/lib/files");
    expect(signUploadPayload("docs/u/doc_1.pdf", 100, "application/pdf", 20971520)).toBe(hmac(["upload", "docs/u/doc_1.pdf", "100", "application/pdf", "20971520"]));
    const url = new URL(signedUploadUrl("docs/u/doc_1.pdf", { contentType: "application/pdf", maxBytes: 20971520.7 }));
    expect(url.pathname).toBe("/u/docs/u/doc_1.pdf");
    expect(url.searchParams.get("ct")).toBe("application/pdf");
    expect(url.searchParams.get("max")).toBe("20971520");
    expect(url.searchParams.get("sig")).toBe(hmac(["upload", "docs/u/doc_1.pdf", url.searchParams.get("exp")!, "application/pdf", "20971520"]));
  });

  it("percent-encodes key segments but keeps the slashes", async () => {
    const { signedReadUrl } = await import("@/lib/files");
    const url = signedReadUrl("docs/a b/c#d.pdf", { disposition: "inline", filename: "x.pdf" });
    expect(url).toContain("/d/docs/a%20b/c%23d.pdf?");
  });
});

describe("object keys", () => {
  it("follow the bucket layout", async () => {
    const { docKey, generatedKey, screenKey, backupKey, userPrefixes } = await import("@/lib/files");
    expect(docKey("user_2abc", "doc_x1", ".PDF")).toBe("docs/user_2abc/doc_x1.pdf");
    expect(generatedKey("user_2abc", "gen_y2", "docx")).toBe("generated/user_2abc/gen_y2.docx");
    expect(screenKey("user_2abc", "app_z3", 4)).toBe("screens/user_2abc/app_z3/4.png");
    expect(backupKey("2026-10-21")).toBe("backups/2026-10-21.sql.gz");
    expect(backupKey(new Date("2026-10-21T23:59:00Z"))).toBe("backups/2026-10-21.sql.gz");
    expect(userPrefixes("user_2abc")).toEqual(["docs/user_2abc/", "generated/user_2abc/", "screens/user_2abc/"]);
  });

  it("refuse anything that could escape the layout", async () => {
    const { docKey, generatedKey, screenKey, backupKey, userPrefixes } = await import("@/lib/files");
    expect(() => docKey("../etc", "d", "pdf")).toThrow();
    expect(() => docKey("u", "d/../../x", "pdf")).toThrow();
    expect(() => docKey("u", "d", "php/x")).toThrow();
    expect(() => generatedKey("u", "", "pdf")).toThrow();
    expect(() => screenKey("u", "a", -1)).toThrow();
    expect(() => screenKey("u", "a", 1.5)).toThrow();
    expect(() => backupKey("2026/10/21")).toThrow();
    expect(() => userPrefixes("")).toThrow();
  });
});
