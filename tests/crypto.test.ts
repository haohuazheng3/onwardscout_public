import { randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { decryptSecret, decryptWithKey, encryptSecret, encryptWithKey, isEncryptedSecret, parseKey, SecretDecryptError } from "@/lib/crypto";

const KEY_HEX = "0f".repeat(32);
const previous = process.env.INTEGRATION_KEY;

beforeAll(() => {
  process.env.INTEGRATION_KEY = KEY_HEX;
});
afterAll(() => {
  if (previous === undefined) delete process.env.INTEGRATION_KEY;
  else process.env.INTEGRATION_KEY = previous;
});

describe("encryptSecret / decryptSecret", () => {
  it("round-trips text of any length, including unicode", () => {
    for (const plain of ["", "1//0refresh-token-example", "x".repeat(10_000), "密钥 🔐 résumé"]) {
      const enc = encryptSecret(plain);
      expect(isEncryptedSecret(enc)).toBe(true);
      expect(enc.startsWith("v1.")).toBe(true);
      expect(decryptSecret(enc)).toBe(plain);
    }
  });

  it("uses a fresh IV every time", () => {
    const a = encryptSecret("same");
    const b = encryptSecret("same");
    expect(a).not.toBe(b);
    expect(a.split(".")[1]).not.toBe(b.split(".")[1]);
  });

  it("binds the optional context (a ciphertext cannot move to another user)", () => {
    const enc = encryptSecret("token", "user_a");
    expect(decryptSecret(enc, "user_a")).toBe("token");
    expect(() => decryptSecret(enc, "user_b")).toThrow(SecretDecryptError);
    expect(() => decryptSecret(enc)).toThrow(SecretDecryptError);
  });

  it("detects tampering with any part", () => {
    const enc = encryptSecret("refresh-token");
    const [v, iv, ct, tag] = enc.split(".");
    const flip = (s: string) => {
      const buf = Buffer.from(s, "base64url");
      buf[0] ^= 0x01;
      return buf.toString("base64url");
    };
    expect(() => decryptSecret([v, flip(iv), ct, tag].join("."))).toThrow(SecretDecryptError);
    expect(() => decryptSecret([v, iv, flip(ct), tag].join("."))).toThrow(SecretDecryptError);
    expect(() => decryptSecret([v, iv, ct, flip(tag)].join("."))).toThrow(SecretDecryptError);
    expect(() => decryptSecret(["v2", iv, ct, tag].join("."))).toThrow(/unsupported/);
    expect(() => decryptSecret("not-encrypted")).toThrow(SecretDecryptError);
  });

  it("fails with another key", () => {
    const enc = encryptWithKey("secret", parseKey(KEY_HEX));
    expect(() => decryptWithKey(enc, randomBytes(32))).toThrow(SecretDecryptError);
    expect(decryptWithKey(enc, Buffer.from(KEY_HEX, "hex"))).toBe("secret");
  });

  it("refuses malformed keys", () => {
    expect(() => parseKey("abc")).toThrow(/64 hex/);
    expect(() => encryptWithKey("x", randomBytes(16))).toThrow(/32-byte/);
    process.env.INTEGRATION_KEY = "z".repeat(64);
    expect(() => encryptSecret("x")).toThrow(/64 hex/);
    process.env.INTEGRATION_KEY = KEY_HEX;
  });
});
