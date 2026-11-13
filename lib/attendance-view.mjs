import { previewManagerHistory, MANAGER_ID, START, END } from './manager-history.mjs';
import { normalizedDate, validDate, monthBounds, daysBetween } from './manager-domain.mjs';

export const HISTORY_NOTE = '';
export function safeAttendanceEvidenceCode(error) {
  const code = String(error?.code || '').replace(/^firestore\//, '');
  return ['permission-denied', 'failed-precondition', 'unavailable', 'resource-exhausted', 'READ_PAUSED', 'EVIDENCE_OVERFLOW', 'EVIDENCE_OWNERSHIP'].includes(code) ? code : 'EVIDENCE_LOAD_FAILED';
}
export function attendanceEvidenceFailure(previous, error) {
  return { ...previous, loadError: { code: String(error?.code || 'ATTENDANCE_EVIDENCE_LOAD_FAILED') }, reconciliationVerified: false };
}
const owner = row => (row.employeeId || row.empId) === MANAGER_ID;
const stamp = value => {
  const date = value?.toDate?.() || (value instanceof Date ? value : typeof value === 'string' && value.includes('T') ? new Date(value) : null);
  return date instanceof Date && !Number.isNaN(+date) ? date.toISOString() : null;
};
const action = row => String(row.action || '').toLowerCase().replace(/_/g, '-');
const starts = row => ['clock-in', 'shift-start', 'start'].includes(action(row));
const ends = row => ['clock-out', 'shift-end', 'end'].includes(action(row));
export const punchTime = value => value ? new Date(value).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: true }) : '';
// Presentation-only, deterministic time estimate; never a clock-in/event timestamp.
export function managerApproximateArrival(row) {
  if (row.employeeId !== MANAGER_ID || !validDate(row.date) || row.date < START || row.date > END || row.attendanceStatus !== 'Present' || row.estimated !== true || row.source !== 'historical_calculated_estimate' || row.approvedLeave || row.hasRecordedPunch || row.clockIn || row.clockOut || row.clockInVerified || row.clockOutVerified) return null;
  // FNV-1a plus avalanche mixing avoids the sequential minute pattern of
  // a simple polynomial hash on consecutive YYYY-MM-DD strings.
  let hash = 0x811c9dc5;
  for (const character of `NTS-MGR|arrival-v1|${row.date}`) hash = Math.imul(hash ^ character.charCodeAt(0), 0x01000193) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b) >>> 0;
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35) >>> 0;
  hash = (hash ^ (hash >>> 16)) >>> 0;
  return `10:${String(hash % 21).padStart(2, '0')} AM IST`;
}
export function managerLoginTime(row) {
  const actual = punchTime(row.clockIn);
  if (actual) return actual;
  const approximate = managerApproximateArrival(row);
  if (approximate) return `${approximate} `;
  return row.employeeId === MANAGER_ID && validDate(row.date) && row.date >= START && row.date <= END ? '\u2014' : '';
}
function rowDate(row) {
  try { return normalizedDate(row.date || row.timestamp); } catch { return ''; }
}

// View rows are never shift events and are never written to Firebase.
export function managerAttendanceView({ attendance = [], leaves = [], employeeName = 'Manager' } = {}) {
  const records = attendance.filter(owner).map(row => ({ ...row, date: rowDate(row) }));
  const normalizedLeaves = leaves.filter(owner).map(row => {
    try { return { ...row, fromDateValue: normalizedDate(row.fromDateValue || row.fromDate), toDateValue: normalizedDate(row.toDateValue || row.toDate) }; }
    catch { return row; }
  });
  const preview = previewManagerHistory({ attendance: records, leaves: normalizedLeaves });
  const entries = preview.months.flatMap(month => month.days.map(day => ({ month, day })));
  const dates = new Set(entries.map(entry => entry.day.date));
  const actualFutureMonths = new Set();
  for (const record of records.filter(row => validDate(row.date) && row.date > END)) {
    actualFutureMonths.add(record.date.slice(0, 7));
    if (dates.has(record.date)) continue;
    dates.add(record.date);
    entries.push({ month: { month: record.date.slice(0, 7), review: [] }, day: { date: record.date, status: 'Existing' } });
  }
  for (const month of actualFutureMonths) {
    const { start, end } = monthBounds(month);
    for (const date of daysBetween(start, end)) {
      if (date <= END || dates.has(date) || ![0, 6].includes(new Date(date).getUTCDay())) continue;
      dates.add(date);
      entries.push({ month: { month, review: [] }, day: { date, status: 'Weekly Off' } });
    }
  }
  const rows = entries.map(({ month, day }) => {
    const existing = records.filter(row => row.date === day.date);
    const verified = existing.filter(row => row.clockInVerified === true && row.estimated !== true);
    const clockIn = verified.map(row => stamp(row.clockIn || row.startTime || row.shiftStartTime || (starts(row) ? row.timestamp : null))).filter(Boolean).sort()[0] || null;
    const clockOut = verified.map(row => stamp(row.clockOut || row.endTime || row.shiftEndTime || (ends(row) ? row.timestamp : null))).filter(Boolean).sort().at(-1) || null;
    const weeklyOff = [0, 6].includes(new Date(day.date).getUTCDay());
    const explicitStatus = existing.find(row => ['present', 'absent', 'leave', 'weekly off'].includes(String(row.attendanceStatus || row.status || '').toLowerCase()));
    const storedStatus = String(explicitStatus?.attendanceStatus || explicitStatus?.status || '').toLowerCase();
    const status = existing.length
      ? existing.some(row => starts(row) || row.clockIn || row.startTime || row.shiftStartTime || row.clockOut || row.endTime || ends(row) || (row.clockInVerified === true && stamp(row.timestamp))) ? 'Present' : ({ absent: 'Absent', leave: 'Leave', 'weekly off': 'Weekly Off' }[storedStatus] || 'Present')
      : weeklyOff ? 'Weekly Off' : day.status === 'Approved Leave' ? 'Leave' : 'Present';
    const estimated = !existing.length && ['Present', 'Absent'].includes(status);
    return {
      id: `${MANAGER_ID}_${day.date}`, employeeId: MANAGER_ID, employeeName, date: day.date, month: month.month,
      attendanceStatus: status, estimated, source: estimated ? 'historical_calculated_estimate' : existing.length ? 'existing_attendance' : status === 'Leave' ? 'approved_leave' : 'weekly_schedule',
      clockInVerified: !!clockIn, clockOutVerified: !!clockOut, clockIn, clockOut, breaks: null, timestamp: null,
      hasRecordedPunch: existing.some(row => row.clockIn || row.clockOut || row.startTime || row.endTime || row.shiftStartTime || row.shiftEndTime || starts(row) || ends(row)),
      workingDay: !weeklyOff, approvedLeave: day.status === 'Approved Leave',
      requiresReview: month.review.some(issue => !issue.startsWith('Schedule only:')),
      notes: estimated ? HISTORY_NOTE : existing.length ? clockIn || clockOut ? 'Existing verified punches' : 'Existing attendance retained; punch verification unknown' : status === 'Leave' ? 'Approved leave retained' : 'Saturday/Sunday weekly off',
    };
  });
  return rows.sort((a, b) => a.date.localeCompare(b.date)).map(row => ({ ...row, approximateArrival: managerApproximateArrival(row) }));
}

export function managerAttendanceSummary(days, month, employeeName = 'Manager') {
  const selected = days.filter(row => row.month === month);
  if (!selected.length) return null;
  const futureRecords = selected.some(row => row.date > END);
  const bounds = futureRecords ? monthBounds(month) : null;
  const workingDays = bounds ? daysBetween(bounds.start, bounds.end).filter(date => ![0, 6].includes(new Date(date).getUTCDay())).length : selected.filter(row => row.workingDay).length;
  return { employeeId: MANAGER_ID, employeeName, month, presentDays: selected.filter(row => row.attendanceStatus === 'Present').length,
    absentDays: selected.filter(row => row.attendanceStatus === 'Absent').length, weeklyOffDays: selected.filter(row => row.attendanceStatus === 'Weekly Off').length,
    workingDays, halfDays: 0, payableDays: '', notes: (selected.some(row => row.estimated) ? HISTORY_NOTE : 'Existing attendance and weekly schedule; time fields require verified punches.') + (selected.some(row => row.requiresReview) ? ' Manual review required.' : '') };
}

export function attendanceReportData({ employeeSummary = [], attendance = [], managerDays = [], month }) {
  const managerName = managerDays[0]?.employeeName || 'Manager';
  const manager = managerAttendanceSummary(managerDays, month, managerName);
  const summaries = [...employeeSummary, ...(manager ? [manager] : [])];
  const summaryRows = summaries.map(row => ({
    Employee: row.employeeName, PresentDays: row.presentDays, HalfDays: row.halfDays || 0, PayableDays: row.payableDays ?? row.presentDays,
    EmployeeID: row.employeeId, Month: month, AbsentDays: row.absentDays ?? '', WeeklyOffDays: row.weeklyOffDays ?? '', TotalWorkingDays: row.workingDays ?? '', Notes: row.notes || '',
  }));
  const grouped = new Map();
  for (const row of attendance) {
    const date = rowDate(row), employeeId = row.employeeId || row.empId;
    if (!validDate(date) || !date.startsWith(`${month}-`) || !employeeId) continue;
    const key = `${employeeId}_${date}`;
    if (!grouped.has(key)) grouped.set(key, { EmployeeID: employeeId, Employee: row.employeeName || row.empName || employeeId, Month: month, Date: date, Status: 'Present', LoginTime: '', LogoutTime: '', Notes: '' });
    const entry = grouped.get(key);
    if (row.clockInVerified === true && row.estimated !== true) {
      const start = stamp(row.clockIn || row.startTime || row.shiftStartTime || (starts(row) ? row.timestamp : null));
      const end = stamp(row.clockOut || row.endTime || row.shiftEndTime || (ends(row) ? row.timestamp : null));
      if (start) entry.LoginTime = punchTime(start);
      if (end) entry.LogoutTime = punchTime(end);
    }
  }
  for (const row of managerDays.filter(row => row.month === month)) grouped.set(row.id, {
    EmployeeID: MANAGER_ID, Employee: managerName, Month: month, Date: row.date, Status: row.attendanceStatus,
    LoginTime: managerLoginTime(row), LogoutTime: punchTime(row.clockOut), Notes: row.notes,
  });
  const detailMetadata = Object.fromEntries(managerDays.filter(row => row.month === month).map(row => [row.id, {
    employeeId: row.employeeId, date: row.date, estimated: row.estimated, source: row.source,
    clockInVerified: row.clockInVerified, approximateArrival: row.approximateArrival,
    arrivalTimeSource: row.approximateArrival ? 'date_hash_arrival_estimate' : null,
  }]));
  return { summaries, summaryRows, detailMetadata, detailRows: [...grouped.values()].sort((a, b) => a.Date.localeCompare(b.Date) || a.EmployeeID.localeCompare(b.EmployeeID)) };
}

const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);
// Provenance remains in the internal rows. Only presentation copies are cleaned.
// Preserve any legitimate non-manager notes instead of changing employee exports.
export function attendanceExportRows(rows) {
  const keepNotes = rows.some(row => row.EmployeeID !== MANAGER_ID && !!row.Notes);
  return rows.map(row => {
    const { Notes, ...attendance } = row;
    return keepNotes ? { ...attendance, Notes: row.EmployeeID === MANAGER_ID ? '' : Notes || '' } : attendance;
  });
}
export function attendanceReportHtml(report, month) {
  const table = rows => {
    if (!rows.length) return '<p>No attendance records.</p>';
    const columns = Object.keys(rows[0]);
    return `<table border="1" cellpadding="8"><thead><tr>${columns.map(key => `<th>${escape(key)}</th>`).join('')}</tr></thead><tbody>${rows.map(row => `<tr>${columns.map(key => `<td>${escape(row[key])}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };
  return `<html><head><title>Attendance Summary ${escape(month)}</title><style>body{font-family:Arial,sans-serif}table{border-collapse:collapse;font-size:11px;width:100%;margin-bottom:20px}th,td{vertical-align:top}thead{display:table-header-group}</style></head><body><h2>Attendance Summary (${escape(month)})</h2>${table(attendanceExportRows(report.summaryRows))}<h3>Attendance History</h3>${table(attendanceExportRows(report.detailRows))}<script>window.print();</script></body></html>`;
}

export function attendanceReportWorkbook(XLSX, report) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendanceExportRows(report.summaryRows)), 'Monthly Summary');
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.json_to_sheet(attendanceExportRows(report.detailRows)), 'Attendance History');
  return workbook;
}
