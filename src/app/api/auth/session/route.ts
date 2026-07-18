import { getSession } from "@/server/auth/session";
import { apiErrorResponse } from "@/server/api/response";

export async function GET() {
  try {
    const session = await getSession();
    return Response.json(
      session
        ? {
            authenticated: true,
            csrfToken: session.session.csrfToken,
            expiresAt: session.session.expiresAt,
          }
        : { authenticated: false },
    );
  } catch (error) {
    return apiErrorResponse(error);
  }
}
