import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { loginSession, readSession } from '../utils/sessionClient.mjs';

// Exercise the real initialization logic with injected SDK boundaries; no cloud IO.
const source = readFileSync(new URL('../lib/server/firebase.js', import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace('export async function serverDb', 'async function serverDb');
function harness(env = {}, { files = [], tokenFails = false, tokenDelay = 0, shared = {} } = {}) {
  const calls = { init: 0, token: 0, firestore: 0 };
  const apps = [];
  const db = {};
  const credential = { async getAccessToken() { calls.token++; if (tokenDelay) await new Promise(resolve => setTimeout(resolve, tokenDelay)); if (tokenFails) throw new Error('sensitive SDK error'); return {}; } };
  const args = { existsSync: file => files.includes(file), homedir: () => 'C:/test-user', path,
    applicationDefault: () => credential, cert: () => credential, getApps: () => apps,
    initializeApp: (options, name) => { calls.init++; const app = { name, options }; apps.push(app); return app; },
    getFirestore: () => { calls.firestore++; return db; }, process: { env, platform: 'win32' }, globalThis: shared };
  const load = () => new Function(...Object.keys(args), `${source}; return {serverDb};`)(...Object.values(args));
  return { ...load(), reload: load, calls, db };
}
test('missing/invalid credential configurations fail before Firestore starts', async () => {
  for (const env of [{}, { GOOGLE_APPLICATION_CREDENTIALS: 'absent.json' }, { FIREBASE_SERVICE_ACCOUNT_JSON: '{bad' }, { FIREBASE_SERVICE_ACCOUNT_JSON: '{}' }, { FIREBASE_PROJECT_ID: 'wrong', FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify({project_id:'expected',client_email:'test',private_key:'fixture'}) }]) {
    const h = harness(env);
    await assert.rejects(h.serverDb(), { status: 503, code: 'FIREBASE_ADMIN_CREDENTIALS_UNAVAILABLE' });
    assert.equal(h.calls.firestore, 0);
    assert.equal(h.calls.init, 0);
  }
});
test('credential preflight failure is caught, cooled down, and never starts Firestore', async () => {
  const h = harness({ FIREBASE_USE_ADC: 'true' }, { tokenFails: true });
  await Promise.all(Array.from({ length: 5 }, () => assert.rejects(h.serverDb(), error => error.status === 503 && !error.message.includes('sensitive'))));
  assert.equal(h.calls.token, 1);
  assert.equal(h.calls.firestore, 0);
  await assert.rejects(h.serverDb(), { status: 503 });
  assert.equal(h.calls.token, 1);
});
test('ADC modes and service account support hot reload without duplicate initialization', async () => {
  for (const env of [{FIREBASE_USE_ADC:'true'}, {K_SERVICE:'managed'}, {GOOGLE_APPLICATION_CREDENTIALS:'authorized-adc.json'}, {APPDATA:'C:/appdata'}, {FIREBASE_SERVICE_ACCOUNT_JSON:JSON.stringify({project_id:'existing-project',client_email:'fixture',private_key:'fixture'})}]) {
    const h=harness(env,{files:['authorized-adc.json',path.join('C:/appdata','gcloud','application_default_credentials.json')],tokenDelay:5});
    const results=await Promise.all([h.serverDb(),h.serverDb(),h.serverDb()]);
    assert.ok(results.every(result=>result===h.db));
    assert.equal(await h.reload().serverDb(), h.db);
    assert.deepEqual(h.calls,{init:1,token:1,firestore:1});
  }
});
test('concurrent login/read requests are deduplicated and failures do not retry', async () => {
  const original=globalThis.fetch;
  let calls=0;
  globalThis.fetch=async()=>{calls++; await new Promise(resolve=>setTimeout(resolve,5)); return {ok:false,json:async()=>({error:'Authentication service unavailable'})};};
  try {
    const results=await Promise.all([loginSession('NTS-MGR','fixture'),loginSession('NTS-MGR','fixture'),loginSession('NTS-MGR','fixture')]);
    assert.equal(calls,1); assert.ok(results.every(result=>result.success===false));
    await new Promise(resolve=>setTimeout(resolve,20));assert.equal(calls,1);
    await Promise.all([readSession(),readSession()]);assert.equal(calls,2);
    await loginSession('NTS-MGR','fixture');assert.equal(calls,3);
    globalThis.fetch=async()=>{calls++;throw new Error('network failure');};
    assert.equal((await loginSession('NTS-MGR','fixture')).success,false);
  } finally { globalThis.fetch=original; }
});
