import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireMutationSession } from "@/server/auth/session";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { db } from "@/server/db";
import { providerConfigurations } from "@/server/db/schema";
import { decryptSecret } from "@/server/security/crypto";
import {
  inferProviderPreset,
  listProviderModels,
} from "@/server/providers/models";

const schema = z.object({
  type: z.enum(["text", "image", "tts"]),
  preset: z.enum([
    "openrouter",
    "openai",
    "mistral",
    "groq",
    "elevenlabs",
    "custom",
  ]),
  apiKey: z.string().trim().optional(),
  baseUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
});

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    const saved = db
      .select()
      .from(providerConfigurations)
      .where(eq(providerConfigurations.type, input.type))
      .get();
    const savedPreset = saved
      ? inferProviderPreset(saved.provider, saved.baseUrl, saved.type)
      : null;
    const apiKey =
      input.apiKey ||
      (saved && savedPreset === input.preset
        ? decryptSecret(saved.encryptedApiKey)
        : undefined);
    const list = await listProviderModels({
      type: input.type,
      preset: input.preset,
      apiKey,
      baseUrl: input.baseUrl,
    });
    return Response.json({ list });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
