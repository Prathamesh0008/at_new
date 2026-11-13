import assert from 'node:assert/strict';
import {test} from 'node:test';
import {indiaDate,transition} from '../lib/attendance-model.mjs';
import {backfillPreview} from '../lib/backfill-model.mjs';
test('Kolkata date crosses UTC midnight correctly',()=>{assert.equal(indiaDate(new Date('2026-11-10T20:00:00Z')),'2026-11-11');});
test('manager and employee shared shift/break lifecycle, overlap and duplicates',()=>{
 for(const employeeId of ['NTS-MGR','NTS-002']) {
 let state={employeeId,date:'2026-11-11',breaks:[]};
 assert.throws(()=>transition(state,'start','2026-11-11T04:30:00Z','Tea'),/Start shift/);
 state=transition(state,'clock-in','2026-11-11T04:30:00Z');
 assert.throws(()=>transition(state,'clock-in','2026-11-11T04:31:00Z'),/already exists/);
 state=transition(state,'start','2026-11-11T05:30:00Z','Tea');
 assert.throws(()=>transition(state,'start','2026-11-11T05:31:00Z','Lunch'),/active break/);
 assert.throws(()=>transition(state,'end','2026-11-11T05:32:00Z','Lunch'),/matching/);
 state=transition(state,'end','2026-11-11T05:45:00Z','Tea');
 assert.equal(state.totalBreakMinutes,15);
 state=transition(state,'start','2026-11-11T06:00:00Z','Lunch');
 state=transition(state,'clock-out','2026-11-11T06:30:00Z');
 assert.equal(state.totalBreakMinutes,45);assert.equal(state.activeBreak,null);assert.equal(state.breaks.length,2);
 assert.throws(()=>transition(state,'clock-out','2026-11-11T06:31:00Z'),/No active shift/);
 assert.throws(()=>transition(state,'start','2026-11-11T06:31:00Z','Tea'),/Start shift/);
 }
});
test('backfill inclusive range, deterministic suggestions, weekends, holidays, leave, actual and idempotency',()=>{
 const options={reviewedYears:[2025,2026],holidays:{'2025-10-20':'Company holiday','2026-01-26':'Republic Day'},attendance:[{date:'2025-10-13'}],leaves:[{status:'approved',fromDate:'2025-10-14',toDate:'2025-10-15'}]};
 const rows=backfillPreview(options);assert.equal(rows[0].date,'2025-10-10');assert.equal(rows.at(-1).date,'2026-11-11');assert.equal(rows.length,398);assert.equal(rows.filter(r=>r.eligible).length,279);
 assert.deepEqual(rows,backfillPreview(options));
 for(const r of rows.filter(r=>r.eligible)) {assert.ok(![0,6].includes(new Date(r.date).getUTCDay()));const [h,m]=r.suggestedClockIn.split(':').map(Number);assert.ok(h*60+m>=590 && h*60+m<=620);assert.equal(r.clockOut,null);}
 assert.equal(rows.find(r=>r.date==='2025-10-20').exclusion,'holiday: Company holiday');assert.equal(rows.find(r=>r.date==='2025-10-14').exclusion,'approved_leave');assert.equal(rows.find(r=>r.date==='2025-10-13').exclusion,'existing_actual_attendance');
 assert.equal(backfillPreview({...options,existing:rows.filter(r=>r.eligible)}).filter(r=>r.eligible).length,0);
 assert.equal(backfillPreview({}).filter(r=>r.eligible).length,0);
});
