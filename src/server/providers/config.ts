import { eq } from "drizzle-orm";
import { db, ensureDatabase } from "@/server/db";
import { providerConfigurations } from "@/server/db/schema";
import { decryptSecret } from "@/server/security/crypto";
import { ApiError } from "@/server/api/response";

export type ProviderType = "text" | "image" | "tts";

export function getProviderConfig(type: ProviderType) {
  ensureDatabase();
  const row = db
    .select()
    .from(providerConfigurations)
    .where(eq(providerConfigurations.type, type))
    .get();
  if (!row || !row.enabled)
    throw new ApiError(
      409,
      "PROVIDER_NOT_CONFIGURED",
      `Le fournisseur ${type} n’est pas configuré.`,
    );
  return { ...row, apiKey: decryptSecret(row.encryptedApiKey) };
}
