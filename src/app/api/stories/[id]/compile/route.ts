import { z } from "zod";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { createGenerationJob, runJobStep } from "@/server/jobs/service";
import { db } from "@/server/db";
import { storyVersions } from "@/server/db/schema";
import { eq } from "drizzle-orm";

const schema = z.object({
  versionId: z.uuid(),
  overrideBudget: z.boolean().default(false),
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
    if (!version || version.storyId !== (await context.params).id)
      throw new ApiError(
        404,
        "VERSION_NOT_FOUND",
        "Version introuvable pour cette histoire.",
      );
    const job = createGenerationJob(input.versionId, input.overrideBudget)!;
    await runJobStep(job.id, "validate");
    const result = await runJobStep(job.id, "compile");
    return Response.json({ success: true, jobId: job.id, result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
