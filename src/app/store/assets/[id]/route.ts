import fs from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { apiErrorResponse, ApiError } from "@/server/api/response";
import { db } from "@/server/db";
import { generatedAssets, stories, storyVersions } from "@/server/db/schema";
import { requireStoreKey } from "@/server/store/auth";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    requireStoreKey(request);
    const row = db
      .select({ asset: generatedAssets })
      .from(generatedAssets)
      .innerJoin(storyVersions, eq(generatedAssets.versionId, storyVersions.id))
      .innerJoin(
        stories,
        and(
          eq(storyVersions.storyId, stories.id),
          eq(stories.activeVersionId, storyVersions.id),
        ),
      )
      .where(
        and(
          eq(generatedAssets.id, (await context.params).id),
          eq(storyVersions.status, "published"),
          isNull(stories.deletedAt),
        ),
      )
      .get();
    const asset = row?.asset;
    if (
      !asset ||
      !["pack", "cover"].includes(asset.type) ||
      !fs.existsSync(asset.path)
    )
      throw new ApiError(404, "ASSET_NOT_FOUND", "Fichier introuvable.");
    const stream = fs.createReadStream(asset.path);
    return new Response(stream as unknown as BodyInit, {
      headers: {
        "content-type": asset.mimeType,
        "content-length": String(asset.bytes),
        "content-disposition":
          asset.type === "pack"
            ? `attachment; filename="${asset.id}.zip"`
            : "inline",
        "cache-control": "private, no-store",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
      },
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
