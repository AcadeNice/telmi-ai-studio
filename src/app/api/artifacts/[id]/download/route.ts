import fs from "node:fs";
import { eq } from "drizzle-orm";
import { apiErrorResponse, ApiError } from "@/server/api/response";
import { requireSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { generatedAssets } from "@/server/db/schema";

export async function GET(
  _: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const asset = db
      .select()
      .from(generatedAssets)
      .where(eq(generatedAssets.id, (await context.params).id))
      .get();
    if (!asset || !fs.existsSync(asset.path))
      throw new ApiError(404, "ASSET_NOT_FOUND", "Fichier introuvable.");
    return new Response(
      fs.createReadStream(asset.path) as unknown as BodyInit,
      {
        headers: {
          "content-type": asset.mimeType,
          "content-length": String(asset.bytes),
          "content-disposition": `attachment; filename="${asset.path.split("/").at(-1)}"`,
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
