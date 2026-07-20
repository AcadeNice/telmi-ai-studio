import { requireSession } from "@/server/auth/session";
import { apiErrorResponse } from "@/server/api/response";
import { listTtsVoices } from "@/server/providers/tts";

export async function GET() {
  try {
    await requireSession();
    return Response.json({ list: await listTtsVoices() });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
