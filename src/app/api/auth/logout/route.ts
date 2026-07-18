import { destroySession, requireMutationSession } from "@/server/auth/session";
import { apiErrorResponse } from "@/server/api/response";

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    await destroySession();
    return Response.json({ authenticated: false });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
