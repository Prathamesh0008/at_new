import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createEmployeeRangeReader } from '../lib/employee-range-read.mjs';
import { refreshFailure, clearRefreshFailure } from '../lib/portal-refresh-status.mjs';
const scope = { employeeId:'fixture-1', start:'2026-11-01T00:00:00Z', end:'2026-11-30T23:59:59.999Z' };
const doc = (id, data) => ({ id, data:()=>data });
const missingIndex = () => { throw Object.assign(Error('index unavailable'),{code:'failed-precondition'}); };

test('missing composite query falls back to bounded timestamp reads and retains only the employee records',async()=>{
 const read=createEmployeeRangeReader();let fallback=0;
 const result=await read('attendance',scope,missingIndex,async(start,end,count)=>{
  fallback++;assert.ok(start>=new Date(scope.start));assert.ok(end<=new Date(scope.end));assert.equal(count,1001);
  return {docs:[doc('own',{employeeId:'fixture-1'}),doc('legacy',{empId:'fixture-1'}),doc('other',{employeeId:'fixture-2'}),doc('conflict',{employeeId:'fixture-1',empId:'fixture-2'})]};
 });
 assert.equal(fallback,1);assert.deepEqual(result[0].docs.map(row=>row.id),['own','legacy']);
});
test('successful existing indexed reads remain unchanged and do not incur fallback reads',async()=>{
 const expected=[{docs:[doc('original',{employeeId:'fixture-1'})]}];
 assert.equal(await createEmployeeRangeReader()('attendance',scope,async()=>expected,()=>assert.fail('extra read')),expected);
});
test('quota, permission and network errors propagate without fallback; manager and unbounded reads are excluded',async()=>{
 for(const code of ['resource-exhausted','permission-denied','unavailable'])await assert.rejects(createEmployeeRangeReader()('attendance',scope,()=>{throw Object.assign(Error('failure'),{code});},()=>assert.fail('must not retry')),{code});
 for(const excluded of [{...scope,employeeId:'NTS-MGR'},{employeeId:'fixture-1'}])await assert.rejects(createEmployeeRangeReader()('attendance',excluded,missingIndex,()=>assert.fail('manager/unbounded fallback')),{code:'failed-precondition'});
});
test('fallback mode avoids repeated failed queries, bounds larger ranges, deduplicates and refuses partial data',async()=>{
 let time=0,indexed=0;const read=createEmployeeRangeReader({now:()=>time});
 const attempt=()=>{indexed++;return missingIndex();};
 let chunks=0;const rangeRead=async(start,end)=>{chunks++;assert.ok(+end-+start<31*86400000);return {docs:[doc('own',{employeeId:'fixture-1'})]};};
 await read('breaks',scope,attempt,rangeRead);await read('breaks',scope,attempt,rangeRead);assert.equal(indexed,1);
 time=300001;await read('breaks',scope,attempt,rangeRead);assert.equal(indexed,2);
 chunks=0;const result=await read('breaks',{...scope,end:'2027-01-03T00:00:00Z'},attempt,rangeRead);assert.equal(chunks,3);assert.equal(result[0].docs.length,1);
 await assert.rejects(read('breaks',scope,attempt,async()=>({docs:Array.from({length:1001},(_,i)=>doc(String(i),{employeeId:'fixture-1'}))})),{code:'EMPLOYEE_RANGE_LIMIT'});
});
test('refresh reports the failing loader safely and clears only its own error after complete success',()=>{
 const jobs=[{section:'Leave'},{section:'Attendance'}];
 const message=refreshFailure(jobs,[{status:'fulfilled'},{status:'rejected',reason:{code:'failed-precondition',message:'private SDK detail'}}]);assert.match(message,/Attendance: failed-precondition/);assert.doesNotMatch(message,/private SDK/);
 assert.equal(clearRefreshFailure(message),'');assert.equal(clearRefreshFailure('Could not load attendance data.'),'Could not load attendance data.');
 assert.equal(refreshFailure(jobs,[{status:'fulfilled'},{status:'rejected',reason:{code:'READ_PAUSED'}}]),null);
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');assert.match(source,/results.every\(result => result.status === "fulfilled"\)/);assert.match(source,/setMessage\(clearRefreshFailure\)/);
});
test('active employee loading uses SDK helpers, bounded cached reads and no abandoned session proxy',()=>{
 for(const file of ['contexts/AuthContext.js','lib/firebase.js','lib/firebase-helpers.js','lib/portal-helpers.js','lib/portal-reads.js','app/portal/page.jsx']){
  const source=readFileSync(new URL('../'+file,import.meta.url),'utf8');assert.doesNotMatch(source,/\/api\/portal-data|portal-data-client|loginSession\(|readSession\(|nts_session/);
 }
 const source=readFileSync(new URL('../lib/firebase-helpers.js',import.meta.url),'utf8');assert.match(source,/employeeRangeRead\('attendance'/);assert.match(source,/employeeRangeRead\('breaks'/);assert.match(source,/orderBy\("timestamp", "desc"\), limit\(count\)/);
 const policy=readFileSync(new URL('../lib/portal-read-policy.mjs',import.meta.url),'utf8');assert.match(policy,/NOTIFICATION_INTERVAL_MS = 60000/);assert.match(policy,/BREAK_INTERVAL_MS = 30000/);assert.match(policy,/if \(blocked\) throw paused/);
});
