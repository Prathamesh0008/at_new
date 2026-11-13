import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { transition, indiaDate } from '../lib/attendance-model.mjs';
import { BACKFILL_SOURCE, backfillPreview } from '../lib/backfill-model.mjs';
import { MANAGER_EMPLOYEE_ID, MANAGER_HOLIDAY_REVIEW_ID, assertManagerBackfillTarget, isAttendanceManager } from '../lib/manager-attendance.mjs';

test('manager identity, shift and all existing break types keep their validations', () => {
  assert.ok(isAttendanceManager({ id: 'NTS-MGR', role: 'manager' }));
  assert.equal(isAttendanceManager({ id: 'OTHER-ACCOUNT', role: 'manager' }), false);
  assert.equal(isAttendanceManager({ id: 'NTS-MGR', role: 'employee' }), false);
  assert.equal(indiaDate(new Date('2026-11-10T20:00:00Z')), '2026-11-11');
  let state = { employeeId: 'NTS-MGR', date: '2026-11-11', breaks: [] };
  assert.throws(() => transition(state, 'start', '2026-11-11T04:30:00Z', 'Tea'), /Start shift/);
  state = transition(state, 'clock-in', '2026-11-11T04:30:00Z');
  assert.throws(() => transition(state, 'clock-in', '2026-11-11T04:31:00Z'), /already exists/);
  for (const [index, type] of ['Tea', 'Lunch', 'Evening', 'Breather'].entries()) {
    const start = new Date(Date.parse('2026-11-11T05:00:00Z') + index * 3600000).toISOString();
    const end = new Date(Date.parse(start) + 5 * 60000).toISOString();
    state = transition(state, 'start', start, type);
    assert.throws(() => transition(state, 'start', start, type), /active break/);
    state = transition(state, 'end', end, type);
  }
  assert.equal(state.totalBreakMinutes, 20);
  state = transition(state, 'start', '2026-11-11T09:00:00Z', 'Tea');
  state = transition(state, 'clock-out', '2026-11-11T09:10:00Z');
  assert.equal(state.activeBreak, null);
  assert.equal(state.totalBreakMinutes, 30);
  assert.throws(() => transition(state, 'start', '2026-11-11T09:11:00Z', 'Tea'), /Start shift/);
});

test('manager preview is inclusive, deterministic, estimated and holiday-review gated', () => {
  const options = { reviewedYears: [2025, 2026], holidays: { '2025-10-20': 'Company holiday' }, attendance: [{ employeeId: 'NTS-MGR', date: '2025-10-13' }], leaves: [{ employeeId: 'NTS-MGR', status: 'approved', fromDate: '2025-10-14', toDate: '2025-10-15' }] };
  const rows = backfillPreview(options);
  assert.equal(rows.length, 398); assert.equal(rows[0].date, '2025-10-10'); assert.equal(rows.at(-1).date, '2026-11-11');
  assert.deepEqual(rows, backfillPreview(options));
  for (const row of rows.filter(row => row.eligible)) {
    assert.equal(row.employeeId, 'NTS-MGR'); assert.equal(row.source, BACKFILL_SOURCE); assert.equal(row.clockOut, null); assert.equal(row.clockInVerified, false);
    assert.ok(![0, 6].includes(new Date(row.date).getUTCDay()));
    const [hour, minute] = row.suggestedClockIn.split(':').map(Number); assert.ok(hour * 60 + minute >= 590 && hour * 60 + minute <= 620);
  }
  assert.equal(rows.find(row => row.date === '2025-10-20').exclusion, 'holiday: Company holiday');
  assert.equal(rows.find(row => row.date === '2025-10-13').exclusion, 'existing_actual_attendance');
  assert.equal(rows.find(row => row.date === '2025-10-14').exclusion, 'approved_leave');
  assert.equal(backfillPreview({}).filter(row => row.eligible).length, 0);
  assert.equal(backfillPreview({ ...options, existing: rows.filter(row => row.eligible) }).filter(row => row.eligible).length, 0);
  assert.throws(() => backfillPreview({ employeeId: 'OTHER-ACCOUNT' }), /restricted to NTS-MGR/);
});

// In-memory Firestore boundary only: the tests cannot contact a production database.
function fixture({ enabled = true } = {}) {
  const store = new Map([
    ['portal_settings/backfill_holidays', { holidays: { '2025-10-20': 'Company holiday' }, reviewedYears: [2025, 2026] }],
    ['attendance/manager-actual', { employeeId: 'NTS-MGR', date: '2025-10-13', action: 'clock-in', timestamp: '2025-10-13T04:30:00Z' }],
    ['leave_requests_v2/manager-leave', { employeeId: 'NTS-MGR', status: 'approved', fromDate: '2025-10-14', toDate: '2025-10-15' }],
    ['attendance/other-actual', { employeeId: 'OTHER-ACCOUNT', date: '2025-10-10', preserved: true }],
  ]);
  const original = structuredClone(store), writes = [], queries = [];
  let seq = 0, connections = 0;
  const snapshot = key => ({ id: key.split('/').at(-1), data: () => structuredClone(store.get(key)) });
  const commit = staged => {
    for (const [operation, key] of staged) if (operation === 'create' && store.has(key)) throw new Error('Duplicate create');
    for (const [operation, key, value] of staged) { store.set(key, structuredClone(value)); writes.push({ operation, key, value: structuredClone(value) }); }
  };
  const db = {
    collection(name) { return {
      doc(id = `fixture-${++seq}`) { const key = `${name}/${id}`; return { id, path: key, get: async () => snapshot(key), create: async value => commit([['create', key, value]]) }; },
      where(field, operator, target) { queries.push({ name, field, operator, target }); return { get: async () => ({ docs: [...store.keys()].filter(key => key.startsWith(`${name}/`) && store.get(key)[field] === target).map(snapshot) }) }; },
    }; },
    async runTransaction(callback) {
      const staged = [];
      const result = await callback({ get: ref => ref.get(), set: (ref, value) => staged.push(['set', ref.path, value]), create: (ref, value) => staged.push(['create', ref.path, value]) });
      commit(staged); return result;
    },
  };
  const source = readFileSync(new URL('../app/api/attendance/backfill/route.js', import.meta.url), 'utf8').replace(/^import .*;\r?\n/gm, '').replaceAll('export async function', 'async function');
  const deps = { createHash, indiaDate, requireUser: async (_request, admin) => { assert.equal(admin, true); return { id: 'AUTHORIZED-ADMIN' }; }, apiError: error => Response.json({ error: error.message }, { status: error.status || 503 }), serverDb: async () => { connections++; return db; }, HOLIDAY_MAP: {}, BACKFILL_SOURCE, backfillPreview, MANAGER_EMPLOYEE_ID, MANAGER_HOLIDAY_REVIEW_ID, assertManagerBackfillTarget, process: { env: { ENABLE_MANAGER_BACKFILL_APPLY: enabled ? 'true' : 'false' } } };
  const api = new Function(...Object.keys(deps), `${source}; return {GET,POST};`)(...Object.values(deps));
  const post = body => api.POST(new Request('http://localhost/api/attendance/backfill', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return { api, post, store, original, writes, queries, connections: () => connections };
}

test('admin preview/apply is manager-only, audited, non-destructive and resumable', async () => {
  const f = fixture();
  let response = await f.api.GET(new Request('http://localhost/api/attendance/backfill'));
  assert.equal(response.status, 200); assert.equal(f.writes.length, 0);
  assert.equal((await response.json()).rows.filter(row => row.eligible).length, 0); // shared review cannot approve manager dates
  assert.equal((await f.post({ mode: 'apply' })).status, 400);
  assert.equal((await f.post({ mode: 'dry-run', employeeId: 'OTHER-ACCOUNT' })).status, 403);
  const connections = f.connections();
  assert.equal((await f.api.GET(new Request('http://localhost/api/attendance/backfill?employeeId=OTHER-ACCOUNT'))).status, 403);
  assert.equal(f.connections(), connections);
  assert.equal((await f.post({ mode: 'holidays', holidays: {}, reviewedYears: [2025, 2026] })).status, 200);
  for (let batch = 0; batch < 4; batch++) {
    response = await f.post({ mode: 'dry-run' }); assert.equal(response.status, 200);
    const preview = await response.json();
    assert.ok(preview.previewId.startsWith('NTS-MGR_'));
    assert.equal(preview.rows.find(row => row.date === '2025-10-20').exclusion, 'holiday: Company holiday');
    response = await f.post({ mode: 'apply', previewId: preview.previewId, confirm: 'APPROVE ESTIMATED ATTENDANCE', reason: 'Authorized estimated history' });
    assert.equal(response.status, 200); const applied = await response.json();
    assert.ok(applied.applied <= 100);
    if (!applied.remaining) break;
  }
  const preview = await (await f.post({ mode: 'dry-run' })).json();
  assert.equal(preview.rows.filter(row => row.eligible).length, 0);
  for (const [key, value] of f.original) assert.deepEqual(f.store.get(key), value); // includes company config and actual attendance
  for (const write of f.writes) {
    assert.ok(write.key.split('/')[1].startsWith('NTS-MGR_'));
    assert.equal(write.value.employeeId, 'NTS-MGR');
    assert.ok(['attendanceBackfillPreviews', 'attendanceAudit', 'attendanceBackfills'].includes(write.key.split('/')[0]));
    if (write.key.startsWith('attendanceBackfills/')) {
      assert.equal(write.value.attendanceStatus, 'Present'); assert.equal(write.value.estimated, true); assert.equal(write.value.source, BACKFILL_SOURCE);
      assert.equal(write.value.clockIn, null); assert.equal(write.value.clockOut, null); assert.equal(write.value.breaks, null);
      assert.ok(write.value.operator && write.value.reason && write.value.approvedAt);
    }
  }
  assert.ok(f.queries.every(query => query.target === 'NTS-MGR' && query.operator === '=='));
});

test('manager apply remains disabled without server enablement and rejects stale previews', async () => {
  const f = fixture({ enabled: false });
  await f.post({ mode: 'holidays', holidays: {}, reviewedYears: [2025, 2026] });
  const preview = await (await f.post({ mode: 'dry-run' })).json();
  const prior = f.writes.length;
  assert.equal((await f.post({ mode: 'apply', previewId: preview.previewId, confirm: 'APPROVE ESTIMATED ATTENDANCE', reason: 'Test approval' })).status, 403);
  assert.equal(f.writes.length, prior);
  const enabled = fixture();
  await enabled.post({ mode: 'holidays', holidays: {}, reviewedYears: [2025, 2026] });
  const stale = await (await enabled.post({ mode: 'dry-run' })).json();
  enabled.store.set('attendance/new-manager-actual', { employeeId: 'NTS-MGR', date: '2025-10-10', action: 'clock-in' });
  assert.equal((await enabled.post({ mode: 'apply', previewId: stale.previewId, confirm: 'APPROVE ESTIMATED ATTENDANCE', reason: 'Test approval' })).status, 409);
  assert.equal([...enabled.store.keys()].filter(key => key.startsWith('attendanceBackfills/')).length, 0);
});
