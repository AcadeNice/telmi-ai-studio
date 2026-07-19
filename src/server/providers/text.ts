import OpenAI from "openai";
import {
  narrativeJsonSchema,
  narrativeStorySchema,
  type CreationParameters,
  type NarrativeStory,
} from "@/lib/narrative/schema";
import {
  normalizeNarrativeSceneTypes,
  validateNarrativeGraph,
} from "@/lib/narrative/validator";
import { ApiError } from "@/server/api/response";
import { getProviderConfig } from "./config";

const graphRules = `
Règles structurelles obligatoires :
- startSceneId référence une scène existante ;
- tous les identifiants de scènes et de choix sont uniques ;
- toutes les scènes sont accessibles depuis la scène initiale ;
- aucune boucle ni aucun cycle ;
- chaque parcours finit dans une scène de type ending ;
- une scène ending ne possède aucun choix sortant ;
- une scène narrative possède exactement une transition sortante ;
- une scène choice possède au moins deux choix sortants ;
- chaque libellé de choix est unique dans toute l'histoire, précis et lié à la scène ; ne jamais répéter un libellé générique comme « Continuer », « Continuer le chemin » ou « Poursuivre » ;
- les destinations existent et l'ordre des choix d'une scène est unique, en commençant à 0.
Les transitions figurent uniquement dans le tableau choices.`;

const creativeRules = `
Règles créatives obligatoires :
- si requiredStoryElements est renseigné, intégrer naturellement chacun des éléments demandés dans le récit ;
- si artDirection est renseignée, l'appliquer à tous les imagePrompt de manière cohérente ;
- ne jamais ajouter de texte à afficher dans les illustrations ;
- conserver un vocabulaire, une durée et une intensité adaptés à l'âge indiqué.`;

export type NarrativeGenerationOptions = {
  currentNarrative?: NarrativeStory;
  instruction?: string;
  preserveSceneIds?: string[];
  preserveChoiceIds?: string[];
};

export function preserveNarrativeEdits(
  generated: NarrativeStory,
  current: NarrativeStory | undefined,
  preserveSceneIds: string[] = [],
  preserveChoiceIds: string[] = [],
) {
  if (!current) return generated;
  const lockedSceneIds = new Set(preserveSceneIds);
  const lockedChoiceIds = new Set(preserveChoiceIds);
  const currentScenes = new Map(
    current.scenes.map((scene) => [scene.id, scene]),
  );
  const currentChoices = new Map(
    current.choices.map((choice) => [choice.id, choice]),
  );
  const presentSceneIds = new Set(generated.scenes.map((scene) => scene.id));
  const presentChoiceIds = new Set(
    generated.choices.map((choice) => choice.id),
  );

  return {
    ...generated,
    scenes: [
      ...generated.scenes.map((scene) =>
        lockedSceneIds.has(scene.id)
          ? (currentScenes.get(scene.id) ?? scene)
          : scene,
      ),
      ...current.scenes.filter(
        (scene) =>
          lockedSceneIds.has(scene.id) && !presentSceneIds.has(scene.id),
      ),
    ],
    choices: [
      ...generated.choices.map((choice) =>
        lockedChoiceIds.has(choice.id)
          ? (currentChoices.get(choice.id) ?? choice)
          : choice,
      ),
      ...current.choices.filter(
        (choice) =>
          lockedChoiceIds.has(choice.id) && !presentChoiceIds.has(choice.id),
      ),
    ],
  };
}

export async function generateNarrative(
  parameters: CreationParameters,
  options: NarrativeGenerationOptions = {},
) {
  const config = getProviderConfig("text");
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? undefined,
  });
  let completion;
  const isRefinement = Boolean(options.currentNarrative);
  const lockedScenes = new Set(options.preserveSceneIds ?? []);
  const lockedChoices = new Set(options.preserveChoiceIds ?? []);
  const creativeParameters = { ...parameters };
  delete creativeParameters.preservedSceneIds;
  delete creativeParameters.preservedChoiceIds;
  try {
    completion = await client.chat.completions.create({
      model: config.model ?? "openai/gpt-4.1-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: isRefinement
            ? `Tu améliores et termines une histoire interactive française pour enfant à partir d'un scénario existant. Le scénario existant est la source de vérité : conserve ses personnages, événements, noms propres et intentions. Conserve les identifiants existants autant que possible. Les scènes et choix marqués comme verrouillés doivent être reproduits sans aucune modification. Complète et harmonise le reste du récit selon la demande du parent. Respecte strictement le JSON Schema. ${creativeRules} ${graphRules}`
            : `Tu écris des histoires interactives en français pour enfants. Respecte strictement le JSON Schema. Les choix sont bienveillants et compréhensibles pour l’âge demandé. ${creativeRules} ${graphRules}`,
        },
        {
          role: "user",
          content: isRefinement
            ? JSON.stringify({
                task: "Améliorer et terminer ce scénario",
                parameters: creativeParameters,
                parentInstruction: options.instruction || undefined,
                lockedSceneIds: [...lockedScenes],
                lockedChoiceIds: [...lockedChoices],
                currentStory: options.currentNarrative,
              })
            : `Crée l'histoire correspondant à ces paramètres :\n${JSON.stringify(creativeParameters)}`,
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: narrativeJsonSchema,
      },
    });
  } catch (error) {
    if (error instanceof OpenAI.APIError)
      throw new ApiError(
        502,
        "PROVIDER_ERROR",
        isRefinement
          ? "Le fournisseur IA a refusé l’amélioration du scénario. Vérifie le modèle configuré puis réessaie."
          : "Le fournisseur IA a refusé la génération. Vérifie le modèle configuré puis réessaie.",
      );
    throw error;
  }
  const content = completion.choices[0]?.message.content;
  if (!content)
    throw new Error("Le fournisseur texte n’a retourné aucun scénario.");
  const initialRaw = JSON.parse(content);
  let narrative = preserveNarrativeEdits(
    normalizeNarrativeSceneTypes(narrativeStorySchema.parse(initialRaw)),
    options.currentNarrative,
    [...lockedScenes],
    [...lockedChoices],
  );
  let validation = validateNarrativeGraph(narrative);

  if (!validation.valid) {
    let repairCompletion;
    try {
      repairCompletion = await client.chat.completions.create({
        model: config.model ?? "openai/gpt-4.1-mini",
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content: `Tu corriges un graphe narratif JSON sans changer le thème, les personnages ni l'intention de l'histoire. Les scènes et choix verrouillés doivent rester strictement identiques. Retourne uniquement un objet conforme au JSON Schema. ${creativeRules} ${graphRules}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              parameters: creativeParameters,
              invalidStory: narrative,
              lockedScenes: options.currentNarrative?.scenes.filter((scene) =>
                lockedScenes.has(scene.id),
              ),
              lockedChoices: options.currentNarrative?.choices.filter(
                (choice) => lockedChoices.has(choice.id),
              ),
              errors: validation.issues
                .filter((issue) => issue.severity === "error")
                .map(({ code, message, sceneId }) => ({
                  code,
                  message,
                  sceneId,
                })),
            }),
          },
        ],
        response_format: {
          type: "json_schema",
          json_schema: narrativeJsonSchema,
        },
      });
    } catch (error) {
      if (error instanceof OpenAI.APIError)
        throw new ApiError(
          502,
          "PROVIDER_ERROR",
          "Le fournisseur IA n’a pas pu réparer le scénario. Réessaie la génération.",
        );
      throw error;
    }

    const repairedContent = repairCompletion.choices[0]?.message.content;
    if (!repairedContent)
      throw new Error(
        "Le fournisseur texte n’a retourné aucun scénario réparé.",
      );
    const repairedRaw = JSON.parse(repairedContent);
    narrative = preserveNarrativeEdits(
      normalizeNarrativeSceneTypes(narrativeStorySchema.parse(repairedRaw)),
      options.currentNarrative,
      [...lockedScenes],
      [...lockedChoices],
    );
    validation = validateNarrativeGraph(narrative);

    return {
      narrative,
      raw: {
        mode: isRefinement ? "refine" : "create",
        initial: initialRaw,
        repaired: repairedRaw,
      },
      usage: {
        prompt_tokens:
          (completion.usage?.prompt_tokens ?? 0) +
          (repairCompletion.usage?.prompt_tokens ?? 0),
        completion_tokens:
          (completion.usage?.completion_tokens ?? 0) +
          (repairCompletion.usage?.completion_tokens ?? 0),
        total_tokens:
          (completion.usage?.total_tokens ?? 0) +
          (repairCompletion.usage?.total_tokens ?? 0),
      },
    };
  }

  return {
    narrative,
    raw: isRefinement ? { mode: "refine", result: initialRaw } : initialRaw,
    usage: completion.usage,
  };
}
