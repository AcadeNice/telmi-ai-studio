import type { CreationParameters, NarrativeStory } from "./schema";

export const ART_STYLE_OPTIONS = [
  {
    value: "watercolor",
    label: "Aquarelle douce",
    prompt:
      "aquarelle jeunesse douce, contours délicats, couleurs pastel lumineuses, texture de papier subtile",
  },
  {
    value: "gouache",
    label: "Gouache de livre jeunesse",
    prompt:
      "gouache de livre jeunesse, formes peintes chaleureuses, couleurs riches et mates, détails doux",
  },
  {
    value: "colored-pencil",
    label: "Crayons de couleur",
    prompt:
      "illustration aux crayons de couleur, traits doux visibles, papier légèrement texturé, ambiance tendre",
  },
  {
    value: "paper-cut",
    label: "Papier découpé",
    prompt:
      "illustration en papier découpé, couches colorées, ombres très douces, formes simples et enfantines",
  },
  {
    value: "clay-3d",
    label: "Pâte à modeler 3D",
    prompt:
      "univers 3D en pâte à modeler, volumes arrondis, lumière douce, matières tactiles et rassurantes",
  },
  {
    value: "flat-vector",
    label: "Illustration vectorielle",
    prompt:
      "illustration vectorielle jeunesse, formes arrondies, aplats colorés, contours propres, composition lisible",
  },
  {
    value: "soft-anime",
    label: "Animation douce",
    prompt:
      "style animation jeunesse douce, expressions chaleureuses, décors peints lumineux, formes simples et élégantes",
  },
  {
    value: "custom",
    label: "Style personnalisé",
    prompt: "",
  },
] as const;

export function resolveArtStyle(parameters: CreationParameters) {
  if (parameters.artStylePreset === "custom")
    return (
      parameters.artDirection?.trim() ||
      "illustration jeunesse douce, cohérente et adaptée à l’âge"
    );
  return (
    ART_STYLE_OPTIONS.find(
      (option) => option.value === parameters.artStylePreset,
    )?.prompt ?? ART_STYLE_OPTIONS[0].prompt
  );
}

export function buildStoryVisualContext(
  narrative: NarrativeStory,
  parameters: CreationParameters,
) {
  return [
    "Contexte visuel constant pour toutes les illustrations de cette histoire",
    `Personnage principal : ${parameters.mainCharacter}`,
    `Univers : ${parameters.universe}`,
    `Résumé de l’histoire : ${narrative.description}`,
    `Style graphique constant : ${resolveArtStyle(parameters)}`,
    "Conserver exactement la même apparence du personnage principal, les mêmes couleurs, proportions, accessoires, palette, lumière et niveau de détail d’une image à l’autre",
  ].join(". ");
}
