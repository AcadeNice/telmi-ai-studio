import { describe, expect, it } from "vitest";
import {
  listPiperVoices,
  PIPER_DEFAULT_VOICE,
  resolvePiperVoice,
} from "./piper";

describe("Piper local voices", () => {
  it("proposes Beatrice first and keeps Siwis available", () => {
    expect(listPiperVoices().map((voice) => voice.voice_id)).toEqual([
      "fr_FR-beatrice",
      "fr_FR-siwis-medium",
    ]);
    expect(PIPER_DEFAULT_VOICE).toBe("fr_FR-beatrice");
  });

  it("falls back to Beatrice for a voice saved by another provider", () => {
    expect(resolvePiperVoice("an-elevenlabs-voice-id")).toBe("fr_FR-beatrice");
  });
});
