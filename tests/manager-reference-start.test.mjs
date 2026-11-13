import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { managerAttendanceView, managerLoginTime, attendanceReportData, attendanceReportHtml, attendanceReportWorkbook } from '../lib/attendance-view.mjs';

test('historical statuses and totals remain intact, with stable approximate arrivals separate from punches',()=>{
 const days=managerAttendanceView();assert.equal(days.length,400);assert.equal(days.filter(row=>row.approximateArrival).length,286);assert.ok(new Set(days.map(row=>row.approximateArrival).filter(Boolean)).size>1);
 for(const [status,total] of [['Present',286],['Absent',0],['Weekly Off',114]])assert.equal(days.filter(row=>row.attendanceStatus===status).length,total);
 for(const row of days){assert.equal(row.clockIn,null);assert.equal(row.clockOut,null);assert.equal(row.timestamp,null);assert.equal(row.clockInVerified,false);assert.equal('referenceStart' in row,false);if(row.attendanceStatus==='Present')assert.ok(managerLoginTime(row).startsWith(row.approximateArrival));else assert.equal(managerLoginTime(row),'\u2014');if(row.attendanceStatus==='Present')assert.match(row.approximateArrival,/^10:(0[0-9]|1[0-9]|20) AM IST$/);else assert.equal(row.approximateArrival,null);}
 assert.deepEqual(days,managerAttendanceView());
});
test('verified punches take precedence, approved leave stays Leave and unverified punches stay blank internally',()=>{
 const attendance=[{employeeId:'NTS-MGR',date:'2025-10-10',clockInVerified:true,clockIn:'2025-10-10T04:30:00Z',clockOut:'2025-10-10T13:30:00Z'},{employeeId:'NTS-MGR',date:'2025-10-13',action:'clock-in',timestamp:new Date('2025-10-13T04:30:00Z')}];
 const leaves=[{employeeId:'NTS-MGR',status:'approved',fromDate:'2025-10-14',toDate:'2025-10-14'}],before=structuredClone({attendance,leaves});
 const days=managerAttendanceView({attendance,leaves});
 const verified=days.find(row=>row.date==='2025-10-10');assert.notEqual(managerLoginTime(verified),'\u2014');assert.equal(verified.clockIn,'2025-10-10T04:30:00.000Z');assert.equal(verified.approximateArrival,null);
 const unknown=days.find(row=>row.date==='2025-10-13');assert.equal(unknown.clockIn,null);assert.equal(unknown.approximateArrival,null);assert.equal(managerLoginTime(unknown),'\u2014');
 assert.equal(days.find(row=>row.date==='2025-10-14').attendanceStatus,'Leave');assert.deepEqual({attendance,leaves},before);
});
test('UI, Excel and PDF label approximate arrivals separately and preserve actual logins and employee values',()=>{
 const employee={employeeId:'NTS-001',employeeName:'Employee',date:'2025-10-10',action:'clock-in',clockInVerified:true,timestamp:new Date('2025-10-10T04:30:00Z')},before=structuredClone(employee);
 const attendance=[employee,{employeeId:'NTS-MGR',date:'2025-10-10',clockInVerified:true,clockIn:'2025-10-10T04:30:00Z'}];
 const report=attendanceReportData({attendance,managerDays:managerAttendanceView({attendance}),month:'2025-10'});
 const workbook=attendanceReportWorkbook(XLSX,report),restored=XLSX.read(XLSX.write(workbook,{type:'buffer',bookType:'xlsx'}),{type:'buffer'});
 const rows=XLSX.utils.sheet_to_json(restored.Sheets['Attendance History'],{defval:''});
 for(const row of rows){assert.equal('Reference Start' in row,false);if(row.EmployeeID==='NTS-MGR'){assert.equal(row.LogoutTime,'');if(row.Date!=='2025-10-10'&&row.Status==='Present')assert.match(row.LoginTime,/^10:(0[0-9]|1[0-9]|20) AM IST(?: \(Approx\.\))?\s*$/);else if(row.Date==='2025-10-10'){assert.notEqual(row.LoginTime,'\u2014');assert.doesNotMatch(row.LoginTime,/Approx/);}else assert.equal(row.LoginTime,'\u2014');}}
 for(const row of rows)assert.equal('Arrival Time (Approx.)' in row,false);
 assert.deepEqual(employee,before);assert.ok(rows.find(row=>row.EmployeeID==='NTS-001').LoginTime);
 const html=attendanceReportHtml(report,'2025-10');assert.doesNotMatch(html,/Reference Start/);assert.match(html,/<th>LoginTime<\/th>/);assert.doesNotMatch(html,/Arrival Time \(Approx\.\)/);for(const row of rows)assert.ok(html.includes(row.LoginTime));assert.match(html,/<td>\u2014<\/td>/);
 const source=readFileSync(new URL('../app/portal/page.jsx',import.meta.url),'utf8');assert.doesNotMatch(source,/Reference Start|referenceStart|Arrival Time \(Approx\.\)/);assert.match(source,/loginTime: managerLoginTime\(row\)/);
});

test('estimates follow final absence adjustments and stop at historical bounds without changing employee-only exports',()=>{
 const days=managerAttendanceView({attendance:[{employeeId:'NTS-MGR',date:'2025-10-10',attendanceStatus:'Absent'},{employeeId:'NTS-MGR',date:'2026-12-01',clockInVerified:true,clockIn:'2026-12-01T04:30:00Z'}]});
 assert.equal(days.filter(row=>row.month==='2025-10'&&row.attendanceStatus==='Absent').length,1);
 assert.ok(days.filter(row=>row.estimated).every(row=>!!row.approximateArrival===(row.attendanceStatus==='Present')));
 assert.ok(days.filter(row=>row.date>'2026-11-13').every(row=>row.approximateArrival===null));
 const report=attendanceReportData({attendance:[{employeeId:'NTS-001',date:'2025-10-10',attendanceStatus:'Present'}],month:'2025-10'});
 assert.equal('Arrival Time (Approx.)' in report.detailRows[0],false);
});

test('date hash is non-sequential, stable across month selection, and provenance stays out of punch columns',()=>{
 const days=managerAttendanceView(),present=days.filter(row=>row.approximateArrival);
 const minute=row=>Number(row.approximateArrival.slice(3,5));
 assert.ok(present.slice(1).filter((row,i)=>minute(row)===minute(present[i])+1).length < present.length/4,'hash must not generate an overall sequential minute pattern');
 const values=new Set(present.map(minute));assert.ok(values.has(0));assert.ok(values.has(20));assert.ok(values.size>15);
 for(const month of [...new Set(days.map(row=>row.month))]){
  const report=attendanceReportData({managerDays:days,month});
  for(const row of report.detailRows){
   const source=days.find(day=>day.date===row.Date);assert.equal(row.LoginTime,managerLoginTime(source));
   const metadata=report.detailMetadata[source.id];assert.equal(metadata.source,source.source);assert.equal(metadata.clockInVerified,false);assert.equal(metadata.approximateArrival,source.approximateArrival);
   assert.equal(metadata.arrivalTimeSource,source.approximateArrival?'date_hash_arrival_estimate':null);
   assert.equal(source.clockIn,null);assert.equal(source.clockOut,null);
  }
 }
});
