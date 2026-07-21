import { z } from "zod";
import { requireMutationSession, requireSession } from "@/server/auth/session";
import { ApiError, apiErrorResponse, readJson } from "@/server/api/response";
import {
  getClaudeLoginStatus,
  logoutClaude,
  startClaudeLogin,
  submitClaudeLoginCode,
} from "@/server/providers/claude";

const schema = z.object({
  action: z.enum(["start", "code", "logout"]).default("start"),
  code: z.string().trim().min(4).max(2_000).optional(),
});

export async function GET() {
  try {
    await requireSession();
    return Response.json(await getClaudeLoginStatus());
  } catch (error) {
    return apiErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireMutationSession(request);
    const input = schema.parse(await readJson(request));
    if (input.action === "logout") return Response.json(await logoutClaude());
    if (input.action === "code") {
      if (!input.code)
        throw new ApiError(
          400,
          "CLAUDE_CODE_REQUIRED",
          "Collez le code d’autorisation Claude.",
        );
      return Response.json(await submitClaudeLoginCode(input.code));
    }
    return Response.json(await startClaudeLogin());
  } catch (error) {
    return apiErrorResponse(error);
  }
}
