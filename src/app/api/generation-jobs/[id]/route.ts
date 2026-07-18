import { apiErrorResponse, ApiError } from "@/server/api/response";
import { requireSession } from "@/server/auth/session";
import { getGenerationJob } from "@/server/jobs/service";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const job = getGenerationJob((await context.params).id);
    if (!job) throw new ApiError(404, "JOB_NOT_FOUND", "Travail introuvable.");
    return Response.json(job);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
