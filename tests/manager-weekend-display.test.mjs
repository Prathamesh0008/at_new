import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import { managerAttendanceView, attendanceReportData, attendanceReportWorkbook, attendanceReportHtml, punchTime } from '../lib/attendance-view.mjs';
const now = new Date('2026-11-16T06:00:00Z');

test('post-cutoff weekends default only in the past; future weekdays and weekends stay absent from rows', () => {
  const rows = managerAttendanceView({ now });
  for (const date of ['2026-11-14', '2026-11-15']) assert.equal(rows.find(row => row.date === date)?.attendanceStatus, 'Weekly Off');
  for (const date of ['2026-11-16', '2026-11-17', '2026-11-21', '2026-11-22']) assert.equal(rows.some(row => row.date === date), false);
  const historical = rows.filter(row => row.date <= '2026-11-13');
  assert.equal(historical.filter(row => row.attendanceStatus === 'Present').length, 286);
  assert.equal(historical.filter(row => row.attendanceStatus === 'Weekly Off').length, 114);
  assert.equal(historical.filter(row => row.attendanceStatus === 'Absent').length, 0);
  const sunday = managerAttendanceView({ now: new Date('2026-11-14T18:31:00Z') });
  assert.equal(sunday.some(row => row.date === '2026-11-15'), false);
  assert.equal(sunday.find(row => row.date === '2026-11-14').attendanceStatus, 'Weekly Off');
});

test('weekend punches override schedule, retain genuine times and reach both existing export formats', () => {
  const attendance = [{ employeeId: 'NTS-MGR', date: '2026-11-14', clockIn: '2026-11-14T04:35:00Z', clockOut: '2026-11-14T13:30:00Z', clockInVerified: true, estimated: false }, { employeeId: 'NTS-001', date: '2026-11-15', attendanceStatus: 'Absent' }];
  const original = structuredClone(attendance);
  const rows = managerAttendanceView({ attendance, now });
  const row = rows.find(row => row.date === '2026-11-14');
  assert.equal(row.attendanceStatus, 'Present'); assert.equal(row.clockIn, new Date(attendance[0].clockIn).toISOString()); assert.equal(row.clockOut, new Date(attendance[0].clockOut).toISOString()); assert.equal(row.approximateArrival, null);
  const report = attendanceReportData({ managerDays: rows, month: '2026-11' });
  const workbook = attendanceReportWorkbook(XLSX, report);
  const details = XLSX.utils.sheet_to_json(workbook.Sheets['Attendance History']);
  const detail = details.find(row => row.Date === '2026-11-14');
  assert.equal(detail.Status, 'Present'); assert.equal(detail.LoginTime, punchTime(attendance[0].clockIn)); assert.equal(detail.LogoutTime, punchTime(attendance[0].clockOut));
  const html = attendanceReportHtml(report, '2026-11'); assert.ok(html.includes(detail.LoginTime)); assert.ok(html.includes(detail.LogoutTime));
  assert.deepEqual(attendance, original);
  assert.equal(rows.find(row => row.date === '2026-11-15').attendanceStatus, 'Weekly Off');
});

test('approved weekend leave and genuine absence survive without inferred times', () => {
  const leaves = [{ employeeId: 'NTS-MGR', status: 'approved', fromDate: '2026-11-15', toDate: '2026-11-15' }, { employeeId: 'NTS-MGR', status: 'approved', fromDate: '2026-11-22', toDate: '2026-11-22' }];
  const rows = managerAttendanceView({ now, leaves, attendance: [{ employeeId: 'NTS-MGR', date: '2026-11-14', attendanceStatus: 'Absent' }] });
  assert.equal(rows.find(row => row.date === '2026-11-14').attendanceStatus, 'Absent');
  for (const date of ['2026-11-15', '2026-11-22']) { const row = rows.find(row => row.date === date); assert.equal(row.attendanceStatus, 'Leave'); assert.equal(row.clockIn, null); assert.equal(row.clockOut, null); }
});

test('calendar and heatmap consume manager statuses instead of independent weekend assumptions', () => {
  const source = readFileSync(new URL('../app/portal/page.jsx', import.meta.url), 'utf8');
  assert.ok(source.includes('managerDay?.attendanceStatus === "Weekly Off" ? "Weekly Off" : ""'));
  assert.ok(source.includes('managerDaysByDate.get(key)?.attendanceStatus === "Weekly Off"'));
  assert.ok(source.includes('emp.id === "NTS-MGR" ? (managerDaysByDate.get(date)?.attendanceStatus || "")'));
});
