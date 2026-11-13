import { issuePortalSession, readPortalSession, PORTAL_SESSION_MS } from '../lib/portal-session.mjs';
import { verifyEmployeeCredential, requireEmployeeCredentialConfiguration } from '../lib/employee-credentials.mjs';
import { verifyPrivateManagerPassword, requireManagerCredentialConfiguration } from '../lib/manager-auth.mjs';
import { publicUser, safeSessionError } from '../lib/public-user.mjs';
import { readJsonBody } from '../lib/portal-http.mjs';
import { createLoginQuotaCooldown } from '../lib/server/login-quota.mjs';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { test } from 'node:test';
import { withLoginDeadline } from '../lib/server/login-deadline.mjs';

// Run the actual route/session functions with isolated cookies and Firestore.
// No credentials, network calls, or production account writes occur in this suite.
function fixture({ quota = false, production = false, locked = false } = {}) {
  const employees = [{ id: 'NTS-MGR', role: 'manager', name: 'Manager fixture' }, { id: 'NTS-005', role: 'agent', name: 'Employee fixture' }];
  const password = randomBytes(32).toString('hex');
  const hashes = Object.fromEntries(employees.map(user => [user.id, scryptSync('offline-old-public-credential', user.id, 64).toString('hex')]));
  const salt='ab'.repeat(32);
  const verifier={algorithm:'scrypt-v1',salt,hash:scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')};
  const env={SESSION_SECRET:randomBytes(32).toString('hex'),NODE_ENV:production?'production':'development',PORTAL_EMPLOYEE_PASSWORD_VERIFIERS:JSON.stringify({'NTS-005':verifier}),MANAGER_ATTENDANCE_PASSWORD_VERIFIER:JSON.stringify(verifier),MANAGER_ATTENDANCE_SESSION_SECRET:randomBytes(32).toString('hex')};
  const jar = new Map(); const writes = []; let reads = 0;
  const cookieStore = { get: key => jar.get(key), set: (key, value, options) => jar.set(key, { value, options }), delete: key => jar.delete(key) };
  const load = (file, deps, exports) => {
    const source = readFileSync(new URL(file, import.meta.url), 'utf8').replace(/^\uFEFF/, '').replace(/^import .*;\r?\n/gm, '').replaceAll('export ', '');
    return new Function(...Object.keys(deps), `${source}; return {${exports}};`)(...Object.values(deps));
  };
  const auth = load('../lib/server/auth.js', {
    cookies: async () => cookieStore, createHmac, timingSafeEqual, employees, issuePortalSession, readPortalSession, PORTAL_SESSION_MS,
    process: { env },
  }, 'sessionUser,setSession,requireUser,requireSessionConfiguration,apiError');
  const db = {
    collection: name => { assert.equal(name, 'loginAttempts'); return { doc: id => ({ id, delete: async () => writes.push({ action: 'delete', id }) }) }; },
    runTransaction: async callback => {
      const staged = [];
      const result = await callback({
        get: async () => { reads++; if (quota) throw Object.assign(new Error('Sensitive SDK detail must not escape'), { code: 8 }); return { data: () => locked ? { count: 10, until: Date.now() + 60000 } : undefined }; },
        set: (ref, data) => staged.push({ action: 'set', id: ref.id, data }),
      });
      writes.push(...staged); return result;
    },
  };
  const credentialDeps={readJsonBody,publicUser,safeSessionError,verifyPrivateManagerPassword:password=>verifyPrivateManagerPassword(password,env),requireManagerCredentialConfiguration:()=>requireManagerCredentialConfiguration(env),verifyEmployeeCredential:(id,password,legacy)=>verifyEmployeeCredential(id,password,legacy,env),requireEmployeeCredentialConfiguration:id=>requireEmployeeCredentialConfiguration(id,env)};
  const api = load('../app/api/session/route.js', { ...auth, ...credentialDeps, loginQuotaCooldown:createLoginQuotaCooldown(), cookies: async () => cookieStore, withLoginDeadline, scryptSync, timingSafeEqual, hashes, employees, serverDb: async () => db }, 'POST,GET,DELETE');
  const request = (employeeId, candidate = password, origin = 'http://localhost:3000') => new Request('http://localhost:3000/api/session', { method: 'POST', headers: { origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ employeeId, password: candidate }) });
  return { api, auth, request, jar, writes, employees, reads: () => reads };
}

test('manager and employee complete password verification, cookie creation, recovery and logout in isolation', async () => {
  for (const id of ['NTS-MGR', 'NTS-005']) {
    const f = fixture();
    const response = await f.api.POST(f.request(id));
    assert.equal(response.status, 200);
    const data = await response.json();
    assert.equal(data.success, true); assert.equal(data.user.id, id); assert.equal(data.user.password, undefined);
    assert.equal(data.user.role, id === 'NTS-MGR' ? 'manager' : 'employee');
    const cookie = f.jar.get('nts_session');
    assert.ok(cookie.value); assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.sameSite, 'strict'); assert.equal(cookie.options.secure, false);
    assert.equal((await f.auth.sessionUser()).id, id);
    assert.equal((await (await f.api.GET()).json()).user.id, id);
    await f.api.DELETE(new Request('http://localhost:3000/api/session',{method:'DELETE',headers:{origin:'http://localhost:3000'}})); assert.equal(await f.auth.sessionUser(), null);
    assert.ok(f.writes.every(write => write.id === id));
  }
});

test('invalid password, unknown account, cross-origin and rate-limited requests cannot issue sessions', async () => {
  for (const [id, password] of [['NTS-MGR', randomBytes(24).toString('hex')], ['UNKNOWN', randomBytes(24).toString('hex')]]) {
    const f = fixture(); assert.equal((await f.api.POST(f.request(id, password))).status, 401); assert.equal(f.jar.size, 0);
  }
  const f = fixture(); assert.equal((await f.api.POST(f.request('NTS-MGR', undefined, 'http://untrusted.example'))).status, 403); assert.equal(f.reads(), 0);
  const limited = fixture({ locked: true }); assert.equal((await limited.api.POST(limited.request('NTS-MGR'))).status, 429); assert.equal(limited.jar.size, 0);
});

test('Firestore quota exhaustion fails closed with a safe code before any cookie or staged write', async () => {
  const f = fixture({ quota: true });
  const response = await f.api.POST(f.request('NTS-MGR'));
  assert.equal(response.status, 503);
  const data = await response.json(); assert.equal(data.code, 'LOGIN_FIRESTORE_QUOTA_EXCEEDED'); assert.ok(!JSON.stringify(data).includes('Sensitive SDK'));
  assert.equal(f.jar.size, 0); assert.equal(f.writes.length, 0);
  const reads=f.reads();
  assert.equal((await f.api.POST(f.request('NTS-005'))).status,503);
  assert.equal(f.reads(),reads); // quota cooldown never bypasses auth or rereads Firestore
  assert.equal(f.jar.size,0);
});

test('production cookie is Secure and tampered/expired sessions are rejected', async () => {
  const f = fixture({ production: true }); await f.api.POST(f.request('NTS-MGR'));
  const cookie = f.jar.get('nts_session'); assert.equal(cookie.options.secure, true);
  f.jar.set('nts_session', { value: cookie.value.slice(0, -1) + (cookie.value.endsWith('a') ? 'b' : 'a') }); assert.equal(await f.auth.sessionUser(), null);
  f.jar.set('nts_session', { value: `NTS-MGR.1.${'a'.repeat(64)}` }); assert.equal(await f.auth.sessionUser(), null);
});
