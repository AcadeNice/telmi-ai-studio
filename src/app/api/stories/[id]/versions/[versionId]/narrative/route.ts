import { eq } from "drizzle-orm";
import { narrativeStorySchema } from "@/lib/narrative/schema";
import { validateNarrativeGraph } from "@/lib/narrative/validator";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import { db } from "@/server/db";
import { storyVersions } from "@/server/db/schema";
import { loadNarrative, saveNarrative } from "@/server/stories/service";

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireSession();
    const { id, versionId } = await params;
    const version = db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.id, versionId))
      .get();
    if (!version || version.storyId !== id)
      throw new ApiError(404, "NOT_FOUND", "Version introuvable.");
    const narrative = loadNarrative(versionId);
    if (!narrative)
      throw new ApiError(404, "NOT_FOUND", "Scénario introuvable.");
    return Response.json({
      narrative,
      validation: validateNarrativeGraph(narrative),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const { id, versionId } = await params;
    const version = db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.id, versionId))
      .get();
    if (!version || version.storyId !== id)
      throw new ApiError(404, "NOT_FOUND", "Version introuvable.");
    if (version.status !== "draft")
      throw new ApiError(
        409,
        "IMMUTABLE_VERSION",
        "Une version validée ou publiée est immuable. Créez un nouveau brouillon.",
      );
    const narrative = narrativeStorySchema.parse(await readJson(request));
    const validation = validateNarrativeGraph(narrative);
    saveNarrative(versionId, narrative);
    return Response.json({ narrative, validation });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const { id, versionId } = await params;
    const version = db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.id, versionId))
      .get();
    if (!version || version.storyId !== id)
      throw new ApiError(404, "NOT_FOUND", "Version introuvable.");
    if (version.status !== "draft")
      throw new ApiError(
        409,
        "IMMUTABLE_VERSION",
        "Seul un brouillon peut être validé.",
      );
    const narrative = loadNarrative(versionId);
    if (!narrative)
      throw new ApiError(404, "NOT_FOUND", "Scénario introuvable.");
    const validation = validateNarrativeGraph(narrative);
    if (!validation.valid)
      throw new ApiError(
        409,
        "INVALID_GRAPH",
        "Le graphe contient des erreurs bloquantes.",
      );
    db.update(storyVersions)
      .set({
        status: "validated",
        validatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(storyVersions.id, versionId))
      .run();
    return Response.json({ status: "validated", validation });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
