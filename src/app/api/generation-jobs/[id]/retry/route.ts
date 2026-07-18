import { z } from "zod";
import { apiErrorResponse } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { JOB_STEPS, runJobStep } from "@/server/jobs/service";
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
    const start = JOB_STEPS.indexOf(input.step);
    let result: unknown = null;
    for (const step of JOB_STEPS.slice(start))
      result = await runJobStep(id, step);
    return Response.json({ success: true, result });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
