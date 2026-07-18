import { desc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { notifications } from "@/server/db/schema";

export async function GET() {
  try {
    await requireSession();
    return Response.json({
      list: db
        .select()
        .from(notifications)
        .orderBy(desc(notifications.createdAt))
        .limit(100)
        .all(),
      unread: db
        .select()
        .from(notifications)
        .where(isNull(notifications.readAt))
        .all().length,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(request: Request) {
  try {
    await requireMutationSession(request);
    const input = z.object({ id: z.uuid() }).parse(await readJson(request));
    db.update(notifications)
      .set({ readAt: new Date() })
      .where(eq(notifications.id, input.id))
      .run();
    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
