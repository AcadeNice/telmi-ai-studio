import { requireMutationSession } from "@/server/auth/session";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import { createVersion } from "@/server/stories/service";
import { creationParametersSchema } from "@/lib/narrative/schema";
import { z } from "zod";

const schema = z.object({ parameters: creationParametersSchema.optional() });

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireMutationSession(request);
    const body = schema.parse(await readJson(request));
    const version = createVersion(
      (await params).id,
      body.parameters ? JSON.stringify(body.parameters) : undefined,
    );
    if (!version) throw new ApiError(404, "NOT_FOUND", "Histoire introuvable.");
    return Response.json(version, { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
