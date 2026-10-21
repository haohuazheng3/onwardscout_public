import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { INTEGRATION_KEY_PATTERN, requireEnv } from "./env";

/*
 * Secrets at rest (Gmail refresh tokens in `integrations.refresh_token_enc`, anything else the
 * app must store but never show): AES-256-GCM under INTEGRATION_KEY (64 hex chars = 32 bytes).
 *
 * Payload format, versioned so the scheme can change without a flag day:
 *   v1.<iv>.<ciphertext>.<tag>        (base64url parts; 12-byte IV, 16-byte tag)
 * An optional `context` (e.g. the user id) is bound as additional authenticated data: a
 * ciphertext copied onto another user's row then fails to decrypt instead of working.
 */

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export class SecretDecryptError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecretDecryptError";
  }
}

/** Parses a 64-hex-character key into its 32 bytes. */
export function parseKey(hex: string): Buffer {
  if (!INTEGRATION_KEY_PATTERN.test(hex)) throw new Error("INTEGRATION_KEY must be 64 hex characters (32 bytes)");
  return Buffer.from(hex, "hex");
}

function integrationKey(): Buffer {
  return parseKey(requireEnv("INTEGRATION_KEY"));
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

export function encryptWithKey(plaintext: string, key: Buffer, context?: string): string {
  if (key.length !== 32) throw new Error("AES-256-GCM needs a 32-byte key");
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
  if (context !== undefined) cipher.setAAD(Buffer.from(`${VERSION}|${context}`, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [VERSION, b64url(iv), b64url(ct), b64url(cipher.getAuthTag())].join(".");
}

export function decryptWithKey(payload: string, key: Buffer, context?: string): string {
  if (key.length !== 32) throw new Error("AES-256-GCM needs a 32-byte key");
  const parts = payload.split(".");
  if (parts.length !== 4) throw new SecretDecryptError("not an encrypted secret");
  const [version, ivPart, ctPart, tagPart] = parts;
  if (version !== VERSION) throw new SecretDecryptError(`unsupported secret version ${version.slice(0, 8)}`);
  const iv = Buffer.from(ivPart, "base64url");
  const ct = Buffer.from(ctPart, "base64url");
  const tag = Buffer.from(tagPart, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new SecretDecryptError("malformed encrypted secret");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_BYTES });
    if (context !== undefined) decipher.setAAD(Buffer.from(`${VERSION}|${context}`, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
  } catch {
    // Wrong key, wrong context or a modified payload: GCM authentication failed.
    throw new SecretDecryptError("secret could not be decrypted (wrong key, wrong context or tampered)");
  }
}

/** Encrypts with INTEGRATION_KEY. Pass the owning user id as `context` for per-user secrets. */
export function encryptSecret(plaintext: string, context?: string): string {
  return encryptWithKey(plaintext, integrationKey(), context);
}

/** Decrypts a payload from `encryptSecret`; throws SecretDecryptError when it does not authenticate. */
export function decryptSecret(payload: string, context?: string): string {
  return decryptWithKey(payload, integrationKey(), context);
}

/** True for strings produced by `encryptSecret` (shape check only, no decryption). */
export function isEncryptedSecret(v: unknown): v is string {
  return typeof v === "string" && /^v1\.[A-Za-z0-9_-]{16}\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]{22}$/.test(v);
}
