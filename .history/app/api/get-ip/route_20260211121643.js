import { NextResponse } from "next/server";

export async function GET(request) {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded
    ? forwarded.split(",")[0].trim()
    : request.ip || "Unknown";

  return NextResponse.json({ ip });
}
