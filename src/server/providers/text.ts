import OpenAI from "openai";
import {
  narrativeJsonSchema,
  narrativeStorySchema,
  type CreationParameters,
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
- les destinations existent et l'ordre des choix d'une scène est unique, en commençant à 0.
Les transitions figurent uniquement dans le tableau choices.`;

export async function generateNarrative(parameters: CreationParameters) {
  const config = getProviderConfig("text");
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? undefined,
  });
  let completion;
  try {
    completion = await client.chat.completions.create({
      model: config.model ?? "openai/gpt-4.1-mini",
      temperature: 0.7,
      messages: [
        {
          role: "system",
          content: `Tu écris des histoires interactives en français pour enfants. Respecte strictement le JSON Schema. Les choix sont bienveillants et compréhensibles pour l’âge demandé. ${graphRules}`,
        },
        {
          role: "user",
          content: `Crée l'histoire correspondant à ces paramètres :\n${JSON.stringify(parameters)}`,
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
        "Le fournisseur IA a refusé la génération. Vérifie le modèle configuré puis réessaie.",
      );
    throw error;
  }
  const content = completion.choices[0]?.message.content;
  if (!content)
    throw new Error("Le fournisseur texte n’a retourné aucun scénario.");
  const initialRaw = JSON.parse(content);
  let narrative = normalizeNarrativeSceneTypes(
    narrativeStorySchema.parse(initialRaw),
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
            content: `Tu corriges un graphe narratif JSON sans changer le thème, les personnages ni l'intention de l'histoire. Retourne uniquement un objet conforme au JSON Schema. ${graphRules}`,
          },
          {
            role: "user",
            content: JSON.stringify({
              parameters,
              invalidStory: narrative,
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
    narrative = normalizeNarrativeSceneTypes(
      narrativeStorySchema.parse(repairedRaw),
    );
    validation = validateNarrativeGraph(narrative);

    return {
      narrative,
      raw: { initial: initialRaw, repaired: repairedRaw },
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
    raw: initialRaw,
    usage: completion.usage,
  };
}
