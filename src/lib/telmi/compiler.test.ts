import { describe, expect, it } from "vitest";
import type { NarrativeStory } from "@/lib/narrative/schema";
import { compileTelmiDocuments, validateTelmiDocuments } from "./compiler";

const story: NarrativeStory = {
  schemaVersion: "1.0",
  title: "Mila et la licorne",
  description: "Une histoire interactive.",
  age: 4,
  targetDurationSeconds: 300,
  startSceneId: "intro",
  scenes: [
    {
      id: "intro",
      type: "choice",
      title: "Introduction",
      text: "Mila rencontre une licorne.",
      imagePrompt: "Une forêt enchantée",
    },
    {
      id: "fin-a",
      type: "ending",
      title: "Le partage",
      text: "Mila partage son goûter.",
    },
    {
      id: "fin-b",
      type: "ending",
      title: "Le chemin",
      text: "Mila retrouve son chemin.",
    },
  ],
  choices: [
    {
      id: "partager",
      sourceSceneId: "intro",
      label: "Partager",
      targetSceneId: "fin-a",
      order: 0,
    },
    {
      id: "marcher",
      sourceSceneId: "intro",
      label: "Marcher",
      targetSceneId: "fin-b",
      order: 1,
    },
  ],
};

describe("Telmi compiler", () => {
  it("generates deterministic valid Telmi documents", () => {
    const first = compileTelmiDocuments(story, "ffffff-test", 1);
    const second = compileTelmiDocuments(story, "ffffff-test", 1);
    expect(first).toEqual(second);
    expect(first.metadata.age).toBe(4);
    expect(validateTelmiDocuments(first.nodes)).toEqual({
      valid: true,
      errors: [],
    });
  });

  it("creates selectable stages for each choice", () => {
    const { nodes } = compileTelmiDocuments(story, "ffffff-test", 1);
    expect(nodes.actions.a_choices_1).toHaveLength(2);
    expect(nodes.stages.q1_1?.control.autoplay).toBe(false);
    expect(nodes.actions.a_choice_1_1).toEqual([{ stage: "s2" }]);
    expect(nodes.actions.a_choice_1_2).toEqual([{ stage: "s3" }]);
    expect(nodes.stages.q1_2?.ok?.action).not.toBe(
      nodes.stages.q1_1?.ok?.action,
    );
  });

  it("rejects empty actions that would restart a story on Telmi OS", () => {
    const { nodes } = compileTelmiDocuments(story, "ffffff-test", 1);
    nodes.actions.a_choice_1_1 = [];

    expect(validateTelmiDocuments(nodes)).toEqual({
      valid: false,
      errors: ["a_choice_1_1: action vide."],
    });
  });

  it("keeps the cover visible in cover-only mode", () => {
    const { nodes } = compileTelmiDocuments(story, "ffffff-test", 1, "cover");
    expect(
      Object.entries(nodes.stages)
        .filter(([key]) => key !== "backStage")
        .every(([, stage]) => stage.image === "story_cover.png"),
    ).toBe(true);
  });

  it("preserves the last displayed image through merged branches", () => {
    const mergedStory: NarrativeStory = {
      ...story,
      scenes: [
        story.scenes[0]!,
        {
          id: "branche-a",
          type: "narrative",
          title: "Branche A",
          text: "La première branche continue.",
        },
        {
          id: "branche-b",
          type: "narrative",
          title: "Branche B",
          text: "La seconde branche continue.",
        },
        {
          id: "fin",
          type: "ending",
          title: "Fin commune",
          text: "Les deux chemins se rejoignent.",
        },
      ],
      choices: [
        {
          id: "partager",
          sourceSceneId: "intro",
          label: "Partager",
          targetSceneId: "branche-a",
          order: 0,
        },
        {
          id: "marcher",
          sourceSceneId: "intro",
          label: "Marcher",
          targetSceneId: "branche-b",
          order: 1,
        },
        {
          id: "suite-a",
          sourceSceneId: "branche-a",
          label: "Continuer",
          targetSceneId: "fin",
          order: 0,
        },
        {
          id: "suite-b",
          sourceSceneId: "branche-b",
          label: "Continuer",
          targetSceneId: "fin",
          order: 0,
        },
      ],
    };

    const { nodes } = compileTelmiDocuments(
      mergedStory,
      "ffffff-test",
      1,
      "choices",
    );
    expect(nodes.stages.s2?.image).toBe("choice_partager.png");
    expect(nodes.stages.s3?.image).toBe("choice_marcher.png");
    expect(nodes.stages.s4?.image).toBe("choice_partager.png");
    expect(nodes.stages.s4_v2?.image).toBe("choice_marcher.png");
    expect(validateTelmiDocuments(nodes)).toEqual({ valid: true, errors: [] });
  });

  it("includes author and readable voice credits in metadata", () => {
    const { metadata } = compileTelmiDocuments(
      story,
      "ffffff-test",
      1,
      "cover",
      {
        author: "Telmi AI Studio",
        voice: "Jessica - Playful, Bright, Warm",
        publisher: "Telmi AI Studio",
      },
    );
    expect(metadata).toMatchObject({
      author: "Telmi AI Studio",
      voice: "Jessica - Playful, Bright, Warm",
      publisher: "Telmi AI Studio",
    });
  });
});
