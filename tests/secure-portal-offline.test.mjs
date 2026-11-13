import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { scryptSync } from 'node:crypto';
import { authorizeWrite, canRead } from '../lib/portal-policy.mjs';
import { createPortalDataService } from '../lib/portal-data-service.mjs';
import { createEmployeeAttendance } from '../lib/employee-attendance-service.mjs';
import { createEmployeeDailyClient } from '../lib/employee-daily-client.mjs';
import { issuePortalSession, readPortalSession, PORTAL_SESSION_MS } from '../lib/portal-session.mjs';
import { verifyEmployeeCredential } from '../lib/employee-credentials.mjs';
import { readJsonBody } from '../lib/portal-http.mjs';
import { managerAttendanceView, managerLoginTime } from '../lib/attendance-view.mjs';
import { encode, decode } from '../lib/portal-wire.mjs';
import * as transport from '../lib/portal-data-client.mjs';

const employee = { id:'NTS-001', name:'Employee', email:'employee@example.test', role:'employee' };
const other = { ...employee, id:'NTS-002' };
const manager = { id:'NTS-MGR', name:'Manager', email:'manager@example.test', role:'manager' };
const Filter = { where:(field,op,value)=>({kind:'where',field,op,value}), or:(...children)=>({kind:'or',children}), and:(...children)=>({kind:'and',children}) };
function database(seed={}) {
 const rows=new Map(Object.entries(seed)),reads=[],writes=[];let tail=Promise.resolve(),counter=0,fail=false;
 const matches=(row,id,c)=> c.kind==='or'?c.children.some(child=>matches(row,id,child)):c.kind==='and'?c.children.every(child=>matches(row,id,child)):(()=>{const a=c.field==='__name__'?id:row[c.field],b=c.field==='__name__'?c.value.id:c.value;return c.op==='=='?a===b:c.op==='>='?a>=b:c.op==='<='?a<=b:c.op==='>'?a>b:c.op==='<'?a<b:false;})();
 const snapshot=path=>({id:path.split('/')[1],exists:rows.has(path),data:()=>rows.get(path)});
 const ref=(name,id)=>({name,id,path:`${name}/${id}`,get:async()=>{reads.push(`${name}/${id}`);return snapshot(`${name}/${id}`);}});
 const query=(name,filters=[],orders=[],cap=Infinity,cursor=null)=>({
  name,where:(field,op,value)=>query(name,[...filters,typeof field==='object'?field:Filter.where(field,op,value)],orders,cap,cursor),
  orderBy:(field,direction)=>query(name,filters,[...orders,{field,direction}],cap,cursor),limit:n=>query(name,filters,orders,n,cursor),startAfter:snap=>query(name,filters,orders,cap,snap.id),
  doc:id=>ref(name,id||`new-${++counter}`),
  get:async()=>{reads.push({name,filters,cap});let docs=[...rows.keys()].filter(path=>path.startsWith(name+'/')).map(snapshot).filter(snap=>filters.every(c=>matches(snap.data(),snap.id,c)));
   docs.sort((a,b)=>{for(const o of orders){const x=a.data()[o.field],y=b.data()[o.field];if(x<y)return o.direction==='desc'?1:-1;if(x>y)return o.direction==='desc'?-1:1;}return a.id.localeCompare(b.id);});if(cursor){const i=docs.findIndex(s=>s.id===cursor);docs=docs.slice(i+1);}docs=docs.slice(0,cap);return {docs,size:docs.length};},
 });
 const db={collection:name=>query(name),runTransaction:work=>{const task=tail.then(async()=>{const staged=[];const tx={get:target=>target.get(),set:(target,row,opts)=>staged.push(['set',target,row,opts]),update:(target,row)=>staged.push(['update',target,row]),create:(target,row)=>{if(rows.has(target.path))throw Error('duplicate');staged.push(['create',target,row]);}};const result=await work(tx);if(fail)throw Error('commit failed');for(const [kind,target,row,opts] of staged){rows.set(target.path,kind==='update'||opts?.merge?{...rows.get(target.path),...row}:row);writes.push(target.path);}return result;});tail=task.catch(()=>{});return task;}};
 return {db,rows,reads,writes,setFailure:value=>{fail=value;}};
}
const deps=f=>({db:f.db,Filter,stamp:()=>new Date('2026-11-14T04:30:00Z')});
const body=(operation,name,id,data)=>({operation,ref:{type:id?'document':'collection',name,...(id?{id}:{}),constraints:[]},...(data?{data}:{})});

test('portal cookies resist forgery, malformed expiry, old cookie formats and credential/secret rotation',()=>{
 const env={SESSION_SECRET:'offline-private-session-secret-at-least-32-bytes'},token=issuePortalSession(employee.id,env,1000);
 assert.equal(readPortalSession(token,env,1001),employee.id);
 for(const forged of [token+'x','NTS-001.NaN.signature','NTS-001.9999999999999.signature',token.replace('NTS-001','NTS-MGR')])assert.equal(readPortalSession(forged,env,1001),null);
 assert.equal(readPortalSession(token,env,1000+PORTAL_SESSION_MS),null);
 assert.equal(readPortalSession(token,{...env,SESSION_SECRET:'different-private-secret-with-32-bytes'},1001),null);
 assert.equal(readPortalSession(token,{...env,PORTAL_EMPLOYEE_PASSWORD_VERIFIERS:'rotated'},1001),null);
});
test('production rejects missing employee private verifiers and exposed legacy credentials',async()=>{
 await assert.rejects(verifyEmployeeCredential(employee.id,'fixture',true,{NODE_ENV:'production'}),{status:503});
 await assert.rejects(verifyEmployeeCredential(employee.id,'fixture',true,{NODE_ENV:'development'}),{status:503});
 const salt='ab'.repeat(32),password='offline-private-only';const registry=JSON.stringify({[employee.id]:{algorithm:'scrypt-v1',salt,hash:scryptSync(password,Buffer.from(salt,'hex'),64).toString('hex')}});
 const env={NODE_ENV:'production',PORTAL_EMPLOYEE_PASSWORD_VERIFIERS:registry};assert.equal(await verifyEmployeeCredential(employee.id,password,false,env),true);assert.equal(await verifyEmployeeCredential(employee.id,password,true,env),false);assert.equal(await verifyEmployeeCredential(employee.id,'wrong',false,env),false);
});
test('API reads scope employee aliases before querying; manager has role access and private collections stay inaccessible',async()=>{
 const f=database({'attendance/own':{employeeId:employee.id},'attendance/legacy':{empId:employee.id},'attendance/other':{employeeId:other.id}}),service=createPortalDataService(deps(f));
 await assert.rejects(service(null,body('list','attendance')),{status:401});
 assert.deepEqual((await service(employee,body('list','attendance'))).rows.map(row=>row.id),['legacy','own']);assert.ok(f.reads[0].filters.some(c=>c.kind==='or'));
 assert.equal((await service(manager,body('list','attendance'))).rows.length,3);
 await assert.rejects(service(employee,body('get','attendance','other')),{status:403});
 for(const name of ['loginAttempts','managerAttendanceHistory','managerAttendanceState','managerAttendanceDaily','managerAttendanceApprovals','attendanceState'])await assert.rejects(service(manager,body('list',name)),{status:403});
 const query=body('list','attendance');query.ref.constraints=[{kind:'where',field:'employeeId',op:'==',value:other.id}];await assert.rejects(service(employee,query),{status:403});
 assert.equal(canRead({...employee,role:'manager'},'salary_slips',{employeeId:other.id}),false);
});
test('employees retain leave requests/cancellation, worksheet submission and task completion but cannot self-approve or alter payroll',()=>{
 const leave={employeeId:employee.id,status:'pending',managerAssigned:false};
 assert.equal(authorizeWrite(employee,'leave_requests_v2',null,{employeeId:employee.id,reason:'Fixture',status:'pending',approvalTrail:[{role:'manager',status:'approved'}]},'add').approvalTrail[0].status,'pending');
 assert.equal(authorizeWrite(employee,'leave_requests_v2',leave,{status:'cancelled',cancelledBy:employee.id},'update').status,'cancelled');
 assert.throws(()=>authorizeWrite(employee,'leave_requests_v2',leave,{status:'approved'},'update'),{status:403});
 assert.throws(()=>authorizeWrite(employee,'leave_requests_v2',{...leave,managerAssigned:true},{status:'cancelled'},'update'),{status:403});
 const sheet={employeeId:employee.id,status:'submitted'};assert.equal(authorizeWrite(employee,'daily_worksheets',sheet,{taskSummary:'Work',status:'submitted'},'update').taskSummary,'Work');assert.throws(()=>authorizeWrite(employee,'daily_worksheets',sheet,{status:'approved'},'update'),{status:403});
 const task={assignedTo:employee.id,status:'assigned',statusHistory:[]};const complete=authorizeWrite(employee,'daily_tasks',task,{status:'completed',lastActionBy:employee.id,statusHistory:[{by:manager.id}]},'update');assert.equal(complete.statusHistory[0].by,employee.id);
 for(const name of ['salary_slips','portal_settings'])assert.throws(()=>authorizeWrite(employee,name,null,{employeeId:employee.id},'add'),{status:403});
 assert.throws(()=>authorizeWrite(employee,'daily_tasks',task,{assignedTo:other.id,status:'completed'},'update'),{status:403});
 assert.throws(()=>authorizeWrite(employee,'daily_tasks',null,{assignedTo:employee.id},'add'),{status:403});
});
test('manager approvals/payroll/tasks/settings stay supported; employee notifications remain scoped',()=>{
 for(const name of ['leave_requests_v2','daily_tasks','salary_slips','salary_slip_requests','reimbursements','attendance_corrections','daily_worksheets'])assert.ok(authorizeWrite(manager,name,null,{employeeId:employee.id},'add'));
 assert.equal(authorizeWrite(manager,'portal_settings',null,{saturdayHolidays:['2026-11-14'],updatedBy:manager.id},'set').updatedBy,manager.id);
 assert.equal(canRead(employee,'portal_notifications',{recipientRole:'manager',recipientId:null}),false);assert.equal(canRead(employee,'portal_notifications',{recipientRole:null,recipientId:employee.id}),true);
 assert.equal(authorizeWrite(employee,'portal_notifications',null,{recipientRole:'manager',recipientId:null,title:'Request',message:'Fixture',type:'leave',meta:{},read:false},'add').createdBy,employee.id);
 assert.throws(()=>authorizeWrite(employee,'portal_notifications',null,{recipientId:other.id,title:'Spoof'},'add'),{status:403});
 for(const name of ['attendance','breaks','attendanceDaily'])assert.throws(()=>authorizeWrite(manager,name,null,{employeeId:employee.id},'add'),{status:403});
});
test('transactional writes recheck ownership, preserve unknown fields and never commit rejected changes',async()=>{
 const f=database({'daily_worksheets/own':{employeeId:employee.id,status:'submitted',legacy:'retained'},'daily_worksheets/other':{employeeId:other.id,status:'submitted'}}),service=createPortalDataService(deps(f));
 await service(employee,body('update','daily_worksheets','own',{taskSummary:'Fixture',status:'submitted'}));assert.equal(f.rows.get('daily_worksheets/own').legacy,'retained');
 await assert.rejects(service(employee,body('update','daily_worksheets','other',{taskSummary:'attack',status:'submitted'})),{status:403});assert.equal(f.writes.length,1);
 f.setFailure(true);await assert.rejects(service(employee,body('update','daily_worksheets','own',{taskSummary:'lost',status:'submitted'})));assert.equal(f.rows.get('daily_worksheets/own').taskSummary,'Fixture');
});
test('employee daily commands recover, deduplicate, bind versions and preserve all three break types',async()=>{
 const f=database(),service=createEmployeeAttendance({...deps(f),now:()=>new Date('2026-11-14T04:30:00Z')});let state=await service(employee);
 assert.equal(state.state.startTime,undefined);assert.equal(f.writes.length,0);
 const command=(action,snapshot,key,breakType)=>({action,breakType,command:{key,date:snapshot.date,shiftId:snapshot.shiftId,expectedVersion:snapshot.version}});
 const start=command('clock-in',state,'start-key-123');state=await service(employee,start);assert.equal(state.state.startTime,'2026-11-14T04:30:00.000Z');const count=f.writes.length;
 assert.equal((await service(employee,start)).duplicate,true);assert.equal(f.writes.length,count);
 assert.equal((await service(employee)).version,state.version);
 await assert.rejects(service(manager,start),{status:403});await assert.rejects(service(null,start),{status:401});
 const stale=command('clock-out',{...state,version:0},'stale-key-123');await assert.rejects(service(employee,stale),{status:409});
 for(const type of ['Tea','Lunch','Evening']){
  state=await service(employee,command('start',state,`start-${type}-123`,type),{breakOperation:true});assert.equal(state.state.activeBreak.breakType,type);
  await assert.rejects(service(employee,command('start',state,`duplicate-${type}`,type),{breakOperation:true}),{status:409});
  state=await service(employee,command('end',state,`end-${type}-123`,type),{breakOperation:true});assert.equal(state.state.activeBreak,null);
 }
 await assert.rejects(service(employee,command('start',state,'breather-denied','Breather'),{breakOperation:true}),{status:400});
 const candidates=await Promise.allSettled([service(employee,command('clock-out',state,'concurrent-end-a')),service(employee,command('clock-out',state,'concurrent-end-b'))]);assert.equal(candidates.filter(r=>r.status==='fulfilled').length,1);
 assert.ok(f.rows.get('attendanceState/'+employee.id).endTime);assert.ok([...f.rows.values()].every(row=>!row.employeeId||row.employeeId===employee.id));
});
test('daily commit failures write nothing; delayed commands cannot close a later shift',async()=>{
 let now=new Date('2026-11-14T04:30:00Z');const f=database(),service=createEmployeeAttendance({...deps(f),now:()=>now});let state=await service(employee);
 const cmd=(action,key,s=state)=>({action,command:{key,date:s.date,shiftId:s.shiftId,expectedVersion:s.version}});
 f.setFailure(true);await assert.rejects(service(employee,cmd('clock-in','failed-start')));assert.equal(f.writes.length,0);
 f.setFailure(false);state=await service(employee,cmd('clock-in','good-start-1'));const delayed=cmd('clock-out','delayed-end-1');state=await service(employee,cmd('clock-out','good-end-123'));
 now=new Date('2026-11-15T04:30:00Z');state=await service(employee);state=await service(employee,cmd('clock-in','next-start-1'));await assert.rejects(service(employee,delayed),{status:409});assert.equal(f.rows.get('attendanceState/'+employee.id).endTime,undefined);
});
test('bounded legacy recovery protects existing punches and rejects ambiguous/undated evidence',async()=>{
 const f=database({'attendance/old':{employeeId:employee.id,date:'2026-11-14',action:'clock-in',timestamp:new Date('2026-11-14T04:00:00Z')}}),service=createEmployeeAttendance({...deps(f),now:()=>new Date('2026-11-14T04:30:00Z')});
 const state=await service(employee);assert.equal(state.state.startTime,'2026-11-14T04:00:00.000Z');assert.ok(f.reads.filter(row=>typeof row==='object').every(row=>row.cap===101));
 const bad=database({'attendance/old':{employeeId:employee.id,date:'2026-11-14',action:'clock-in',time:'10:00'}});await assert.rejects(createEmployeeAttendance({...deps(bad),now:()=>new Date('2026-11-14T04:30:00Z')})(employee),{status:409});
});
test('client coalesces duplicate posts, uses server versions and keeps the same receipt after a lost response',async()=>{
 let posts=0,lost=true;const snapshot={date:'2026-11-14',shiftId:'NTS-001_2026-11-14',version:0,state:{}};const bodies=[];
 const client=createEmployeeDailyClient({key:()=> 'fixed-key-123',fetcher:async(_path,options)=>{if(options.method==='GET')return Response.json(snapshot);posts++;bodies.push(JSON.parse(options.body));if(lost){lost=false;throw Error('lost response');}return Response.json({...snapshot,version:1,state:{startTime:'2026-11-14T04:30:00Z'}});}});
 await client.recover();await assert.rejects(client.perform('/api/attendance',{action:'clock-in',employeeId:other.id}));await client.perform('/api/attendance',{action:'clock-in'});assert.equal(posts,2);assert.deepEqual(bodies[0],bodies[1]);assert.equal('employeeId' in bodies[0],false);
});
test('JSON boundary rejects cross-shaped, oversized and non-JSON input; wire dates round-trip',async()=>{
 const request=(text,type='application/json')=>new Request('https://portal.example',{method:'POST',headers:{'content-type':type},body:text});
 await assert.rejects(readJsonBody(request('[]'),20),{status:400});await assert.rejects(readJsonBody(request('x'.repeat(30)),20),{status:413});await assert.rejects(readJsonBody(request('{}','text/plain'),20),{status:415});
 const date=new Date('2026-11-14T04:30:00Z');assert.equal(decode(encode(date)).toDate().toISOString(),date.toISOString());
});
test('source audit: no browser Firestore SDK, client credentials or realtime subscriptions remain; deny-all rules cover manager data',()=>{
 const walk=folder=>readdirSync(new URL('../'+folder,import.meta.url),{withFileTypes:true}).flatMap(entry=>entry.isDirectory()?walk(folder+'/'+entry.name):/\.(jsx?|mjs|tsx?)$/.test(entry.name)?[folder+'/'+entry.name]:[]);
 for(const file of ['app','components','contexts','hooks','lib','utils'].flatMap(walk)){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/from ['"]firebase\/(firestore|auth)['"]|\bonSnapshot\(/,file);
 }
 const constants=readFileSync(new URL('../utils/constants.js',import.meta.url),'utf8');assert.equal(/\bpassword\s*:|ADMIN_PASSWORD/.test(constants),false,'No credential fields in public directory');
 const auth=readFileSync(new URL('../contexts/AuthContext.js',import.meta.url),'utf8');assert.match(auth,/await loginSession/);assert.match(auth,/readSession\(\)/);assert.doesNotMatch(auth,/emp\.password|localStorage\.getItem/);
 const rules=readFileSync(new URL('../firestore.rules',import.meta.url),'utf8');assert.match(rules,/allow read, write: if false/);assert.doesNotMatch(rules,/allow[^;]*if true/);
 const days=managerAttendanceView();assert.equal(days.filter(row=>row.attendanceStatus==='Present').length,286);assert.equal(days.filter(row=>row.attendanceStatus==='Absent').length,0);assert.equal(days.filter(row=>row.attendanceStatus==='Weekly Off').length,114);assert.ok(days.filter(row=>row.approximateArrival).every(row=>managerLoginTime(row).startsWith(row.approximateArrival)));
});

test('real portal helpers complete leave, task, worksheet, reimbursement, correction, salary and holiday workflows through the authorized transport',async()=>{
 const f=database(),service=createPortalDataService(deps(f));let actor=employee;const originalFetch=globalThis.fetch;
 globalThis.fetch=async(path,options)=>{
  if(path==='/api/send-email')return Response.json({success:true}); // No external email.
  assert.equal(path,'/api/portal-data');
  try{return Response.json(await service(actor,JSON.parse(options.body)));}catch(error){return Response.json({error:error.message},{status:error.status||503});}
 };
 try {
  const raw=readFileSync(new URL('../lib/portal-helpers.js',import.meta.url),'utf8');const names=[...raw.matchAll(/export const (\w+)/g)].map(match=>match[1]);
  const source=raw.replace(/^import[\s\S]*?;\r?\n/gm,'').replaceAll('export const ','const ');
  const injected={...transport,employees:[employee,other,manager],MANAGER:{...manager},fetchAllAttendanceData:async()=>[]};
  const helpers=new Function(...Object.keys(injected),source+';return {'+names.join(',')+'};')(...Object.values(injected));
  const leave=await helpers.submitLeaveRequest({employeeId:employee.id,employeeName:employee.name,fromDate:'2026-11-16',toDate:'2026-11-16',reason:'Fixture',days:1});
  actor=manager;await helpers.reviewLeaveRequest({leaveId:leave,decision:'approved',approverId:manager.id,approverName:manager.name});assert.equal(f.rows.get('leave_requests_v2/'+leave).status,'approved');
  actor=employee;await helpers.cancelLeaveRequest({leaveId:leave,employeeId:employee.id,employeeName:employee.name});assert.equal(f.rows.get('leave_requests_v2/'+leave).status,'cancelled');
  actor=manager;const task=await helpers.createTask({title:'Fixture',assignedTo:employee.id,assignedToName:employee.name,assignedBy:manager.id,assignedByName:manager.name});
  actor=employee;await helpers.updateTaskStatus({taskId:task,status:'in_progress',actorId:employee.id,actorName:employee.name});await helpers.updateTaskStatus({taskId:task,status:'completed',actorId:employee.id,actorName:employee.name});assert.equal(f.rows.get('daily_tasks/'+task).status,'completed');
  const worksheet=await helpers.upsertWorksheet({employeeId:employee.id,employeeName:employee.name,date:'2026-11-14',taskSummary:'Fixture',hoursWorked:0,blockers:'',status:'submitted'});
  actor=manager;await helpers.reviewWorksheet({worksheetId:worksheet,status:'approved',reviewerId:manager.id,reviewerName:manager.name});assert.equal(f.rows.get('daily_worksheets/'+worksheet).status,'approved');
  actor=employee;const reimbursement=await helpers.createReimbursementRequest({employeeId:employee.id,employeeName:employee.name,amount:100,reason:'Fixture'});const correction=await helpers.createAttendanceCorrectionRequest({employeeId:employee.id,employeeName:employee.name,date:'2026-11-14',reason:'Fixture'});
  const salary=await helpers.createSalarySlipRequest({employeeId:employee.id,employeeName:employee.name,month:'2026-11'});
  actor=manager;await helpers.reviewReimbursement({reimbursementId:reimbursement,status:'approved',reviewerId:manager.id,reviewerName:manager.name});await helpers.reviewAttendanceCorrection({correctionId:correction,status:'approved',reviewerId:manager.id,reviewerName:manager.name});
  await helpers.reviewSalarySlipRequest({requestId:salary,decision:'approved',managerId:manager.id,managerName:manager.name});const slip=await helpers.createSalarySlipRecord({requestId:salary,employeeId:employee.id,employeeName:employee.name,month:'2026-11',generatedBy:manager.id,generatedByName:manager.name});assert.ok(f.rows.has('salary_slips/'+slip));
  await helpers.setSaturdayHoliday({date:'2026-11-14',isHoliday:true,managerId:manager.id,managerName:manager.name});actor=employee;assert.deepEqual((await helpers.fetchPortalSettings()).saturdayHolidays,['2026-11-14']);
  assert.equal((await helpers.fetchSalarySlips({employeeId:employee.id})).length,1);assert.equal((await helpers.fetchWorksheets({employeeId:employee.id})).length,1);
  actor=other;assert.equal((await helpers.fetchSalarySlips({employeeId:other.id})).length,0);assert.equal((await helpers.fetchTasks({assignedTo:other.id})).length,0);
 } finally {globalThis.fetch=originalFetch;transport.invalidatePortalTransport();}
});

test('real requireUser rejects anonymous/cross-site requests and derives roles from the server directory',async()=>{
 const env={SESSION_SECRET:'offline-private-session-key-with-32-bytes'};let token='';
 const raw=readFileSync(new URL('../lib/server/auth.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 const requireUser=new Function('cookies','employees','issuePortalSession','readPortalSession','PORTAL_SESSION_MS','process',raw+';return requireUser;')(
  async()=>({get:()=>token?{value:token}:undefined}),[employee,{...manager,role:'manager'}],issuePortalSession,readPortalSession,PORTAL_SESSION_MS,{env}
 );
 const request=(origin='https://portal.example',site='same-origin')=>new Request('https://portal.example/api/portal-data',{method:'POST',headers:{origin,'sec-fetch-site':site}});
 await assert.rejects(requireUser(request()),{status:401});token=issuePortalSession(employee.id,env);
 assert.equal((await requireUser(request())).id,employee.id);
 await assert.rejects(requireUser(request('https://attacker.example')),{status:403});await assert.rejects(requireUser(request('https://portal.example','cross-site')),{status:403});await assert.rejects(requireUser(request(),true),{status:403});
 token=issuePortalSession(manager.id,env);assert.equal((await requireUser(request())).role,'manager');
});

test('quota errors stop employee retries and account changes invalidate transport results and portal state',async()=>{
 let calls=0;const snapshot={date:'2026-11-14',shiftId:'NTS-001_2026-11-14',version:0,state:{employeeId:employee.id}};
 const client=createEmployeeDailyClient({expectedEmployeeId:employee.id,key:()=> 'quota-command',fetcher:async(_path,options)=>{calls++;return options.method==='GET'?Response.json(snapshot):Response.json({error:'Firestore quota exhausted',code:'FIRESTORE_QUOTA_EXCEEDED'},{status:503});}});
 await client.recover();await assert.rejects(client.perform('/api/attendance',{action:'clock-in'}));await assert.rejects(client.recover());assert.equal(calls,2);
 let release;const pending=new Promise(resolve=>{release=resolve;});
 const request=transport.portalRequest({operation:'get'},async()=>{await pending;return Response.json({data:'prior-account'});});transport.invalidatePortalTransport();release();await assert.rejects(request,{code:'SESSION_CHANGED'});
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');assert.match(source,/<PortalSession key=\{user\?\.id \|\| 'signed-out'\}/);
});

test('duplicate employee commands coalesce but a different concurrent transition is rejected',async()=>{
 let release,posts=0;const gate=new Promise(resolve=>{release=resolve;});
 const snapshot={date:'2026-11-14',shiftId:'NTS-001_2026-11-14',version:0,state:{employeeId:employee.id}};
 const client=createEmployeeDailyClient({key:()=> 'coalesced-key',fetcher:async(_path,options)=>{if(options.method==='GET')return Response.json(snapshot);posts++;await gate;return Response.json({...snapshot,version:1});}});
 await client.recover();const first=client.perform('/api/attendance',{action:'clock-in'}),duplicate=client.perform('/api/attendance',{action:'clock-in'});
 await assert.rejects(client.perform('/api/attendance',{action:'clock-out'}),/pending attendance/);assert.equal(posts,1);release();await Promise.all([first,duplicate]);assert.equal(posts,1);
});

test('the shared server connection refuses missing or conflicting project IDs before credential initialization',()=>{
 const source=readFileSync(new URL('../lib/server/firebase.js',import.meta.url),'utf8').replace(/^import .*;\r?\n/gm,'').replaceAll('export ','');
 const check=env=>new Function('process','globalThis','cert','getApps','initializeApp','getFirestore','applicationDefault','existsSync','homedir','path',source+';return adminOptions();')(
  {env,platform:'win32'},{},()=>{throw Error('must not initialize credentials');},()=>[],()=>{},()=>{},()=>{},()=>false,()=>'/offline',{join:(...parts)=>parts.join('/')}
 );
 assert.throws(()=>check({}),{status:503});assert.throws(()=>check({FIREBASE_PROJECT_ID:'different',NEXT_PUBLIC_FIREBASE_PROJECT_ID:'portal',FIREBASE_SERVICE_ACCOUNT_JSON:'{}'}),{status:503});
});
