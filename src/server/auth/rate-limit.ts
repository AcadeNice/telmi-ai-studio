import { eq } from "drizzle-orm";
import { db, ensureDatabase } from "@/server/db";
import { loginAttempts } from "@/server/db/schema";
import { ApiError } from "@/server/api/response";

const WINDOW_MS = 15 * 60_000;
const BLOCK_MS = 30 * 60_000;
const MAX_FAILURES = 5;

export function assertLoginAllowed(key: string, now = new Date()) {
  ensureDatabase();
  const attempt = db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.key, key))
    .get();
  if (attempt?.blockedUntil && attempt.blockedUntil > now)
    throw new ApiError(
      429,
      "LOGIN_BLOCKED",
      "Trop de tentatives. Réessaie plus tard.",
    );
}

export function recordLoginFailure(key: string, now = new Date()) {
  const current = db
    .select()
    .from(loginAttempts)
    .where(eq(loginAttempts.key, key))
    .get();
  const withinWindow =
    current && now.getTime() - current.windowStartedAt.getTime() < WINDOW_MS;
  const failures = withinWindow ? current.failures + 1 : 1;
  db.insert(loginAttempts)
    .values({
      key,
      failures,
      windowStartedAt: withinWindow ? current.windowStartedAt : now,
      blockedUntil:
        failures >= MAX_FAILURES ? new Date(now.getTime() + BLOCK_MS) : null,
    })
    .onConflictDoUpdate({
      target: loginAttempts.key,
      set: {
        failures,
        windowStartedAt: withinWindow ? current!.windowStartedAt : now,
        blockedUntil:
          failures >= MAX_FAILURES ? new Date(now.getTime() + BLOCK_MS) : null,
      },
    })
    .run();
}

export function clearLoginFailures(key: string) {
  db.delete(loginAttempts).where(eq(loginAttempts.key, key)).run();
}
