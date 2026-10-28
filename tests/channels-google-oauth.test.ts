import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/*
 * Google OAuth helpers (no network): PKCE, the sealed state cookie, the consent URL, the ID
 * token's email, and which redirect URI is used. Test keys are built at runtime.
 */
const KEY = "ab".repeat(32);
const saved: Record<string, string | undefined> = {};
const ENV = { INTEGRATION_KEY: KEY, GOOGLE_OAUTH_CLIENT_ID: ["test-client", "apps.googleusercontent.com"].join("."), GOOGLE_OAUTH_CLIENT_SECRET: ["test", "secret"].join("-") };

beforeAll(() => {
  for (const [k, v] of Object.entries(ENV)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

const load = () => import("@/lib/integrations/google/oauth");

describe("PKCE", () => {
  it("derives the S256 challenge from the verifier", async () => {
    const { createPkce, pkceChallenge } = await load();
    const { verifier, challenge } = createPkce();
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).toBe(createHash("sha256").update(verifier).digest("base64url"));
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM"); // RFC 7636 appendix B
  });
});

describe("sealed state cookie", () => {
  it("round-trips for the same user and refuses everyone and everything else", async () => {
    const { sealState, openState, newState } = await load();
    const now = Date.now();
    const s = { state: newState(), verifier: "v".repeat(43), userId: "user_a", returnTo: "/app/integrations", locale: "zh" as const, createdAt: now };
    const sealed = sealState(s);
    expect(sealed).not.toContain(s.verifier);
    expect(openState(sealed, "user_a", now + 1000)).toEqual(s);
    expect(openState(sealed, "user_b", now + 1000)).toBeNull(); // bound to the user
    expect(openState(sealed, "user_a", now + 11 * 60 * 1000)).toBeNull(); // expired
    // tampered: one character in the middle changed (the end may only carry padding bits)
    const mid = Math.floor(sealed.length / 2);
    expect(openState(`${sealed.slice(0, mid)}${sealed[mid] === "A" ? "B" : "A"}${sealed.slice(mid + 1)}`, "user_a", now)).toBeNull();
    expect(openState(undefined, "user_a")).toBeNull();
  });
});

describe("consent URL", () => {
  it("asks for exactly openid, email and gmail.send, offline, with PKCE", async () => {
    const { buildAuthUrl, GOOGLE_SCOPES } = await load();
    const u = new URL(buildAuthUrl({ redirectUri: "https://onwardscout.com/api/integrations/google/callback", state: "st", codeChallenge: "ch" }));
    expect(u.origin + u.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(u.searchParams.get("scope")).toBe("openid email https://www.googleapis.com/auth/gmail.send");
    expect([...GOOGLE_SCOPES]).toEqual(["openid", "email", "https://www.googleapis.com/auth/gmail.send"]);
    expect(u.searchParams.get("access_type")).toBe("offline");
    expect(u.searchParams.get("prompt")).toBe("consent");
    expect(u.searchParams.get("code_challenge_method")).toBe("S256");
    expect(u.searchParams.get("code_challenge")).toBe("ch");
    expect(u.searchParams.get("state")).toBe("st");
    expect(u.searchParams.get("response_type")).toBe("code");
    expect(u.searchParams.get("client_id")).toBe(ENV.GOOGLE_OAUTH_CLIENT_ID);
    expect(u.searchParams.has("include_granted_scopes")).toBe(false);
  });

  it("reports whether Gmail can be connected at all", async () => {
    const { googleOAuthConfigured } = await load();
    expect(googleOAuthConfigured()).toBe(true);
    const id = process.env.GOOGLE_OAUTH_CLIENT_ID;
    delete process.env.GOOGLE_OAUTH_CLIENT_ID;
    expect(googleOAuthConfigured()).toBe(false);
    process.env.GOOGLE_OAUTH_CLIENT_ID = id;
  });
});

describe("tokens and redirect", () => {
  it("reads the account email from the ID token and the granted scopes", async () => {
    const { emailFromIdToken, grantedScopes } = await load();
    const payload = Buffer.from(JSON.stringify({ email: "Mei.Chen@Gmail.com", email_verified: true, sub: "1234" })).toString("base64url");
    expect(emailFromIdToken(`h.${payload}.s`)).toEqual({ email: "mei.chen@gmail.com", verified: true, sub: "1234" });
    expect(emailFromIdToken("garbage")).toBeNull();
    expect(emailFromIdToken(undefined)).toBeNull();
    expect(grantedScopes("openid https://www.googleapis.com/auth/userinfo.email https://www.googleapis.com/auth/gmail.send")).toContain("https://www.googleapis.com/auth/gmail.send");
    expect(grantedScopes(undefined)).toEqual([]);
  });

  it("uses the request origin only for local development", async () => {
    const { googleRedirectUri } = await load();
    expect(googleRedirectUri("http://localhost:3205/api/integrations/google/start")).toBe("http://localhost:3205/api/integrations/google/callback");
    expect(googleRedirectUri("https://evil.example/api/integrations/google/start")).toMatch(/^https:\/\/[^/]+\/api\/integrations\/google\/callback$/);
    expect(googleRedirectUri("https://evil.example/api/integrations/google/start")).not.toContain("evil.example");
  });
});
