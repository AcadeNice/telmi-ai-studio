import { eq } from "drizzle-orm";
import { db, ensureDatabase } from "@/server/db";
import { settings } from "@/server/db/schema";
import { ApiError } from "@/server/api/response";
import { constantTimeEqual, hashToken } from "@/server/security/crypto";

export function requireStoreKey(request: Request) {
  ensureDatabase();
  const key = new URL(request.url).searchParams.get("api_key") ?? "";
  const config = db
    .select()
    .from(settings)
    .where(eq(settings.id, "primary"))
    .get();
  if (
    !config?.storeEnabled ||
    !key ||
    !constantTimeEqual(hashToken(key), config.storeApiKeyHash)
  )
    throw new ApiError(403, "INVALID_STORE_KEY", "Clé du store invalide.");
  return { config, key };
}
