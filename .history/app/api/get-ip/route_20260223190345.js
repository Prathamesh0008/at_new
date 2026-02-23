import { NextResponse } from "next/server";

export async function GET(request) {
  let ip =
    request.headers.get("x-forwarded-for")?.split(",")[0].trim() ||
    request.ip ||
    "Unknown";

  if (ip.startsWith("::ffff:")) {
    ip = ip.replace("::ffff:", "");
  }

  console.log("🔥 Detected IP:", ip);  // ADD THIS

 return NextResponse.json({ ip });
}

