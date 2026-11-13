import 'server-only';
import fs from 'node:fs';
import path from 'node:path';
import * as XLSX from 'xlsx';
// A compatibility mirror only. Firestore commit is authoritative. No reads or
// writes occur on import, and offline tests never invoke this filesystem writer.
export function mirrorEmployeeEvent(user, result, body, isBreak) {
  if (result.duplicate) return true;
  const file = path.join(process.cwd(), 'attendance_data.xlsx');
  const workbook = fs.existsSync(file) ? XLSX.readFile(file) : XLSX.utils.book_new();
  const sheet = isBreak ? 'Breaks' : 'Attendance';
  const rows = workbook.Sheets[sheet] ? XLSX.utils.sheet_to_json(workbook.Sheets[sheet]) : [];
  const state = result.state;
  const time = new Date(state.updatedAt).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit' });
  rows.push(isBreak ? {
    EmployeeID: user.id, EmployeeName: user.name, Date: result.date, BreakType: body.breakType,
    BreakStart: body.action === 'start' ? time : '', BreakEnd: body.action === 'end' ? time : '', BreakDuration: '', Status: body.action === 'start' ? 'Active' : 'Completed',
  } : {
    EmployeeID: user.id, EmployeeName: user.name, Date: result.date,
    LoginTime: body.action === 'clock-in' ? time : '', LogoutTime: body.action === 'clock-out' ? time : '',
    Status: body.action === 'clock-in' ? 'Present' : 'Completed', Shift: '10:00 AM - 7:00 PM', IsLate: body.action === 'clock-in' && new Date(state.startTime).toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour12: false }) > '10:00:00', BreakDuration: '00:00', NetHours: '',
  });
  if (!workbook.SheetNames.includes(sheet)) workbook.SheetNames.push(sheet);
  workbook.Sheets[sheet] = XLSX.utils.json_to_sheet(rows);
  XLSX.writeFile(workbook, file);
  return true;
}
