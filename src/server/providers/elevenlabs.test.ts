import { describe, expect, it } from "vitest";
import { getElevenLabsVoicesUrl } from "./elevenlabs";

describe("ElevenLabs voices URL", () => {
  it("uses the current v2 voices endpoint from the configured v1 base", () => {
    expect(getElevenLabsVoicesUrl("https://api.elevenlabs.io/v1")).toBe(
      "https://api.elevenlabs.io/v2/voices",
    );
  });

  it("accepts a trailing slash and an explicit v2 base", () => {
    expect(getElevenLabsVoicesUrl("https://api.elevenlabs.io/v2/")).toBe(
      "https://api.elevenlabs.io/v2/voices",
    );
  });

  it("keeps custom proxy base paths", () => {
    expect(getElevenLabsVoicesUrl("https://voice.example/api")).toBe(
      "https://voice.example/api/voices",
    );
  });
});
