import { eq, lt } from "drizzle-orm";
import { db, ensureDatabase } from "@/server/db";
import { n8nNonces } from "@/server/db/schema";
import { ApiError } from "@/server/api/response";
import { verifyN8nSignature } from "./hmac";

export function verifySignedN8nRequest(request: Request, rawBody: string) {
  ensureDatabase();
  const timestamp = request.headers.get("x-telmi-timestamp") ?? "";
  const nonce = request.headers.get("x-telmi-nonce") ?? "";
  const signature = request.headers.get("x-telmi-signature") ?? "";
  if (!nonce || !verifyN8nSignature(rawBody, timestamp, nonce, signature))
    throw new ApiError(
      401,
      "INVALID_SIGNATURE",
      "Signature n8n invalide ou expirée.",
    );
  db.delete(n8nNonces).where(lt(n8nNonces.expiresAt, new Date())).run();
  if (db.select().from(n8nNonces).where(eq(n8nNonces.nonce, nonce)).get())
    throw new ApiError(409, "REPLAY_DETECTED", "Ce nonce a déjà été utilisé.");
  db.insert(n8nNonces)
    .values({ nonce, expiresAt: new Date(Date.now() + 5 * 60_000) })
    .run();
}
