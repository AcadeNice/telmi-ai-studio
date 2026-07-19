import { and, eq } from "drizzle-orm";
import { z } from "zod";
import {
  creationParametersSchema,
  narrativeStorySchema,
  type NarrativeChoice,
  type NarrativeScene,
} from "@/lib/narrative/schema";
import { validateNarrativeGraph } from "@/lib/narrative/validator";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import { db } from "@/server/db";
import { scenes, storyVersions } from "@/server/db/schema";
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
    const creationParameters = creationParametersSchema.parse(
      JSON.parse(version.parametersJson),
    );
    return Response.json({
      narrative,
      validation: validateNarrativeGraph(narrative),
      graphLayoutSaved: creationParameters.graphLayoutSaved ?? false,
      preservedSceneIds: creationParameters.preservedSceneIds ?? [],
      preservedChoiceIds: creationParameters.preservedChoiceIds ?? [],
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
    const previousNarrative = loadNarrative(versionId);
    const creationParameters = creationParametersSchema.parse(
      JSON.parse(version.parametersJson),
    );
    const changedSceneIds = previousNarrative
      ? narrative.scenes
          .filter((scene) =>
            sceneWasEdited(
              previousNarrative.scenes.find((item) => item.id === scene.id),
              scene,
            ),
          )
          .map((scene) => scene.id)
      : narrative.scenes.map((scene) => scene.id);
    const changedChoiceIds = previousNarrative
      ? narrative.choices
          .filter((choice) =>
            choiceWasEdited(
              previousNarrative.choices.find((item) => item.id === choice.id),
              choice,
            ),
          )
          .map((choice) => choice.id)
      : narrative.choices.map((choice) => choice.id);
    const preservedSceneIds = [
      ...new Set([
        ...(creationParameters.preservedSceneIds ?? []),
        ...changedSceneIds,
      ]),
    ];
    const preservedChoiceIds = [
      ...new Set([
        ...(creationParameters.preservedChoiceIds ?? []),
        ...changedChoiceIds,
      ]),
    ];
    const validation = validateNarrativeGraph(narrative);
    saveNarrative(versionId, narrative);
    db.update(storyVersions)
      .set({
        parametersJson: JSON.stringify({
          ...creationParameters,
          preservedSceneIds,
          preservedChoiceIds,
        }),
        updatedAt: new Date(),
      })
      .where(eq(storyVersions.id, versionId))
      .run();
    return Response.json({
      narrative,
      validation,
      preservedSceneIds,
      preservedChoiceIds,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

const layoutSchema = z.object({
  positions: z
    .array(
      z.object({
        id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
        position: z.object({
          x: z.number().finite().min(-100_000).max(100_000),
          y: z.number().finite().min(-100_000).max(100_000),
        }),
      }),
    )
    .min(1)
    .max(200),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const { id, versionId } = await params;
    const version = db
      .select()
      .from(storyVersions)
      .where(
        and(eq(storyVersions.id, versionId), eq(storyVersions.storyId, id)),
      )
      .get();
    if (!version) throw new ApiError(404, "NOT_FOUND", "Version introuvable.");

    const input = layoutSchema.parse(await readJson(request));
    const sceneRows = db
      .select({ id: scenes.id, key: scenes.key })
      .from(scenes)
      .where(eq(scenes.versionId, versionId))
      .all();
    const positionsByKey = new Map(
      input.positions.map((item) => [item.id, item.position]),
    );
    if (
      positionsByKey.size !== input.positions.length ||
      sceneRows.length !== positionsByKey.size ||
      sceneRows.some((scene) => !positionsByKey.has(scene.key))
    )
      throw new ApiError(
        400,
        "INVALID_LAYOUT",
        "La disposition doit contenir exactement toutes les scènes du scénario.",
      );

    const now = new Date();
    const creationParameters = creationParametersSchema.parse(
      JSON.parse(version.parametersJson),
    );
    db.transaction((tx) => {
      for (const scene of sceneRows) {
        const position = positionsByKey.get(scene.key)!;
        tx.update(scenes)
          .set({
            positionX: position.x,
            positionY: position.y,
            updatedAt: now,
          })
          .where(eq(scenes.id, scene.id))
          .run();
      }
      tx.update(storyVersions)
        .set({
          parametersJson: JSON.stringify({
            ...creationParameters,
            graphLayoutSaved: true,
          }),
          updatedAt: now,
        })
        .where(eq(storyVersions.id, versionId))
        .run();
    });

    return Response.json({ success: true, positions: input.positions });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

function sceneWasEdited(
  previous: NarrativeScene | undefined,
  next: NarrativeScene,
) {
  if (!previous) return true;
  return (
    previous.type !== next.type ||
    previous.title !== next.title ||
    previous.text !== next.text ||
    previous.imagePrompt !== next.imagePrompt ||
    previous.voiceId !== next.voiceId
  );
}

function choiceWasEdited(
  previous: NarrativeChoice | undefined,
  next: NarrativeChoice,
) {
  if (!previous) return true;
  return (
    previous.label !== next.label ||
    previous.sourceSceneId !== next.sourceSceneId ||
    previous.targetSceneId !== next.targetSceneId ||
    previous.order !== next.order
  );
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
