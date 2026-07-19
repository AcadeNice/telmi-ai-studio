import argon2 from "argon2";
import { count } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { db, ensureDatabase } from "@/server/db";
import { admins, providerConfigurations, settings } from "@/server/db/schema";
import { encryptSecret } from "@/server/security/crypto";
import { createSession } from "@/server/auth/session";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";

const setupSchema = z.object({
  instanceName: z.string().trim().min(2).max(100).default("Telmi AI Studio"),
  childName: z.string().trim().min(1).max(80),
  password: z.string().min(12).max(200),
  publicUrl: z.url(),
  monthlyBudgetCents: z.number().int().min(0).max(1_000_000).default(2000),
  storyBudgetCents: z.number().int().min(0).max(100_000).default(300),
  providers: z
    .array(
      z.object({
        type: z.enum(["text", "image", "tts"]),
        provider: z.string().min(1),
        apiKey: z.string().min(1),
        baseUrl: z.url().optional(),
        model: z.string().optional(),
      }),
    )
    .default([]),
});

export async function GET() {
  try {
    ensureDatabase();
    const total = db.select({ value: count() }).from(admins).get()?.value ?? 0;
    return Response.json({
      setupRequired: total === 0,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    ensureDatabase();
    const total = db.select({ value: count() }).from(admins).get()?.value ?? 0;
    if (total > 0)
      throw new ApiError(
        409,
        "ALREADY_CONFIGURED",
        "L’installation initiale est déjà terminée.",
      );
    const input = setupSchema.parse(await readJson(request));
    // A fixed primary key makes the bootstrap race-safe at the database level.
    const adminId = "primary";
    const now = new Date();
    const passwordHash = await argon2.hash(input.password, {
      type: argon2.argon2id,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    db.transaction((tx) => {
      tx.insert(admins)
        .values({ id: adminId, passwordHash, createdAt: now, updatedAt: now })
        .run();
      tx.insert(settings)
        .values({
          id: "primary",
          instanceName: input.instanceName,
          childName: input.childName,
          publicUrl: input.publicUrl,
          monthlyBudgetCents: input.monthlyBudgetCents,
          storyBudgetCents: input.storyBudgetCents,
          storeEnabled: true,
          // Kept empty only for compatibility with databases created before
          // the store became directly accessible by URL.
          storeApiKeyHash: "",
          storeApiKeyEncrypted: "",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      for (const provider of input.providers)
        tx.insert(providerConfigurations)
          .values({
            id: randomUUID(),
            type: provider.type,
            provider: provider.provider,
            baseUrl: provider.baseUrl,
            model: provider.model,
            encryptedApiKey: encryptSecret(provider.apiKey),
            enabled: true,
            createdAt: now,
            updatedAt: now,
          })
          .run();
    });
    const session = await createSession(adminId);
    return Response.json(
      { success: true, csrfToken: session.csrfToken },
      { status: 201 },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
