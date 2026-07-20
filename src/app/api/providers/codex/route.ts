import { requireMutationSession, requireSession } from "@/server/auth/session";
import { apiErrorResponse, readJson } from "@/server/api/response";
import {
  getCodexLoginStatus,
  logoutCodex,
  startCodexDeviceLogin,
} from "@/server/providers/codex";

export async function GET() {
  try {
    await requireSession();
    return Response.json(await getCodexLoginStatus());
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const input = (await readJson(request)) as { action?: string };
    if (input.action === "logout") return Response.json(await logoutCodex());
    return Response.json(await startCodexDeviceLogin());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
