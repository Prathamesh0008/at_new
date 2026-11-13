import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID, scryptSync } from 'node:crypto';
import { createManagerDailyClient, managerControlState, mergeManagerDailyEvents, mergeManagerDailyBreaks } from '../lib/manager-daily-client.mjs';
import { managerAttendanceView, attendanceReportData } from '../lib/attendance-view.mjs';
import { createManagerStore, HISTORY, DAILY, AUDIT, CONFIRM, QUERY_CAP } from '../lib/manager-store.mjs';
import { createManagerApi } from '../lib/manager-api.mjs';
import { dailyTransition, dateInIndia, MANAGER_ID } from '../lib/manager-domain.mjs';
import { signReview, readReview, exchangeManagerPassword, verifyManagerSession } from '../lib/manager-auth.mjs';

const identity = { uid: 'manager-credential:NTS-MGR', employeeId: MANAGER_ID };
const testPassword = 'offline-private-manager-password';
const salt = 'ab'.repeat(32);
const verifier = JSON.stringify({ algorithm: 'scrypt-v1', salt, hash: scryptSync(testPassword, Buffer.from(salt,'hex'),64).toString('hex') });
const env = { NODE_ENV: 'production', MANAGER_ATTENDANCE_ENABLED: 'true', MANAGER_ATTENDANCE_ORIGIN: 'https://portal.example', MANAGER_ATTENDANCE_PASSWORD_VERIFIER: verifier, MANAGER_ATTENDANCE_SESSION_SECRET: 'offline-only-session-secret-32-bytes-long', MANAGER_ATTENDANCE_REVIEW_SECRET: 'offline-only-placeholder-not-a-production-secret', MANAGER_ATTENDANCE_STORAGE_APPROVED: 'true', MANAGER_LEGACY_HISTORY_RECONCILED: 'true', MANAGER_ATTENDANCE_APPLY_ENABLED: 'true' };
const auth = { reserveAttempt: async () => {}, privatePasswordAllowed: () => true };
const sessionCookie = (await exchangeManagerPassword(auth, testPassword, env)).cookie;
function database() {
  const docs = new Map(), reads = [], writes = [];
  let version = 0;
  let tail = Promise.resolve();
  const copy = x => structuredClone(x);
  function snapshot(path) {
    const entry = docs.get(path);
    return { id: path.split('/').at(-1), exists: !!entry, data: () => entry && copy(entry.row), updateTime: { toMillis: () => entry?.version || 0 } };
  }
  class Ref {
    constructor(path) { this.path = path; }
    get() { reads.push({ document: this.path }); return Promise.resolve(snapshot(this.path)); }
  }
  class Query {
    constructor(name, filters = [], cap = null) { this.name = name; this.filters = filters; this.cap = cap; }
    doc(id) { return new Ref(`${this.name}/${id}`); }
    where(...filter) { return new Query(this.name, [...this.filters, filter], this.cap); }
    limit(cap) { return new Query(this.name, this.filters, cap); }
    async get() {
      assert.ok(this.cap && this.cap <= QUERY_CAP+1, 'bounded query required');
      assert.ok(this.filters.some(([field,op,value]) => ['employeeId','empId'].includes(field) && op==='==' && value===MANAGER_ID));
      assert.ok(this.filters.some(([,op])=>op==='>=') && this.filters.some(([,op])=>op==='<='));
      reads.push({ collection:this.name, filters:this.filters, cap:this.cap });
      const matches = [...docs].filter(([path,entry]) => path.startsWith(this.name+'/') && this.filters.every(([field,op,value])=>{
        const actual=entry.row[field];
        if(actual===undefined || (actual instanceof Date)!==(value instanceof Date) || typeof actual!==typeof value) return false;
        return op==='==' ? actual===value : op==='>=' ? actual>=value : actual<=value;
      })).slice(0,this.cap).map(([path])=>snapshot(path));
      return {docs:matches};
    }
  }
  const db = {
    failCommit:false,
    collection:name=>new Query(name),
    async runTransaction(work,options) {
      const previous=tail;let release;tail=new Promise(resolve=>{release=resolve;});await previous;
      try {
      assert.equal(options.maxAttempts,1);
      const queue=[]; let writing=false;
      const tx={get:ref=>{assert.equal(writing,false,'all reads before writes');return ref.get();},create:(ref,row)=>{writing=true;queue.push(['create',ref.path,row]);},update:(ref,row)=>{writing=true;queue.push(['update',ref.path,row]);},set:(ref,row)=>{writing=true;queue.push(['set',ref.path,row]);}};
      const result=await work(tx);
      if(db.failCommit) throw Error('offline injected commit failure');
      for(const [type,path] of queue){if(type==='create' && docs.has(path)) throw Error('duplicate');if(type==='update' && !docs.has(path)) throw Error('missing');}
      for(const [type,path,row] of queue){assert.ok([HISTORY,DAILY,AUDIT,'managerAttendanceState'].includes(path.split('/')[0])); if(type!=='update' || row.employeeId) assert.equal(row.employeeId,MANAGER_ID);const prior=docs.get(path)?.row; docs.set(path,{row:copy(type==='update'?{...prior,...row}:row),version:++version}); writes.push(path);}
      return result;
      } finally { release(); }
    },
    seed(path,row){docs.set(path,{row:copy(row),version:++version});}, docs, reads, writes,
  };
  return db;
}
function setup() { const db=database();const store=createManagerStore({db,stamp:()=> '2026-11-14T05:00:00.000Z',timestamp:d=>d});return {db,store}; }
async function dailyCommand(store, now) {
 const state=await store.daily(identity,null,null,now);
 return {key:randomUUID(),date:state.date,shiftId:state.shiftId,expectedVersion:state.version};
}
async function sendDaily(store,who,action,type,now){return store.daily(who,action,type,now,await dailyCommand(store,now));}
function request(operation,body,method=body?'POST':'GET',cookie=true,origin=env.MANAGER_ATTENDANCE_ORIGIN) {
  return new Request(`${env.MANAGER_ATTENDANCE_ORIGIN}/api/manager-attendance/${operation}`,{method,headers:{origin,'content-type':'application/json',...(cookie?{cookie:`nts_manager_attendance=${sessionCookie}`}:{})},body:body?JSON.stringify(body):undefined});
}
async function reviewed(store,month='2025-10') { const preview=await store.preview(identity,month);const review={...identity,month,fingerprint:preview.fingerprint};const approval=await store.approve(identity,review,'Manager historical review completed');return {...review,...approval}; }

test('server auth: private credential, signed session, cookie flags, CSRF and disabled defaults',async()=>{
 assert.equal((await exchangeManagerPassword(auth,testPassword,env)).identity.employeeId,MANAGER_ID);
 await assert.rejects(()=>exchangeManagerPassword(auth,'wrong',env));
 await assert.rejects(()=>verifyManagerSession('forged',env));
 assert.equal((await verifyManagerSession(sessionCookie,env)).employeeId,MANAGER_ID);
 let starts=0;const api=createManagerApi({env,services:async()=>{starts++;return {auth};}});
 let response=await api(request('session',{password:testPassword},'POST',false));assert.equal(response.status,200);const cookie=response.headers.get('set-cookie');for(const text of ['HttpOnly','Secure','SameSite=Strict','Path=/api/manager-attendance'])assert.ok(cookie.includes(text));
 response=await api(request('session',{password:testPassword},'POST',false,'https://attacker.example'));assert.equal(response.status,403);
 response=await api(request('session',{password:testPassword,employeeId:MANAGER_ID}));assert.equal(response.status,400);
 const disabled=createManagerApi({env:{},services:async()=>{throw Error('must not initialize Firebase');}});assert.equal((await disabled(request('daily'))).status,503);assert.equal((await disabled(request('capabilities'))).status,200);assert.ok(starts>0);
});

test('review signatures bind exact identity, stage, expiration and digest',()=>{
 const value={...identity,month:'2025-10',fingerprint:'snapshot',stage:'preview'};const token=signReview(value,env,1000);
 assert.equal(readReview(token,identity,'preview',env,2000).fingerprint,'snapshot');
 for(const action of [()=>readReview(token+'x',identity,'preview',env,2000),()=>readReview(token,{uid:'other'},'preview',env,2000),()=>readReview(token,identity,'approved',env,2000),()=>readReview(token,identity,'preview',env,2000000),()=>signReview(value,{})]) assert.throws(action);
});

test('preview reads only; create-only month apply, audited approval and retry idempotency',async()=>{
 const {db,store}=setup();const preview=await store.preview(identity,'2025-10');assert.equal(db.writes.length,0);assert.equal(preview.proposal.absentDates.length,0);
 const review=await reviewed(store);assert.equal(db.writes.length,1);assert.equal([...db.docs].filter(([p])=>p.startsWith(AUDIT+'/')).length,1);
 const result=await store.apply(identity,review,CONFIRM);assert.equal(result.created,16);assert.equal([...db.docs].filter(([p])=>p.startsWith(HISTORY+'/')).length,16);
 const again=await store.apply(identity,review,CONFIRM);assert.equal(again.created,0);assert.equal(again.alreadyApplied,true);
 const before=db.writes.length;const verified=await store.verify(identity,review);assert.equal(verified.verified,true);assert.equal(db.writes.length,before);
 const history=await store.history(identity,'2025-10');assert.equal(history.records.length,16);
 for(const [path,{row}] of db.docs) if(path.startsWith(HISTORY+'/')){assert.equal(path,`${HISTORY}/${MANAGER_ID}_${row.date}`);assert.equal(row.clockIn,null);assert.equal(row.clockOut,null);assert.equal(row.breaks,null);assert.equal(row.clockInVerified,false);assert.equal(row.approvedBy,identity.uid);}
 const path=`${HISTORY}/${MANAGER_ID}_2025-10-10`;
 db.seed(path,{...db.docs.get(path).row,approvedBy:'tampered'});
 assert.equal((await store.verify(identity,review)).verified,false);
 await assert.rejects(()=>store.apply(identity,review,CONFIRM),/metadata/);
});

test('verified attendance and approved spanning Timestamp leave protected, other employees ignored',async()=>{
 const {db,store}=setup();db.seed('attendance/real',{employeeId:MANAGER_ID,date:'2025-10-17',clockInVerified:true});db.seed('attendance/other',{employeeId:'NTS-001',date:'2025-10-24'});
 db.seed('leave_requests/spanning',{employeeId:MANAGER_ID,status:'Approved',fromDate:new Date('2025-09-01T00:00:00+05:30'),toDate:new Date('2025-10-12T00:00:00+05:30')});
 const p=await store.preview(identity,'2025-10');assert.ok(!p.proposal.absentDates.includes('2025-10-17'));assert.equal(p.proposal.days.find(d=>d.date==='2025-10-10').status,'Approved Leave');
 const before=structuredClone(db.docs.get('attendance/other'));
 const review=await reviewed(store);await store.apply(identity,review,CONFIRM);
 assert.equal(db.docs.has(`${HISTORY}/${MANAGER_ID}_2025-10-17`),false);assert.equal(db.docs.has(`${HISTORY}/${MANAGER_ID}_2025-10-10`),false);assert.deepEqual(db.docs.get('attendance/other'),before);
});

test('transaction rechecks stale attendance/leave and requires review confirmation',async()=>{
 const {db,store}=setup();const review=await reviewed(store);
 await assert.rejects(()=>store.apply(identity,review,''));
 db.seed('attendance/new',{empId:MANAGER_ID,date:'2025-10-24'});
 await assert.rejects(()=>store.apply(identity,review,CONFIRM),/changed/);assert.equal([...db.docs].filter(([p])=>p.startsWith(HISTORY+'/')).length,0);
 const p=await store.preview(identity,'2025-10');db.seed('leave_requests_v2/new',{employeeId:MANAGER_ID,status:'approved',fromDate:'2025-10-15',toDate:'2025-10-15'});
 await assert.rejects(()=>store.approve(identity,{...identity,month:'2025-10',fingerprint:p.fingerprint},'Approved offline review'),/changed/);
});

test('atomic failure: no partial month, audit unchanged, manual retry and verification',async()=>{
 const {db,store}=setup();const review=await reviewed(store);db.failCommit=true;
 await assert.rejects(()=>store.apply(identity,review,CONFIRM),/commit failure/);
 assert.equal([...db.docs].filter(([p])=>p.startsWith(HISTORY+'/')).length,0);assert.equal(db.docs.get(`${AUDIT}/${review.approvalId}`).row.state,'approved');
 db.failCommit=false;await store.apply(identity,review,CONFIRM);assert.equal((await store.verify(identity,review)).verified,true);
});

test('existing incompatible estimate, invalid leaves and bounded-query overflow fail closed',async()=>{
 const {db,store}=setup();db.seed(`${HISTORY}/${MANAGER_ID}_2025-10-10`,{employeeId:MANAGER_ID,date:'2025-10-10',estimated:false,clockIn:'invented'});
 const p=await store.preview(identity,'2025-10');assert.ok(p.proposal.review.length);await assert.rejects(()=>reviewed(store));
 const next=setup();next.db.seed('leave_requests_v2/invalid',{employeeId:MANAGER_ID,status:'approved',fromDate:'2025-10-00',toDate:'2025-10-31'});await assert.rejects(()=>next.store.preview(identity,'2025-10'));
 const overflow=setup();for(let i=0;i<=QUERY_CAP;i++)overflow.db.seed(`attendance/${i}`,{employeeId:MANAGER_ID,date:'2025-10-10'});await assert.rejects(()=>overflow.store.preview(identity,'2025-10'),/limit/);
});

test('daily transitions, four breaks, duplicate prevention and midnight recovery',async()=>{
 const {db,store}=setup();const nov14=new Date('2026-11-14T10:00:00+05:30');const nov15=new Date('2026-11-15T10:00:00+05:30');
 assert.equal((await store.daily(identity,null,null,nov14)).record,null);
 await assert.rejects(()=>sendDaily(store,identity,'end',null,nov14));await assert.rejects(()=>sendDaily(store,identity,'start',null,new Date('2026-11-13T10:00:00+05:30')));
 await sendDaily(store,identity,'start',null,nov14);await assert.rejects(()=>sendDaily(store,identity,'start',null,nov14));
 for(const type of ['Tea','Lunch','Evening','Breather']){
  await sendDaily(store,identity,'break-start',type,nov14);await assert.rejects(()=>sendDaily(store,identity,'end',null,nov14));await assert.rejects(()=>sendDaily(store,identity,'break-start','Tea',nov14));await assert.rejects(()=>sendDaily(store,identity,'break-end','Wrong',nov14));
  await sendDaily(store,identity,'break-end',type,nov14);await assert.rejects(()=>sendDaily(store,identity,'break-start',type,nov14));
 }
 assert.equal((await store.daily(identity,null,null,nov15)).date,'2026-11-14');await sendDaily(store,identity,'end',null,nov15);await sendDaily(store,identity,'start',null,nov15);
 const history=await store.history(identity,'2026-11');assert.equal(history.records.filter(r=>r.source==='verified_manager_daily').length,2);
 assert.equal(db.docs.get(`${DAILY}/${MANAGER_ID}_2026-11-14`).row.state,'ended');
 assert.equal(dateInIndia(new Date('2026-11-13T20:00:00Z')),'2026-11-14');
 assert.throws(()=>dailyTransition(null,'start',null,'server','2026-11-13'));
});

test('daily commit failure leaves no state or attendance record',async()=>{
 const {db,store}=setup();db.failCommit=true;await assert.rejects(()=>sendDaily(store,identity,'start',null,new Date('2026-11-14T10:00:00Z')));assert.equal(db.docs.size,0);
});

test('API approval/apply workflow, unauthorized requests, activation gates and read-only verification',async()=>{
 const {store,db}=setup();const api=createManagerApi({env,services:async()=>({auth,store})});
 assert.equal((await api(request('daily',null,'GET',false))).status,401);assert.equal(db.reads.length,0);
 let r=await api(request('preview',{month:'2025-10'}));assert.equal(r.status,200);const preview=await r.json();assert.equal(db.writes.length,0);
 r=await api(request('approve',{token:preview.token,reviewed:false,confirmation:'APPROVE NTS-MGR HISTORICAL ESTIMATES',reason:'Offline review completed'}));assert.equal(r.status,400);
 r=await api(request('approve',{token:preview.token,reviewed:true,confirmation:'APPROVE NTS-MGR HISTORICAL ESTIMATES',reason:'Offline review completed'}));assert.equal(r.status,200);const approval=await r.json();
 r=await api(request('apply',{token:preview.token,confirmation:CONFIRM}));assert.equal(r.status,403);
 const blocked=createManagerApi({env:{...env,MANAGER_ATTENDANCE_APPLY_ENABLED:'false'},services:async()=>({auth,store})});assert.equal((await blocked(request('apply',{token:approval.token,confirmation:CONFIRM}))).status,503);
 r=await api(request('apply',{token:approval.token,confirmation:CONFIRM}));assert.equal(r.status,200);
 const before=db.writes.length;r=await api(request('verify',{token:approval.token}));assert.equal((await r.json()).verified,true);assert.equal(db.writes.length,before);
 await assert.rejects(()=>store.history({uid:'employee',employeeId:'NTS-001'},'2025-10'));
});

test('storage and legacy reconciliation gates, request sizes and sanitized failures',async()=>{
 const {store}=setup();for(const key of ['MANAGER_ATTENDANCE_STORAGE_APPROVED','MANAGER_LEGACY_HISTORY_RECONCILED']){
  const api=createManagerApi({env:{...env,[key]:'false'},services:async()=>({auth,store})});assert.equal((await api(request('preview',{month:'2025-10'}))).status,503);
 }
 const api=createManagerApi({env,services:async()=>({auth,store})});assert.equal((await api(request('daily',{action:'start',padding:'x'.repeat(17000)}))).status,413);
 const broken=createManagerApi({env,services:async()=>{throw Error('private-key-never-expose');}});const response=await broken(request('daily'));assert.equal(response.status,503);assert.doesNotMatch(await response.text(),/private-key/);
});

test('on-demand only: no polling or clock-driven history refresh; no client authoritative attendance',()=>{
 const ui=readFileSync(new URL('../lib/attendance-view.mjs',import.meta.url),'utf8');assert.doesNotMatch(ui,/setInterval|setTimeout|useEffect|localStorage|onSnapshot/);assert.doesNotMatch(ui,/fetch\(|signInWithEmailAndPassword|type="password"/);assert.match(ui,/previewManagerHistory/);
 const source=readFileSync(new URL('../lib/manager-store.mjs',import.meta.url),'utf8');assert.doesNotMatch(source,/collectionGroup|collection\([^\n]+\.add\(/);assert.match(source,/maxAttempts: 1/);
});


test('daily command receipts reject stale targets, changed payloads and concurrent versions',async()=>{
 const {db,store}=setup();const day1=new Date('2026-11-14T10:00:00+05:30'),day2=new Date('2026-11-15T10:00:00+05:30');
 await assert.rejects(()=>store.daily(identity,'start',null,day1),/command key/);
 const start=await dailyCommand(store,day1);await store.daily(identity,'start',null,day1,start);
 const before=db.writes.length;assert.equal((await store.daily(identity,'start',null,day1,start)).replayed,true);assert.equal(db.writes.length,before);
 await assert.rejects(()=>store.daily(identity,'end',null,day1,start),/different operation/);
 const expected=await dailyCommand(store,day1);
 const results=await Promise.allSettled([store.daily(identity,'break-start','Tea',day1,{...expected,key:randomUUID()}),store.daily(identity,'end',null,day1,{...expected,key:randomUUID()})]);
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);assert.equal(results.filter(r=>r.status==='rejected').length,1);
 const oldBreakEnd=await dailyCommand(store,day1);await store.daily(identity,'break-end','Tea',day1,oldBreakEnd);
 const delayedBreakEnd={...oldBreakEnd,key:randomUUID()};
 const oldEnd=await dailyCommand(store,day1);await store.daily(identity,'end',null,day1,oldEnd);
 await sendDaily(store,identity,'start',null,day2);await sendDaily(store,identity,'break-start','Tea',day2);
 const later=structuredClone(db.docs.get(`${DAILY}/${MANAGER_ID}_2026-11-15`));const writes=db.writes.length;
 assert.equal((await store.daily(identity,'end',null,day2,oldEnd)).replayed,true);
 await assert.rejects(()=>store.daily(identity,'end',null,day2,{...oldEnd,key:randomUUID()}),/Stale/);
 await assert.rejects(()=>store.daily(identity,'break-end','Tea',day2,delayedBreakEnd),/Stale/);
 assert.deepEqual(db.docs.get(`${DAILY}/${MANAGER_ID}_2026-11-15`),later);assert.equal(db.writes.length,writes);
});

test('daily receipt and version are atomic on failure, retry writes once',async()=>{
 const {db,store}=setup();const now=new Date('2026-11-14T10:00:00Z'),command=await dailyCommand(store,now);
 db.failCommit=true;await assert.rejects(()=>store.daily(identity,'start',null,now,command));assert.equal(db.docs.size,0);
 db.failCommit=false;await store.daily(identity,'start',null,now,command);const writes=db.writes.length;
 await store.daily(identity,'start',null,now,command);assert.equal(db.writes.length,writes);
});

test('manager browser logout clears cookie with feature disabled and never initializes Firebase',async()=>{
 let initialized=0;const api=createManagerApi({env:{NODE_ENV:'production'},services:async()=>{initialized++;throw Error('must not initialize');}});
 const response=await api(request('session',null,'DELETE'));assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/HttpOnly/);assert.match(response.headers.get('set-cookie'),/Max-Age=0/);assert.match(response.headers.get('set-cookie'),/Secure/);assert.equal(initialized,0);
 assert.equal((await api(request('session',null,'DELETE',true,'https://attacker.example'))).status,403);
});


function dailyBridge() {
 const db=database(),calls=[];let serverNow=new Date('2026-11-14T04:30:00Z'),loseResponse=false,authorized=true;
 const raw=createManagerStore({db,stamp:()=>serverNow.toISOString(),timestamp:date=>date});
 const store={...raw,daily:(who,action,type,_now,command)=>raw.daily(who,action,type,serverNow,command)};
 const api=createManagerApi({env,services:async()=>({auth,store})});
 const fetcher=async(path,options={})=>{
  calls.push({path,options});assert.equal(options.credentials,'same-origin');
  const response=await api(new Request('https://portal.example'+path,{method:options.method||'GET',headers:{origin:'https://portal.example','content-type':'application/json',...(authorized?{cookie:`nts_manager_attendance=${sessionCookie}`}:{})},body:options.body}));
  if(loseResponse&&options.method==='POST'&&response.ok){loseResponse=false;throw Error('offline lost response');}
  return response;
 };
 return {db,calls,raw,fetcher,client:()=>createManagerDailyClient({fetcher,newKey:randomUUID}),setNow:value=>{serverNow=new Date(value);},lose:()=>{loseResponse=true;},deny:()=>{authorized=false;}};
}

test('daily UI client refuses browser-only or wrong-identity sessions without attendance requests',async()=>{
 for(const session of [{authenticated:false,enabled:false},{authenticated:true,employeeId:'NTS-001'}]){
  const calls=[];const client=createManagerDailyClient({fetcher:async path=>{calls.push(path);return Response.json(session);}});
  assert.equal(await client.connect(),false);assert.equal(managerControlState(client.getSnapshot()).canStart,false);
  await assert.rejects(()=>client.perform('start'),/server-verified/);assert.deepEqual(calls,['/api/manager-attendance/session']);
 }
});

test('shared-control client uses real server state, coalesces Start and restores after refresh',async()=>{
 const bridge=dailyBridge(),client=bridge.client();assert.equal(await client.connect(),true);assert.equal(managerControlState(client.getSnapshot()).canStart,true);
 await Promise.all([client.perform('start'),client.perform('start')]);
 assert.equal(bridge.calls.filter(call=>call.options.method==='POST').length,1);assert.equal(client.getSnapshot().snapshot.record.clockIn,'2026-11-14T04:30:00.000Z');assert.equal(managerControlState(client.getSnapshot()).shiftStartAt,Date.parse('2026-11-14T04:30:00Z'));
 const payload=JSON.parse(bridge.calls.find(call=>call.options.method==='POST').options.body);assert.equal(payload.command.expectedVersion,0);assert.equal(payload.command.date,'2026-11-14');for(const key of ['employeeId','role','clockIn','clockOut','timestamp'])assert.equal(key in payload,false);
 const restored=bridge.client();assert.equal(await restored.connect(),true);assert.equal(managerControlState(restored.getSnapshot()).shiftRunning,true);assert.equal(managerControlState(restored.getSnapshot()).canStart,false);assert.equal(bridge.calls.filter(call=>call.options.method==='POST').length,1);
});

test('all four manager breaks use protected transitions; employee records remain untouched',async()=>{
 const bridge=dailyBridge(),client=bridge.client();bridge.db.seed('attendance/employee',{employeeId:'NTS-001',date:'2026-11-14',action:'clock-in'});const employee=structuredClone(bridge.db.docs.get('attendance/employee'));
 await client.connect();await client.perform('start');
 for(const type of ['Tea','Lunch','Evening','Breather']){
  assert.equal(managerControlState(client.getSnapshot()).canBreak(type),true);await client.perform('break-start',type);
  assert.equal(managerControlState(client.getSnapshot()).activeBreakType,type);assert.ok(mergeManagerDailyBreaks([],client.getSnapshot().records).some(row=>row.breakType===type&&row.action==='start'&&row.status==='Active'));assert.equal(managerControlState(client.getSnapshot()).canEnd,false);assert.equal(managerControlState(client.getSnapshot()).canBreak(type),true);
  const other=type==='Tea'?'Lunch':'Tea';assert.equal(managerControlState(client.getSnapshot()).canBreak(other),false);
  await client.perform('break-end',type);assert.equal(managerControlState(client.getSnapshot()).canBreak(type),false);
 }
 await client.perform('end');assert.equal(managerControlState(client.getSnapshot()).shiftRunning,false);assert.equal(managerControlState(client.getSnapshot()).canEnd,false);assert.equal(managerControlState(client.getSnapshot()).canStart,false);
 assert.deepEqual(bridge.db.docs.get('attendance/employee'),employee);assert.ok(bridge.calls.filter(call=>call.options.method==='POST').every(call=>call.path==='/api/manager-attendance/daily'));
});

test('lost command response retains exact idempotency key and retry does not duplicate writes',async()=>{
 const bridge=dailyBridge(),client=bridge.client();await client.connect();bridge.lose();await assert.rejects(()=>client.perform('start'),/lost response/);const pending=structuredClone(client.getSnapshot().pending);assert.ok(pending.command.key);assert.equal(managerControlState(client.getSnapshot()).canStart,false);
 const writes=bridge.db.writes.length;await client.retry();assert.equal(bridge.db.writes.length,writes);assert.equal(client.getSnapshot().pending,null);
 const posts=bridge.calls.filter(call=>call.options.method==='POST');assert.equal(posts.length,2);assert.deepEqual(JSON.parse(posts[0].options.body),JSON.parse(posts[1].options.body));
});

test('stale displayed manager version is rejected and explicit recovery restores active break',async()=>{
 const bridge=dailyBridge(),first=bridge.client(),second=bridge.client();await first.connect();await first.perform('start');await second.connect();await second.perform('break-start','Tea');
 await assert.rejects(()=>first.perform('end'),/Stale/);assert.ok(first.getSnapshot().pending);await first.recover();assert.equal(first.getSnapshot().pending,null);assert.equal(managerControlState(first.getSnapshot()).activeBreakType,'Tea');
 await first.perform('break-end','Tea');await first.perform('end');assert.equal(managerControlState(first.getSnapshot()).shiftRunning,false);
});

test('overnight End recovers the exact prior-date clock-out and report adapters retain real times',async()=>{
 const bridge=dailyBridge(),client=bridge.client();await client.connect();await client.perform('start');bridge.setNow('2026-11-15T05:17:23Z');await client.perform('end');
 const closed=client.getSnapshot().records.find(row=>row.date==='2026-11-14');assert.equal(closed.clockOut,'2026-11-15T05:17:23.000Z');assert.ok(bridge.calls.some(call=>call.path.includes('date=2026-11-14')));
 const legacy=[{empId:'NTS-001',date:'2026-11-14',action:'clock-in'}];const merged=mergeManagerDailyEvents(legacy,client.getSnapshot().records,'Manager fixture');assert.equal(merged[0],legacy[0]);assert.equal(merged.filter(row=>row.empId==='NTS-MGR').length,2);
 const days=managerAttendanceView({attendance:merged,employeeName:'Manager fixture'});const report=attendanceReportData({employeeSummary:[],attendance:merged,managerDays:days,month:'2026-11'});const row=report.detailRows.find(row=>row.EmployeeID==='NTS-MGR'&&row.Date==='2026-11-14');assert.ok(row.LoginTime);assert.ok(row.LogoutTime);
 const before=bridge.db.reads.length;await bridge.raw.history(identity,'2026-11',{dailyOnly:true,date:'2026-11-14'});assert.equal(bridge.db.reads.length-before,1);assert.equal(bridge.db.reads.at(-1).document,`${DAILY}/NTS-MGR_2026-11-14`);
 await assert.rejects(()=>bridge.raw.history(identity,'2026-11',{dailyOnly:true,date:'2026-12-01'}));
});

test('daily-only monthly history is cached and bounded; quota pauses automatic attempts',async()=>{
 const bridge=dailyBridge(),client=bridge.client();await client.connect();await Promise.all([client.loadMonth('2026-11'),client.loadMonth('2026-11')]);await client.loadMonth('2026-11');assert.equal(bridge.calls.filter(call=>call.path.includes('history?')).length,1);
 assert.ok(bridge.db.reads.filter(read=>read.document).every(read=>read.document.startsWith(DAILY+'/')||read.document.startsWith('managerAttendanceState/')));assert.equal(bridge.db.reads.filter(read=>read.collection).length,0);
 let calls=0;const quota=createManagerDailyClient({fetcher:async()=>{calls++;return Response.json({error:'Firestore quota unavailable'},{status:503});}});await quota.connect();const count=calls;await quota.recover();await quota.loadMonth('2026-11');assert.equal(calls,count);assert.equal(quota.getSnapshot().paused,true);
 const blocked=createManagerDailyClient({blocked:()=>true,fetcher:async()=>{throw Error('must not call network');}});assert.equal(await blocked.connect(),false);assert.equal(blocked.getSnapshot().paused,true);
});

test('revoked session keeps manager controls disabled and never writes through employee APIs',async()=>{
 const bridge=dailyBridge(),client=bridge.client();await client.connect();bridge.deny();await assert.rejects(()=>client.perform('start'),/sign-in required/);assert.equal(client.getSnapshot().ready,false);assert.equal(client.getSnapshot().snapshot,null);assert.equal(bridge.db.writes.length,0);
 assert.ok(bridge.calls.every(call=>call.path.startsWith('/api/manager-attendance/')));
 const source=readFileSync(new URL('../hooks/useManagerDailyAttendance.js',import.meta.url),'utf8');assert.doesNotMatch(source,/setInterval|setTimeout|onSnapshot|clockTick/);
 const portal=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');assert.match(portal,/isPersonalManager \? \[\.\.\.BREAK_TYPES, "Breather"\] : BREAK_TYPES/);assert.match(portal,/if \(isPersonalManager\) return handleManagerDaily\("start"\)/);assert.match(portal,/if \(isPersonalManager\) return handleManagerDaily\("end"\)/);assert.match(portal,/if \(!isAuthenticated \|\| !user\?\.id \|\| isPersonalManager\) return/);
});
