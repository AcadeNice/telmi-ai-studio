import fs from "node:fs";
import { eq } from "drizzle-orm";
import { ApiError, apiErrorResponse } from "@/server/api/response";
import { requireSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { generatedAssets } from "@/server/db/schema";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    await requireSession();
    const asset = db
      .select()
      .from(generatedAssets)
      .where(eq(generatedAssets.id, (await context.params).id))
      .get();
    if (
      !asset ||
      !["cover", "image", "title_image", "title_audio", "audio"].includes(
        asset.type,
      ) ||
      !fs.existsSync(asset.path)
    )
      throw new ApiError(404, "ASSET_NOT_FOUND", "Média introuvable.");

    const size = fs.statSync(asset.path).size;
    const range = request.headers.get("range");
    const headers = {
      "accept-ranges": "bytes",
      "cache-control": "private, no-store",
      "content-disposition": `inline; filename="${asset.type}.${asset.mimeType === "audio/mpeg" ? "mp3" : "png"}"`,
      "content-type": asset.mimeType,
    };
    if (!range)
      return new Response(
        fs.createReadStream(asset.path) as unknown as BodyInit,
        {
          headers: { ...headers, "content-length": String(size) },
        },
      );

    const match = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!match)
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    const suffixLength = !match[1] && match[2] ? Number(match[2]) : null;
    const start =
      suffixLength === null
        ? Number(match[1])
        : Math.max(0, size - suffixLength);
    const end = suffixLength === null && match[2] ? Number(match[2]) : size - 1;
    if (start < 0 || end < start || end >= size)
      return new Response(null, {
        status: 416,
        headers: { "content-range": `bytes */${size}` },
      });
    return new Response(
      fs.createReadStream(asset.path, { start, end }) as unknown as BodyInit,
      {
        status: 206,
        headers: {
          ...headers,
          "content-length": String(end - start + 1),
          "content-range": `bytes ${start}-${end}/${size}`,
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
