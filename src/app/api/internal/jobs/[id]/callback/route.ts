import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiErrorResponse, readText } from "@/server/api/response";
import { db } from "@/server/db";
import { generationJobs, storyVersions } from "@/server/db/schema";
import { verifySignedN8nRequest } from "@/server/security/n8n-auth";

const schema = z.object({
  status: z.enum(["completed", "failed"]),
  error: z.string().max(4000).optional(),
});

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const raw = await readText(request, 64_000);
    verifySignedN8nRequest(request, raw);
    const input = schema.parse(JSON.parse(raw));
    const id = (await context.params).id;
    const job = db
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.id, id))
      .get();
    if (!job) throw new Error("Travail n8n introuvable.");
    db.transaction((tx) => {
      tx.update(generationJobs)
        .set({
          status: input.status,
          progress: input.status === "completed" ? 100 : undefined,
          error: input.error,
          updatedAt: new Date(),
        })
        .where(eq(generationJobs.id, id))
        .run();
      if (input.status === "failed")
        tx.update(storyVersions)
          .set({ status: "failed", updatedAt: new Date() })
          .where(eq(storyVersions.id, job.versionId))
          .run();
    });
    return Response.json({ success: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
