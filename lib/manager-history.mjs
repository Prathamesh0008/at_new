import { validDate } from './manager-domain.mjs';
export const MANAGER_ID = 'NTS-MGR';
export const START = '2025-10-10';
export const END = '2026-11-13';
const owns = r => (r.employeeId || r.empId) === MANAGER_ID;
export function previewManagerHistory({attendance = [], leaves = [], reconciled = false} = {}) {
  const protectedDates = new Set(attendance.filter(owns).map(r => String(r.date || '').slice(0,10)));
  const approved = leaves.filter(r => owns(r) && String(r.status).toLowerCase() === 'approved');
  const months = new Map();
  for (let day = new Date(START + 'T00:00:00Z'); day.toISOString().slice(0,10) <= END; day.setUTCDate(day.getUTCDate()+1)) {
    const date = day.toISOString().slice(0,10), month = date.slice(0,7);
    if (!months.has(month)) months.set(month, {month, eligible:0, present:0, absentDates:[], weeklyOff:0, existing:0, leave:0, review:[], days:[]});
    const m = months.get(month), off = [0,6].includes(day.getUTCDay());
    const existing = protectedDates.has(date);
    const leave = approved.some(r => String(r.fromDateValue || r.fromDate).slice(0,10) <= date && date <= String(r.toDateValue || r.toDate).slice(0,10));
    if (!off) m.eligible++;
    if (off) m.weeklyOff++;
    if (existing) m.existing++;
    if (leave) m.leave++;
    if (existing && leave) m.review.push(date + ': attendance overlaps approved leave');
    m.days.push({date, status: existing ? 'Existing record (verification requires review)' : leave ? 'Approved Leave' : off ? 'Weekly Off' : 'Present (Estimated)', eligible: !off && !existing && !leave});
  }
  for (const m of months.values()) {
    m.present=m.days.filter(r=>r.status==='Present (Estimated)').length;
    if(!reconciled) m.review.push('Schedule only: database attendance and leave have not been reconciled');
    if([...protectedDates].some(date => !validDate(date))) m.review.push('Invalid or undated manager attendance requires review');
    if(approved.some(r=> !validDate(r.fromDateValue || r.fromDate) || !validDate(r.toDateValue || r.toDate) || (r.fromDateValue || r.fromDate) > (r.toDateValue || r.toDate))) m.review.push('Invalid leave dates require normalization and review');
  }
  return {employeeId:MANAGER_ID,start:START,end:END,reconciled,months:[...months.values()]};
}
// Offline record contract only. Never use a browser-supplied approval as authorization.
export function proposedRecords(preview, approval) {
  if(preview.employeeId!==MANAGER_ID || !approval?.trustedServerIdentity || approval.employeeId!==MANAGER_ID || approval.role!=='manager') throw Error('Trusted manager authorization required');
  if(!approval.reviewed || !approval.confirmed || !approval.approvedBy || !approval.approvedAt) throw Error('Review, approval and explicit confirmation required');
  if(!preview.reconciled || preview.months.some(m=>m.review.length)) throw Error('Reconciliation and conflict resolution required');
  return preview.months.flatMap(m=>m.days.filter(r=>r.eligible).map(r=>({id:MANAGER_ID+'_'+r.date,employeeId:MANAGER_ID,date:r.date,attendanceStatus:r.status==='Absent (Proposed)'?'Absent':'Present',estimated:true,source:'admin_approved_historical_estimate',clockInVerified:false,clockIn:null,clockOut:null,breaks:null,approvedBy:approval.approvedBy,approvedAt:approval.approvedAt,reason:'Manager historical attendance estimate'})));
}
