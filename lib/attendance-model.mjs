export const indiaDate = (date = new Date()) => new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Kolkata',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
export const BREAK_MINUTES = {Tea:15,Lunch:30,Evening:15,Breather:5};
export function transition(state, action, now, breakType) {
 const next = {...state, breaks: [...(state.breaks || [])]};
 const fail = message => { throw Object.assign(new Error(message),{status:409}); };
 const closeBreak = () => { const b=next.activeBreak; if(b) { next.breaks.push({...b,endTime:now,durationMinutes:(Date.parse(now)-Date.parse(b.startTime))/60000}); next.activeBreak=null; } };
 if(action==='clock-in') { if(state.startTime || state.legacyAttendance) fail('Attendance already exists; administrator reconciliation required'); next.startTime=now; next.status='Active'; }
 else if(action==='clock-out') { if(!state.startTime || state.endTime) fail('No active shift'); closeBreak(); next.endTime=now; next.status='Completed'; }
 else if(action==='start') { if(!state.startTime || state.endTime) fail('Start shift before break'); if(state.activeBreak) fail('End the active break first'); if(!BREAK_MINUTES[breakType]) fail('Invalid break type'); next.activeBreak={breakType,startTime:now}; }
 else if(action==='end') { if(!state.activeBreak || state.activeBreak.breakType!==breakType) fail('No matching active break'); closeBreak(); }
 else fail('Invalid action');
 next.totalBreakMinutes=(state.legacyBreakMinutes || 0)+next.breaks.reduce((sum,b)=>sum+b.durationMinutes,0);
 next.updatedAt=now;
 return next;
}
