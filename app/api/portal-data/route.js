import { readJsonBody } from '@/lib/portal-http.mjs';
import { requireUser, apiError } from '@/lib/server/auth';
import { serverDb } from '@/lib/server/firebase';
import { FieldValue, Filter } from 'firebase-admin/firestore';
import { createPortalDataService } from '@/lib/portal-data-service.mjs';
export const runtime = 'nodejs';
export async function POST(request) {
  try {
    const user = await requireUser(request);
    const body = await readJsonBody(request, 4 * 1024 * 1024);
    const service = createPortalDataService({ db: await serverDb(), Filter, stamp: () => FieldValue.serverTimestamp() });
    return Response.json(await service(user, body), { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) { return apiError(error); }
}
