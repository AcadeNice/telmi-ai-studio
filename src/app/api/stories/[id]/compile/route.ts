import { z } from "zod";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { createCompileJob, runJobStep } from "@/server/jobs/service";
import { db } from "@/server/db";
import { storyVersions } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { markMediaReviewed } from "@/server/media/service";
import { publishStoryVersion } from "@/server/stories/service";

const schema = z.object({
  versionId: z.uuid(),
  mediaReviewed: z.literal(true),
  publish: z.boolean().default(false),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    const version = db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.id, input.versionId))
      .get();
    const storyId = (await context.params).id;
    if (!version || version.storyId !== storyId)
      throw new ApiError(
        404,
        "VERSION_NOT_FOUND",
        "Version introuvable pour cette histoire.",
      );
    await markMediaReviewed(storyId, input.versionId, {
      allowPublished: input.publish,
    });
    const job = createCompileJob(input.versionId, {
      allowPublished: input.publish,
    })!;
    await runJobStep(job.id, "validate");
    const result = await runJobStep(job.id, "compile");
    const publication = input.publish
      ? publishStoryVersion(storyId, input.versionId, true)
      : null;
    return Response.json({
      success: true,
      jobId: job.id,
      result,
      publication,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
