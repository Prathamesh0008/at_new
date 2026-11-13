import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createPortalReads, pollVisible, portalDataPlan, mergeDateWindows, NOTIFICATION_INTERVAL_MS, BREAK_INTERVAL_MS } from '../lib/portal-read-policy.mjs';
import { publicUser, safeSessionError } from '../lib/public-user.mjs';
import { clearManagerBrowserSession, managerSignInAttempt, exchangeManagerBrowserSession } from '../utils/manager-logout.mjs';
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};

test('read cache deduplicates, expires and invalidates after mutations without overlap',async()=>{
 let clock=0,calls=0;const reads=createPortalReads({now:()=>clock});const gate=deferred();
 const first=reads.run('attendance',()=>{calls++;return gate.promise;});const second=reads.run('attendance',()=>{calls++;return 'wrong';});await flush();assert.equal(calls,1);
 reads.invalidate();const next=reads.run('attendance',()=>{calls++;return 'new';});await flush();assert.equal(calls,1);
 gate.resolve('old');assert.equal(await first,'old');assert.equal(await second,'old');assert.equal(await next,'new');assert.equal(calls,2);
 assert.equal(await reads.run('attendance',()=>{calls++;return 'wrong';}),'new');assert.equal(calls,2);
 clock=300001;assert.equal(await reads.run('attendance',()=>{calls++;return 'fresh';}),'fresh');assert.equal(calls,3);
});

test('quota errors latch across invalidations, queued reads and polling; hidden tabs do not read',async()=>{
 let calls=0,visible=false;const reads=createPortalReads({visible:()=>visible});
 await assert.rejects(()=>reads.run('hidden',()=>calls++),{code:'READ_PAUSED'});assert.equal(calls,0);visible=true;
 await assert.rejects(()=>reads.run('quota',()=>{calls++;throw Object.assign(Error('quota'),{code:'firestore/resource-exhausted'});}));
 reads.invalidate();await assert.rejects(()=>reads.run('retry',()=>calls++),{code:'resource-exhausted'});assert.equal(calls,1);
 const timers=[];let errors=0;const stop=pollVisible(()=>reads.run('poll',()=>calls++),30,{visible:()=>true,blocked:()=>reads.isBlocked(),schedule:fn=>timers.push(fn),onError:()=>errors++});await flush();assert.equal(timers.length,0);assert.equal(errors,0);stop();
});

test('polling waits for completion, pauses hidden reads and stops on quota/cleanup',async()=>{
 const timers=[];let visible=true,calls=0;const gate=deferred();const stop=pollVisible(()=>{calls++;return gate.promise;},30,{visible:()=>visible,blocked:()=>false,schedule:fn=>{timers.push(fn);return timers.length;},cancel:()=>{}});
 await flush();assert.equal(calls,1);assert.equal(timers.length,0);gate.resolve();await flush();assert.equal(timers.length,1);
 visible=false;await timers.shift()();assert.equal(calls,1);assert.equal(timers.length,1);stop();await timers.shift()();assert.equal(calls,1);
 let errors=0;const stopQuota=pollVisible(async()=>{throw Object.assign(Error('quota'),{code:'resource-exhausted'});},30,{visible:()=>true,blocked:()=>false,schedule:()=>{throw Error('must not reschedule');},onError:()=>errors++});await flush();assert.equal(errors,1);stopQuota();
});

test('tab plans preserve dashboard worksheets, salary data and complete on-demand exports',()=>{
 assert.equal(NOTIFICATION_INTERVAL_MS,60000);assert.equal(BREAK_INTERVAL_MS,30000);
 for(const role of ['manager','employee']){
  const dashboard=portalDataPlan(role,'dashboard');assert.ok(dashboard.attendance&&dashboard.breaks&&dashboard.worksheets);assert.equal(dashboard.salary,false);
  assert.equal(portalDataPlan(role,'profile').attendance,false);assert.equal(portalDataPlan(role,'salary').salary,true);
  const exports=portalDataPlan(role,'exports');assert.ok(exports.allHistory&&exports.worksheets&&exports.salary&&exports.attendance&&exports.breaks);
 }
 const windows=mergeDateWindows([{start:new Date('2026-01-01'),end:new Date('2026-01-31')},{start:new Date('2026-01-10'),end:new Date('2026-02-28')},{start:new Date('2026-11-01'),end:new Date('2026-11-30')},{start:new Date('invalid'),end:new Date()}]);assert.equal(windows.length,2);assert.ok(windows[0].end.startsWith('2026-02-28'));
});

test('session DTO strips unknown, nested and sensitive fields; errors never reflect internals',async()=>{
 const safe=publicUser({id:'fixture',name:'Person',role:'employee',password:'discard',hash:'discard',private_key:'discard',token:'discard',email:{password:'discard'}});
 assert.equal(safe.email,null);assert.equal(Object.keys(safe).length,8);for(const key of ['password','hash','private_key','token'])assert.equal(key in safe,false);
 for(const status of [400,401,403,429,503]){const response=safeSessionError({status,message:'private internal content'});assert.equal(response.status,status);assert.doesNotMatch(await response.text(),/private internal/);}
});

test('real experimental session GET/POST/error handlers return only safe fields with mocked dependencies',async()=>{
 let source=readFileSync(new URL('../app/api/session/route.js',import.meta.url),'utf8');
 const fixture="const offlineUser={id:'NTS-001',name:'Fixture',role:'employee',password:'discard',hash:'discard',token:'discard'};let offlineFail=false;";
 source=source.replace(/import \{ loginQuotaCooldown \}[^;]+;/,"const loginQuotaCooldown={check(){},block(){}};")
  .replace(/import \{ withLoginDeadline \}[^;]+;/,'const withLoginDeadline=operation=>operation;')
  .replace(/import \{ cookies \}[^;]+;/,"const cookies=async()=>({delete(){}});")
  .replace(/import hashes[^;]+;/,"const hashes={'NTS-001':scryptSync('fixture','NTS-001',64).toString('hex')};")
  .replace(/import \{ employees \}[^;]+;/,fixture+'const employees=[offlineUser];')
  .replace(/import \{ requireSessionConfiguration, sessionUser, setSession \}[^;]+;/,"const requireSessionConfiguration=()=>{if(offlineFail)throw Object.assign(Error('private internal content'),{status:503});};const sessionUser=async()=>{requireSessionConfiguration();return offlineUser;};const setSession=async()=>{};")
  .replace(/from '@\/lib\/public-user.mjs'/,"from '"+new URL('../lib/public-user.mjs',import.meta.url).href+"'")
  .replace(/import \{ serverDb \}[^;]+;/,"const serverDb=async()=>({collection:()=>({doc:()=>({delete:async()=>{}})}),runTransaction:async work=>work({get:async()=>({data:()=>null}),set(){}})});");
 source=source.replace(/import \{ readJsonBody \}[^;]+;/,"const readJsonBody=request=>request.json();").replace(/import \{ verifyEmployeeCredential, requireEmployeeCredentialConfiguration \}[^;]+;/,"const verifyEmployeeCredential=async(_id,_password,legacy)=>legacy,requireEmployeeCredentialConfiguration=()=>{};").replace(/import \{ verifyPrivateManagerPassword, requireManagerCredentialConfiguration \}[^;]+;/,"const verifyPrivateManagerPassword=async()=>false,requireManagerCredentialConfiguration=()=>{};");
 source+='\nexport function setOfflineFailure(value){offlineFail=value;}';
 const route=await import('data:text/javascript,'+encodeURIComponent(source));
 for(const response of [await route.GET(),await route.POST(new Request('https://portal.example/api/session',{method:'POST',headers:{origin:'https://portal.example','Content-Type':'application/json'},body:JSON.stringify({employeeId:'NTS-001',password:'fixture'})}))]){
  assert.equal(response.status,200);const payload=await response.json();assert.equal(payload.user.id,'NTS-001');assert.equal('password' in payload.user,false);assert.equal('hash' in payload.user,false);assert.equal('token' in payload.user,false);
 }
 route.setOfflineFailure(true);for(const response of [await route.GET(),await route.POST(new Request('https://portal.example/api/session',{method:'POST',headers:{origin:'https://portal.example','Content-Type':'application/json'},body:JSON.stringify({employeeId:'NTS-001',password:'fixture'})}))]){assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private internal content/);}
});

test('browser logout reports failure and serializes sign-in before cookie clearing',async()=>{
 await assert.rejects(()=>clearManagerBrowserSession(async()=>({ok:false})),/could not be confirmed/);
 const attempt=managerSignInAttempt(),gate=deferred(),order=[];
 const signIn=exchangeManagerBrowserSession(attempt,async()=>{order.push('exchange');await gate.promise;});await flush();
 const logout=clearManagerBrowserSession(async()=>{order.push('clear');return {ok:true};});await flush();assert.deepEqual(order,['exchange']);assert.throws(()=>managerSignInAttempt(),/in progress/);
 gate.resolve();await signIn;await logout;assert.deepEqual(order,['exchange','clear']);
 await assert.rejects(()=>exchangeManagerBrowserSession(attempt,async()=>{throw Error('must not start stale exchange');}),/cancelled/);
});

test('active portal has no broad refresh interval; summaries reuse rows and labels are explicit',()=>{
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');assert.doesNotMatch(source,/AUTO_SYNC_MS|setInterval\(loadNotifications|setInterval\(pollLiveBreaks|fetchPendingCounts/);
 assert.match(source,/attendance: attendanceRaw, leaves: leaveRows/);assert.match(source,/activeTab !== "dashboard"/);assert.match(source,/logoutError/);assert.match(source,/document\.hidden/);
 assert.match(source,/personalAttendanceRows/);assert.doesNotMatch(source,/import ManagerHistoryPreview|signInWithEmailAndPassword/);
 const context=readFileSync(new URL('../contexts/AuthContext.js',import.meta.url),'utf8');assert.ok(context.indexOf('await clearManagerBrowserSession()')<context.lastIndexOf("localStorage.removeItem('user')"));
});
