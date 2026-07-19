import type { NarrativeStory } from "@/lib/narrative/schema";

export type TelmiStage = {
  image: string | null;
  audio: string | null;
  ok: { action: string; index: number } | null;
  home: { action: "backAction"; index: 0 };
  control: { ok: boolean; home: boolean; autoplay: boolean };
};

export type TelmiNodes = {
  startAction: { action: string; index: number };
  stages: Record<string, TelmiStage>;
  actions: Record<string, Array<{ stage: string }>>;
};

const safe = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, "_");

export function compileTelmiDocuments(
  story: NarrativeStory,
  uuid: string,
  version: number,
  illustrationMode: "cover" | "choices" | "every-scene" = "every-scene",
  credits?: { author?: string; voice?: string; publisher?: string },
) {
  const sceneKeys = new Map(
    story.scenes.map((scene, index) => [scene.id, `s${index + 1}`]),
  );
  const scenesById = new Map(story.scenes.map((scene) => [scene.id, scene]));
  const outgoingByScene = new Map(
    story.scenes.map((scene) => [
      scene.id,
      story.choices
        .filter((choice) => choice.sourceSceneId === scene.id)
        .sort((a, b) => a.order - b.order),
    ]),
  );
  const stages: Record<string, TelmiStage> = {
    backStage: {
      image: null,
      audio: null,
      ok: { action: "backChildAction", index: -1 },
      home: { action: "backAction", index: 0 },
      control: { ok: true, home: false, autoplay: true },
    },
  };
  const actions: Record<string, Array<{ stage: string }>> = {
    backAction: [{ stage: "backStage" }],
    backChildAction: [],
  };
  const notes: Record<
    string,
    { title: string; notes: string; color?: string }
  > = {
    backStage: { title: "Retour", notes: "" },
  };
  const variantKeys = new Map<string, string>();
  const variantCounts = new Map<string, number>();

  const compileSceneVariant = (
    sceneId: string,
    inheritedImage: string,
  ): string => {
    const scene = scenesById.get(sceneId);
    const baseStageKey = sceneKeys.get(sceneId);
    if (!scene || !baseStageKey)
      throw new Error(`La scène ${sceneId} est introuvable.`);

    const image =
      illustrationMode === "every-scene" && scene.imagePrompt
        ? `${baseStageKey}.png`
        : inheritedImage;
    const variantIdentity = `${sceneId}\u0000${image}`;
    const existing = variantKeys.get(variantIdentity);
    if (existing) return existing;

    const variantNumber = (variantCounts.get(sceneId) ?? 0) + 1;
    variantCounts.set(sceneId, variantNumber);
    const variantSuffix = variantNumber === 1 ? "" : `_v${variantNumber}`;
    const stageKey = `${baseStageKey}${variantSuffix}`;
    const sceneIndex = story.scenes.findIndex((item) => item.id === sceneId);
    const actionIndex = sceneIndex + 1;
    const outgoing = outgoingByScene.get(sceneId) ?? [];
    variantKeys.set(variantIdentity, stageKey);

    // Register the stage before walking its descendants. Narrative validation
    // rejects cycles, while this also keeps compilation safe for shared paths.
    stages[stageKey] = {
      image,
      audio: `${baseStageKey}.mp3`,
      ok: null,
      home: { action: "backAction", index: 0 },
      control: { ok: true, home: true, autoplay: false },
    };
    notes[stageKey] = {
      title: scene.title,
      notes: scene.text,
      color:
        scene.type === "ending"
          ? "green3"
          : scene.type === "choice"
            ? "orange2"
            : "blue3",
    };
    actions[`a_scene_${actionIndex}${variantSuffix}`] = [{ stage: stageKey }];

    if (scene.type === "choice") {
      const selectionAction = `a_choices_${actionIndex}${variantSuffix}`;
      const selectionStages: Array<{ stage: string }> = [];
      for (const [choiceIndex, choice] of outgoing.entries()) {
        const choiceStage = `q${actionIndex}${variantSuffix}_${choiceIndex + 1}`;
        const choiceImage =
          illustrationMode === "cover"
            ? image
            : `choice_${safe(choice.id)}.png`;
        const targetStage = compileSceneVariant(
          choice.targetSceneId,
          choiceImage,
        );
        const uniqueAction = `a_choice_${actionIndex}${variantSuffix}_${choiceIndex + 1}`;
        actions[uniqueAction] = [{ stage: targetStage }];
        stages[choiceStage] = {
          image: choiceImage,
          audio: `choice_${safe(choice.id)}.mp3`,
          ok: { action: uniqueAction, index: 0 },
          home: { action: "backAction", index: 0 },
          control: { ok: true, home: true, autoplay: false },
        };
        notes[choiceStage] = {
          title: choice.label,
          notes: choice.label,
          color: "purple3",
        };
        selectionStages.push({ stage: choiceStage });
      }
      actions[selectionAction] = selectionStages;
      stages[stageKey].ok = { action: selectionAction, index: 0 };
      stages[stageKey].control.autoplay = true;
    } else if (outgoing[0]) {
      const targetStage = compileSceneVariant(
        outgoing[0].targetSceneId,
        image,
      );
      const uniqueAction = `a_next_${actionIndex}${variantSuffix}`;
      actions[uniqueAction] = [{ stage: targetStage }];
      stages[stageKey].ok = { action: uniqueAction, index: 0 };
      stages[stageKey].control.autoplay = true;
    }

    return stageKey;
  };

  const startIndex = story.scenes.findIndex(
    (scene) => scene.id === story.startSceneId,
  );
  if (startIndex === -1)
    throw new Error(`La scène initiale ${story.startSceneId} est introuvable.`);
  compileSceneVariant(story.startSceneId, "story_cover.png");
  const nodes: TelmiNodes = {
    startAction: { action: `a_scene_${startIndex + 1}`, index: 0 },
    stages,
    actions,
  };

  return {
    metadata: {
      title: story.title,
      uuid,
      image: "cover.png",
      version,
      description: story.description,
      age: story.age,
      category: "Histoire Interactive",
      designer: "Telmi AI Studio",
      ...(credits?.author ? { author: credits.author } : {}),
      ...(credits?.voice ? { voice: credits.voice } : {}),
      ...(credits?.publisher ? { publisher: credits.publisher } : {}),
    },
    nodes,
    notes,
  };
}

export function validateTelmiDocuments(nodes: TelmiNodes) {
  const errors: string[] = [];
  if (!nodes.actions[nodes.startAction.action])
    errors.push("startAction pointe vers une action inconnue.");
  for (const [stageKey, stage] of Object.entries(nodes.stages)) {
    if (stage.home.action !== "backAction")
      errors.push(`${stageKey}: home doit pointer vers backAction.`);
    if (stage.ok && !nodes.actions[stage.ok.action])
      errors.push(`${stageKey}: ok pointe vers une action inconnue.`);
  }
  for (const [actionKey, entries] of Object.entries(nodes.actions)) {
    if (actionKey !== "backChildAction" && entries.length === 0)
      errors.push(`${actionKey}: action vide.`);
    for (const entry of entries)
      if (!nodes.stages[entry.stage])
        errors.push(`${actionKey}: scène ${entry.stage} inconnue.`);
  }
  const okActions = Object.entries(nodes.stages).flatMap(([key, stage]) =>
    stage.ok ? [{ key, action: stage.ok.action }] : [],
  );
  const seen = new Set<string>();
  for (const item of okActions) {
    if (seen.has(item.action))
      errors.push(`${item.key}: action ok ${item.action} réutilisée.`);
    seen.add(item.action);
  }
  return { valid: errors.length === 0, errors };
}
