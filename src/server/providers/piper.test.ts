import { describe, expect, it } from "vitest";
import {
  listPiperVoices,
  PIPER_DEFAULT_VOICE,
  resolvePiperVoice,
} from "./piper";

describe("Piper local voices", () => {
  it("proposes Beatrice first and all official French models", () => {
    expect(listPiperVoices().map((voice) => voice.voice_id)).toEqual([
      "fr_FR-beatrice",
      "fr_FR-gilles-low",
      "fr_FR-mls-medium",
      "fr_FR-mls_1840-low",
      "fr_FR-siwis-low",
      "fr_FR-siwis-medium",
      "fr_FR-tom-medium",
      "fr_FR-upmc-medium",
    ]);
    expect(PIPER_DEFAULT_VOICE).toBe("fr_FR-beatrice");
  });

  it("falls back to Beatrice for a voice saved by another provider", () => {
    expect(resolvePiperVoice("an-elevenlabs-voice-id")).toBe("fr_FR-beatrice");
  });
});
