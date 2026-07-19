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

  for (const [sceneIndex, scene] of story.scenes.entries()) {
    const stageKey = sceneKeys.get(scene.id)!;
    const outgoing = story.choices
      .filter((choice) => choice.sourceSceneId === scene.id)
      .sort((a, b) => a.order - b.order);
    const sceneAction = `a_scene_${sceneIndex + 1}`;
    actions[sceneAction] = [{ stage: stageKey }];

    if (scene.type === "choice") {
      const selectionAction = `a_choices_${sceneIndex + 1}`;
      const selectionStages: Array<{ stage: string }> = [];
      for (const [choiceIndex, choice] of outgoing.entries()) {
        const choiceStage = `q${sceneIndex + 1}_${choiceIndex + 1}`;
        const targetIndex = story.scenes.findIndex(
          (item) => item.id === choice.targetSceneId,
        );
        const targetStage = sceneKeys.get(choice.targetSceneId);
        if (targetIndex === -1 || !targetStage) {
          throw new Error(
            `Le choix ${choice.id} pointe vers une scène inconnue (${choice.targetSceneId}).`,
          );
        }
        const uniqueAction = `a_choice_${sceneIndex + 1}_${choiceIndex + 1}`;
        // Point directly to the target stage. The target scene action may not
        // have been created yet when the destination follows this scene.
        actions[uniqueAction] = [{ stage: targetStage }];
        stages[choiceStage] = {
          image:
            illustrationMode === "cover"
              ? null
              : `choice_${safe(choice.id)}.png`,
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
      stages[stageKey] = {
        image:
          illustrationMode === "every-scene" && scene.imagePrompt
            ? `${stageKey}.png`
            : null,
        audio: `${stageKey}.mp3`,
        ok: { action: selectionAction, index: 0 },
        home: { action: "backAction", index: 0 },
        control: { ok: true, home: true, autoplay: true },
      };
    } else {
      let ok: TelmiStage["ok"] = null;
      if (outgoing[0]) {
        const targetIndex = story.scenes.findIndex(
          (item) => item.id === outgoing[0]!.targetSceneId,
        );
        const uniqueAction = `a_next_${sceneIndex + 1}`;
        actions[uniqueAction] = [
          { stage: sceneKeys.get(story.scenes[targetIndex]!.id)! },
        ];
        ok = { action: uniqueAction, index: 0 };
      }
      stages[stageKey] = {
        image:
          illustrationMode === "every-scene" && scene.imagePrompt
            ? `${stageKey}.png`
            : null,
        audio: `${stageKey}.mp3`,
        ok,
        home: { action: "backAction", index: 0 },
        control: { ok: true, home: true, autoplay: ok !== null },
      };
    }
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
  }

  const startIndex = story.scenes.findIndex(
    (scene) => scene.id === story.startSceneId,
  );
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
