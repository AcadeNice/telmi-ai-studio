import { z } from "zod";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import {
  getStory,
  purgeStory,
  restoreStory,
  trashStory,
} from "@/server/stories/service";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const story = getStory((await params).id);
    if (!story) throw new ApiError(404, "NOT_FOUND", "Histoire introuvable.");
    return Response.json(story);
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireMutationSession(request);
    const id = (await params).id;
    const purging = new URL(request.url).searchParams.get("purge") === "true";
    if (!(purging ? purgeStory(id) : trashStory(id)))
      throw new ApiError(404, "NOT_FOUND", "Histoire introuvable.");
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    await requireMutationSession(request);
    const input = z
      .object({ action: z.literal("restore") })
      .parse(await readJson(request));
    if (input.action === "restore" && !restoreStory((await params).id))
      throw new ApiError(404, "NOT_FOUND", "Histoire introuvable.");
    return Response.json(getStory((await params).id));
  } catch (error) {
    return apiErrorResponse(error);
  }
}
