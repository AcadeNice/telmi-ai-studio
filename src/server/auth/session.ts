import { and, eq, gt } from "drizzle-orm";
import { cookies } from "next/headers";
import { randomBytes, randomUUID } from "node:crypto";
import { db, ensureDatabase } from "@/server/db";
import { admins, sessions } from "@/server/db/schema";
import { ApiError } from "@/server/api/response";
import { hashToken } from "@/server/security/crypto";

const SESSION_COOKIE = "telmi_session";
const SESSION_DURATION = 30 * 24 * 60 * 60_000;

export async function createSession(adminId: string) {
  ensureDatabase();
  const token = randomBytes(32).toString("base64url");
  const csrfToken = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DURATION);
  db.insert(sessions)
    .values({
      id: randomUUID(),
      adminId,
      tokenHash: hashToken(token),
      csrfToken,
      expiresAt,
      createdAt: new Date(),
    })
    .run();
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.COOKIE_SECURE === "true",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return { csrfToken, expiresAt };
}

export async function getSession() {
  ensureDatabase();
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const row = db
    .select({ session: sessions, admin: admins })
    .from(sessions)
    .innerJoin(admins, eq(sessions.adminId, admins.id))
    .where(
      and(
        eq(sessions.tokenHash, hashToken(token)),
        gt(sessions.expiresAt, new Date()),
      ),
    )
    .get();
  return row ?? null;
}

export async function requireSession() {
  const session = await getSession();
  if (!session)
    throw new ApiError(401, "UNAUTHENTICATED", "Authentification requise.");
  return session;
}

export async function requireMutationSession(request: Request) {
  const session = await requireSession();
  const csrf = request.headers.get("x-csrf-token");
  if (!csrf || csrf !== session.session.csrfToken)
    throw new ApiError(403, "INVALID_CSRF", "Jeton CSRF invalide.");
  return session;
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token)
    db.delete(sessions)
      .where(eq(sessions.tokenHash, hashToken(token)))
      .run();
  jar.delete(SESSION_COOKIE);
}
