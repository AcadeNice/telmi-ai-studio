import { z } from "zod";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import {
  approveCharacterReference,
  generateCharacterReference,
} from "@/server/media/service";

const generateSchema = z.object({
  action: z.literal("generate"),
  prompt: z.string().trim().max(4_000).optional(),
});
const approveSchema = z.object({ action: z.literal("approve") });

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const { id, versionId } = await context.params;
    const input = z
      .discriminatedUnion("action", [generateSchema, approveSchema])
      .parse(await readJson(request));
    const review =
      input.action === "approve"
        ? await approveCharacterReference(id, versionId)
        : await generateCharacterReference(id, versionId, input.prompt);
    return Response.json(review);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
