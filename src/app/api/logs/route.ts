import { z } from "zod";
import { apiErrorResponse } from "@/server/api/response";
import { requireSession } from "@/server/auth/session";
import { readAppLogs } from "@/server/logging/app-log";

export async function GET(request: Request) {
  try {
    await requireSession();
    const limit = z.coerce
      .number()
      .int()
      .min(1)
      .max(1000)
      .catch(200)
      .parse(new URL(request.url).searchParams.get("limit") ?? 200);
    return Response.json({ list: await readAppLogs(limit) });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
