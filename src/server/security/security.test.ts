import { beforeEach, describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret } from "./crypto";

describe("security primitives", () => {
  beforeEach(() => {
    process.env.APP_ENCRYPTION_KEY = "11".repeat(32);
  });

  it("encrypts secrets with a random nonce", () => {
    const first = encryptSecret("secret");
    const second = encryptSecret("secret");
    expect(first).not.toBe(second);
    expect(decryptSecret(first)).toBe("secret");
  });
});
