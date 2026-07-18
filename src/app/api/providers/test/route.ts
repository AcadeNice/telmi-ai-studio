import OpenAI from "openai";
import { z } from "zod";
import { requireMutationSession } from "@/server/auth/session";
import { apiErrorResponse, readJson } from "@/server/api/response";

const schema = z.object({
  type: z.enum(["text", "image", "tts"]),
  apiKey: z.string().min(1),
  baseUrl: z.url().optional(),
});

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    if (input.type === "tts") {
      const baseUrl = (input.baseUrl ?? "https://api.elevenlabs.io/v1").replace(
        /\/+$/,
        "",
      );
      const response = await fetch(`${baseUrl}/voices`, {
        headers: { "xi-api-key": input.apiKey },
      });
      return Response.json({ ok: response.ok, status: response.status });
    }
    const client = new OpenAI({ apiKey: input.apiKey, baseURL: input.baseUrl });
    await client.models.list();
    return Response.json({ ok: true });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
