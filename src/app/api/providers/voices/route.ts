import { requireSession } from "@/server/auth/session";
import { apiErrorResponse } from "@/server/api/response";
import { listElevenLabsVoices } from "@/server/providers/elevenlabs";

export async function GET() {
  try {
    await requireSession();
    return Response.json({ list: await listElevenLabsVoices() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
