import { z } from "zod";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import {
  createGenerationJob,
  scheduleInternalPipeline,
} from "@/server/jobs/service";

const schema = z.object({
  versionId: z.uuid(),
  overrideBudget: z.boolean().default(false),
});

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    const job = await createGenerationJob(
      input.versionId,
      input.overrideBudget,
    );
    const dispatch = scheduleInternalPipeline(job!.id);
    return Response.json({ job, dispatch }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
