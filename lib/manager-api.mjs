import { fail, managerIdentity, MANAGER_ID } from './manager-domain.mjs';
import { requireEnabled, sameOrigin, exchangeManagerPassword, verifyManagerSession, SESSION_COOKIE, SESSION_MS, SESSION_PATH, signReview, readReview, requireReviewConfiguration } from './manager-auth.mjs';
import { CONFIRM } from './manager-store.mjs';

const serializable = value => value?.toDate ? value.toDate().toISOString() : Array.isArray(value) ? value.map(serializable) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializable(item)])) : value;
const json = (value, status = 200, headers = {}) => Response.json(serializable(value), { status, headers: { 'Cache-Control': 'no-store', ...headers } });
function cookie(value, env, maxAge = SESSION_MS / 1000) {
  return `${SESSION_COOKIE}=${encodeURIComponent(value)}; Path=${SESSION_PATH}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${env.NODE_ENV === 'production' ? '; Secure' : ''}`;
}
async function bodyOf(request) {
  const reader = request.body?.getReader();
  if (!reader) fail('JSON body required', 400);
  const chunks = []; let size = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > 16000) { await reader.cancel(); fail('Request too large', 413); }
    chunks.push(value);
  }
  let body;
  try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { fail('Invalid JSON', 400); }
  if (!body || Array.isArray(body) || typeof body !== 'object') fail('Invalid body', 400);
  if (['employeeId', 'empId', 'role', 'uid', 'approvedBy', 'approvedAt'].some(key => key in body)) fail('Client identity and approval fields are not accepted', 400);
  return body;
}
function requireStorage(env) {
  if (env.MANAGER_ATTENDANCE_STORAGE_APPROVED !== 'true') fail('Manager storage protection has not been approved', 503);
}
function requireHistorical(env, apply = false) {
  requireStorage(env);
  if (env.MANAGER_LEGACY_HISTORY_RECONCILED !== 'true') fail('Legacy schema reconciliation and historical manager write freeze required', 503);
  if (apply && env.MANAGER_ATTENDANCE_APPLY_ENABLED !== 'true') fail('Historical application is disabled pending separate administrator activation', 503);
}
// All dependencies injected; tests exercise the exact handlers with no network SDK.
export function createManagerApi({ services, env = process.env }) {
  return async function handle(request) {
    try {
      const operation = new URL(request.url).pathname.split('/').at(-1);
      const method = request.method;
      if (!['capabilities', 'session', 'preview', 'approve', 'apply', 'verify', 'history', 'daily'].includes(operation)) return json({ error: 'Not found' }, 404);
      // Clear only this browser's HttpOnly cookie, even when the feature is disabled
      // or server credentials are missing. Never initialize Firebase for logout.
      if (operation === 'session' && method === 'DELETE') {
        const origin = new URL(request.url).origin;
        if (request.headers.get('origin') !== origin || request.headers.get('sec-fetch-site') === 'cross-site' || (env.MANAGER_ATTENDANCE_ORIGIN && env.MANAGER_ATTENDANCE_ORIGIN !== origin)) fail('Cross-site request refused', 403);
        return json({ success: true }, 200, { 'Set-Cookie': cookie('', env, 0) });
      }
      if (operation === 'capabilities' && method === 'GET') {
        if (env.MANAGER_ATTENDANCE_ENABLED !== 'true') return json({ enabled: false, applyEnabled: false });
        requireEnabled(env);
        return json({ enabled: true, applyEnabled: env.MANAGER_ATTENDANCE_APPLY_ENABLED === 'true' });
      }
      if (operation === 'session' && method === 'GET' && env.MANAGER_ATTENDANCE_ENABLED !== 'true') return json({ authenticated: false, enabled: false, applyEnabled: false });
      requireEnabled(env);
      if (!['GET', 'HEAD'].includes(method)) sameOrigin(request, env);
      const allowed = operation === 'session' ? ['GET', 'POST'] : operation === 'history' ? ['GET'] : operation === 'daily' ? ['GET', 'POST'] : ['POST'];
      if (!allowed.includes(method)) return json({ error: 'Method not allowed' }, 405);
      // The persistent credential throttle must be protected before any login writes.
      if (operation === 'session' && method === 'POST') requireStorage(env);
      const deps = await services();
      if (operation === 'session' && method === 'POST') {
        const body = await bodyOf(request);
        if (Object.keys(body).some(key => key !== 'password')) fail('Only a manager password is accepted', 400);
        const { cookie: value } = await exchangeManagerPassword(deps.auth, body.password, env);
        return json({ authenticated: true, employeeId: MANAGER_ID, applyEnabled: env.MANAGER_ATTENDANCE_APPLY_ENABLED === 'true' }, 200, { 'Set-Cookie': cookie(value, env) });
      }
      const raw = request.headers.get('cookie')?.split(';').map(s => s.trim()).find(s => s.startsWith(`${SESSION_COOKIE}=`))?.slice(SESSION_COOKIE.length + 1);
      let session;
      try { session = raw ? decodeURIComponent(raw) : ''; } catch { fail('Invalid session', 401); }
      const identity = await verifyManagerSession(session, env);
      managerIdentity(identity);
      if (operation === 'session') return json({ authenticated: true, employeeId: MANAGER_ID, applyEnabled: env.MANAGER_ATTENDANCE_APPLY_ENABLED === 'true' });
      requireStorage(env);
      if (operation === 'history') {
        const params = new URL(request.url).searchParams;
        return json(await deps.store.history(identity, params.get('month'), { dailyOnly: params.get('view') === 'daily', date: params.get('view') === 'daily' ? params.get('date') : null }));
      }
      if (operation === 'daily' && method === 'GET') return json(await deps.store.daily(identity));
      const body = await bodyOf(request);
      if (operation === 'daily') return json(await deps.store.daily(identity, body.action || fail('Action required', 400), body.breakType, undefined, body.command));
      requireHistorical(env, operation === 'apply');
      requireReviewConfiguration(env);
      if (operation === 'preview') {
        const preview = await deps.store.preview(identity, body.month);
        const token = signReview({ stage: 'preview', uid: identity.uid, employeeId: MANAGER_ID, month: body.month, fingerprint: preview.fingerprint }, env);
        return json({ ...preview, token });
      }
      if (operation === 'approve') {
        if (body.reviewed !== true || body.confirmation !== 'APPROVE NTS-MGR HISTORICAL ESTIMATES') fail('Explicit review and approval confirmation required', 400);
        const review = readReview(body.token, identity, 'preview', env);
        const approval = await deps.store.approve(identity, review, body.reason);
        return json({ ...approval, token: signReview({ ...approval, uid: identity.uid, employeeId: MANAGER_ID, stage: 'approved' }, env) });
      }
      const approval = readReview(body.token, identity, 'approved', env);
      if (operation === 'verify') return json(await deps.store.verify(identity, approval));
      return json(await deps.store.apply(identity, approval, body.confirmation === CONFIRM ? CONFIRM : ''));
    } catch (error) {
      const authFailure = typeof error.code === 'string' && error.code.startsWith('auth/');
      const quota = error.code === 8 || error.code === 'resource-exhausted';
      const status = error.status || (authFailure ? 401 : 503);
      return json({ error: error.status ? error.message : authFailure ? 'Manager authentication failed; sign in again' : quota ? 'Firestore quota unavailable; stop and retry manually later' : 'Manager service unavailable; no success confirmed. Verify state before retrying.' }, status);
    }
  };
}
