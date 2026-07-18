import argon2 from "argon2";
import { count } from "drizzle-orm";
import { z } from "zod";
import { db, ensureDatabase } from "@/server/db";
import { admins } from "@/server/db/schema";
import { createSession } from "@/server/auth/session";
import {
  assertLoginAllowed,
  clearLoginFailures,
  recordLoginFailure,
} from "@/server/auth/rate-limit";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";

const schema = z.object({ password: z.string().min(1) });

export async function POST(request: Request) {
  try {
    ensureDatabase();
    const installed =
      db.select({ value: count() }).from(admins).get()?.value ?? 0;
    if (installed === 0)
      throw new ApiError(
        409,
        "SETUP_REQUIRED",
        "L’installation initiale est requise.",
      );
    // Une instance ne possède qu’un administrateur : un compteur global évite
    // qu’un attaquant contourne la limite en forgeant X-Forwarded-For.
    const key = "single-admin";
    assertLoginAllowed(key);
    const input = schema.parse(await readJson(request));
    const admin = db.select().from(admins).get();
    if (!admin || !(await argon2.verify(admin.passwordHash, input.password))) {
      recordLoginFailure(key);
      throw new ApiError(401, "INVALID_CREDENTIALS", "Mot de passe incorrect.");
    }
    clearLoginFailures(key);
    const session = await createSession(admin.id);
    return Response.json({
      authenticated: true,
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
