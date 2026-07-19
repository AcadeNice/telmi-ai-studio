import { describe, expect, it } from "vitest";
import type { NarrativeStory } from "./schema";
import {
  choiceDisplayLabel,
  choiceImagePrompt,
  noTextImagePrompt,
  removeChildName,
} from "./choice-labels";

const narrative: NarrativeStory = {
  schemaVersion: "1.0",
  title: "Deux chemins",
  description: "Deux branches se rejoignent.",
  age: 4,
  targetDurationSeconds: 180,
  startSceneId: "depart",
  scenes: [
    { id: "depart", type: "choice", title: "Le départ", text: "Choisis." },
    { id: "foret", type: "narrative", title: "La forêt", text: "Avance." },
    { id: "riviere", type: "narrative", title: "La rivière", text: "Avance." },
    { id: "fin", type: "ending", title: "Les retrouvailles", text: "Fin." },
  ],
  choices: [
    {
      id: "c1",
      sourceSceneId: "foret",
      targetSceneId: "fin",
      label: "Continuer",
      order: 0,
    },
    {
      id: "c2",
      sourceSceneId: "riviere",
      targetSceneId: "fin",
      label: "Continuer",
      order: 0,
    },
  ],
};

describe("choice labels used by media and graph views", () => {
  it("adds the source scene when a label is repeated", () => {
    expect(choiceDisplayLabel(narrative, narrative.choices[0]!)).toBe(
      "Continuer · La forêt",
    );
    expect(choiceDisplayLabel(narrative, narrative.choices[1]!)).toBe(
      "Continuer · La rivière",
    );
  });

  it("gives image generation enough context to distinguish merged branches", () => {
    const prompt = choiceImagePrompt(narrative, narrative.choices[0]!);
    expect(prompt).toContain("Avance");
    expect(prompt).toContain("Fin");
    expect(prompt).toContain("Aucun texte");
    expect(prompt).not.toContain("«");
    expect(prompt).not.toContain("Continuer");
  });

  it("removes the child's first name without removing similar words", () => {
    expect(
      removeChildName("Mila, une petite licorne avance avec Émilane.", "Mila"),
    ).toBe("une petite licorne avance avec Émilane.");
    expect(
      noTextImagePrompt(
        "Mila la licorne traverse la forêt avec mila.",
        "",
        "Mila",
      ),
    ).not.toMatch(/mila/iu);
  });
});
