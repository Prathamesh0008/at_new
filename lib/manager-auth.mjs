import { createHmac, createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { fail, MANAGER_ID } from './manager-domain.mjs';
const derive = promisify(scrypt);
export const SESSION_COOKIE = 'nts_manager_attendance';
export const SESSION_PATH = '/api/manager-attendance';
export const SESSION_MS = 3600000;
export const CREDENTIAL_IDENTITY = Object.freeze({ uid: 'manager-credential:NTS-MGR', employeeId: MANAGER_ID });

function configuration(env) {
  const key = env.MANAGER_ATTENDANCE_SESSION_SECRET;
  if (typeof key !== 'string' || Buffer.byteLength(key) < 32) fail('Private manager session secret missing or invalid', 503);
  let verifier;
  try { verifier = JSON.parse(env.MANAGER_ATTENDANCE_PASSWORD_VERIFIER); } catch { fail('Private manager password verifier missing or invalid', 503); }
  if (verifier?.algorithm !== 'scrypt-v1' || !/^[a-f0-9]{64}$/.test(verifier.salt || '') || !/^[a-f0-9]{128}$/.test(verifier.hash || '')) fail('Private manager password verifier missing or invalid', 503);
  return { key, verifier, version: createHash('sha256').update(JSON.stringify(verifier)).digest('hex') };
}
export function requireEnabled(env = process.env) {
  if (env.MANAGER_ATTENDANCE_ENABLED !== 'true') fail('Manager attendance is not activated', 503);
  if (!env.MANAGER_ATTENDANCE_ORIGIN) fail('Manager authentication configuration missing', 503);
  let origin;
  try { origin = new URL(env.MANAGER_ATTENDANCE_ORIGIN); } catch { fail('Invalid manager attendance origin configuration', 503); }
  if (origin.origin !== env.MANAGER_ATTENDANCE_ORIGIN || (origin.protocol !== 'https:' && !(env.NODE_ENV !== 'production' && origin.hostname === 'localhost'))) fail('Invalid manager attendance origin configuration', 503);
  configuration(env);
}
export function sameOrigin(request, env = process.env) {
  requireEnabled(env);
  if (request.headers.get('origin') !== env.MANAGER_ATTENDANCE_ORIGIN || new URL(request.url).origin !== env.MANAGER_ATTENDANCE_ORIGIN || request.headers.get('sec-fetch-site') === 'cross-site') fail('Cross-site request refused', 403);
}
const signature = (body, key) => createHmac('sha256', key).update(body).digest('base64url');
export function requireManagerCredentialConfiguration(env = process.env) { configuration(env); }
export async function verifyPrivateManagerPassword(password, env = process.env) {
  if (typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) fail('Invalid manager credential', 400);
  const { verifier } = configuration(env);
  const actual = await derive(password, Buffer.from(verifier.salt, 'hex'), 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  return timingSafeEqual(actual, Buffer.from(verifier.hash, 'hex'));
}
export async function exchangeManagerPassword(auth, password, env = process.env, now = Date.now()) {
  requireEnabled(env);
  if (typeof password !== 'string' || !password || Buffer.byteLength(password) > 1024) fail('Invalid manager credential', 400);
  // Distributed, transactionally reserved attempts before expensive password work.
  await auth.reserveAttempt(now);
  const { key, verifier, version } = configuration(env);
  const actual = await derive(password, Buffer.from(verifier.salt, 'hex'), 64, { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });
  if (!timingSafeEqual(actual, Buffer.from(verifier.hash, 'hex')) || !auth.privatePasswordAllowed(password)) fail('Invalid manager credential', 401);
  const body = Buffer.from(JSON.stringify({ v: 1, sub: MANAGER_ID, iat: now, exp: now + SESSION_MS, nonce: randomBytes(24).toString('hex'), credentialVersion: version })).toString('base64url');
  return { identity: CREDENTIAL_IDENTITY, cookie: `${body}.${signature(body, key)}` };
}
export async function verifyManagerSession(cookie, env = process.env, now = Date.now()) {
  requireEnabled(env);
  if (typeof cookie !== 'string' || !cookie || cookie.length > 2000) fail('Manager sign-in required', 401);
  const { key, version } = configuration(env);
  const [body, supplied, extra] = cookie.split('.');
  const expected = signature(body || '', key);
  if (extra || !supplied || supplied.length !== expected.length || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) fail('Manager sign-in required', 401);
  let value;
  try { value = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { fail('Manager sign-in required', 401); }
  if (value.v !== 1 || value.sub !== MANAGER_ID || value.credentialVersion !== version || !Number.isSafeInteger(value.iat) || !Number.isSafeInteger(value.exp) || value.iat > now || value.exp !== value.iat + SESSION_MS || value.exp <= now || !/^[a-f0-9]{48}$/.test(value.nonce || '')) fail('Manager session expired or revoked; sign in again', 401);
  return CREDENTIAL_IDENTITY;
}

// One fixed manager document, no scans. Five attempts per 15-minute window,
// across server instances; failures never fall back to process-local throttling.
export function createManagerCredentialAuth(db, publicPassword) {
  return {
    privatePasswordAllowed: password => typeof publicPassword === 'function' ? publicPassword(password) : typeof publicPassword === 'string' && password !== publicPassword,
    async reserveAttempt(now) {
      const ref = db.collection('managerAttendanceState').doc('NTS-MGR_auth_attempts');
      await db.runTransaction(async tx => {
        const prior = (await tx.get(ref)).data();
        if (prior && (prior.employeeId !== MANAGER_ID || !Number.isSafeInteger(prior.count) || prior.count < 1 || !Number.isFinite(prior.until))) fail('Manager login throttle requires review', 503);
        const active = prior && prior.until > now;
        if (active && prior.count >= 5) fail('Manager sign-in temporarily locked. Retry after 15 minutes.', 429);
        tx.set(ref, { employeeId: MANAGER_ID, count: active ? prior.count + 1 : 1, until: active ? prior.until : now + 900000 });
      });
    },
  };
}
function secret(env) {
  const key = env.MANAGER_ATTENDANCE_REVIEW_SECRET;
  if (!key || Buffer.byteLength(key) < 32) fail('Historical review signing secret missing', 503);
  return key;
}
export function requireReviewConfiguration(env = process.env) { secret(env); }
export function signReview(data, env = process.env, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ ...data, expiresAt: now + 30 * 60000 })).toString('base64url');
  return `${body}.${createHmac('sha256', secret(env)).update(body).digest('base64url')}`;
}
export function readReview(token, identity, stage, env = process.env, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 6000) fail('Invalid review token', 400);
  const [body, signature, extra] = token.split('.');
  const expected = createHmac('sha256', secret(env)).update(body || '').digest('base64url');
  if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) fail('Invalid review signature', 403);
  let data;
  try { data = JSON.parse(Buffer.from(body, 'base64url').toString()); } catch { fail('Invalid review token', 400); }
  if (!Number.isFinite(data.expiresAt) || data.expiresAt <= now || data.uid !== identity.uid || data.stage !== stage || data.employeeId !== MANAGER_ID) fail('Review expired or belongs to another session', 403);
  return data;
}
