import { z } from "zod";
import { creationParametersSchema } from "@/lib/narrative/schema";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { updateDraftCreation } from "@/server/stories/service";

const updateSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(1000).default(""),
  parameters: creationParametersSchema,
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const { id, versionId } = await params;
    const input = updateSchema.parse(await readJson(request));
    const story = updateDraftCreation(id, versionId, input);
    if (!story) throw new ApiError(404, "NOT_FOUND", "Brouillon introuvable.");
    if (story === "immutable")
      throw new ApiError(
        409,
        "IMMUTABLE_VERSION",
        "Seul un brouillon peut être modifié.",
      );
    return Response.json(story);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
