import { readJsonBody } from '@/lib/portal-http.mjs';
import { loginQuotaCooldown } from '@/lib/server/login-quota.mjs';
import { withLoginDeadline } from '@/lib/server/login-deadline.mjs';
import { scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import hashes from '@/lib/server/legacy-password-hashes.json';
import { employees } from '@/utils/constants';
import { requireSessionConfiguration, sessionUser, setSession } from '@/lib/server/auth';
import { publicUser, safeSessionError } from '@/lib/public-user.mjs';
import { serverDb } from '@/lib/server/firebase';
import { verifyEmployeeCredential, requireEmployeeCredentialConfiguration } from '@/lib/employee-credentials.mjs';
import { verifyPrivateManagerPassword, requireManagerCredentialConfiguration } from '@/lib/manager-auth.mjs';
export const runtime = 'nodejs';
export async function GET() { try { return Response.json({ user: publicUser(await sessionUser()) }, { headers: { 'Cache-Control': 'no-store' } }); } catch (error) { return safeSessionError(error); } }
export async function DELETE(request) { try { if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return safeSessionError({ status: 403 }); (await cookies()).delete('nts_session'); return Response.json({ success: true }); } catch (error) { return safeSessionError(error); } }
export async function POST(request) {
 let stage = 'SESSION_CONFIGURATION';
 try {
  if (request.headers.get('origin') !== new URL(request.url).origin || request.headers.get('sec-fetch-site') === 'cross-site') return Response.json({ success: false }, { status: 403 });
  const { employeeId, password } = await readJsonBody(request, 4096);
  const id = String(employeeId || '').trim().toUpperCase();
  if (typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) return Response.json({ success: false }, { status: 400 });
  requireSessionConfiguration();
  const user = employees.find(e => e.id === id);
  if (!user) return Response.json({ success: false, message: 'Invalid Employee ID or password' }, { status: 401 });
  if (id === 'NTS-MGR') requireManagerCredentialConfiguration(); else requireEmployeeCredentialConfiguration(id);
  loginQuotaCooldown.check();
  const expiresAt = Date.now() + 10000;
  const wait = operation => withLoginDeadline(operation, expiresAt - Date.now());
  stage = 'FIREBASE_ADMIN_INITIALIZATION';
  const db = await wait(serverDb()); const ref = db.collection('loginAttempts').doc(id.replace(/[^A-Z0-9-]/g, '_').slice(0,80) || 'unknown');
  stage = 'FIRESTORE_LOGIN_ATTEMPT';
  await wait(db.runTransaction(async tx => { const snap = await tx.get(ref); const prior = snap.data(); if (prior?.until > Date.now() && prior.count >= 10) throw Object.assign(new Error('Too many attempts; try again later'), {status:429}); tx.set(ref, {count: prior?.until > Date.now() ? prior.count + 1 : 1, until: prior?.until > Date.now() ? prior.until : Date.now()+900000}); }, { maxAttempts: 1 }));
  stage = 'PASSWORD_VERIFICATION';
  const expected = hashes[id]; const actual = scryptSync(password, id, 64);
  const legacyMatch = typeof expected === 'string' && /^[a-f0-9]{128}$/.test(expected) && timingSafeEqual(actual, Buffer.from(expected, 'hex'));
  // The manager's exposed legacy credential can never authorize any portal API.
  const verified = id === 'NTS-MGR' ? !legacyMatch && await verifyPrivateManagerPassword(password) : await verifyEmployeeCredential(id, password, legacyMatch);
  if (!user || !verified) return Response.json({ success: false, message: 'Invalid Employee ID or password' }, { status: 401 });
  stage = 'FIRESTORE_LOGIN_RESET';
  await wait(ref.delete());
  stage = 'SESSION_COOKIE';
  await setSession(id); return Response.json({ success: true, user: publicUser({ ...user, role: user.id === 'NTS-MGR' ? 'manager' : 'employee' }) }, { headers: { 'Cache-Control': 'no-store' } });
 } catch (error) {
  if (error.code === 8 || error.code === 'resource-exhausted' || error.code === 'LOGIN_FIRESTORE_QUOTA_EXCEEDED') {
   if (error.code !== 'LOGIN_FIRESTORE_QUOTA_EXCEEDED') loginQuotaCooldown.block();
   return Response.json({
    error: 'Firestore quota exceeded. The project administrator must resolve the database quota before sign-in can complete.',
    code: 'LOGIN_FIRESTORE_QUOTA_EXCEEDED',
   }, { status: 503 });
  }
  if (error.status && error.status !== 503) return safeSessionError(error);
  // Only fixed phase names and sanitized errors are returned, never SDK details.
  return Response.json({
   error: 'Sign-in service unavailable. Please contact the administrator.',
   code: `LOGIN_${stage}_UNAVAILABLE`,
  }, { status: 503 });
 }
}
