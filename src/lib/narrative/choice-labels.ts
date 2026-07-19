import type { NarrativeChoice, NarrativeStory } from "./schema";

export function normalizeChoiceLabel(label: string) {
  return label
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("fr")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function choiceDisplayLabel(
  narrative: NarrativeStory,
  choice: NarrativeChoice,
) {
  const normalized = normalizeChoiceLabel(choice.label);
  const repeated = narrative.choices.filter(
    (item) => normalizeChoiceLabel(item.label) === normalized,
  ).length;
  if (repeated < 2) return choice.label;
  const source = narrative.scenes.find(
    (scene) => scene.id === choice.sourceSceneId,
  );
  return source ? `${choice.label} · ${source.title}` : choice.label;
}

export function choiceImagePrompt(
  narrative: NarrativeStory,
  choice: NarrativeChoice,
  artDirection = "",
) {
  const source = narrative.scenes.find(
    (scene) => scene.id === choice.sourceSceneId,
  );
  const target = narrative.scenes.find(
    (scene) => scene.id === choice.targetSceneId,
  );
  const context = [
    source ? `après « ${source.title} »` : null,
    target ? `vers « ${target.title} »` : null,
  ]
    .filter(Boolean)
    .join(" et ");
  return `Illustration jeunesse simple et distincte représentant le choix « ${choice.label} »${context ? `, ${context}` : ""}. Sans texte.${artDirection}`;
}
