import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {previewManagerHistory,proposedRecords,MANAGER_ID,START,END} from '../lib/manager-history.mjs';
const approval={trustedServerIdentity:true,employeeId:MANAGER_ID,role:'manager',reviewed:true,confirmed:true,approvedBy:'offline-test',approvedAt:'offline-test'};
test('inclusive boundaries, weekends, weekday presence and no generated absences',()=>{
 const p=previewManagerHistory(); const days=p.months.flatMap(m=>m.days);
 assert.equal(days[0].date,START);assert.equal(days.at(-1).date,END);assert.equal(days.length,400);assert.equal(p.months.length,14);
 assert.deepEqual(p,previewManagerHistory());
 for(const m of p.months){assert.equal(m.absentDates.length,0);assert.equal(m.present,m.eligible);}
 for(const d of days){const off=[0,6].includes(new Date(d.date).getUTCDay());assert.equal(d.status==='Weekly Off',off);}
});
test('stable unique IDs, null timestamps, employee isolation and no input mutation',()=>{
 const input={attendance:[{employeeId:'NTS-001',date:START}],reconciled:true};const before=JSON.stringify(input);
 const p=previewManagerHistory(input);const rows=proposedRecords(p,approval);
 assert.equal(JSON.stringify(input),before);assert.equal(new Set(rows.map(r=>r.id)).size,rows.length);assert.deepEqual(rows,proposedRecords(p,approval));
 for(const r of rows){assert.equal(r.employeeId,MANAGER_ID);assert.equal(r.clockIn,null);assert.equal(r.clockOut,null);assert.equal(r.breaks,null);assert.equal(r.clockInVerified,false);assert.equal(r.estimated,true);}
});
test('existing attendance and approved leave protected; overlapping dates flagged',()=>{
 const date=START;
 const p=previewManagerHistory({attendance:[{employeeId:MANAGER_ID,date}],leaves:[{employeeId:MANAGER_ID,status:'approved',fromDate:date,toDate:date}],reconciled:true});
 assert.ok(!p.months[0].absentDates.includes(date));assert.ok(p.months[0].review.length);assert.throws(()=>proposedRecords(p,approval));
 const q=previewManagerHistory({leaves:[{employeeId:MANAGER_ID,status:'approved',fromDate:START,toDate:END}],reconciled:true});
 assert.ok(q.months.every(m=>m.absentDates.length===0 && m.present===0 && m.review.length===0));
});
test('authorization, review, confirmation and reconciliation required',()=>{
 const p=previewManagerHistory({reconciled:true});
 for(const bad of [null,{...approval,employeeId:'NTS-001'},{...approval,role:'employee'},{...approval,trustedServerIdentity:false},{...approval,reviewed:false},{...approval,confirmed:false}]) assert.throws(()=>proposedRecords(p,bad));
 assert.throws(()=>proposedRecords(previewManagerHistory(),approval));
});
test('UI has no automatic history polling; legacy backfill route refuses operations',async()=>{
 const ui=readFileSync(new URL('../lib/attendance-view.mjs',import.meta.url),'utf8');assert.doesNotMatch(ui,/setInterval|setTimeout|useEffect|localStorage|onSnapshot/);
 const source=readFileSync(new URL('../app/api/attendance/backfill/route.js',import.meta.url),'utf8');
 const route=await import('data:text/javascript,'+encodeURIComponent(source));
 for(const handler of [route.GET,route.POST]){const result=handler();assert.equal(result.status,503);assert.equal((await result.json()).code,'MANAGER_AUTH_BLOCKED');}
 assert.doesNotMatch(source,/serverDb|requireUser|request\.json|firebase/);
});


test('simple manager display retains baseline monthly totals and blocks unauthenticated shifts',()=>{
 const history=previewManagerHistory();
 const total=history.months.reduce((sum,row)=>({present:sum.present+row.present,absent:sum.absent+row.absentDates.length,off:sum.off+row.weeklyOff,eligible:sum.eligible+row.eligible}),{present:0,absent:0,off:0,eligible:0});
 assert.deepEqual(total,{present:286,absent:0,off:114,eligible:286});
 assert.equal(history.months[0].eligible,16);assert.equal(history.months.at(-1).eligible,10);
 const portal=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(portal,/import ManagerHistoryPreview/);
 assert.match(portal,/role === "employee" \|\| isPersonalManager/);assert.match(portal,/personalAttendanceRows/);assert.match(portal,/isPersonalManager \? !managerDaily.canStart : shiftRunning/);
 assert.match(portal,/useManagerDailyAttendance/);
});

test('every month uses all working weekdays, with no automatic absences in UI and export selectors',async()=>{
 const {managerAttendanceView,managerAttendanceSummary,attendanceReportData}=await import('../lib/attendance-view.mjs');
 const preview=previewManagerHistory(),days=managerAttendanceView();
 const present=[16,20,23,22,20,22,22,21,22,23,21,22,22,10],off=[6,10,8,9,8,9,8,10,8,8,10,8,9,3];
 for(const [index,month] of preview.months.entries()){
  assert.equal(month.present,present[index]);assert.equal(month.weeklyOff,off[index]);assert.deepEqual(month.absentDates,[]);
  const summary=managerAttendanceSummary(days,month.month);assert.equal(summary.presentDays,present[index]);assert.equal(summary.absentDays,0);assert.equal(summary.weeklyOffDays,off[index]);
  const report=attendanceReportData({managerDays:days,month:month.month});assert.equal(report.summaryRows[0].PresentDays,present[index]);assert.equal(report.summaryRows[0].AbsentDays,0);assert.ok(report.detailRows.every(row=>row.Status!=='Absent'));
 }
});
