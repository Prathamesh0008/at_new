import { MANAGER_EMPLOYEE_ID, MANAGER_JOINING_DATE, MANAGER_BACKFILL_END, assertManagerBackfillTarget } from './manager-attendance.mjs';
export const BACKFILL_SOURCE='admin_backfill_estimated';
export function backfillPreview({employeeId=MANAGER_EMPLOYEE_ID,holidays={},reviewedYears=[],attendance=[],leaves=[],existing=[]}) {
 assertManagerBackfillTarget(employeeId);
 const managerRecords = rows => rows.filter(row => !(row.employeeId || row.empId) || (row.employeeId || row.empId) === MANAGER_EMPLOYEE_ID);
 attendance=managerRecords(attendance); leaves=managerRecords(leaves); existing=managerRecords(existing);
 const rows=[];
 for(let day=new Date(`${MANAGER_JOINING_DATE}T00:00:00Z`);day<=new Date(`${MANAGER_BACKFILL_END}T00:00:00Z`);day.setUTCDate(day.getUTCDate()+1)) {
  const date=day.toISOString().slice(0,10), weekday=day.getUTCDay();
  let exclusion='';
  if(!weekday || weekday===6) exclusion='weekend';
  else if(holidays[date]) exclusion=`holiday: ${holidays[date]}`;
  else if(leaves.some(l=>['approved','approved_l2'].includes(String(l.status).toLowerCase()) && date>=String(l.fromDate || l.date).slice(0,10) && date<=String(l.toDate || l.fromDate || l.date).slice(0,10))) exclusion='approved_leave';
  else if(attendance.some(a=>String(a.date).slice(0,10)===date)) exclusion='existing_actual_attendance';
  else if(existing.some(a=>a.date===date)) exclusion='existing_estimate';
  else if(!reviewedYears.includes(Number(date.slice(0,4)))) exclusion='holiday_review_required';
  const minute=590+(Number(date.replaceAll('-',''))%31);
  rows.push({employeeId:MANAGER_EMPLOYEE_ID,date,exclusion,eligible:!exclusion,proposedAttendanceStatus:'Present (estimated; approval required)',clockInVerified:false,suggestedClockIn:`${String(Math.floor(minute/60)).padStart(2,'0')}:${String(minute%60).padStart(2,'0')}`,source:BACKFILL_SOURCE,clockOut:null});
 }
 return rows;
}
