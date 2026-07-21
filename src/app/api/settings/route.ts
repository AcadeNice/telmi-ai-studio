import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { db, ensureDatabase } from "@/server/db";
import { providerConfigurations, settings } from "@/server/db/schema";
import { encryptSecret } from "@/server/security/crypto";

const updateSchema = z.object({
  instanceName: z.string().trim().min(2).max(100),
  childName: z.string().trim().min(1).max(80),
  publicUrl: z.url(),
  monthlyBudgetCents: z.number().int().min(0),
  storyBudgetCents: z.number().int().min(0),
  storeEnabled: z.boolean(),
  providers: z
    .array(
      z.object({
        type: z.enum(["text", "image", "tts"]),
        provider: z.string().min(1),
        apiKey: z.string().optional(),
        baseUrl: z.union([z.url(), z.literal(""), z.null()]).optional(),
        model: z.string().nullable().optional(),
        enabled: z.boolean().default(true),
      }),
    )
    .default([]),
});

export async function GET() {
  try {
    await requireSession();
    ensureDatabase();
    const config = db.select().from(settings).get();
    const providers = db
      .select({
        id: providerConfigurations.id,
        type: providerConfigurations.type,
        provider: providerConfigurations.provider,
        baseUrl: providerConfigurations.baseUrl,
        model: providerConfigurations.model,
        enabled: providerConfigurations.enabled,
      })
      .from(providerConfigurations)
      .all();
    return Response.json({
      ...config,
      storeApiKeyHash: undefined,
      storeApiKeyEncrypted: undefined,
      providers: providers.map((provider) => ({
        ...provider,
        configured: true,
      })),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(request: Request) {
  try {
    await requireMutationSession(request);
    const input = updateSchema.parse(await readJson(request));
    const now = new Date();
    db.transaction((tx) => {
      tx.update(settings)
        .set({
          instanceName: input.instanceName,
          childName: input.childName,
          publicUrl: input.publicUrl,
          monthlyBudgetCents: input.monthlyBudgetCents,
          storyBudgetCents: input.storyBudgetCents,
          storeEnabled: input.storeEnabled,
          updatedAt: now,
        })
        .where(eq(settings.id, "primary"))
        .run();
      for (const provider of input.providers) {
        const current = tx
          .select()
          .from(providerConfigurations)
          .where(eq(providerConfigurations.type, provider.type))
          .get();
        const normalizedProvider = provider.provider.toLowerCase();
        const localProvider =
          (provider.type === "tts" && normalizedProvider === "piper") ||
          (["text", "image"].includes(provider.type) &&
            normalizedProvider === "codex") ||
          (provider.type === "text" && normalizedProvider === "claude");
        const encryptedApiKey = provider.apiKey
          ? encryptSecret(provider.apiKey)
          : (current?.encryptedApiKey ??
            (localProvider ? encryptSecret("") : undefined));
        if (!encryptedApiKey) continue;
        tx.insert(providerConfigurations)
          .values({
            id: current?.id ?? randomUUID(),
            type: provider.type,
            provider: provider.provider,
            baseUrl: provider.baseUrl || null,
            model: provider.model,
            enabled: provider.enabled,
            encryptedApiKey,
            createdAt: current?.createdAt ?? now,
            updatedAt: now,
          })
          .onConflictDoUpdate({
            target: providerConfigurations.type,
            set: {
              provider: provider.provider,
              baseUrl: provider.baseUrl || null,
              model: provider.model,
              enabled: provider.enabled,
              encryptedApiKey,
              updatedAt: now,
            },
          })
          .run();
      }
    });
    return GET();
  } catch (error) {
    return apiErrorResponse(error);
  }
}
