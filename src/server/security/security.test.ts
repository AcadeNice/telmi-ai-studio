import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";
import { signN8nRequest, verifyN8nSignature } from "./hmac";

describe("security primitives", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = "11".repeat(32);
    process.env.N8N_SHARED_SECRET = "a-long-test-secret-for-n8n-callbacks";
  });

  it("encrypts secrets with a random nonce", () => {
    const first = encryptSecret("secret");
    const second = encryptSecret("secret");
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("secret");
  });

  it("verifies signed callbacks within five minutes", () => {
    const timestamp = String(Date.now());
    const signed = signN8nRequest("{}", timestamp, "nonce-1");
    expect(
      verifyN8nSignature(
        "{}",
        signed.timestamp,
        signed.nonce,
        signed.signature,
      ),
    ).toBe(true);
    expect(
      verifyN8nSignature(
        "changed",
        signed.timestamp,
        signed.nonce,
        signed.signature,
      ),
    ).toBe(false);
  });
});
