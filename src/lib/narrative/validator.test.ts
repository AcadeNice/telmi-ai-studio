import { describe, expect, it } from "vitest";
import {
  narrativeJsonSchema,
  narrativeStorySchema,
  type NarrativeStory,
} from "./schema";
import { validateNarrativeGraph } from "./validator";

const validStory: NarrativeStory = {
  schemaVersion: "1.0",
  title: "Mila et la licorne",
  description: "Une histoire de partage.",
  age: 4,
  targetDurationSeconds: 180,
  startSceneId: "intro",
  scenes: [
    {
      id: "intro",
      type: "choice",
      title: "La rencontre",
      text: "Mila rencontre une licorne dans la forêt enchantée et doit choisir son chemin.",
    },
    {
      id: "partage",
      type: "ending",
      title: "Le partage",
      text: "Mila partage son goûter avec la licorne et toutes deux deviennent amies.",
    },
    {
      id: "chemin",
      type: "ending",
      title: "Le chemin",
      text: "Mila aide la licorne à retrouver le chemin du village.",
    },
  ],
  choices: [
    {
      id: "c1",
      sourceSceneId: "intro",
      label: "Partager",
      targetSceneId: "partage",
      order: 0,
    },
    {
      id: "c2",
      sourceSceneId: "intro",
      label: "Chercher le chemin",
      targetSceneId: "chemin",
      order: 1,
    },
  ],
};

describe("narrative graph", () => {
  it("keeps the provider schema compact for Gemini", () => {
    const encoded = JSON.stringify(narrativeJsonSchema.schema);
    expect(narrativeJsonSchema.strict).toBe(false);
    for (const unsupportedConstraint of [
      "$schema",
      "pattern",
      "minLength",
      "maxLength",
      "minimum",
      "maximum",
      "minItems",
      "maxItems",
    ])
      expect(encoded).not.toContain(`"${unsupportedConstraint}"`);
  });

  it("accepts a complete branching story", () => {
    expect(narrativeStorySchema.parse(validStory)).toEqual(validStory);
    expect(validateNarrativeGraph(validStory).valid).toBe(true);
  });

  it("rejects missing targets", () => {
    const story = structuredClone(validStory);
    story.choices[0]!.targetSceneId = "missing";
    expect(
      validateNarrativeGraph(story).issues.some(
        (issue) => issue.code === "MISSING_TARGET",
      ),
    ).toBe(true);
  });

  it("rejects cycles", () => {
    const story = structuredClone(validStory);
    story.scenes[1]!.type = "narrative";
    story.choices.push({
      id: "c3",
      sourceSceneId: "partage",
      label: "Retour",
      targetSceneId: "intro",
      order: 0,
    });
    expect(
      validateNarrativeGraph(story).issues.some(
        (issue) => issue.code === "CYCLE",
      ),
    ).toBe(true);
  });

  it("reports unreachable scenes", () => {
    const story = structuredClone(validStory);
    story.scenes.push({
      id: "cachee",
      type: "ending",
      title: "Cachée",
      text: "Personne ne peut atteindre cette scène.",
    });
    expect(
      validateNarrativeGraph(story).issues.some(
        (issue) => issue.code === "UNREACHABLE" && issue.sceneId === "cachee",
      ),
    ).toBe(true);
  });

  it("rejects multiple outgoing branches from a narrative scene", () => {
    const story = structuredClone(validStory);
    story.scenes[0]!.type = "narrative";
    expect(
      validateNarrativeGraph(story).issues.some(
        (issue) => issue.code === "NARRATIVE_MULTIPLE_OUTPUTS",
      ),
    ).toBe(true);
  });
});
