import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { establishManagerSession } from '../lib/manager-login.mjs';
import { safeAttendanceEvidenceCode } from '../lib/attendance-view.mjs';

function fixture({ accepted=true }={}) {
 const requests=[];
 return {requests,deps:{fetcher:async(path,options)=>{requests.push({path,options});return Response.json({authenticated:accepted,employeeId:'NTS-MGR',...(!accepted?{error:'Manager attendance is not activated'}:{})},{status:accepted?200:503});}}};
}
test('existing login sends only the private password to same-origin server session endpoint',async()=>{
 const f=fixture();await establishManagerSession('offline-private',f.deps);
 assert.equal(f.requests.length,1);const request=f.requests[0];assert.deepEqual(JSON.parse(request.options.body),{password:'offline-private'});
 assert.equal(request.options.credentials,'same-origin');assert.ok(request.options.signal);
});
test('disabled or rejected session never reports success',async()=>{
 const denied=fixture({accepted:false});await assert.rejects(establishManagerSession('offline',denied.deps),/not activated/);
});
test('only manager login uses bridge; employee checks remain intact and no Firebase Auth is used',()=>{
 const source=readFileSync(new URL('../contexts/AuthContext.js',import.meta.url),'utf8');
 assert.match(source,/if \(employee.id === 'NTS-MGR'\)/);assert.match(source,/employee.id !== 'NTS-MGR' && employee.password !== password/);assert.doesNotMatch(source,/loginSession|readSession/);assert.match(source,/await establishManagerSession\(password\)/);
 assert.match(source,/attempt === loginGeneration.current/);assert.match(source,/attempt !== loginGeneration.current/);
 const bridge=readFileSync(new URL('../lib/manager-login.mjs',import.meta.url),'utf8');assert.doesNotMatch(bridge,/firebase|localStorage|console\./i);
 const server=readFileSync(new URL('../lib/server/manager-firebase.js',import.meta.url),'utf8');assert.doesNotMatch(server,/getAuth|firebase-admin\/auth/);
 const login=readFileSync(new URL('../components/Login.js',import.meta.url),'utf8');assert.match(login,/await login\(employeeId, password\)/);
});
test('evidence diagnostics expose only allowlisted error codes and preserve bounded query failure',()=>{
 assert.equal(safeAttendanceEvidenceCode({code:'firestore/failed-precondition'}),'failed-precondition');assert.equal(safeAttendanceEvidenceCode({code:'secret detail'}),'EVIDENCE_LOAD_FAILED');
 const source=readFileSync(new URL('../lib/firebase-helpers.js',import.meta.url),'utf8');assert.match(source,/catch \(cause\) \{ throw Object.assign/);assert.match(source,/evidenceCollection: name/);assert.match(source,/limit\(101\)/);
});
