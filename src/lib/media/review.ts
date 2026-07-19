import type { NarrativeStory } from "@/lib/narrative/schema";

export type IllustrationMode = "cover" | "choices" | "every-scene";
export type ExpectedMedia = {
  type: "cover" | "image" | "title_audio" | "audio";
  sceneKey: string | null;
};

export function expectedMedia(
  narrative: NarrativeStory,
  illustrationMode: IllustrationMode,
): ExpectedMedia[] {
  const expected: ExpectedMedia[] = [
    { type: "cover", sceneKey: null },
    { type: "title_audio", sceneKey: null },
    ...narrative.scenes.map((scene) => ({
      type: "audio" as const,
      sceneKey: scene.id,
    })),
    ...narrative.choices.map((choice) => ({
      type: "audio" as const,
      sceneKey: `choice:${choice.id}`,
    })),
  ];
  if (illustrationMode === "every-scene")
    expected.push(
      ...narrative.scenes
        .filter((scene) => scene.imagePrompt)
        .map((scene) => ({ type: "image" as const, sceneKey: scene.id })),
    );
  if (illustrationMode !== "cover")
    expected.push(
      ...narrative.choices.map((choice) => ({
        type: "image" as const,
        sceneKey: `choice:${choice.id}`,
      })),
    );
  return expected;
}

export function mediaKey(media: { type: string; sceneKey: string | null }) {
  return `${media.type}:${media.sceneKey ?? ""}`;
}
