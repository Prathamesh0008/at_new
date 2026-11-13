import 'server-only';
import { cookies } from 'next/headers';
import { issuePortalSession, readPortalSession, PORTAL_SESSION_MS } from '../portal-session.mjs';
import { employees } from '@/utils/constants';
export function requireSessionConfiguration() {
  if (!process.env.SESSION_SECRET || Buffer.byteLength(process.env.SESSION_SECRET) < 32) throw Object.assign(
    new Error('Authentication service unavailable. Ask the administrator to configure SESSION_SECRET.'),
    { status: 503, code: 'SESSION_CONFIGURATION_UNAVAILABLE' }
  );
}
export async function sessionUser() {
  const id = readPortalSession((await cookies()).get('nts_session')?.value || '', process.env);
  const user = id ? employees.find(employee => employee.id === id) : null;
  return user ? { ...user, role: user.id === 'NTS-MGR' ? 'manager' : 'employee' } : null;
}
export async function setSession(id) {
  requireSessionConfiguration();
  (await cookies()).set('nts_session', issuePortalSession(id, process.env), { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'strict', path: '/', maxAge: PORTAL_SESSION_MS / 1000 });
}
export async function requireUser(request, admin = false) {
  const user = await sessionUser();
  if (!user) throw Object.assign(new Error('Authentication required'), { status: 401 });
  if (request && !['GET','HEAD'].includes(request.method) && (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site')) throw Object.assign(new Error('Invalid origin'), { status: 403 });
  if (admin && !(process.env.ATTENDANCE_ADMIN_IDS || '').split(',').map(x => x.trim()).includes(user.id)) throw Object.assign(new Error('Administrator access required'), { status: 403 });
  return user;
}
export function apiError(error) {
 const headers = { 'Cache-Control': 'no-store' };
 if (error.code === 8 || error.code === 'resource-exhausted') return Response.json({error:'Firestore quota exhausted; automatic reads paused.',code:'FIRESTORE_QUOTA_EXCEEDED'},{status:503,headers});
 if (error.code === 9 || error.code === 'failed-precondition') return Response.json({error:'A portal query requires an approved Firestore index. Contact the administrator.',code:'failed-precondition'},{status:503,headers});
 const status = [400,401,403,404,409,413,415,429,503].includes(error.status) ? error.status : 503;
 return Response.json({error:error.status ? error.message : 'Persistence unavailable; no success confirmed',code:error.status ? 'PORTAL_REQUEST_REJECTED' : 'PORTAL_SERVICE_UNAVAILABLE'},{status,headers});
}
