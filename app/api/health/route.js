export async function GET() {
  return Response.json({
    ok: true,
    service: "attendanceportal",
    timestamp: new Date().toISOString(),
  });
}
