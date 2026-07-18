import { z } from "zod";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import {
  createGenerationJob,
  dispatchGenerationJob,
  failGenerationDispatch,
} from "@/server/jobs/service";

const schema = z.object({
  versionId: z.uuid(),
  overrideBudget: z.boolean().default(false),
});

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    const job = createGenerationJob(input.versionId, input.overrideBudget);
    let dispatch;
    try {
      dispatch = await dispatchGenerationJob(job!.id);
    } catch (error) {
      failGenerationDispatch(
        job!.id,
        error instanceof Error ? error.message : "Échec du webhook n8n.",
      );
      throw error;
    }
    return Response.json({ job, dispatch }, { status: 202 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
