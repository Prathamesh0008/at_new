import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

async function helpers(){
 let source=readFileSync(new URL('../lib/portal-helpers.js',import.meta.url),'utf8');
 source=source.replace('import { db } from "@/lib/firebase";','const db={};');
 source=source.replace(/import \{\s*addDoc,[\s\S]*?\} from "firebase\/firestore";/,`const collection=(_db,name)=>({name}),doc=(_db,name,id)=>({name,id}),query=(ref,...constraints)=>({...ref,constraints}),where=(field,op,value)=>({field,op,value}),serverTimestamp=()=> 'server-fixture';const addDoc=async(ref,row)=>{offlineWrites.push({kind:'add',name:ref.name,row});return {id:'new-fixture'};};const updateDoc=async(ref,row)=>{offlineWrites.push({kind:'update',name:ref.name,id:ref.id,row});};const setDoc=async()=>{throw Error('not used');};`);
 source=source.replace('import { getDoc, getDocs } from "./portal-reads";',`export const offlineReads=[],offlineWrites=[];export const offlineRows={leave_requests_v2:[{id:'leave-own',employeeId:'fixture-1',status:'approved',leaveType:'Half Day',days:0.5,fromDate:'2026-11-04',toDate:'2026-11-04'},{id:'leave-other',employeeId:'fixture-2'}],daily_tasks:[{id:'task-own',employeeId:'fixture-1'},{id:'task-other',assignedTo:'fixture-2'}],daily_worksheets:[{id:'worksheet-own',employeeId:'fixture-1'},{id:'worksheet-other',employeeId:'fixture-2'}],salary_slip_requests:[{id:'request-own',employeeId:'fixture-1'},{id:'request-other',employeeId:'fixture-2'}],salary_slips:[{id:'slip-existing',employeeId:'fixture-1',month:'2026-11'}]};const getDocs=async(ref,options)=>{offlineReads.push({ref,options});return {docs:(offlineRows[ref.name]||[]).filter(row=>(ref.constraints||[]).every(c=>row[c.field]===c.value)).map(row=>({id:row.id,data:()=>({...row})}))};};const getDoc=async()=>{throw Error('not used');};`);
 source=source.replace('import { fetchAllAttendanceData } from "@/lib/firebase-helpers";','const fetchAllAttendanceData=async()=>{throw Error("Summary must reuse supplied attendance");};');
 source=source.replace('import { MANAGER, employees } from "@/utils/constants";','const MANAGER={id:"fixture-manager",name:"Manager"};const employees=[{id:"fixture-1",name:"Person",role:"employee"},MANAGER];');
 return import('data:text/javascript,'+encodeURIComponent(source));
}

test('employee collections and legacy task aliases are scoped without losing rows',async()=>{
 const portalHelpers=await helpers();
 for(const [fn,ids] of [['fetchLeaveRequests',['leave-own']],['fetchWorksheets',['worksheet-own']],['fetchSalarySlipRequests',['request-own']],['fetchSalarySlips',['slip-existing']]]){
  assert.deepEqual((await portalHelpers[fn]({employeeId:'fixture-1'})).map(row=>row.id),ids);
 }
 assert.deepEqual((await portalHelpers.fetchTasks({assignedTo:'fixture-1'})).map(row=>row.id),['task-own']);
 for(const {ref} of portalHelpers.offlineReads)assert.ok(ref.constraints.some(c=>c.value==='fixture-1'));
});

test('monthly summary reuses rows with unchanged payable-day calculation; salary duplicate check stays fresh',async()=>{
 const portalHelpers=await helpers();const before=portalHelpers.offlineReads.length;
 const summary=await portalHelpers.fetchMonthlyAttendanceSummary({year:'2026',month:'11',employees:[{id:'fixture-1',name:'Person',role:'employee'},{id:'fixture-manager',role:'manager'}],attendance:[{empId:'fixture-1',empName:'Person',date:'2026-11-03',timestamp:new Date('2026-11-03T10:00:00'),action:'clock-in'}],leaves:[{employeeId:'fixture-1',status:'approved',leaveType:'Half Day',days:0.5,fromDate:'2026-11-04'}]});
 assert.equal(portalHelpers.offlineReads.length,before);assert.equal(summary.length,1);assert.equal(summary[0].presentDays,2);assert.equal(summary[0].payableDays,1.5);
 const id=await portalHelpers.createSalarySlipRecord({employeeId:'fixture-1',employeeName:'Person',month:'2026-11'});assert.equal(id,'slip-existing');
 assert.equal(portalHelpers.offlineReads.at(-1).options.maxAge,0);assert.ok(portalHelpers.offlineWrites.some(write=>write.kind==='update'&&write.name==='salary_slips'));
 assert.ok(!portalHelpers.offlineWrites.some(write=>write.kind==='add'&&write.name==='salary_slips'));
});

test('attendance reads retain employee aliases and date bounds; quota is never reported as empty history',async()=>{
 let source=readFileSync(new URL('../lib/firebase-helpers.js',import.meta.url),'utf8');
 source=source.replace("import { db } from './firebase';",'const db={};');
 source=source.replace(/import \{\s*collection,[\s\S]*?\} from "firebase\/firestore";/,`const collection=(_db,name)=>({name}),query=(ref,...constraints)=>({...ref,constraints}),where=(field,op,value)=>({field,op,value}),orderBy=(field,op)=>({field,op}),Timestamp={fromDate:date=>date},serverTimestamp=()=> 'server-fixture',addDoc=async()=>{throw Error('unexpected write');};`);
 source=source.replace('import { getDocs } from "./portal-reads";',`export const offlineQueries=[];let offlineQuota=false;export function setOfflineQuota(){offlineQuota=true;}const fixtureRows=[{id:'own',employeeId:'fixture-1',action:'clock-in',timestamp:new Date('2026-11-14T10:00:00Z')},{id:'legacy',empId:'fixture-1',action:'clock-in',timestamp:new Date('2026-11-14T11:00:00Z')},{id:'other',employeeId:'fixture-2',timestamp:new Date('2026-11-14T10:00:00Z')},{id:'old',employeeId:'fixture-1',timestamp:new Date('2025-11-14T10:00:00Z')}];const getDocs=async ref=>{offlineQueries.push(ref);if(offlineQuota)throw Object.assign(Error('quota'),{code:'resource-exhausted'});const docs=(ref.name==='attendance'?fixtureRows:[]).filter(row=>(ref.constraints||[]).every(c=>c.op==='desc'||(c.op==='=='?row[c.field]===c.value:c.op==='>='?row[c.field]>=c.value:row[c.field]<=c.value))).map(row=>({id:row.id,data:()=>({...row,timestamp:{toDate:()=>row.timestamp}})}));return {docs,forEach:fn=>docs.forEach(fn)};};const console={log(){},error(){}};`);
 source=source.replace('from "./portal-read-policy.mjs"','from "'+new URL('../lib/portal-read-policy.mjs',import.meta.url).href+'"');
 source=source.replace("from './manager-domain.mjs'",'from "'+new URL('../lib/manager-domain.mjs',import.meta.url).href+'"');
 source=source.replace("from './employee-range-read.mjs'",'from \"'+new URL('../lib/employee-range-read.mjs',import.meta.url).href+'\"');
 const firebaseHelpers=await import('data:text/javascript,'+encodeURIComponent(source));
 const rows=await firebaseHelpers.fetchAllAttendanceData({employeeId:'fixture-1',start:'2026-11-14T00:00:00Z',end:'2026-11-14T23:59:59Z'});
 assert.deepEqual(rows.map(row=>row.id),['own','legacy']);assert.equal(firebaseHelpers.offlineQueries.length,2);
 for(const query of firebaseHelpers.offlineQueries){assert.ok(query.constraints.some(c=>c.op==='>='));assert.ok(query.constraints.some(c=>c.op==='<='));}
 firebaseHelpers.setOfflineQuota();await assert.rejects(()=>firebaseHelpers.fetchAllAttendanceData(),{code:'resource-exhausted'});await assert.rejects(()=>firebaseHelpers.fetchAllDataForExcel(),{code:'resource-exhausted'});
});
