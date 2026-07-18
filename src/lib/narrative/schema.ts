import { z } from "zod";

export const creationParametersSchema = z.object({
  childName: z.string().trim().min(1).max(80),
  age: z.number().int().min(2).max(12),
  targetDurationMinutes: z.number().int().min(2).max(60),
  mainCharacter: z.string().trim().min(1).max(120),
  universe: z.string().trim().min(1).max(160),
  value: z.string().trim().min(1).max(120),
  decisionCount: z.number().int().min(1).max(8).default(3),
  choicesPerDecision: z.number().int().min(2).max(5).default(2),
  endingStrategy: z.enum(["shared", "per-branch", "mixed"]).default("mixed"),
  happyEnding: z.enum(["always", "optional", "never"]).default("always"),
  explicitMoral: z.boolean().default(false),
  illustrationMode: z
    .enum(["cover", "choices", "every-scene"])
    .default("choices"),
  voiceMode: z.enum(["single", "characters"]).default("single"),
  defaultVoiceId: z.string().trim().min(1).optional(),
});

export const narrativeSceneSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  type: z.enum(["narrative", "choice", "ending"]),
  title: z.string().trim().min(1).max(160),
  text: z.string().trim().min(1).max(12_000),
  imagePrompt: z.string().trim().max(2_000).optional(),
  voiceId: z.string().trim().max(160).optional(),
  position: z.object({ x: z.number(), y: z.number() }).optional(),
});

export const narrativeChoiceSchema = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  sourceSceneId: z.string().min(1),
  label: z.string().trim().min(1).max(160),
  targetSceneId: z.string().min(1),
  order: z.number().int().min(0),
});

export const narrativeStorySchema = z.object({
  schemaVersion: z.literal("1.0"),
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(1_000),
  age: z.number().int().min(2).max(12),
  targetDurationSeconds: z.number().int().min(60).max(7_200),
  startSceneId: z.string().min(1),
  moral: z.string().trim().max(500).optional(),
  scenes: z.array(narrativeSceneSchema).min(2).max(200),
  choices: z.array(narrativeChoiceSchema).max(500),
});

export type CreationParameters = z.infer<typeof creationParametersSchema>;
export type NarrativeStory = z.infer<typeof narrativeStorySchema>;
export type NarrativeScene = z.infer<typeof narrativeSceneSchema>;
export type NarrativeChoice = z.infer<typeof narrativeChoiceSchema>;

export const narrativeJsonSchema = {
  name: "telmi_narrative_story",
  strict: true,
  schema: z.toJSONSchema(narrativeStorySchema),
};
