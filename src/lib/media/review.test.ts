import { describe, expect, it } from "vitest";
import type { NarrativeStory } from "@/lib/narrative/schema";
import { expectedMedia, mediaKey } from "./review";

const narrative: NarrativeStory = {
  schemaVersion: "1.0",
  title: "Mila et la forêt",
  description: "Une aventure",
  age: 4,
  targetDurationSeconds: 300,
  startSceneId: "intro",
  scenes: [
    {
      id: "intro",
      type: "choice",
      title: "La clairière",
      text: "Mila arrive.",
      imagePrompt: "Une clairière colorée",
    },
    {
      id: "fin",
      type: "ending",
      title: "La fin",
      text: "Tout va bien.",
    },
  ],
  choices: [
    {
      id: "arc-en-ciel",
      sourceSceneId: "intro",
      targetSceneId: "fin",
      label: "Suivre l’arc-en-ciel",
      order: 0,
    },
  ],
};

describe("media review requirements", () => {
  it("requires every narration but only the cover in cover mode", () => {
    expect(expectedMedia(narrative, "cover").map(mediaKey)).toEqual([
      "cover:",
      "title_audio:",
      "audio:intro",
      "audio:fin",
      "audio:choice:arc-en-ciel",
    ]);
  });

  it("adds choice images without duplicating the title image", () => {
    expect(expectedMedia(narrative, "choices").map(mediaKey)).toContain(
      "image:choice:arc-en-ciel",
    );
    expect(expectedMedia(narrative, "choices").map(mediaKey)).not.toContain(
      "title_image:",
    );
  });

  it("adds only scenes that define an illustration prompt", () => {
    expect(expectedMedia(narrative, "every-scene").map(mediaKey)).toEqual(
      expect.arrayContaining(["image:intro", "image:choice:arc-en-ciel"]),
    );
    expect(expectedMedia(narrative, "every-scene").map(mediaKey)).not.toContain(
      "image:fin",
    );
  });
});
