import OpenAI from "openai";
import {
  narrativeJsonSchema,
  narrativeStorySchema,
  type CreationParameters,
} from "@/lib/narrative/schema";
import { getProviderConfig } from "./config";

export async function generateNarrative(parameters: CreationParameters) {
  const config = getProviderConfig("text");
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl ?? undefined,
  });
  const completion = await client.chat.completions.create({
    model: config.model ?? "openai/gpt-4.1-mini",
    temperature: 0.7,
    messages: [
      {
        role: "system",
        content:
          "Tu écris des histoires interactives en français pour enfants. Respecte strictement le JSON Schema. Chaque parcours doit mener à une fin, sans boucle ni scène inaccessible. Les choix sont bienveillants et compréhensibles pour l’âge demandé.",
      },
      { role: "user", content: JSON.stringify(parameters) },
    ],
    response_format: { type: "json_schema", json_schema: narrativeJsonSchema },
  });
  const content = completion.choices[0]?.message.content;
  if (!content)
    throw new Error("Le fournisseur texte n’a retourné aucun scénario.");
  const raw = JSON.parse(content);
  return {
    narrative: narrativeStorySchema.parse(raw),
    raw,
    usage: completion.usage,
  };
}
