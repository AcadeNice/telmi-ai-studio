import { describe, expect, it } from "vitest";
import type { NarrativeStory } from "@/lib/narrative/schema";
import { preserveNarrativeEdits } from "./text";

const current: NarrativeStory = {
  schemaVersion: "1.0",
  title: "Mila et l’elfe",
  description: "Une aventure féerique.",
  age: 4,
  targetDurationSeconds: 300,
  startSceneId: "intro",
  scenes: [
    {
      id: "intro",
      type: "narrative",
      title: "L’arc-en-ciel",
      text: "Mila rencontre un elfe qui s’appelle Noa.",
      imagePrompt: "Un arc-en-ciel peint à l’aquarelle.",
    },
    {
      id: "fin",
      type: "ending",
      title: "La fête",
      text: "Tout le monde fête cette rencontre.",
    },
  ],
  choices: [
    {
      id: "continuer",
      sourceSceneId: "intro",
      label: "Suivre Noa",
      targetSceneId: "fin",
      order: 0,
    },
  ],
};

describe("narrative refinement", () => {
  it("preserves manually edited scenes and choice labels", () => {
    const generated: NarrativeStory = {
      ...current,
      scenes: current.scenes.map((scene) => ({
        ...scene,
        title: `IA ${scene.title}`,
        text: `IA ${scene.text}`,
      })),
      choices: current.choices.map((choice) => ({
        ...choice,
        label: `IA ${choice.label}`,
      })),
    };

    const result = preserveNarrativeEdits(
      generated,
      current,
      ["intro"],
      ["continuer"],
    );

    expect(result.scenes.find((scene) => scene.id === "intro")).toEqual(
      current.scenes[0],
    );
    expect(result.scenes.find((scene) => scene.id === "fin")?.title).toBe(
      "IA La fête",
    );
    expect(result.choices[0]?.label).toBe("Suivre Noa");
  });

  it("restores a locked scene omitted by the provider", () => {
    const generated = {
      ...current,
      scenes: current.scenes.filter((scene) => scene.id !== "intro"),
    };
    const result = preserveNarrativeEdits(generated, current, ["intro"]);
    expect(result.scenes.some((scene) => scene.id === "intro")).toBe(true);
  });
});
