import test from 'node:test';
import assert from 'node:assert/strict';
import { scryptSync } from 'node:crypto';
import { createManagerCredentialAuth, exchangeManagerPassword, verifyManagerSession, SESSION_MS } from '../lib/manager-auth.mjs';
import { createManagerApi } from '../lib/manager-api.mjs';

const password='offline-private-credential';
const salt='cd'.repeat(32);
const verifier=JSON.stringify({algorithm:'scrypt-v1',salt,hash:scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')});
const env={NODE_ENV:'production',MANAGER_ATTENDANCE_ENABLED:'true',MANAGER_ATTENDANCE_STORAGE_APPROVED:'true',MANAGER_ATTENDANCE_ORIGIN:'https://portal.example',MANAGER_ATTENDANCE_SESSION_SECRET:'offline-session-key-with-at-least-32-bytes',MANAGER_ATTENDANCE_PASSWORD_VERIFIER:verifier};
function database({fail=false}={}) {
 let row, tail=Promise.resolve(); const reads=[],writes=[];
 const db={collection:name=>({doc:id=>({name,id})}),runTransaction:callback=>{
  const work=tail.then(async()=>{let next;const result=await callback({get:async ref=>{reads.push(ref);if(fail)throw Error('private database failure');return {data:()=>row};},set:(ref,value)=>{writes.push(ref);next=value;}});if(next)row=next;return result;});tail=work.catch(()=>{});return work;
 }};
 return {db,reads,writes};
}
const request=(body,origin=env.MANAGER_ATTENDANCE_ORIGIN)=>new Request(env.MANAGER_ATTENDANCE_ORIGIN+'/api/manager-attendance/session',{method:'POST',headers:{origin,'Content-Type':'application/json'},body:JSON.stringify(body)});
test('private password succeeds without Firebase Auth; public and invalid passwords cannot authenticate',async()=>{
 const f=database(),auth=createManagerCredentialAuth(f.db,'public-legacy');
 const session=await exchangeManagerPassword(auth,password,env,100000);
 assert.deepEqual(await verifyManagerSession(session.cookie,env,100001),{uid:'manager-credential:NTS-MGR',employeeId:'NTS-MGR'});
 await assert.rejects(exchangeManagerPassword(auth,'wrong',env,100002),{status:401});
 const rejectsPublic=createManagerCredentialAuth(f.db,password);
 await assert.rejects(exchangeManagerPassword(rejectsPublic,password,env,100003),{status:401});
 assert.ok(f.reads.every(ref=>ref.name==='managerAttendanceState'&&ref.id==='NTS-MGR_auth_attempts'));
});
test('sessions reject tampering, expiration, future issuance, secret rotation and verifier rotation',async()=>{
 const auth=createManagerCredentialAuth(database().db,'public');
 const {cookie}=await exchangeManagerPassword(auth,password,env,100000);
 for(const [token,settings,now] of [[cookie+'x',env,100001],[cookie,env,100000+SESSION_MS],[cookie,env,99999],[cookie,{...env,MANAGER_ATTENDANCE_SESSION_SECRET:'different-offline-secret-at-least-32-bytes'},100001],[cookie,{...env,MANAGER_ATTENDANCE_PASSWORD_VERIFIER:JSON.stringify({...JSON.parse(verifier),salt:'ef'.repeat(32)})},100001],['old-firebase-session',env,100001]])await assert.rejects(verifyManagerSession(token,settings,now),{status:401});
});
test('distributed attempt reservations allow only five concurrent logins and expire after 15 minutes',async()=>{
 const f=database(),auth=createManagerCredentialAuth(f.db,'public');
 const results=await Promise.allSettled(Array.from({length:8},()=>auth.reserveAttempt(100000)));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,5);assert.equal(results.filter(r=>r.status==='rejected'&&r.reason.status===429).length,3);
 await auth.reserveAttempt(100000+900000);assert.equal(f.writes.length,6);
});
test('missing private configuration fails closed before DB access; CSRF and old token exchange are rejected',async()=>{
 let services=0;
 for(const settings of [{...env,MANAGER_ATTENDANCE_PASSWORD_VERIFIER:undefined},{...env,MANAGER_ATTENDANCE_SESSION_SECRET:undefined},{...env,MANAGER_ATTENDANCE_PASSWORD_VERIFIER:'bad'}]){
 const api=createManagerApi({env:settings,services:async()=>{services++;throw Error('must not initialize');}});const response=await api(request({password}));assert.equal(response.status,503);assert.equal(response.headers.get('set-cookie'),null);
 }
 assert.equal(services,0);
 const auth=createManagerCredentialAuth(database().db,'public'),api=createManagerApi({env,services:async()=>({auth})});
 assert.equal((await api(request({password},'https://other.example'))).status,403);
 assert.equal((await api(request({password,employeeId:'NTS-MGR'}))).status,400);
 assert.equal((await api(request({idToken:'legacy-token'}))).status,400);
});
test('database failures cannot issue cookie or expose SDK details; success returns only allowlisted fields',async()=>{
 const auth=createManagerCredentialAuth(database({fail:true}).db,'public');
 const api=createManagerApi({env,services:async()=>({auth})});
 const failed=await api(request({password}));assert.equal(failed.status,503);assert.equal(failed.headers.get('set-cookie'),null);assert.doesNotMatch(await failed.text(),/private database/);
 const good=createManagerApi({env,services:async()=>({auth:createManagerCredentialAuth(database().db,'public')})});
 const response=await good(request({password}));assert.equal(response.status,200);
 const body=await response.json();assert.deepEqual(Object.keys(body).sort(),['applyEnabled','authenticated','employeeId']);assert.doesNotMatch(JSON.stringify(body),/hash|salt|secret|password|uid/);
 const cookie=response.headers.get('set-cookie');for(const flag of ['HttpOnly','Secure','SameSite=Strict','Max-Age=3600','Path=/api/manager-attendance'])assert.ok(cookie.includes(flag));
});
