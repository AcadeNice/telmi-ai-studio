import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiErrorResponse, ApiError, readJson } from "@/server/api/response";
import { requireMutationSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { stories, storyVersions, usageRecords } from "@/server/db/schema";
import { randomUUID } from "node:crypto";
import { creationParametersSchema } from "@/lib/narrative/schema";
import { validateNarrativeGraph } from "@/lib/narrative/validator";
import { generateNarrative } from "@/server/providers/text";
import { getProviderConfig } from "@/server/providers/config";
import { loadNarrative, saveNarrative } from "@/server/stories/service";
import { writeAppLog } from "@/server/logging/app-log";

const requestSchema = z.object({
  mode: z.enum(["create", "refine"]).default("create"),
  instruction: z.string().trim().max(2_000).optional(),
  preserveSceneIds: z.array(z.string().min(1).max(64)).max(200).default([]),
  preserveChoiceIds: z.array(z.string().min(1).max(64)).max(500).default([]),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string; versionId: string }> },
) {
  try {
    await requireMutationSession(request);
    const { id, versionId } = await context.params;
    const row = db
      .select()
      .from(storyVersions)
      .where(eq(storyVersions.id, versionId))
      .get();
    if (!row || row.storyId !== id)
      throw new ApiError(404, "VERSION_NOT_FOUND", "Version introuvable.");
    if (row.status !== "draft")
      throw new ApiError(
        409,
        "IMMUTABLE_VERSION",
        "Seul un brouillon peut être régénéré.",
      );
    const input = requestSchema.parse(await readJson(request));
    const parameters = creationParametersSchema.parse(
      JSON.parse(row.parametersJson),
    );
    const currentNarrative =
      input.mode === "refine" ? loadNarrative(versionId) : undefined;
    if (input.mode === "refine" && !currentNarrative)
      throw new ApiError(
        404,
        "NARRATIVE_NOT_FOUND",
        "Aucun scénario à améliorer n’a été trouvé.",
      );
    const result = await generateNarrative(parameters, {
      currentNarrative: currentNarrative ?? undefined,
      instruction: input.instruction,
      preserveSceneIds: [
        ...new Set([
          ...(parameters.preservedSceneIds ?? []),
          ...input.preserveSceneIds,
        ]),
      ],
      preserveChoiceIds: [
        ...new Set([
          ...(parameters.preservedChoiceIds ?? []),
          ...input.preserveChoiceIds,
        ]),
      ],
    });
    const validation = validateNarrativeGraph(result.narrative);
    if (!validation.valid) {
      await writeAppLog("warning", "Graphe IA invalide après réparation", {
        issueCodes: validation.issues
          .filter((issue) => issue.severity === "error")
          .map((issue) => issue.code),
        metrics: validation.metrics,
      });
      throw new ApiError(
        422,
        "INVALID_AI_GRAPH",
        "Le fournisseur a produit un graphe invalide.",
        { graph: validation.issues.map((item) => item.message) },
      );
    }
    saveNarrative(versionId, result.narrative, result.raw);
    const textProvider = getProviderConfig("text").provider;
    const totalTokens = result.usage?.total_tokens ?? 0;
    const estimatedCostCents =
      textProvider.toLowerCase() === "codex"
        ? 0
        : Math.max(1, Math.ceil(totalTokens / 1000));
    db.insert(usageRecords)
      .values({
        id: randomUUID(),
        versionId,
        provider: textProvider,
        operation: "scenario",
        units: totalTokens,
        costCents: estimatedCostCents,
        createdAt: new Date(),
      })
      .run();
    db.update(storyVersions)
      .set({
        actualCostCents: estimatedCostCents,
        parametersJson: JSON.stringify({
          ...parameters,
          graphLayoutSaved: false,
        }),
        updatedAt: new Date(),
      })
      .where(eq(storyVersions.id, versionId))
      .run();
    db.update(stories)
      .set({
        title: result.narrative.title,
        description: result.narrative.description,
        age: result.narrative.age,
        updatedAt: new Date(),
      })
      .where(eq(stories.id, id))
      .run();
    return Response.json({
      narrative: result.narrative,
      validation,
      usage: result.usage,
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
