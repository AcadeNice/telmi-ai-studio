import { z } from "zod";
import { apiErrorResponse, ApiError, readText } from "@/server/api/response";
import { JOB_STEPS, runJobStep } from "@/server/jobs/service";
import { verifySignedN8nRequest } from "@/server/security/n8n-auth";
import { db } from "@/server/db";
import { generationJobs, storyVersions } from "@/server/db/schema";
import { eq } from "drizzle-orm";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; step: string }> },
) {
  try {
    const raw = await readText(request, 64_000);
    verifySignedN8nRequest(request, raw);
    if (raw)
      z.object({ assetId: z.string().optional() }).parse(JSON.parse(raw));
    const { id, step } = await context.params;
    if (!JOB_STEPS.includes(step as (typeof JOB_STEPS)[number]))
      throw new ApiError(400, "INVALID_STEP", "Étape inconnue.");
    if (step === "compile") {
      const row = db
        .select({ version: storyVersions })
        .from(generationJobs)
        .innerJoin(
          storyVersions,
          eq(generationJobs.versionId, storyVersions.id),
        )
        .where(eq(generationJobs.id, id))
        .get();
      if (!row?.version.mediaReviewedAt)
        return Response.json({
          success: true,
          skipped: true,
          code: "MEDIA_REVIEW_REQUIRED",
          message:
            "Compilation différée jusqu’à la validation des médias dans le studio.",
        });
    }
    return Response.json({
      success: true,
      result: await runJobStep(id, step as (typeof JOB_STEPS)[number]),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
