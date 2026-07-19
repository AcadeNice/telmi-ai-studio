import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import {
  getGenerationJob,
  JOB_STEPS,
  scheduleInternalPipeline,
} from "@/server/jobs/service";
import { readJson } from "@/server/api/response";

const schema = z.object({ step: z.enum(JOB_STEPS) });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    const id = (await context.params).id;
    const job = getGenerationJob(id);
    const configuredSteps = JOB_STEPS.filter((step) =>
      job?.steps.some((record) => record.step === step),
    );
    const start = configuredSteps.indexOf(input.step);
    if (start < 0)
      throw new ApiError(404, "STEP_NOT_FOUND", "Étape absente de ce travail.");
    const dispatch = scheduleInternalPipeline(id, configuredSteps[start]);
    return Response.json({ success: true, dispatch }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
