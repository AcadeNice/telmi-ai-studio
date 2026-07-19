import { z } from "zod";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { createCompileJob, runJobStep } from "@/server/jobs/service";
import { db } from "@/server/db";
import { storyVersions } from "@/server/db/schema";
import { eq } from "drizzle-orm";
import { markMediaReviewed } from "@/server/media/service";

const schema = z.object({
  versionId: z.uuid(),
  mediaReviewed: z.literal(true),
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
    await markMediaReviewed(storyId, input.versionId);
    const job = createCompileJob(input.versionId)!;
    await runJobStep(job.id, "validate");
    const result = await runJobStep(job.id, "compile");
    return Response.json({ success: true, jobId: job.id, result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
