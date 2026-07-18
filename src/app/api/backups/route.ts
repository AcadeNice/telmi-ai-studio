import fs from "node:fs";
import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/server/api/response";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { db } from "@/server/db";
import { backups } from "@/server/db/schema";
import {
  createBackup,
  MAX_BACKUP_BYTES,
  restoreBackup,
} from "@/server/backups/service";

export async function GET(request: Request) {
  try {
    await requireSession();
    const id = new URL(request.url).searchParams.get("download");
    if (id) {
      const item = db.select().from(backups).where(eq(backups.id, id)).get();
      if (!item || !fs.existsSync(item.path))
        throw new ApiError(404, "BACKUP_NOT_FOUND", "Sauvegarde introuvable.");
      return new Response(
        fs.createReadStream(item.path) as unknown as BodyInit,
        {
          headers: {
            "content-type": "application/octet-stream",
            "content-length": String(item.bytes),
            "content-disposition": `attachment; filename="${item.path.split("/").at(-1)}"`,
          },
        },
      );
    }
    return Response.json({
      list: db
        .select({
          id: backups.id,
          bytes: backups.bytes,
          createdAt: backups.createdAt,
        })
        .from(backups)
        .orderBy(desc(backups.createdAt))
        .all(),
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const declared = Number(request.headers.get("content-length") ?? 0);
    if (Number.isFinite(declared) && declared > MAX_BACKUP_BYTES + 1_000_000)
      throw new ApiError(
        413,
        "BACKUP_TOO_LARGE",
        "La sauvegarde dépasse 512 Mo.",
      );
    const form = await request.formData();
    const password = z.string().min(12).parse(form.get("password"));
    const action = z.enum(["create", "restore"]).parse(form.get("action"));
    if (action === "create") {
      const created = await createBackup(password);
      return Response.json(
        { id: created.id, bytes: created.bytes },
        { status: 201 },
      );
    }
    const file = form.get("file");
    if (!(file instanceof File) || file.size > MAX_BACKUP_BYTES)
      throw new ApiError(
        400,
        "INVALID_BACKUP",
        "Fichier de sauvegarde invalide.",
      );
    const result = await restoreBackup(
      Buffer.from(await file.arrayBuffer()),
      password,
    );
    setTimeout(() => process.exit(0), 500);
    return Response.json(result);
  } catch (error) {
    return apiErrorResponse(error);
  }
}
