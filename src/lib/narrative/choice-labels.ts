import type { NarrativeChoice, NarrativeStory } from "./schema";

const noTextRequirement =
  "Image exclusivement visuelle. Aucun texte, mot, lettre, chiffre, titre, logo, signature, filigrane, pancarte, affiche, enseigne, livre ou symbole ressemblant à de l’écriture.";

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function removeChildName(visualDescription: string, childName?: string) {
  const name = childName?.trim();
  if (!name) return visualDescription;
  return visualDescription
    .replace(
      new RegExp(
        `(^|[^\\p{L}\\p{N}])${escapeRegExp(name)}(?=$|[^\\p{L}\\p{N}])`,
        "giu",
      ),
      "$1",
    )
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/^\s*[,;:]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function noTextImagePrompt(
  visualDescription: string,
  artDirection = "",
  childName?: string,
) {
  const description = removeChildName(visualDescription, childName)
    .trim()
    .replace(/[.\s]+$/, "");
  const direction = artDirection.trim().replace(/[.\s]+$/, "");
  return [description, direction, noTextRequirement]
    .filter(Boolean)
    .map((part) => `${part.replace(/[.\s]+$/, "")}.`)
    .join(" ");
}

export function coverImagePrompt(
  narrative: NarrativeStory,
  artDirection = "",
  childName?: string,
) {
  return noTextImagePrompt(
    `Illustration de couverture jeunesse douce et colorée au format horizontal 4:3. Représenter visuellement cette histoire sans afficher son titre : ${narrative.description}`,
    artDirection,
    childName,
  );
}

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
  childName?: string,
) {
  const source = narrative.scenes.find(
    (scene) => scene.id === choice.sourceSceneId,
  );
  const target = narrative.scenes.find(
    (scene) => scene.id === choice.targetSceneId,
  );
  const sourceDescription = source?.imagePrompt ?? source?.text;
  const targetDescription = target?.imagePrompt ?? target?.text;
  const visualDescription = [
    "Illustration jeunesse douce, colorée et distincte au format horizontal 4:3",
    sourceDescription
      ? `Faire partir la scène de cette situation visuelle : ${sourceDescription}`
      : null,
    targetDescription
      ? `Montrer principalement le résultat visuel suivant : ${targetDescription}`
      : null,
  ]
    .filter(Boolean)
    .join(". ");
  return noTextImagePrompt(visualDescription, artDirection, childName);
}
