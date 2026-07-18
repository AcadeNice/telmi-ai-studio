import { NextResponse } from "next/server";
import { ensureDatabase } from "@/server/db";

export const dynamic = "force-dynamic";

export function GET() {
  ensureDatabase();
  return NextResponse.json({
    status: "ok",
    service: "telmi-ai-studio",
    version: "0.1.0",
  });
}
