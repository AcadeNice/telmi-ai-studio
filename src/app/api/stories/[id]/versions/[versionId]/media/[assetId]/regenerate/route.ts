import { z } from "zod";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { regenerateMedia } from "@/server/media/service";

const schema = z.object({
  prompt: z.string().trim().min(1).max(4_000).optional(),
  voiceId: z.string().trim().min(1).max(200).optional(),
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string; versionId: string; assetId: string }>;
  },
) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    const { id, versionId, assetId } = await context.params;
    return Response.json(await regenerateMedia(id, versionId, assetId, input));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
