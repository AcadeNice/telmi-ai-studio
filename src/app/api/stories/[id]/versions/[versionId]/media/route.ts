import { apiErrorResponse } from "@/server/api/response";
import { requireSession } from "@/server/auth/session";
import { getMediaReview } from "@/server/media/service";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireSession();
    const { id, versionId } = await context.params;
    return Response.json(await getMediaReview(id, versionId));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
