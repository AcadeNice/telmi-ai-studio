import { and, eq } from "drizzle-orm";
import { apiErrorResponse, ApiError, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { storyVersions } from "@/server/db/schema";
import { publishStoryVersion } from "@/server/stories/service";
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
    return Response.json(
      publishStoryVersion(id, versionId, input.replace),
    );
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
