import { z } from "zod";
import { apiErrorResponse, ApiError, readText } from "@/server/api/response";
import { JOB_STEPS, runJobStep } from "@/server/jobs/service";
import { verifySignedN8nRequest } from "@/server/security/n8n-auth";

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
    return Response.json({
      success: true,
      result: await runJobStep(id, step as (typeof JOB_STEPS)[number]),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
