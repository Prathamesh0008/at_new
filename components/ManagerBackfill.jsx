'use client';
import { useRef, useState } from 'react';
import { MANAGER_EMPLOYEE_ID } from '@/lib/manager-attendance.mjs';

export default function ManagerBackfill({onApplied}) {
  const [data, setData] = useState(null);
  const [calendar, setCalendar] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [denied, setDenied] = useState(false);
  const inFlight = useRef(false);

  const invalidatePreview = () => setData(previous => previous ? { ...previous, previewId: null } : previous);
  const run = async body => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      const response = await fetch('/api/attendance/backfill', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, employeeId: MANAGER_EMPLOYEE_ID }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || 'Manager backfill unavailable');
      if (result.rows) setData(result); else invalidatePreview();
      if(body.mode==='apply' && result.applied>0)onApplied?.();
      setMessage(result.message || (result.rows ? 'Review the proposed estimated Present dates before approval.' : 'Manager holiday review saved. Generate a fresh preview.'));
    } catch (error) { setMessage(error.message); }
    finally { inFlight.current = false; setBusy(false); }
  };

  if (denied) return null;
  return <details className="mt-4 rounded-xl border border-slate-500/30 p-4">
    <summary>Administrator: NTS-MGR historical attendance (estimated)</summary>
    <p className="mt-2 text-sm">Only NTS-MGR, 10 October 2025 through 11 November 2026, Asia/Kolkata. Approval creates estimated Present records, never actual punches. No historical clock-outs or breaks are generated.</p>
    {data ? <>
      <label className="mt-3 block text-sm">Company holidays for manager backfill review (JSON)
        <textarea aria-label="Manager backfill holiday calendar" value={calendar} onChange={event => { setCalendar(event.target.value); setReviewed(false); invalidatePreview(); }} className="block h-48 w-full rounded border p-2 dark:bg-slate-900" />
      </label>
      <p className="text-xs">Existing company holidays remain excluded. Add missing 2025 and 2026 holidays here. Saving this review changes manager-only metadata; it does not change the company calendar or any employee record.</p>
      <label className="mt-2 block text-sm"><input type="checkbox" checked={reviewed} onChange={event => { setReviewed(event.target.checked); invalidatePreview(); }} /> I reviewed the complete 2025 and 2026 company holiday lists for this manager backfill.</label>
      <button type="button" disabled={busy} onClick={() => { try { run({ mode: 'holidays', holidays: JSON.parse(calendar), reviewedYears: reviewed ? [2025, 2026] : [] }); } catch { setMessage('Invalid holiday JSON'); } }} className="m-2 rounded border p-2 text-sm">Save manager holiday review</button>
      <p className="text-sm">Proposed estimated Present: {data.rows.filter(row => row.eligible).length} | Excluded: {data.rows.filter(row => !row.eligible).length}</p>
      <div className="max-h-64 overflow-auto"><table className="w-full text-left text-sm">
        <thead><tr><th className="p-2">Date (IST)</th><th className="p-2">Exclusion / proposal</th><th className="p-2">Suggested start (estimated)</th></tr></thead>
        <tbody>{data.rows.map(row => <tr key={row.date} className="border-t border-slate-500/20"><td className="p-2">{row.date}</td><td className="p-2">{row.exclusion || row.proposedAttendanceStatus}</td><td className="p-2">{row.eligible ? row.suggestedClockIn : '-'}</td></tr>)}</tbody>
      </table></div>
      <details><summary>Manager existing attendance, leave and prior estimates</summary><pre className="max-h-60 overflow-auto whitespace-pre-wrap text-xs">{JSON.stringify({ attendance: data.existingAttendance, leaves: data.leaveRecords, estimates: data.existingEstimates }, null, 2)}</pre></details>
      <input aria-label="Manager backfill reason" placeholder="Reason for manager estimated attendance" value={reason} onChange={event => setReason(event.target.value)} className="m-2 max-w-full rounded border p-2 text-sm dark:bg-slate-900" />
      <input aria-label="Explicit estimated attendance approval" placeholder="APPROVE ESTIMATED ATTENDANCE" value={confirm} onChange={event => setConfirm(event.target.value)} className="m-2 max-w-full rounded border p-2 text-sm dark:bg-slate-900" />
      <button type="button" disabled={busy || !data.previewId || !reason.trim() || confirm !== 'APPROVE ESTIMATED ATTENDANCE'} onClick={() => run({ mode: 'apply', reason, confirm, previewId: data.previewId })} className="m-2 rounded border p-2 text-sm">Approve manager estimated Present</button>
      <p className="text-xs">Up to 100 dates per approved batch. Generate a new preview to resume. Actual attendance, leave, salary and project records are never updated by this workflow.</p>
    </> : null}
    <button type="button" disabled={busy} onClick={() => run({ mode: 'dry-run' })} className="m-2 rounded border p-2 text-sm">Generate manager dry-run preview</button>
    <p role="status" className="text-sm">{message}</p>
  </details>;
}
