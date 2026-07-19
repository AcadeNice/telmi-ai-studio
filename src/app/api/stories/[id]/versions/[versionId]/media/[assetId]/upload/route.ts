import { ApiError, apiErrorResponse } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { uploadMedia } from "@/server/media/service";

export async function POST(
  request: Request,
  context: {
    params: Promise<{ id: string; versionId: string; assetId: string }>;
  },
) {
  try {
    await requireMutationSession(request);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > 55_000_000)
      throw new ApiError(
        413,
        "MEDIA_TOO_LARGE",
        "Le fichier envoyé est trop volumineux.",
      );
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File))
      throw new ApiError(400, "FILE_REQUIRED", "Sélectionnez un fichier.");
    const { id, versionId, assetId } = await context.params;
    return Response.json(await uploadMedia(id, versionId, assetId, file));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
