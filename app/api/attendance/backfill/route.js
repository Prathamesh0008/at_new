// Fail closed: tracked login provides no trusted server identity.
export function GET() {
  return Response.json({error:'Trusted server manager authentication required. Historical persistence is disabled.',code:'MANAGER_AUTH_BLOCKED'},{status:503,headers:{'Cache-Control':'no-store'}});
}
export const POST = GET;
