import { scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
const derive = promisify(scrypt);
const unavailable = () => { throw Object.assign(new Error('Private employee credentials must be provisioned before production activation'), { status: 503 }); };
export function requireEmployeeCredentialConfiguration(id, env = process.env) {
  let verifier;
  if (env.PORTAL_EMPLOYEE_PASSWORD_VERIFIERS) {
    try { verifier = JSON.parse(env.PORTAL_EMPLOYEE_PASSWORD_VERIFIERS)?.[id]; } catch { unavailable(); }
  }
  if (verifier?.algorithm !== 'scrypt-v1' || !/^[a-f0-9]{64}$/.test(verifier.salt || '') || !/^[a-f0-9]{128}$/.test(verifier.hash || '')) unavailable();
}
export async function verifyEmployeeCredential(id, password, legacyMatch, env = process.env) {
  let registry;
  if (env.PORTAL_EMPLOYEE_PASSWORD_VERIFIERS) {
    try { registry = JSON.parse(env.PORTAL_EMPLOYEE_PASSWORD_VERIFIERS); } catch { unavailable(); }
  }
  const verifier = registry?.[id];
  if (!verifier) unavailable();
  if (verifier.algorithm !== 'scrypt-v1' || !/^[a-f0-9]{64}$/.test(verifier.salt || '') || !/^[a-f0-9]{128}$/.test(verifier.hash || '')) unavailable();
  // An exposed credential is not made private by hashing it with a fresh salt.
  if (legacyMatch) return false;
  const actual = await derive(password, Buffer.from(verifier.salt, 'hex'), 64, { N: 16384, r: 8, p: 1, maxmem: 33554432 });
  return timingSafeEqual(actual, Buffer.from(verifier.hash, 'hex'));
}
