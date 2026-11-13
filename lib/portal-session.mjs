import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const PORTAL_SESSION_MS = 12 * 3600000;
const version = (id, env) => createHash('sha256').update(id === 'NTS-MGR' ? env.MANAGER_ATTENDANCE_PASSWORD_VERIFIER || '' : env.PORTAL_EMPLOYEE_PASSWORD_VERIFIERS || 'unconfigured-private-credentials').digest('hex');
const signature = (value, env) => {
  if (typeof env.SESSION_SECRET !== 'string' || Buffer.byteLength(env.SESSION_SECRET) < 32) throw Object.assign(new Error('Private session configuration unavailable'), { status: 503 });
  return createHmac('sha256', env.SESSION_SECRET).update(value).digest('hex');
};
export function issuePortalSession(id, env = process.env, now = Date.now()) {
  const body = `${id}.${now + PORTAL_SESSION_MS}.${version(id, env)}.${randomBytes(16).toString('hex')}`;
  return `${body}.${signature(body, env)}`;
}
export function readPortalSession(token, env = process.env, now = Date.now()) {
  if (typeof token !== 'string' || token.length > 600) return null;
  const parts = token.split('.');
  if (parts.length !== 5) return null;
  const [id, expiry, credentialVersion, nonce, supplied] = parts, expires = Number(expiry);
  if (!/^[A-Z0-9-]{1,80}$/.test(id) || !Number.isSafeInteger(expires) || expires <= now || expires > now + PORTAL_SESSION_MS || credentialVersion !== version(id, env) || !/^[a-f0-9]{32}$/.test(nonce) || !/^[a-f0-9]{64}$/.test(supplied)) return null;
  const expected = signature(parts.slice(0,4).join('.'), env);
  return timingSafeEqual(Buffer.from(expected), Buffer.from(supplied)) ? id : null;
}
