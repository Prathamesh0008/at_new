'use client';
import { useEffect, useState } from 'react';
import { readJson } from '@/utils/read-fetch.mjs';
import { startReadPolling, clientReadCoordinator } from '@/utils/read-control.mjs';
import { indiaDate } from '@/lib/attendance-model.mjs';
const time = value => value ? new Date(value).toLocaleTimeString('en-IN',{timeZone:'Asia/Kolkata'}) : '—';
export default function PersonalAttendance({user,revision,onState,historyRevision=0}) {
 const [data,setData]=useState(null),[error,setError]=useState(''),[month,setMonth]=useState(indiaDate().slice(0,7));
 useEffect(()=>{
  let alive=true;
  readJson('/api/attendance',user.id).then(d=>{if(alive){setData(d);setError('');onState(d.state);}}).catch(e=>{if(alive)setError(e.message);});
  return()=>{alive=false;};
 },[onState,user.id,historyRevision]);
 useEffect(()=>{
  let alive=true;
  const stop=startReadPolling(async()=>{
   const d=await readJson('/api/attendance?view=state',user.id);
   if(alive && d.state){
    onState(d.state);
    setData(previous=>previous?{...previous,state:d.state,attendanceDaily:[...previous.attendanceDaily.filter(row=>row.date!==d.state.date),d.state]}:previous);
   }
  },60000,{site:'personal-state',immediate:revision>0,blocked:clientReadCoordinator.isBlocked,onError:e=>{if(alive)setError(e.message);}});
  return()=>{alive=false;stop();};
 },[onState,user.id,revision]);

 if(!data)return <p role="status">{error || 'Loading personal attendance…'}</p>;
 const actual=new Map();
 data.attendanceDaily.forEach(r=>actual.set(r.date,{...r,startTime:r.startTime || r.shiftStartTime,endTime:r.endTime || r.shiftEndTime}));
 data.attendance.forEach(r=>{const date=r.date;if(!date)return;const prior=actual.get(date)||{date};const action=String(r.action).toLowerCase();const stamp=r.timestamp?._seconds ? new Date(r.timestamp._seconds*1000).toISOString() : r.timestamp || (r.time ? `${date}T${r.time}+05:30` : null);if(['clock-in','start','shift-start'].includes(action))prior.startTime=prior.startTime || stamp;if(['clock-out','end','shift-end'].includes(action))prior.endTime=stamp;actual.set(date,prior);});
 const estimates=new Map(data.attendanceBackfills.map(r=>[r.date,r]));
 const days=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
 const rows=Array.from({length:days},(_,i)=>{const date=`${month}-${String(i+1).padStart(2,'0')}`,r=actual.get(date),e=estimates.get(date),holiday=data.holidays?.[date],leave=data.leaves?.find(l=>['approved','approved_l2'].includes(l.status)&&date>=(l.fromDate||l.date)&&date<=(l.toDate||l.fromDate||l.date));const weekend=[0,6].includes(new Date(date+'T00:00:00Z').getUTCDay());return {date,clockIn:r?time(r.startTime):e?.suggestedClockIn || '—',clockOut:time(r?.endTime),status:r?'Actual attendance':e?'Estimated — admin approved':holiday?`Holiday: ${holiday}`:leave?'Approved leave':weekend?'Weekend':date<user.dateOfJoining?'Before joining':data.reviewedYears?.includes(Number(date.slice(0,4)))?'Working day — no record':'Holiday calendar unreviewed — no record',source:r?'live_or_legacy_actual':e?.source || '',operator:e?.operator || '',reason:e?.reason || '',approvedAt:e?.approvedAt || '',breakMinutes:r?.totalBreakMinutes ?? '',verified:e?false:''};});
 const exportRows=()=>{const blob=new Blob([JSON.stringify({employeeId:user.id,timezone:'Asia/Kolkata',month,days:rows,currentDayBreaks:data.state?.breaks || [],breaks:data.breaks.filter(b=>b.date?.startsWith(month)),estimates:data.attendanceBackfills.filter(b=>b.date?.startsWith(month))},null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`${user.id}-attendance-${month}.json`;a.click();URL.revokeObjectURL(url);};
 const today=indiaDate();
 return <section id="my-attendance-history" className="mt-5 space-y-3 rounded-xl border border-slate-500/30 p-4">
  <div className="flex flex-wrap items-center gap-3"><h3 className="font-semibold">My attendance history & calendar</h3><input aria-label="Attendance month" type="month" value={month} onChange={e=>setMonth(e.target.value)} className="rounded border p-2 dark:bg-slate-900"/><button type="button" onClick={exportRows} className="rounded border p-2">Export personal attendance & breaks</button></div>
  {error && <p role="alert">{error}</p>}
  <p className="text-sm">Today: {data.state?.date===today?data.state.status:'No shift recorded'} · Actual days: {rows.filter(r=>r.status==='Actual attendance').length} · Estimated days: {rows.filter(r=>r.source==='admin_backfill_estimated').length} · Holidays: {rows.filter(r=>r.status.startsWith('Holiday:')).length} · Leave: {rows.filter(r=>r.status==='Approved leave').length} · Reviewed working days without records: {rows.filter(r=>r.status.startsWith('Working day')).length}</p>
  <p className="text-sm">Completed breaks today: {data.state?.date===today?Number(data.state.totalBreakMinutes||0).toFixed(1):0} minutes. Estimates have no verified clock-in, clock-out, breaks or payable-day classification.</p>
  <div aria-label="Monthly attendance calendar" className="grid grid-cols-7 gap-1 text-center text-xs">
   {['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(day=><div key={day} className="p-1 font-semibold">{day}</div>)}
   {Array.from({length:new Date(`${month}-01T00:00:00Z`).getUTCDay()},(_,i)=><div key={`empty-${i}`}/>)}
   {rows.map(r=><div key={r.date} title={`${r.date}: ${r.status}${r.source ? ` ? ${r.source}` : ''}`} className={`rounded border border-slate-500/20 p-2 ${r.status==='Actual attendance'?'bg-emerald-500/15':r.source==='admin_backfill_estimated'?'bg-amber-500/20':r.status.startsWith('Holiday:')?'bg-blue-500/15':''}`}><span>{Number(r.date.slice(8))}</span><span className="block truncate text-[10px]">{r.status==='Actual attendance'?'Actual':r.source==='admin_backfill_estimated'?'Estimated':r.status.startsWith('Holiday:')?'Holiday':r.status==='Approved leave'?'Leave':r.status==='Weekend'?'Off':'?'}</span></div>)}
  </div>
  <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr>{['Date','Clock-in / suggestion','Clock-out','Status / provenance'].map(h=><th key={h} className="p-2">{h}</th>)}</tr></thead><tbody>{rows.map(r=><tr key={r.date} className="border-t border-slate-500/20"><td className="p-2">{r.date}</td><td className="p-2">{r.clockIn}</td><td className="p-2">{r.clockOut}</td><td className="p-2">{r.status}{r.source==='admin_backfill_estimated' && <p>{r.source} · {r.operator} · {r.reason} · {r.approvedAt}</p>}</td></tr>)}</tbody></table></div>
  <details><summary>Today’s break history</summary>{data.state?.date===today && data.state.breaks?.map((b,i)=><p key={i}>{b.breakType}: {time(b.startTime)} – {time(b.endTime)} ({b.durationMinutes.toFixed(1)} min)</p>)}{data.state?.activeBreak && <p>Active: {data.state.activeBreak.breakType} since {time(data.state.activeBreak.startTime)}</p>}</details>
 </section>;
}

