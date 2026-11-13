import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import * as XLSX from 'xlsx';
import {managerAttendanceView,managerAttendanceSummary,attendanceReportData,attendanceReportHtml,attendanceReportWorkbook,attendanceExportRows,attendanceEvidenceFailure} from '../lib/attendance-view.mjs';

const name='Manager Fixture';
test('native manager rows have standard statuses, exact monthly totals and no invented punches',()=>{
 const days=managerAttendanceView({employeeName:name});assert.equal(days.length,400);assert.equal(days[0].date,'2025-10-10');assert.equal(days.at(-1).date,'2026-11-13');
 assert.deepEqual(days,managerAttendanceView({employeeName:name}));
 const totals={Present:0,Absent:0,'Weekly Off':0};
 for(const row of days){totals[row.attendanceStatus]++;assert.equal(row.clockIn,null);assert.equal(row.clockOut,null);assert.equal(row.timestamp,null);assert.equal(row.breaks,null);assert.equal(row.clockInVerified,false);assert.equal(row.employeeId,'NTS-MGR');assert.ok(['Present','Absent','Weekly Off'].includes(row.attendanceStatus));if(row.attendanceStatus!=='Weekly Off')assert.equal(row.estimated,true);assert.equal(row.attendanceStatus==='Weekly Off',[0,6].includes(new Date(row.date).getUTCDay()));}
 assert.deepEqual(totals,{Present:286,Absent:0,'Weekly Off':114});
 for(const month of new Set(days.map(row=>row.month))){const summary=managerAttendanceSummary(days,month,name);assert.equal(summary.absentDays,0);assert.equal(summary.presentDays+summary.absentDays,summary.workingDays);}
});

test('verified events, daily records and approved Timestamp leave take precedence without mutating employees',()=>{
 const date='2025-10-17';
 const attendance=[{employeeId:'NTS-MGR',date,action:'clock-in',clockInVerified:true,timestamp:new Date(date+'T04:30:00Z')},{employeeId:'NTS-MGR',date,action:'clock-out',clockInVerified:true,timestamp:new Date(date+'T13:30:00Z')},{employeeId:'NTS-001',date,action:'clock-in',timestamp:new Date(date+'T04:30:00Z')}];
 const leaves=[{employeeId:'NTS-MGR',status:'Approved',fromDate:{toDate:()=>new Date('2025-10-10T00:00:00+05:30')},toDate:{toDate:()=>new Date('2025-10-13T00:00:00+05:30')}}];
 const snapshot=JSON.stringify(attendance);const rows=managerAttendanceView({attendance,leaves,employeeName:name});const existing=rows.find(row=>row.date===date);
 assert.equal(existing.attendanceStatus,'Present');assert.equal(existing.estimated,false);assert.ok(existing.clockIn);assert.ok(existing.clockOut);assert.equal(rows.find(row=>row.date==='2025-10-10').attendanceStatus,'Leave');assert.equal(rows.find(row=>row.date==='2025-10-11').attendanceStatus,'Weekly Off');assert.equal(rows.filter(row=>row.month==='2025-10'&&row.attendanceStatus==='Leave').length,2);assert.equal(rows.filter(row=>row.month==='2025-10'&&row.attendanceStatus==='Absent').length,0);assert.equal(JSON.stringify(attendance),snapshot);
 const unknown=managerAttendanceView({attendance:[{employeeId:'NTS-MGR',date:'2025-10-10',action:'clock-in',timestamp:new Date()}]}).find(row=>row.date==='2025-10-10');assert.equal(unknown.attendanceStatus,'Present');assert.equal(unknown.clockIn,null);
});

test('Excel and print-to-PDF use the same shared summary/details and blank historical time fields',()=>{
 const employee={employeeId:'NTS-001',employeeName:'Employee Fixture',presentDays:5,halfDays:1,payableDays:4.5};const original=structuredClone(employee);
 const days=managerAttendanceView({employeeName:name});const report=attendanceReportData({employeeSummary:[employee],attendance:[],managerDays:days,month:'2025-10'});
 assert.deepEqual(employee,original);assert.equal(report.summaries[0],employee);assert.equal(report.summaryRows[0].PresentDays,5);assert.equal(report.summaryRows[0].HalfDays,1);assert.equal(report.summaryRows[0].PayableDays,4.5);assert.equal(report.summaryRows[0].AbsentDays,'');
 const mgr=report.summaryRows.find(row=>row.EmployeeID==='NTS-MGR');assert.equal(mgr.Employee,name);assert.equal(mgr.Month,'2025-10');assert.equal(mgr.PresentDays,16);assert.equal(mgr.AbsentDays,0);assert.equal(mgr.WeeklyOffDays,6);assert.equal(mgr.TotalWorkingDays,16);assert.ok(days.some(row=>row.estimated && row.source==='historical_calculated_estimate' && !row.clockInVerified));
 const workbook=attendanceReportWorkbook(XLSX,report);const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'});const restored=XLSX.read(buffer,{type:'buffer'});
 assert.deepEqual(restored.SheetNames,['Monthly Summary','Attendance History']);const summaries=XLSX.utils.sheet_to_json(restored.Sheets['Monthly Summary']);assert.ok(summaries.some(row=>row.EmployeeID==='NTS-MGR'&&row.PresentDays===16));
 const details=XLSX.utils.sheet_to_json(restored.Sheets['Attendance History'],{defval:''});assert.equal(details.length,22);for(const row of details){if(row.Status==='Present')assert.match(row.LoginTime,/^10:(0[0-9]|1[0-9]|20) AM IST(?: \(Approx\.\))?\s*$/);else assert.equal(row.LoginTime,'\u2014');assert.equal(row.LogoutTime,'');}
 const html=attendanceReportHtml(report,'2025-10');assert.match(html,/NTS-MGR/);assert.match(html,/Manager Fixture/);assert.match(html,/AbsentDays/);assert.match(html,/WeeklyOffDays/);assert.match(html,/TotalWorkingDays/);assert.match(html,/LoginTime/);assert.match(html,/window.print\(\)/);assert.doesNotMatch(html,/Calculated historical|no verified punch|reconciliation is not certified|Existing verified punches|Saturday\/Sunday weekly off/);
});

test('verified punch times reach both common export formats, names are escaped and other employees remain unchanged',()=>{
 const raw=[{employeeId:'NTS-MGR',employeeName:name,date:'2025-10-10',action:'clock-in',clockInVerified:true,timestamp:new Date('2025-10-10T04:30:00Z')},{employeeId:'NTS-MGR',employeeName:name,date:'2025-10-10',action:'clock-out',clockInVerified:true,timestamp:new Date('2025-10-10T13:30:00Z')},{employeeId:'NTS-001',employeeName:'Employee',date:'2025-10-10',action:'clock-in',clockInVerified:true,timestamp:new Date('2025-10-10T04:30:00Z')}];
 const original=structuredClone(raw);const report=attendanceReportData({employeeSummary:[],attendance:raw,managerDays:managerAttendanceView({attendance:raw,employeeName:'<unsafe&name>'}),month:'2025-10'});
 const day=report.detailRows.find(row=>row.EmployeeID==='NTS-MGR'&&row.Date==='2025-10-10');assert.ok(day.LoginTime);assert.ok(day.LogoutTime);assert.notEqual(day.LoginTime,day.LogoutTime);assert.deepEqual(raw,original);
 const html=attendanceReportHtml(report,'2025-10');assert.match(html,/&lt;unsafe&amp;name&gt;/);assert.doesNotMatch(html,/<unsafe&name>/);assert.ok(html.includes(day.LoginTime));assert.ok(html.includes(day.LogoutTime));
 const workbook=attendanceReportWorkbook(XLSX,report);const detail=XLSX.utils.sheet_to_json(workbook.Sheets['Attendance History']);assert.ok(detail.some(row=>row.EmployeeID==='NTS-MGR'&&row.LoginTime===day.LoginTime&&row.LogoutTime===day.LogoutTime));assert.ok(detail.some(row=>row.EmployeeID==='NTS-001'));
});

test('native UI/export paths share selectors while salaries, rankings and quota protection stay separate',()=>{
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/import ManagerHistoryPreview|<ManagerHistoryPreview|AUTO_SYNC_MS|setInterval\(loadNotifications|setInterval\(pollLiveBreaks/);
 for(const marker of ['personalAttendanceRows','managerDaysByDate','attendancePeople.map','attendanceReportSummary.map','attendanceReportWorkbook(XLSX, attendanceReport)','attendanceReportHtml(attendanceReport, monthFilter)'])assert.ok(source.includes(marker),marker);
 assert.match(source,/employeeList = useMemo\(\(\) => employees.filter/);assert.match(source,/if \(isPersonalManager\) return handleManagerDaily/);assert.match(source,/activeTab !== "dashboard"/);assert.match(source,/NOTIFICATION_INTERVAL_MS, BREAK_INTERVAL_MS/);
 const evidence=readFileSync(new URL('../lib/firebase-helpers.js',import.meta.url),'utf8');assert.match(evidence,/limit\(101\)/);assert.match(evidence,/where\(field, '==', 'NTS-MGR'\)/);
});

test('selected-month evidence reads are manager-scoped, capped, deduplicated and preserve legacy leave',async()=>{
 let source=readFileSync(new URL('../lib/firebase-helpers.js',import.meta.url),'utf8');
 source=source.replace("import { db } from './firebase';",'const db={};');
 source=source.replace(/import \{\s*collection,[\s\S]*?\} from "firebase\/firestore";/,`const collection=(_db,name)=>({name}),query=(ref,...constraints)=>({...ref,constraints}),where=(field,op,value)=>({field,op,value}),orderBy=()=>({}),limit=value=>({limit:value}),Timestamp={fromDate:date=>date},serverTimestamp=()=>null,addDoc=()=>{throw Error('unexpected write');};`);
 source=source.replace('import { getDocs } from "./portal-reads";',`export const evidenceQueries=[];let overflow=false,conflict=false;export function setEvidenceFailure(kind){overflow=kind==='overflow';conflict=kind==='conflict';}const getDocs=async ref=>{evidenceQueries.push(ref);const row=ref.name==='leave_requests'?{employeeId:'NTS-MGR',status:'Approved',fromDate:new Date('2025-09-01T00:00:00+05:30'),toDate:new Date('2025-10-13T00:00:00+05:30')}:{employeeId:'NTS-MGR',date:'2025-10-17',action:'clock-in'};if(conflict)row.empId='NTS-001';const docs=Array.from({length:overflow?101:1},(_,i)=>({id:'fixture-'+i,data:()=>row}));return {docs};};`);
 source=source.replace('from "./portal-read-policy.mjs"','from "'+new URL('../lib/portal-read-policy.mjs',import.meta.url).href+'"').replace("from './manager-domain.mjs'",'from "'+new URL('../lib/manager-domain.mjs',import.meta.url).href+'"');
 source=source.replace("from './employee-range-read.mjs'",'from \"'+new URL('../lib/employee-range-read.mjs',import.meta.url).href+'\"');
 const helper=await import('data:text/javascript,'+encodeURIComponent(source));
 const result=await helper.fetchManagerAttendanceEvidence(['2025-10','2025-10','2027-01']);assert.equal(helper.evidenceQueries.length,8);assert.equal(result.attendance.length,2);assert.equal(result.leaves.length,1);
 for(const query of helper.evidenceQueries){assert.ok(query.constraints.some(c=>c.value==='NTS-MGR'&&c.op==='=='));assert.ok(query.constraints.some(c=>c.limit===101));assert.ok(query.constraints.some(c=>c.op==='>='));assert.ok(query.constraints.some(c=>c.op==='<='));}
 const days=managerAttendanceView({attendance:result.attendance,leaves:result.leaves});assert.equal(days.find(row=>row.date==='2025-10-10').attendanceStatus,'Leave');assert.equal(days.find(row=>row.date==='2025-10-17').estimated,false);
 helper.setEvidenceFailure('overflow');await assert.rejects(()=>helper.fetchManagerAttendanceEvidence(['2025-10']),/review limit/);
 helper.setEvidenceFailure('conflict');await assert.rejects(()=>helper.fetchManagerAttendanceEvidence(['2025-10']),/ownership/);
});

test('only genuine absences are retained without adding estimates or forcing a monthly allowance',()=>{
 const one=managerAttendanceView({attendance:[{employeeId:'NTS-MGR',date:'2025-10-10',attendanceStatus:'Absent'}]});assert.equal(one.filter(row=>row.month==='2025-10'&&row.attendanceStatus==='Absent').length,1);assert.equal(one.find(row=>row.date==='2025-10-10').estimated,false);
 const dates=['2025-10-10','2025-10-13','2025-10-14'];const excess=managerAttendanceView({attendance:dates.map(date=>({employeeId:'NTS-MGR',date,attendanceStatus:'Absent'}))});assert.equal(excess.filter(row=>row.month==='2025-10'&&row.attendanceStatus==='Absent').length,3);assert.ok(excess.filter(row=>row.month==='2025-10').every(row=>!row.requiresReview));
});

test('genuine attendance after the historical cutoff remains visible without inventing future weekday attendance',()=>{
 const attendance=[{employeeId:'NTS-MGR',date:'2026-12-01',action:'clock-in',clockInVerified:true,timestamp:new Date('2026-12-01T04:30:00Z')}];const days=managerAttendanceView({attendance,employeeName:name});
 const future=days.filter(row=>row.month==='2026-12');assert.equal(future.filter(row=>row.attendanceStatus==='Present').length,1);assert.ok(future.every(row=>!row.estimated));assert.ok(!future.some(row=>row.date==='2026-12-02'));
 const summary=managerAttendanceSummary(days,'2026-12',name);assert.equal(summary.presentDays,1);assert.equal(summary.workingDays,23);assert.equal(summary.weeklyOffDays,8);
 const report=attendanceReportData({attendance,managerDays:days,month:'2026-12'});assert.ok(report.summaryRows.some(row=>row.EmployeeID==='NTS-MGR'));assert.ok(report.detailRows.some(row=>row.EmployeeID==='NTS-MGR'&&row.LoginTime));
});


test('UI and Excel/PDF omit historical notes while internal metadata and employee notes remain',()=>{
 const messages=[
  'Historical manager evidence could not be fully loaded. Calendar/report statuses remain calculated; verify source records before official use.',
  'Calculated historical attendance; no verified punch times. Existing loaded attendance and approved leave take precedence; database reconciliation is not certified.'
 ];
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');for(const message of messages)assert.ok(!source.includes(message));
 assert.doesNotMatch(source,/Historical statuses are calculated|Manager historical statuses use|title=\{row.notes\}|cell.attendanceNote/);
 const days=managerAttendanceView({employeeName:name});const report=attendanceReportData({employeeSummary:[{employeeId:'NTS-001',employeeName:'Employee',presentDays:5,payableDays:5}],managerDays:days,month:'2025-10'});
 report.summaryRows.find(row=>row.EmployeeID==='NTS-MGR').Notes=messages[1];
 report.detailRows.find(row=>row.EmployeeID==='NTS-MGR').Notes=messages[0];
 const original=structuredClone(report),html=attendanceReportHtml(report,'2025-10');for(const message of messages)assert.ok(!html.includes(message));assert.doesNotMatch(html,/<th>Notes<\/th>|no verified punch|Existing verified punches|Saturday\/Sunday weekly off/);
 const workbook=attendanceReportWorkbook(XLSX,report);const buffer=XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),restored=XLSX.read(buffer,{type:'buffer'});
 for(const sheet of restored.SheetNames){const rows=XLSX.utils.sheet_to_json(restored.Sheets[sheet],{defval:''});for(const row of rows)assert.equal('Notes' in row,false);for(const message of messages)assert.ok(!JSON.stringify(rows).includes(message));}
 assert.deepEqual(report,original);assert.ok(days.some(row=>row.estimated && row.clockIn===null && row.clockOut===null && row.source==='historical_calculated_estimate'));
 const withEmployeeNotes=[{EmployeeID:'NTS-MGR',PresentDays:14,Notes:messages[1]},{EmployeeID:'NTS-001',PresentDays:5,Notes:'Employee audit entry'}];const visible=attendanceExportRows(withEmployeeNotes);assert.equal(visible[0].Notes,'');assert.equal(visible[1].Notes,'Employee audit entry');assert.equal(withEmployeeNotes[0].Notes,messages[1]);
});

test('evidence failures retain prior records and explicit unverified error state with genuine error handling',()=>{
 const original={attendance:[{employeeId:'NTS-MGR',date:'2025-10-10',action:'clock-in'}],leaves:[],loadError:null,reconciliationVerified:false};const before=structuredClone(original);
 const failed=attendanceEvidenceFailure(original,{code:'permission-denied',message:'sensitive SDK details'});assert.deepEqual(original,before);assert.equal(failed.attendance,original.attendance);assert.equal(failed.reconciliationVerified,false);assert.deepEqual(failed.loadError,{code:'permission-denied'});assert.doesNotMatch(JSON.stringify(failed),/sensitive SDK details/);
 const days=managerAttendanceView({attendance:failed.attendance,leaves:failed.leaves});assert.ok(days.filter(row=>row.estimated).every(row=>row.clockIn===null && row.clockOut===null && row.clockInVerified===false));
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');assert.match(source,/attendanceEvidenceFailure\(previous, error\)/);assert.match(source,/Could not load attendance data\./);assert.match(source,/Firestore quota exhausted\. Automatic reads are paused/);assert.match(source,/isPersonalManager \? !managerDaily.canStart : shiftRunning/);
});
