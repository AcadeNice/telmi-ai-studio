import packageJson from "../../../../../package.json";
import { apiErrorResponse } from "@/server/api/response";
import { requireSession } from "@/server/auth/session";

export async function GET() {
  try {
    await requireSession();
    const url =
      process.env.UPDATE_CHECK_URL ??
      "https://api.github.com/repos/Aca-Ludo/telmi-ai-studio/releases/latest";
    const response = await fetch(url, {
      headers: {
        accept: "application/vnd.github+json",
        "user-agent": "Telmi-AI-Studio",
      },
      cache: "no-store",
    });
    const payload = response.ok
      ? ((await response.json()) as { tag_name?: string; html_url?: string })
      : {};
    return Response.json({
      installed: packageJson.version,
      latest: payload.tag_name?.replace(/^v/, "") ?? null,
      releaseUrl: payload.html_url ?? null,
      updateAvailable:
        !!payload.tag_name &&
        payload.tag_name.replace(/^v/, "") !== packageJson.version,
      command: "docker compose pull && docker compose up -d",
    });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
