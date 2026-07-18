import { z } from "zod";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { apiErrorResponse, readJson } from "@/server/api/response";
import { creationParametersSchema } from "@/lib/narrative/schema";
import { createStory, listStories } from "@/server/stories/service";

const createSchema = z.object({
  title: z.string().trim().min(1).max(180),
  description: z.string().trim().max(1000).default(""),
  age: z.number().int().min(2).max(12),
  parameters: creationParametersSchema,
});

export async function GET(request: Request) {
  try {
    await requireSession();
    const includeDeleted =
      new URL(request.url).searchParams.get("deleted") === "true";
    return Response.json({ list: listStories(includeDeleted) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const input = createSchema.parse(await readJson(request));
    return Response.json(createStory(input), { status: 201 });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
