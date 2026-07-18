import { eq } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { apiErrorResponse } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { settings } from "@/server/db/schema";
import { encryptSecret, hashToken } from "@/server/security/crypto";

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const key = randomBytes(32).toString("base64url");
    db.update(settings)
      .set({
        storeApiKeyHash: hashToken(key),
        storeApiKeyEncrypted: encryptSecret(key),
        updatedAt: new Date(),
      })
      .where(eq(settings.id, "primary"))
      .run();
    return Response.json({ storeApiKey: key });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
