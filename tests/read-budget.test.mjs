import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createReadCoordinator, startReadPolling, readDiagnosticsEnabled, readDiagnostic } from '../utils/read-control.mjs';
import { createLoginQuotaCooldown } from '../lib/server/login-quota.mjs';

test('identical pending reads deduplicate, distinct user scopes do not, completed data is not cached', async () => {
 const reads=createReadCoordinator();let calls=0,resolve;
 const task=()=>{calls++;return new Promise(done=>{resolve=done;});};
 const first=reads.run('user-one:history',task),same=reads.run('user-one:history',task);
 await Promise.resolve();assert.equal(calls,1);assert.equal(first,same);resolve({size:2});await first;
 await reads.run('user-one:history',async()=>{calls++;return {size:2};});assert.equal(calls,2);
 await Promise.all(['user-one','user-two'].map(scope=>reads.run(scope,async()=>{calls++;return {size:1};})));assert.equal(calls,4);
});
test('quota errors latch the read circuit without retrying or disguising a failure as data', async () => {
 const reads=createReadCoordinator();let calls=0;
 await assert.rejects(reads.run('first',async()=>{calls++;throw Object.assign(new Error('quota'),{code:'resource-exhausted'});}));
 await assert.rejects(reads.run('next',async()=>{calls++;return [];}),{code:'resource-exhausted'});
 assert.equal(calls,1);assert.equal(reads.isBlocked(),true);
});
test('poll cleanup, hidden-tab pause and no overlap', async context => {
 context.mock.timers.enable({apis:['setTimeout']});let calls=0,finish;
 const stop=startReadPolling(()=>{calls++;return new Promise(done=>{finish=done;});},100,{visible:()=>true});
 assert.equal(calls,1);context.mock.timers.tick(500);assert.equal(calls,1);
 stop();finish();await Promise.resolve();context.mock.timers.tick(1000);assert.equal(calls,1);
 const hiddenStop=startReadPolling(async()=>{calls++;},100,{visible:()=>false});context.mock.timers.tick(100);await Promise.resolve();assert.equal(calls,1);hiddenStop();context.mock.timers.reset();
});
test('quota error stops polling rather than rescheduling', async context => {
 context.mock.timers.enable({apis:['setTimeout']});let calls=0;
 const stop=startReadPolling(async()=>{calls++;throw Object.assign(new Error('quota'),{code:'resource-exhausted'});},100);
 await Promise.resolve();await Promise.resolve();context.mock.timers.tick(10000);assert.equal(calls,1);stop();context.mock.timers.reset();
});
test('login quota cooldown fails closed, permits explicit retry only after cooldown', () => {
 let now=0;const gate=createLoginQuotaCooldown(()=>now);gate.check();gate.block();assert.throws(gate.check,{status:503});now=59999;assert.throws(gate.check,{status:503});now=60000;assert.doesNotThrow(gate.check);
});
test('client complete-query pagination returns every record with bounded pages', async () => {
 const source=readFileSync(new URL('../lib/firestore-reads.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 const data=Array.from({length:425},(_,index)=>({id:index}));const limits=[];
 const deps={clientReadCoordinator:createReadCoordinator(),readDiagnosticsEnabled:()=>false,readDiagnostic:()=>{},queryEqual:(a,b)=>a===b,refEqual:(a,b)=>a===b,query:(ref,...clauses)=>({ref,clauses}),limit:n=>({limit:n}),startAfter:doc=>({after:doc.id}),sdkGetDoc:async()=>{},sdkGetDocs:async request=>{const size=request.clauses.find(clause=>clause.limit).limit;limits.push(size);const offset=(request.clauses.find(clause=>clause.after!==undefined)?.after??-1)+1;const docs=data.slice(offset,offset+size);return {docs,size:docs.length};}};
 const {getPagedDocs}=new Function(...Object.keys(deps),source+';return {getPagedDocs};')(...Object.values(deps));
 let release; const pendingHttp=deps.clientReadCoordinator.run('api:user-one',()=>new Promise(resolve=>{release=resolve;}));
 const result=await getPagedDocs({type:'query'});release({});await pendingHttp;assert.equal(result.size,425);assert.deepEqual(result.docs,data);assert.deepEqual(limits,[200,200,200]);
});
test('server personal-state and team-state reads are scoped and team access is manager-only', async () => {
 const source=readFileSync(new URL('../lib/attendanceStorage.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 let connections=0;const ids=[];
 const db={collection:name=>{assert.equal(name,'attendanceState');return {doc:id=>({id,get:async()=>{ids.push(id);return {data:()=>({employeeId:id})};}})};},getAll:async(...refs)=>{ids.push(...refs.map(ref=>ref.id));return refs.map(ref=>({exists:true,data:()=>({employeeId:ref.id,employeeName:'fixture',date:'2026-11-11',activeBreak:null})}));}};
 const deps={employees:[{id:'manager'},{id:'employee'}],readDiagnostic:()=>{},serverDb:async()=>{connections++;return db;}};
 const api=new Function(...Object.keys(deps),source+';return {getAttendanceState,getTeamBreakStates};')(...Object.values(deps));
 await assert.rejects(api.getTeamBreakStates({id:'employee',role:'agent'}),{status:403});assert.equal(connections,0);
 assert.equal((await api.getAttendanceState({id:'employee'})).state.employeeId,'employee');assert.deepEqual(ids,['employee']);
 await api.getTeamBreakStates({id:'manager',role:'manager'});assert.deepEqual(ids,['employee','manager','employee']);
});
test('automatic full-history refresh and backfill preview effects are absent', () => {
 const portal=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');
 assert.ok(!portal.includes('AUTO_SYNC_MS'));assert.ok(portal.includes("readJson('/api/breaks?view=team-state'"));
 const history=readFileSync(new URL('../components/PersonalAttendance.jsx',import.meta.url),'utf8');assert.ok(!history.includes('setInterval'));assert.ok(history.includes("readJson('/api/attendance?view=state'"));
 const backfill=readFileSync(new URL('../components/ManagerBackfill.jsx',import.meta.url),'utf8');assert.ok(!backfill.includes('useEffect'));assert.ok(backfill.includes("mode: 'dry-run'"));
});

test('diagnostics are opt-in, production-disabled and redact arbitrary fields; duplicate poll registrations clean up', () => {
 const oldMode=process.env.NODE_ENV,oldFlag=process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS,oldInfo=console.info;
 const events=[];console.info=(...args)=>events.push(args);
 try {
  process.env.NODE_ENV='production';process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS='true';assert.equal(readDiagnosticsEnabled(),false);
  readDiagnostic('fixture',{employeeId:'fixture'});assert.equal(events.length,0);
  process.env.NODE_ENV='development';delete process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS;assert.equal(readDiagnosticsEnabled(),false);
  process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS='true';assert.equal(readDiagnosticsEnabled(),true);
  readDiagnostic('fixture',{site:'fixture',documents:2,employeeId:'must-be-redacted',token:'must-be-redacted'});
  assert.deepEqual(events[0][2],{site:'fixture',documents:2});
  const first=startReadPolling(async()=>{},1000,{site:'fixture-listener',immediate:false});
  const second=startReadPolling(async()=>{},1000,{site:'fixture-listener',immediate:false});
  assert.equal(events.filter(event=>event[1]==='poll-start').at(-1)[2].duplicate,true);
  first();second();assert.equal(events.filter(event=>event[1]==='poll-stop').at(-1)[2].active,0);
 } finally {
  console.info=oldInfo;
  if(oldMode===undefined)delete process.env.NODE_ENV;else process.env.NODE_ENV=oldMode;
  if(oldFlag===undefined)delete process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS;else process.env.NEXT_PUBLIC_FIRESTORE_DIAGNOSTICS=oldFlag;
 }
});

test('quota latch cancels a queued operation before it starts', async () => {
 const reads=createReadCoordinator();let calls=0;
 const queued=reads.run('queued',async()=>{calls++;return {size:1};});
 reads.block();
 await assert.rejects(queued,{code:'resource-exhausted'});
 assert.equal(calls,0);
});
