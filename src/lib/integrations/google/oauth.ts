import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { decryptSecret, encryptSecret } from "@/lib/crypto";
import { env, features } from "@/lib/env";
import { siteUrl } from "@/lib/site";

/*
 * Google OAuth 2.0 for Gmail sending (authorization code + PKCE, offline access).
 *
 * Scopes are exactly `openid email gmail.send`: we can send mail as the person and learn which
 * address we send from. We can never read, list or delete their mail (no restricted scopes).
 * The PKCE verifier and the CSRF state travel in an httpOnly cookie, sealed with AES-256-GCM
 * (INTEGRATION_KEY) and bound to the user id, so it can't be read, forged or replayed by
 * another account. Env: GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET (optional — without
 * them the integrations page says Gmail isn't available yet and CH4 falls back to mailto).
 */

export const GMAIL_SEND_SCOPE = "https://www.googleapis.com/auth/gmail.send";
export const GOOGLE_SCOPES = ["openid", "email", GMAIL_SEND_SCOPE] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export const OAUTH_COOKIE = "os_google_oauth";
export const OAUTH_COOKIE_PATH = "/api/integrations/google";
export const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;
export const CALLBACK_PATH = "/api/integrations/google/callback";

export class GoogleAuthError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "GoogleAuthError";
    this.code = code;
  }
}

export function googleOAuthConfigured(): boolean {
  return features().gmail;
}

function clientCredentials(): { clientId: string; clientSecret: string } {
  const clientId = env("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = env("GOOGLE_OAUTH_CLIENT_SECRET");
  if (!clientId || !clientSecret) throw new GoogleAuthError("not_configured", "Gmail connection isn't available yet.");
  return { clientId, clientSecret };
}

/**
 * The redirect URI registered in the Google Cloud console: the canonical site origin on
 * deployments; the request's own origin during local development (localhost).
 */
export function googleRedirectUri(requestUrl: string): string {
  if (process.env.NODE_ENV !== "production") {
    try {
      const u = new URL(requestUrl);
      if (u.hostname === "localhost" || u.hostname === "127.0.0.1") return `${u.origin}${CALLBACK_PATH}`;
    } catch {
      /* fall through to the canonical origin */
    }
  }
  return `${siteUrl()}${CALLBACK_PATH}`;
}

/* ------------------------------------------------------------------ PKCE + state */

export interface Pkce {
  verifier: string;
  challenge: string;
}

export function createPkce(): Pkce {
  const verifier = randomBytes(32).toString("base64url");
  return { verifier, challenge: pkceChallenge(verifier) };
}

export function pkceChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

export interface OAuthState {
  state: string;
  verifier: string;
  userId: string;
  /** Unprefixed app path to come back to ("/app/integrations"). */
  returnTo: string;
  locale: "en" | "zh";
  createdAt: number;
}

export function newState(): string {
  return randomBytes(24).toString("base64url");
}

/** Seals the state for the cookie (encrypted + authenticated, bound to the user id). */
export function sealState(s: OAuthState): string {
  return encryptSecret(JSON.stringify(s), `google-oauth:${s.userId}`);
}

/** Opens a sealed state; null when missing, tampered, from another user or older than 10 minutes. */
export function openState(sealed: string | undefined | null, userId: string, now = Date.now()): OAuthState | null {
  if (!sealed) return null;
  try {
    const s = JSON.parse(decryptSecret(sealed, `google-oauth:${userId}`)) as OAuthState;
    if (s.userId !== userId || typeof s.state !== "string" || typeof s.verifier !== "string") return null;
    if (now - s.createdAt > OAUTH_STATE_TTL_MS || s.createdAt > now + 60_000) return null;
    return s;
  } catch {
    return null;
  }
}

/** Google's consent screen URL. `prompt=consent` makes Google return a refresh token every time. */
export function buildAuthUrl(input: { redirectUri: string; state: string; codeChallenge: string; loginHint?: string | null }): string {
  const { clientId } = clientCredentials();
  const p = new URLSearchParams({
    client_id: clientId,
    redirect_uri: input.redirectUri,
    response_type: "code",
    scope: GOOGLE_SCOPES.join(" "),
    access_type: "offline",
    prompt: "consent",
    state: input.state,
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256",
  });
  if (input.loginHint) p.set("login_hint", input.loginHint);
  return `${AUTH_URL}?${p.toString()}`;
}

/* ------------------------------------------------------------------ tokens */

export interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  id_token?: string;
  token_type?: string;
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(params).toString(),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
  } catch (err) {
    throw new GoogleAuthError("network", `Google could not be reached (${err instanceof Error ? err.message : "network error"}).`);
  }
  const json = (await res.json().catch(() => null)) as (Partial<TokenResponse> & { error?: string; error_description?: string }) | null;
  if (!res.ok || !json?.access_token) {
    const code = json?.error ?? `http_${res.status}`;
    throw new GoogleAuthError(code, json?.error_description ?? `Google refused the token request (${code}).`);
  }
  return json as TokenResponse;
}

/** Authorization code → tokens (with the PKCE verifier). */
export async function exchangeCode(input: { code: string; verifier: string; redirectUri: string }): Promise<TokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return tokenRequest({
    code: input.code,
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: input.redirectUri,
    grant_type: "authorization_code",
    code_verifier: input.verifier,
  });
}

/** Refresh token → a fresh access token. Throws GoogleAuthError("invalid_grant") once access was revoked. */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const { clientId, clientSecret } = clientCredentials();
  return tokenRequest({ refresh_token: refreshToken, client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token" });
}

/** Revokes a refresh (or access) token at Google. Returns false when Google says it was already invalid. */
export async function revokeToken(token: string): Promise<boolean> {
  const res = await fetch(REVOKE_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ token }).toString(),
    signal: AbortSignal.timeout(10_000),
    cache: "no-store",
  });
  if (res.ok) return true;
  if (res.status === 400) return false; // already revoked or expired
  throw new GoogleAuthError(`http_${res.status}`, "Google could not revoke access right now.");
}

/**
 * The account behind an ID token received directly from Google's token endpoint over TLS
 * (OpenID Connect Core §3.1.3.7 allows trusting it without re-verifying the signature).
 */
export function emailFromIdToken(idToken: string | undefined): { email: string; verified: boolean; sub: string | null } | null {
  if (!idToken) return null;
  const payload = idToken.split(".")[1];
  if (!payload) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { email?: unknown; email_verified?: unknown; sub?: unknown };
    if (typeof claims.email !== "string" || !claims.email.includes("@")) return null;
    return { email: claims.email.toLowerCase(), verified: claims.email_verified === true || claims.email_verified === "true", sub: typeof claims.sub === "string" ? claims.sub : null };
  } catch {
    return null;
  }
}

/** Scopes Google actually granted (the person can untick gmail.send on the consent screen). */
export function grantedScopes(scope: string | undefined): string[] {
  return (scope ?? "").split(/\s+/).filter(Boolean);
}
