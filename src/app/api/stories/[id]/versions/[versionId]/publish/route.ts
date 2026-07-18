import { and, eq, ne } from "drizzle-orm";
import { apiErrorResponse, ApiError, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { stories, storyVersions } from "@/server/db/schema";
import { z } from "zod";

const schema = z.object({ replace: z.boolean().default(true) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    const { id, versionId } = await context.params;
    const version = db
      .select()
      .from(storyVersions)
      .where(
        and(eq(storyVersions.id, versionId), eq(storyVersions.storyId, id)),
      )
      .get();
    if (!version)
      throw new ApiError(404, "VERSION_NOT_FOUND", "Version introuvable.");
    if (version.status !== "ready" && version.status !== "published")
      throw new ApiError(
        409,
        "PACK_NOT_READY",
        "Le pack doit être compilé avant publication.",
      );
    const now = new Date();
    db.transaction((tx) => {
      if (input.replace)
        tx.update(storyVersions)
          .set({ status: "superseded", updatedAt: now })
          .where(
            and(
              eq(storyVersions.storyId, id),
              eq(storyVersions.status, "published"),
              ne(storyVersions.id, versionId),
            ),
          )
          .run();
      tx.update(storyVersions)
        .set({ status: "published", publishedAt: now, updatedAt: now })
        .where(eq(storyVersions.id, versionId))
        .run();
      tx.update(stories)
        .set({ activeVersionId: versionId, updatedAt: now })
        .where(eq(stories.id, id))
        .run();
    });
    return Response.json({ success: true, status: "published" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const { id, versionId } = await context.params;
    const version = db
      .select()
      .from(storyVersions)
      .where(
        and(eq(storyVersions.id, versionId), eq(storyVersions.storyId, id)),
      )
      .get();
    if (!version)
      throw new ApiError(404, "VERSION_NOT_FOUND", "Version introuvable.");
    db.update(storyVersions)
      .set({ status: "ready", publishedAt: null, updatedAt: new Date() })
      .where(eq(storyVersions.id, versionId))
      .run();
    return Response.json({ success: true, status: "ready" });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
