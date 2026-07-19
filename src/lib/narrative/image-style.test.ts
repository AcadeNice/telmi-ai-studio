import { describe, expect, it } from "vitest";
import type { CreationParameters, NarrativeStory } from "./schema";
import { buildStoryVisualContext, resolveArtStyle } from "./image-style";

const narrative: NarrativeStory = {
  schemaVersion: "1.0",
  title: "La forêt",
  description: "Une licorne découvre une forêt enchantée.",
  age: 4,
  targetDurationSeconds: 300,
  startSceneId: "intro",
  scenes: [{ id: "intro", type: "ending", title: "Début", text: "La fin." }],
  choices: [],
};

const parameters: CreationParameters = {
  childName: "Mila",
  age: 4,
  targetDurationMinutes: 5,
  mainCharacter: "Une petite licorne blanche",
  universe: "Une forêt enchantée",
  value: "Le partage",
  decisionCount: 1,
  choicesPerDecision: 2,
  endingStrategy: "shared",
  happyEnding: "always",
  explicitMoral: false,
  illustrationMode: "choices",
  voiceMode: "single",
  artStylePreset: "watercolor",
};

describe("image style context", () => {
  it("repeats the visual bible and selected style for every image", () => {
    const context = buildStoryVisualContext(narrative, parameters);
    expect(context).toContain("Une petite licorne blanche");
    expect(context).toContain("Une forêt enchantée");
    expect(context).toContain("aquarelle jeunesse douce");
    expect(context).toContain("même apparence");
  });

  it("uses a custom direction only when custom is selected", () => {
    expect(
      resolveArtStyle({
        ...parameters,
        artStylePreset: "custom",
        artDirection: "Pastels et formes géométriques",
      }),
    ).toBe("Pastels et formes géométriques");
  });
});
