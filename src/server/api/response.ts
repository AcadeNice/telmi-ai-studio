import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { writeAppLog } from "@/server/logging/app-log";

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
  }
}

export function apiErrorResponse(
  error: unknown,
  requestId = crypto.randomUUID(),
) {
  if (error instanceof ApiError)
    return NextResponse.json(
      {
        code: error.code,
        message: error.message,
        fieldErrors: error.fieldErrors,
        requestId,
      },
      { status: error.status },
    );
  if (error instanceof ZodError) {
    const flattened = error.flatten();
    return NextResponse.json(
      {
        code: "VALIDATION_ERROR",
        message: "Les données envoyées sont invalides.",
        fieldErrors: flattened.fieldErrors,
        requestId,
      },
      { status: 400 },
    );
  }
  console.error(`[${requestId}] Erreur API non gérée`);
  void writeAppLog("error", "Erreur API", {
    requestId,
    error: error instanceof Error ? error.message : String(error),
  });
  return NextResponse.json(
    {
      code: "INTERNAL_ERROR",
      message: "Une erreur interne est survenue.",
      requestId,
    },
    { status: 500 },
  );
}

export async function readJson(request: Request) {
  const raw = await readText(request);
  try {
    return JSON.parse(raw);
  } catch {
    throw new ApiError(400, "INVALID_JSON", "Le corps JSON est invalide.");
  }
}

export async function readText(request: Request, maxBytes = 2_000_000) {
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(declared) && declared > maxBytes)
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      "Le corps de la requête est trop volumineux.",
    );
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > maxBytes)
    throw new ApiError(
      413,
      "PAYLOAD_TOO_LARGE",
      "Le corps de la requête est trop volumineux.",
    );
  return raw;
}
