import { describe, expect, it } from "vitest";
import { buildVerticalGraphLayout } from "./layout";
import type { NarrativeStory } from "./schema";

const narrative: NarrativeStory = {
  schemaVersion: "1.0",
  title: "Une histoire",
  description: "Test",
  age: 4,
  targetDurationSeconds: 600,
  startSceneId: "intro",
  scenes: [
    { id: "intro", type: "narrative", title: "Intro", text: "Début" },
    { id: "left", type: "choice", title: "Gauche", text: "À gauche" },
    { id: "right", type: "choice", title: "Droite", text: "À droite" },
    { id: "end", type: "ending", title: "Fin", text: "Fin" },
  ],
  choices: [
    {
      id: "c1",
      sourceSceneId: "intro",
      label: "Gauche",
      targetSceneId: "left",
      order: 0,
    },
    {
      id: "c2",
      sourceSceneId: "intro",
      label: "Droite",
      targetSceneId: "right",
      order: 1,
    },
    {
      id: "c3",
      sourceSceneId: "left",
      label: "Fin",
      targetSceneId: "end",
      order: 0,
    },
    {
      id: "c4",
      sourceSceneId: "right",
      label: "Fin",
      targetSceneId: "end",
      order: 0,
    },
  ],
};

describe("vertical graph layout", () => {
  it("places descendants below their parent and separates sibling branches", () => {
    const positions = buildVerticalGraphLayout(narrative);

    expect(positions.left!.y).toBeGreaterThan(positions.intro!.y);
    expect(positions.right!.y).toBe(positions.left!.y);
    expect(positions.end!.y).toBeGreaterThan(positions.left!.y);
    expect(
      Math.abs(positions.right!.x - positions.left!.x),
    ).toBeGreaterThanOrEqual(300);
  });
});
