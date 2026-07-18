import type { NarrativeStory } from "./schema";

export type GraphIssue = {
  severity: "error" | "warning";
  code: string;
  message: string;
  sceneId?: string;
};

export type GraphValidation = {
  valid: boolean;
  issues: GraphIssue[];
  metrics: {
    scenes: number;
    choices: number;
    maxDepth: number;
    endings: number;
    estimatedWords: number;
  };
};

export function validateNarrativeGraph(
  story: NarrativeStory,
  maxDepth = 32,
): GraphValidation {
  const issues: GraphIssue[] = [];
  const ids = new Set<string>();
  const scenes = new Map(story.scenes.map((scene) => [scene.id, scene]));

  for (const scene of story.scenes) {
    if (ids.has(scene.id))
      issues.push({
        severity: "error",
        code: "DUPLICATE_SCENE",
        message: `La scène ${scene.id} est dupliquée.`,
        sceneId: scene.id,
      });
    ids.add(scene.id);
  }
  if (!scenes.has(story.startSceneId))
    issues.push({
      severity: "error",
      code: "MISSING_START",
      message: "La scène initiale n’existe pas.",
      sceneId: story.startSceneId,
    });

  const outgoing = new Map<string, string[]>();
  const choiceIds = new Set<string>();
  for (const choice of story.choices) {
    if (choiceIds.has(choice.id))
      issues.push({
        severity: "error",
        code: "DUPLICATE_CHOICE",
        message: `Le choix ${choice.id} est dupliqué.`,
        sceneId: choice.sourceSceneId,
      });
    choiceIds.add(choice.id);
    if (!scenes.has(choice.sourceSceneId))
      issues.push({
        severity: "error",
        code: "MISSING_SOURCE",
        message: `La source ${choice.sourceSceneId} n’existe pas.`,
        sceneId: choice.sourceSceneId,
      });
    if (!scenes.has(choice.targetSceneId))
      issues.push({
        severity: "error",
        code: "MISSING_TARGET",
        message: `La destination ${choice.targetSceneId} n’existe pas.`,
        sceneId: choice.sourceSceneId,
      });
    const targets = outgoing.get(choice.sourceSceneId) ?? [];
    targets.push(choice.targetSceneId);
    outgoing.set(choice.sourceSceneId, targets);
  }

  for (const scene of story.scenes) {
    const count = outgoing.get(scene.id)?.length ?? 0;
    if (scene.type === "ending" && count > 0)
      issues.push({
        severity: "error",
        code: "ENDING_HAS_CHOICES",
        message: "Une fin ne doit pas proposer de choix.",
        sceneId: scene.id,
      });
    if (scene.type !== "ending" && count === 0)
      issues.push({
        severity: "error",
        code: "DEAD_END",
        message: "Cette scène ne mène vers aucune suite.",
        sceneId: scene.id,
      });
    if (scene.type === "choice" && count < 2)
      issues.push({
        severity: "error",
        code: "INSUFFICIENT_CHOICES",
        message: "Une scène de choix doit proposer au moins deux options.",
        sceneId: scene.id,
      });
    if (scene.type === "narrative" && count > 1)
      issues.push({
        severity: "error",
        code: "NARRATIVE_MULTIPLE_OUTPUTS",
        message:
          "Une scène narrative ne peut avoir qu’une seule suite. Utilisez une scène de choix.",
        sceneId: scene.id,
      });
    const orders = story.choices
      .filter((choice) => choice.sourceSceneId === scene.id)
      .map((choice) => choice.order);
    if (new Set(orders).size !== orders.length)
      issues.push({
        severity: "error",
        code: "DUPLICATE_CHOICE_ORDER",
        message: "Deux choix utilisent le même ordre.",
        sceneId: scene.id,
      });
  }

  const reachable = new Set<string>();
  const visiting = new Set<string>();
  const visited = new Set<string>();
  let maxObservedDepth = 0;
  let hasCycle = false;

  function walk(id: string, depth: number) {
    if (!scenes.has(id)) return;
    reachable.add(id);
    maxObservedDepth = Math.max(maxObservedDepth, depth);
    if (visiting.has(id)) {
      hasCycle = true;
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const target of outgoing.get(id) ?? []) walk(target, depth + 1);
    visiting.delete(id);
    visited.add(id);
  }
  walk(story.startSceneId, 1);

  if (hasCycle)
    issues.push({
      severity: "error",
      code: "CYCLE",
      message: "Le graphe contient un cycle qui peut empêcher une fin.",
    });
  if (maxObservedDepth > maxDepth)
    issues.push({
      severity: "error",
      code: "MAX_DEPTH",
      message: `La profondeur ${maxObservedDepth} dépasse la limite ${maxDepth}.`,
    });
  for (const scene of story.scenes)
    if (!reachable.has(scene.id))
      issues.push({
        severity: "error",
        code: "UNREACHABLE",
        message: "Cette scène est inaccessible.",
        sceneId: scene.id,
      });

  const endings = story.scenes.filter(
    (scene) => scene.type === "ending",
  ).length;
  if (endings === 0)
    issues.push({
      severity: "error",
      code: "NO_ENDING",
      message: "Le graphe ne contient aucune fin.",
    });
  if (story.scenes.length > 40)
    issues.push({
      severity: "warning",
      code: "COMBINATORIAL_GROWTH",
      message:
        "Le nombre de scènes peut rendre l’histoire difficile à maintenir.",
    });

  const content = story.scenes
    .map((scene) => scene.text.toLowerCase())
    .join(" ");
  const sensitiveTerms = [
    "tuer",
    "sang",
    "arme",
    "violence",
    "mourir",
    "abandon",
  ];
  const detected = sensitiveTerms.filter((term) => content.includes(term));
  if (detected.length)
    issues.push({
      severity: "warning",
      code: "AGE_CONTENT_WARNING",
      message: `Contenu à relire pour l’âge indiqué : ${detected.join(", ")}.`,
    });
  if (
    story.age <= 5 &&
    story.scenes.some((scene) =>
      scene.text
        .split(/[.!?]+/)
        .some((sentence) => sentence.trim().split(/\s+/).length > 28),
    )
  ) {
    issues.push({
      severity: "warning",
      code: "VOCABULARY_WARNING",
      message:
        "Certaines phrases sont longues pour un enfant de moins de six ans.",
    });
  }

  const estimatedWords = story.scenes.reduce(
    (total, scene) => total + scene.text.split(/\s+/).filter(Boolean).length,
    0,
  );
  const estimatedSeconds = Math.round((estimatedWords / 130) * 60);
  if (
    Math.abs(estimatedSeconds - story.targetDurationSeconds) >
    story.targetDurationSeconds * 0.4
  ) {
    issues.push({
      severity: "warning",
      code: "DURATION_MISMATCH",
      message: "La durée estimée s’écarte de plus de 40 % de la durée cible.",
    });
  }

  return {
    valid: !issues.some((issue) => issue.severity === "error"),
    issues,
    metrics: {
      scenes: story.scenes.length,
      choices: story.choices.length,
      maxDepth: maxObservedDepth,
      endings,
      estimatedWords,
    },
  };
}
