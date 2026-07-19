import { eq } from "drizzle-orm";
import { db, ensureDatabase } from "@/server/db";
import { settings } from "@/server/db/schema";
import { ApiError } from "@/server/api/response";

export function requireStoreEnabled() {
  ensureDatabase();
  const config = db
    .select()
    .from(settings)
    .where(eq(settings.id, "primary"))
    .get();
  if (!config?.storeEnabled)
    throw new ApiError(404, "STORE_DISABLED", "Le store est désactivé.");
  return config;
}
